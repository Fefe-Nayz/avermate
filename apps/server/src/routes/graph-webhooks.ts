import { and, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { db } from "../db";
import { contentConnections, contentOauthStates } from "../db/schema";
import {
  enqueueOneDriveSubscriptionRenewal,
  enqueueOneDriveSync,
} from "../jobs/onedrive-sync";
import { open } from "../lib/crypto";
import { env } from "../lib/env";
import { newId } from "../lib/id";
import {
  createOneDriveSubscription,
  exchangeOneDriveAuthorizationCode,
  matchesOneDriveWebhookSecret,
  newOneDriveWebhookClientState,
  oneDriveOauthStateHash,
  oneDriveWebhookSecretHash,
  parseOneDriveCredentials,
  sealOneDriveCredentials,
} from "../lib/onedrive";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const MAX_NOTIFICATIONS = 1_000;

const notificationSchema = z
  .object({
    subscriptionId: z.string().min(1).max(1_024),
    clientState: z.string().min(1).max(1_024),
    subscriptionExpirationDateTime: z.string().max(128).optional(),
  })
  .passthrough();

const notificationCollectionSchema = z
  .object({ value: z.array(notificationSchema).max(MAX_NOTIFICATIONS) })
  .passthrough();

function callbackRedirect(status: "connected" | "error", reason?: string) {
  const url = new URL("/settings/integrations", env.CLIENT_URL);
  url.searchParams.set("onedrive", status);
  if (reason) url.searchParams.set("reason", reason);
  return url.toString();
}

function callbackErrorReason(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("expired") || message.includes("state")) return "state";
  if (message.includes("grant") || message.includes("authorization")) {
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
        eq(contentOauthStates.stateHash, oneDriveOauthStateHash(state)),
        eq(contentOauthStates.provider, "onedrive"),
      ),
    )
    .returning();
  if (!consumed || consumed.expiresAt.getTime() <= now.getTime()) {
    throw new Error("The OneDrive OAuth state is invalid or expired");
  }
  if (!consumed.sealedVerifier) {
    throw new Error("The OneDrive OAuth verifier is unavailable");
  }
  return { ...consumed, verifier: open(consumed.sealedVerifier) };
}

async function persistAuthorizedConnection(
  oauthState: Awaited<ReturnType<typeof consumeOauthState>>,
  authorized: Awaited<ReturnType<typeof exchangeOneDriveAuthorizationCode>>,
  connectedAt: Date,
) {
  const sealedCredentials = sealOneDriveCredentials(authorized.credentials);
  return db.transaction(async (transaction) => {
    const candidates = await transaction
      .select()
      .from(contentConnections)
      .where(
        and(
          eq(contentConnections.provider, "onedrive"),
          eq(contentConnections.userId, oauthState.userId),
          eq(contentConnections.yearId, oauthState.yearId),
        ),
      );
    const existing = candidates.find((candidate) => {
      try {
        const credentials = parseOneDriveCredentials(
          candidate.sealedCredentials,
        );
        return (
          credentials.accountId === authorized.credentials.accountId &&
          credentials.driveId === authorized.credentials.driveId
        );
      } catch {
        return false;
      }
    });
    if (existing) {
      const keepSubscription = Boolean(
        existing.subscriptionId &&
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
          ...(keepSubscription
            ? {}
            : {
                subscriptionId: null,
                subscriptionExpiresAt: null,
                webhookSecretHash: null,
              }),
          updatedAt: connectedAt,
        })
        .where(
          and(
            eq(contentConnections.id, existing.id),
            eq(contentConnections.userId, oauthState.userId),
          ),
        )
        .returning();
      if (!updated) {
        throw new Error("The OneDrive connection changed while reconnecting");
      }
      return updated;
    }

    const [created] = await transaction
      .insert(contentConnections)
      .values({
        id: newId("cconn"),
        provider: "onedrive",
        accountLabel: authorized.accountLabel,
        status: "connected",
        cursor: null,
        subscriptionId: null,
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
    if (!created) throw new Error("The OneDrive connection was not saved");
    return created;
  });
}

export interface GraphWebhookRouteDependencies {
  now?: () => Date;
  exchangeAuthorizationCode?: typeof exchangeOneDriveAuthorizationCode;
  createSubscription?: typeof createOneDriveSubscription;
  enqueueSubscriptionRenewal?: typeof enqueueOneDriveSubscriptionRenewal;
  enqueueSync?: typeof enqueueOneDriveSync;
}

export function createGraphWebhookRoutes(
  dependencies: GraphWebhookRouteDependencies = {},
) {
  const routes = new Hono();
  const now = dependencies.now ?? (() => new Date());
  const exchangeAuthorizationCode =
    dependencies.exchangeAuthorizationCode ?? exchangeOneDriveAuthorizationCode;
  const createSubscription =
    dependencies.createSubscription ?? createOneDriveSubscription;
  const enqueueSubscriptionRenewal =
    dependencies.enqueueSubscriptionRenewal ??
    enqueueOneDriveSubscriptionRenewal;
  const enqueueSync = dependencies.enqueueSync ?? enqueueOneDriveSync;

  routes.use(
    "/webhooks/graph",
    bodyLimit({
      maxSize: MAX_WEBHOOK_BODY_BYTES,
      onError: (context) => context.json({ error: "payload_too_large" }, 413),
    }),
  );

  routes.get("/connectors/onedrive/callback", async (context) => {
    const state = context.req.query("state")?.trim();
    if (!state || state.length > 4_096) {
      return context.redirect(callbackRedirect("error", "state"), 303);
    }
    try {
      // Delete-before-exchange is the replay fence. Even a provider-declined
      // callback consumes its exact state and cannot be replayed with a code.
      const oauthState = await consumeOauthState(state, now());
      const providerError = context.req.query("error");
      if (providerError) {
        return context.redirect(
          callbackRedirect("error", "authorization"),
          303,
        );
      }
      const code = context.req.query("code")?.trim();
      if (!code || code.length > 16 * 1024) {
        throw new Error("Microsoft did not return an authorization code");
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

      const clientState = newOneDriveWebhookClientState();
      try {
        if (
          connection.subscriptionId &&
          connection.webhookSecretHash &&
          connection.subscriptionExpiresAt &&
          connection.subscriptionExpiresAt.getTime() > connectedAt.getTime()
        ) {
          await enqueueSubscriptionRenewal(connection);
          return context.redirect(callbackRedirect("connected"), 303);
        }
        const subscription = await createSubscription(connection, clientState);
        if (subscription) {
          const [subscribed] = await db
            .update(contentConnections)
            .set({
              subscriptionId: subscription.id,
              subscriptionExpiresAt: subscription.expiresAt,
              webhookSecretHash: oneDriveWebhookSecretHash(clientState),
              updatedAt: now(),
            })
            .where(
              and(
                eq(contentConnections.id, connection.id),
                eq(contentConnections.userId, connection.userId),
              ),
            )
            .returning();
          if (!subscribed) {
            throw new Error("The OneDrive subscription was not saved");
          }
          await enqueueSubscriptionRenewal(subscribed);
        }
      } catch (error) {
        // The OAuth connection remains useful for browse/manual sync. Surface
        // automatic-update failure without exposing Graph payloads or tokens.
        await db
          .update(contentConnections)
          .set({
            status: "error",
            lastError:
              "OneDrive connected, but automatic update subscription failed",
            updatedAt: now(),
          })
          .where(eq(contentConnections.id, connection.id));
        console.error(
          "[onedrive] change-notification subscription failed",
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

  routes.post("/webhooks/graph", async (context) => {
    const validationToken = context.req.query("validationToken");
    if (validationToken !== undefined) {
      if (validationToken.length === 0 || validationToken.length > 4_096) {
        return context.text("Invalid validation token", 400);
      }
      // Graph requires the URL-decoded opaque token byte-for-byte as plain text.
      context.header("Content-Type", "text/plain; charset=utf-8");
      return context.body(validationToken, 200);
    }

    const declaredLength = Number(context.req.header("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_WEBHOOK_BODY_BYTES
    ) {
      return context.json({ error: "payload_too_large" }, 413);
    }
    const body = await context.req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_WEBHOOK_BODY_BYTES) {
      return context.json({ error: "payload_too_large" }, 413);
    }
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return context.json({ error: "invalid_notification" }, 400);
    }
    const parsed = notificationCollectionSchema.safeParse(value);
    if (!parsed.success) {
      return context.json({ error: "invalid_notification" }, 400);
    }
    const subscriptionIds = [
      ...new Set(parsed.data.value.map((entry) => entry.subscriptionId)),
    ];
    if (subscriptionIds.length === 0) return context.body(null, 202);
    const connections = await db
      .select()
      .from(contentConnections)
      .where(
        and(
          eq(contentConnections.provider, "onedrive"),
          inArray(contentConnections.subscriptionId, subscriptionIds),
        ),
      );
    const bySubscription = new Map(
      connections
        .filter(
          (connection) =>
            connection.subscriptionId && connection.webhookSecretHash,
        )
        .map((connection) => [connection.subscriptionId!, connection]),
    );
    const validConnectionIds = new Set<string>();
    for (const notification of parsed.data.value) {
      const connection = bySubscription.get(notification.subscriptionId);
      if (
        !connection?.webhookSecretHash ||
        !matchesOneDriveWebhookSecret(
          notification.clientState,
          connection.webhookSecretHash,
        )
      ) {
        continue;
      }
      validConnectionIds.add(connection.id);
    }
    try {
      await Promise.all(
        [...validConnectionIds].map((connectionId) => {
          const connection = connections.find(
            (row) => row.id === connectionId,
          )!;
          return enqueueSync(connection.userId, connection.id);
        }),
      );
    } catch {
      // A valid notification that did not reach the durable queue must be
      // retried by Graph; never acknowledge work held only in process memory.
      return context.json({ error: "queue_unavailable" }, 503);
    }
    // Unknown subscriptions and invalid clientState values are deliberately
    // acknowledged but ignored so the endpoint does not become an oracle.
    return context.body(null, 202);
  });

  return routes;
}

export const graphWebhookRoutes = createGraphWebhookRoutes();
