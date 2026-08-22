import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  contentConnections,
  contentOauthStates,
  materialDocuments,
  materialFolders,
} from "../db/schema";
import {
  enqueueGoogleDriveSync,
  retireGoogleDriveConnectionMaterials,
} from "../jobs/googledrive-sync";
import {
  enqueueOneDriveSync,
  retireOneDriveConnectionMaterials,
} from "../jobs/onedrive-sync";
import { seal } from "../lib/crypto";
import {
  browseGoogleDrive,
  createGoogleDriveAuthorization,
  deleteGoogleDriveChannel,
  googleDriveConfigured,
  googleDriveOauthStateHash,
  normalizeGoogleDriveFolderScope,
} from "../lib/googledrive";
import {
  browseOneDrive,
  createOneDriveAuthorization,
  deleteOneDriveSubscription,
  normalizeOneDriveFolderScope,
  oneDriveConfigured,
  oneDriveOauthStateHash,
} from "../lib/onedrive";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireYear } from "../lib/ownership";
import { reserveDurableRateLimit } from "../lib/rate-limit";

const connectionInput = z.object({ connectionId: z.string().min(1) });

function publicConnection(row: typeof contentConnections.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider,
    accountLabel: row.accountLabel,
    status: row.status,
    subscriptionExpiresAt: row.subscriptionExpiresAt,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    scopeJson: row.scopeJson,
    yearId: row.yearId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireContentConnection(userId: string, connectionId: string) {
  const [connection] = await db
    .select()
    .from(contentConnections)
    .where(
      and(
        eq(contentConnections.id, connectionId),
        eq(contentConnections.userId, userId),
      ),
    )
    .limit(1);
  if (!connection) badRequest("The content connection is unavailable");
  return connection;
}

function connectorInputError(error: unknown): never {
  badRequest(
    error instanceof Error
      ? error.message
      : "The content connection request failed",
  );
}

export const connectorsRouter = {
  list: protectedProcedure
    .input(z.object({ yearId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      const rows = await db
        .select()
        .from(contentConnections)
        .where(
          and(
            eq(contentConnections.userId, userId),
            eq(contentConnections.yearId, input.yearId),
          ),
        )
        .orderBy(desc(contentConnections.createdAt));
      return rows.map(publicConnection);
    }),

  oauthUrl: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["moodle", "onedrive", "googledrive"]),
        yearId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      if (input.provider !== "onedrive" && input.provider !== "googledrive") {
        badRequest("This provider does not support OAuth connection");
      }
      const configured =
        input.provider === "onedrive"
          ? oneDriveConfigured()
          : googleDriveConfigured();
      if (!configured) {
        badRequest(
          `The ${input.provider === "onedrive" ? "OneDrive" : "Google Drive"} connector is not configured on this server`,
        );
      }
      await reserveDurableRateLimit({
        subject: `${userId}:${input.provider}`,
        action: "connectors.oauthUrl",
        limit: 10,
        windowMs: 10 * 60_000,
      });
      const now = new Date();
      await db
        .delete(contentOauthStates)
        .where(lt(contentOauthStates.expiresAt, now));
      const authorization =
        input.provider === "onedrive"
          ? createOneDriveAuthorization()
          : createGoogleDriveAuthorization();
      await db.insert(contentOauthStates).values({
        stateHash:
          input.provider === "onedrive"
            ? oneDriveOauthStateHash(authorization.state)
            : googleDriveOauthStateHash(authorization.state),
        provider: input.provider,
        sealedVerifier: seal(authorization.verifier),
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        yearId: input.yearId,
        userId,
        createdAt: now,
      });
      return { url: authorization.url, state: authorization.state };
    }),

  disconnect: protectedProcedure
    .input(connectionInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const connection = await requireContentConnection(
        userId,
        input.connectionId,
      );
      if (connection.provider === "onedrive") {
        // Disconnect must remain possible after consent was revoked. A stale
        // Graph subscription expires by itself and its now-unknown clientState
        // is ignored by the webhook route.
        await deleteOneDriveSubscription(connection).catch(() => undefined);
        await retireOneDriveConnectionMaterials(connection);
      } else if (connection.provider === "googledrive") {
        if (connection.subscriptionId && connection.subscriptionResourceId) {
          await deleteGoogleDriveChannel(connection, {
            id: connection.subscriptionId,
            resourceId: connection.subscriptionResourceId,
          }).catch(() => undefined);
        }
        await retireGoogleDriveConnectionMaterials(connection);
      }
      await db.transaction(async (transaction) => {
        // The deployed SQLite migration uses NO ACTION for these added FKs.
        // Detach explicitly before deleting the credential-bearing connection.
        await transaction
          .update(materialDocuments)
          .set({ connectionId: null, updatedAt: new Date() })
          .where(
            and(
              eq(materialDocuments.connectionId, connection.id),
              eq(materialDocuments.userId, userId),
            ),
          );
        await transaction
          .update(materialFolders)
          .set({ connectionId: null, updatedAt: new Date() })
          .where(
            and(
              eq(materialFolders.connectionId, connection.id),
              eq(materialFolders.userId, userId),
            ),
          );
        await transaction
          .delete(contentConnections)
          .where(
            and(
              eq(contentConnections.id, connection.id),
              eq(contentConnections.userId, userId),
            ),
          );
      });
      return { ok: true as const };
    }),

  browse: protectedProcedure
    .input(
      connectionInput.extend({
        remoteFolderId: z.string().trim().min(1).max(1_024).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const connection = await requireContentConnection(
        userId,
        input.connectionId,
      );
      if (
        connection.provider !== "onedrive" &&
        connection.provider !== "googledrive"
      ) {
        badRequest("Browsing is only available for drive connections");
      }
      await reserveDurableRateLimit({
        subject: `${userId}:${connection.id}`,
        action: "connectors.browse",
        limit: 120,
        windowMs: 10 * 60_000,
      });
      try {
        return connection.provider === "onedrive"
          ? await browseOneDrive(connection, input.remoteFolderId)
          : await browseGoogleDrive(connection, input.remoteFolderId);
      } catch (error) {
        connectorInputError(error);
      }
    }),

  setScope: protectedProcedure
    .input(
      connectionInput.extend({
        folderIds: z.array(z.string().trim().min(1).max(1_024)).max(50),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const connection = await requireContentConnection(
        userId,
        input.connectionId,
      );
      if (
        connection.provider !== "onedrive" &&
        connection.provider !== "googledrive"
      ) {
        badRequest("Folder scope is only available for drive connections");
      }
      await reserveDurableRateLimit({
        subject: `${userId}:${connection.id}`,
        action: "connectors.setScope",
        limit: 20,
        windowMs: 10 * 60_000,
      });
      let folderIds: string[];
      try {
        // Validate every opaque id and collapse ancestor+descendant choices to
        // an antichain, preventing the same subtree from being selected twice.
        folderIds =
          connection.provider === "onedrive"
            ? await normalizeOneDriveFolderScope(connection, input.folderIds)
            : await normalizeGoogleDriveFolderScope(
                connection,
                input.folderIds,
              );
      } catch (error) {
        connectorInputError(error);
      }
      const [updated] = await db
        .update(contentConnections)
        .set({
          scopeJson: { folderIds },
          cursor: null,
          syncRevision: sql`${contentConnections.syncRevision} + 1`,
          status: "connected",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(contentConnections.id, connection.id),
            eq(contentConnections.userId, userId),
            eq(contentConnections.provider, connection.provider),
            eq(contentConnections.syncRevision, connection.syncRevision),
          ),
        )
        .returning();
      if (!updated) badRequest("The content connection changed before saving");
      // A scope change is itself a durable synchronization request. Each
      // provider coalesces it behind an already-active pass.
      if (connection.provider === "onedrive") {
        await enqueueOneDriveSync(userId, connection.id);
      } else {
        await enqueueGoogleDriveSync(userId, connection.id);
      }
      return publicConnection(updated);
    }),

  syncNow: protectedProcedure
    .input(connectionInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const connection = await requireContentConnection(
        userId,
        input.connectionId,
      );
      if (
        connection.provider !== "onedrive" &&
        connection.provider !== "googledrive"
      ) {
        badRequest("Manual synchronization is unavailable for this provider");
      }
      await reserveDurableRateLimit({
        subject: `${userId}:${connection.id}`,
        action: "connectors.syncNow",
        limit: 12,
        windowMs: 10 * 60_000,
      });
      const job =
        connection.provider === "onedrive"
          ? await enqueueOneDriveSync(userId, connection.id)
          : await enqueueGoogleDriveSync(userId, connection.id);
      return { jobId: job.id };
    }),
};
