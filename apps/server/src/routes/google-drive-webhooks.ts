import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { db } from "../db";
import { contentConnections, contentOauthStates } from "../db/schema";
import {
  enqueueGoogleDriveChannelRenewal,
  enqueueGoogleDriveSync,
} from "../jobs/googledrive-sync";
import { open } from "../lib/crypto";
import { env } from "../lib/env";
import { newId } from "../lib/id";
import {
  createGoogleDriveChannel,
  deleteGoogleDriveChannel,
  exchangeGoogleDriveAuthorizationCode,
  getGoogleDriveStartPageToken,
  googleDriveOauthStateHash,
  googleDriveWebhookTokenHash,
  matchesGoogleDriveWebhookToken,
  newGoogleDriveWebhookToken,
  parseGoogleDriveCredentials,
  sealGoogleDriveCredentials,
  type GoogleDriveAuthorization,
} from "../lib/googledrive";

const MAX_WEBHOOK_BODY_BYTES = 4 * 1024;
const MAX_HEADER_LENGTH = 4_096;

function callbackRedirect(status: "connected" | "error", reason?: string) {
  const url = new URL("/settings/integrations", env.CLIENT_URL);
  url.searchParams.set("googledrive", status);
  if (reason) url.searchParams.set("reason", reason);
  return url.toString();
}

function callbackErrorReason(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("expired") || message.includes("state")) return "state";
  if (
    message.includes("grant") ||
    message.includes("authorization") ||
    message.includes("refresh")
  ) {
    return "authorization";
  }
  if (message.includes("configured")) return "disabled";
  return "provider";
}

async function consumeOauthState(state: string, now: Date) {
  const [consumed] = await db
    .delete(contentOauthStates)
    .where(
      and(
        eq(contentOauthStates.stateHash, googleDriveOauthStateHash(state)),
        eq(contentOauthStates.provider, "googledrive"),
      ),
    )
    .returning();
  if (!consumed || consumed.expiresAt.getTime() <= now.getTime()) {
    throw new Error("The Google Drive OAuth state is invalid or expired");
  }
  if (!consumed.sealedVerifier) {
    throw new Error("The Google Drive OAuth verifier is unavailable");
  }
  return { ...consumed, verifier: open(consumed.sealedVerifier) };
}

async function persistAuthorizedConnection(
  oauthState: Awaited<ReturnType<typeof consumeOauthState>>,
  authorized: GoogleDriveAuthorization,
  connectedAt: Date,
) {
  return db.transaction(async (transaction) => {
    const candidates = await transaction
      .select()
      .from(contentConnections)
      .where(
        and(
          eq(contentConnections.provider, "googledrive"),
          eq(contentConnections.userId, oauthState.userId),
          eq(contentConnections.yearId, oauthState.yearId),
        ),
      );
    const existing = candidates.find((candidate) => {
      try {
        return (
          parseGoogleDriveCredentials(candidate.sealedCredentials).accountId ===
          authorized.credentials.accountId
        );
      } catch {
        return false;
      }
    });
    const existingCredentials = existing
      ? parseGoogleDriveCredentials(existing.sealedCredentials)
      : null;
    const refreshToken =
      authorized.credentials.refreshToken ?? existingCredentials?.refreshToken;
    if (!refreshToken) {
      throw new Error(
        "Google did not issue offline Drive access; reconnect and grant file access",
      );
    }
    const sealedCredentials = sealGoogleDriveCredentials({
      ...authorized.credentials,
      refreshToken,
    });

    if (existing) {
      const keepChannel = Boolean(
        existing.subscriptionId &&
        existing.subscriptionResourceId &&
        existing.webhookSecretHash &&
        existing.subscriptionExpiresAt &&
        existing.subscriptionExpiresAt.getTime() > connectedAt.getTime(),
      );
      const [updated] = await transaction
        .update(contentConnections)
        .set({
          accountLabel: authorized.accountLabel,
          status: "connected",
          sealedCredentials,
          lastError: null,
          syncRevision: sql`${contentConnections.syncRevision} + 1`,
          ...(keepChannel
            ? {}
            : {
                subscriptionId: null,
                subscriptionResourceId: null,
                subscriptionExpiresAt: null,
                webhookSecretHash: null,
              }),
          updatedAt: connectedAt,
        })
        .where(
          and(
            eq(contentConnections.id, existing.id),
            eq(contentConnections.userId, oauthState.userId),
            eq(contentConnections.provider, "googledrive"),
            eq(
              contentConnections.sealedCredentials,
              existing.sealedCredentials,
            ),
          ),
        )
        .returning();
      if (!updated) {
        throw new Error(
          "The Google Drive connection changed while reconnecting",
        );
      }
      return updated;
    }

    const [created] = await transaction
      .insert(contentConnections)
      .values({
        id: newId("cconn"),
        provider: "googledrive",
        accountLabel: authorized.accountLabel,
        status: "connected",
        cursor: null,
        subscriptionId: null,
        subscriptionResourceId: null,
        subscriptionExpiresAt: null,
        lastSyncedAt: null,
        lastError: null,
        scopeJson: { folderIds: [] },
        sealedCredentials,
        webhookSecretHash: null,
        yearId: oauthState.yearId,
        userId: oauthState.userId,
        createdAt: connectedAt,
        updatedAt: connectedAt,
      })
      .returning();
    if (!created) throw new Error("The Google Drive connection was not saved");
    return created;
  });
}

export interface GoogleDriveWebhookRouteDependencies {
  now?: () => Date;
  exchangeAuthorizationCode?: typeof exchangeGoogleDriveAuthorizationCode;
  getStartPageToken?: typeof getGoogleDriveStartPageToken;
  createChannel?: typeof createGoogleDriveChannel;
  deleteChannel?: typeof deleteGoogleDriveChannel;
  enqueueChannelRenewal?: typeof enqueueGoogleDriveChannelRenewal;
  enqueueSync?: typeof enqueueGoogleDriveSync;
}

export function createGoogleDriveWebhookRoutes(
  dependencies: GoogleDriveWebhookRouteDependencies = {},
) {
  const routes = new Hono();
  const now = dependencies.now ?? (() => new Date());
  const exchangeAuthorizationCode =
    dependencies.exchangeAuthorizationCode ??
    exchangeGoogleDriveAuthorizationCode;
  const getStartPageToken =
    dependencies.getStartPageToken ?? getGoogleDriveStartPageToken;
  const createChannel = dependencies.createChannel ?? createGoogleDriveChannel;
  const deleteChannel = dependencies.deleteChannel ?? deleteGoogleDriveChannel;
  const enqueueChannelRenewal =
    dependencies.enqueueChannelRenewal ?? enqueueGoogleDriveChannelRenewal;
  const enqueueSync = dependencies.enqueueSync ?? enqueueGoogleDriveSync;

  routes.use(
    "/webhooks/google-drive",
    bodyLimit({
      maxSize: MAX_WEBHOOK_BODY_BYTES,
      onError: (context) => context.json({ error: "payload_too_large" }, 413),
    }),
  );

  routes.get("/connectors/googledrive/callback", async (context) => {
    const state = context.req.query("state")?.trim();
    if (!state || state.length > MAX_HEADER_LENGTH) {
      return context.redirect(callbackRedirect("error", "state"), 303);
    }
    try {
      // Delete-before-exchange is the one-use/replay fence.
      const oauthState = await consumeOauthState(state, now());
      if (context.req.query("error")) {
        return context.redirect(
          callbackRedirect("error", "authorization"),
          303,
        );
      }
      const code = context.req.query("code")?.trim();
      if (!code || code.length > 16 * 1024) {
        throw new Error("Google did not return an authorization code");
      }
      const authorized = await exchangeAuthorizationCode(
        code,
        oauthState.verifier,
      );
      const connectedAt = now();
      const connection = await persistAuthorizedConnection(
        oauthState,
        authorized,
        connectedAt,
      );

      try {
        if (
          connection.subscriptionId &&
          connection.subscriptionResourceId &&
          connection.webhookSecretHash &&
          connection.subscriptionExpiresAt &&
          connection.subscriptionExpiresAt.getTime() > connectedAt.getTime()
        ) {
          await enqueueChannelRenewal(connection);
          return context.redirect(callbackRedirect("connected"), 303);
        }
        const pageToken = await getStartPageToken(connection);
        const webhookToken = newGoogleDriveWebhookToken();
        const channel = await createChannel(
          connection,
          pageToken,
          webhookToken,
        );
        if (channel) {
          const [subscribed] = await db
            .update(contentConnections)
            .set({
              subscriptionId: channel.id,
              subscriptionResourceId: channel.resourceId,
              subscriptionExpiresAt: channel.expiresAt,
              webhookSecretHash: googleDriveWebhookTokenHash(webhookToken),
              updatedAt: now(),
            })
            .where(
              and(
                eq(contentConnections.id, connection.id),
                eq(contentConnections.userId, connection.userId),
                eq(contentConnections.provider, "googledrive"),
                isNull(contentConnections.subscriptionId),
                isNull(contentConnections.subscriptionResourceId),
              ),
            )
            .returning();
          if (!subscribed) {
            await deleteChannel(connection, {
              id: channel.id,
              resourceId: channel.resourceId,
            }).catch(() => undefined);
            throw new Error("The Google Drive channel was not saved");
          }
          await enqueueChannelRenewal(subscribed);
        }
      } catch (error) {
        // Browse and manual sync remain available without a public webhook.
        await db
          .update(contentConnections)
          .set({
            status: "error",
            lastError:
              "Google Drive connected, but automatic update channel failed",
            updatedAt: now(),
          })
          .where(
            and(
              eq(contentConnections.id, connection.id),
              eq(contentConnections.userId, connection.userId),
              eq(contentConnections.provider, "googledrive"),
              eq(
                contentConnections.sealedCredentials,
                connection.sealedCredentials,
              ),
              isNull(contentConnections.subscriptionId),
              isNull(contentConnections.subscriptionResourceId),
            ),
          );
        console.error(
          "[googledrive] change-notification channel failed",
          error instanceof Error ? error.message : "unknown error",
        );
      }
      return context.redirect(callbackRedirect("connected"), 303);
    } catch (error) {
      return context.redirect(
        callbackRedirect("error", callbackErrorReason(error)),
        303,
      );
    }
  });

  routes.post("/webhooks/google-drive", async (context) => {
    const declaredLength = Number(context.req.header("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_WEBHOOK_BODY_BYTES
    ) {
      return context.json({ error: "payload_too_large" }, 413);
    }
    const body = await context.req.arrayBuffer();
    if (body.byteLength > MAX_WEBHOOK_BODY_BYTES) {
      return context.json({ error: "payload_too_large" }, 413);
    }

    const channelId = context.req.header("x-goog-channel-id")?.trim();
    const channelToken = context.req.header("x-goog-channel-token")?.trim();
    const resourceId = context.req.header("x-goog-resource-id")?.trim();
    const resourceState = context.req.header("x-goog-resource-state")?.trim();
    const messageNumber = context.req.header("x-goog-message-number")?.trim();
    if (
      !channelId ||
      !channelToken ||
      !resourceId ||
      !resourceState ||
      !messageNumber ||
      [channelId, channelToken, resourceId, resourceState, messageNumber].some(
        (value) => value.length > MAX_HEADER_LENGTH,
      )
    ) {
      // Unknown/spoofed traffic is acknowledged without becoming an oracle.
      return context.body(null, 204);
    }

    const [connection] = await db
      .select()
      .from(contentConnections)
      .where(
        and(
          eq(contentConnections.provider, "googledrive"),
          eq(contentConnections.subscriptionId, channelId),
        ),
      )
      .limit(1);
    if (
      !connection?.webhookSecretHash ||
      connection.subscriptionResourceId !== resourceId ||
      !matchesGoogleDriveWebhookToken(
        channelToken,
        connection.webhookSecretHash,
      )
    ) {
      return context.body(null, 204);
    }

    // `sync` may arrive before the watch response itself. It is harmless to
    // enqueue: generation coalescing makes duplicate/overlapping channels cheap.
    if (resourceState !== "sync" && resourceState !== "change") {
      return context.body(null, 204);
    }
    try {
      await enqueueSync(connection.userId, connection.id);
    } catch {
      // Do not acknowledge durable work that never reached the queue.
      return context.json({ error: "queue_unavailable" }, 503);
    }
    return context.body(null, 204);
  });

  return routes;
}

export const googleDriveWebhookRoutes = createGoogleDriveWebhookRoutes();
