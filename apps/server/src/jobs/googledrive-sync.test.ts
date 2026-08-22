import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderFetch, ProviderLookup } from "../sync/provider-network";

const testDirectory = mkdtempSync(join(tmpdir(), "avermate-google-sync-"));
const databasePath = join(testDirectory, "google-drive.db").replaceAll(
  "\\",
  "/",
);
process.env.DATABASE_URL = `file:${databasePath}`;
process.env.BETTER_AUTH_URL = "http://localhost:5000";
process.env.BETTER_AUTH_SECRET =
  "google-sync-test-secret-that-is-at-least-32-characters";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.DISABLE_JOBS = "true";
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_UPLOAD_DIR = join(testDirectory, "uploads");
process.env.GOOGLE_DRIVE_CLIENT_ID = "google-drive-client";
process.env.GOOGLE_DRIVE_CLIENT_SECRET = "google-drive-secret";
process.env.GOOGLE_DRIVE_WEBHOOK_URL =
  "https://api.example.test/api/webhooks/google-drive";

const { db, schema } = await import("../db");
const { registerSharedTestDatabaseLifecycle } =
  await import("../testing/database-lifecycle");
const { sealGoogleDriveCredentials } = await import("../lib/googledrive");
const {
  GOOGLE_DRIVE_CHANNEL_RENEW_JOB_KIND,
  runGoogleDriveChannelRenewalJob,
  runGoogleDriveSyncJob,
} = await import("./googledrive-sync");

const userId = "google-sync-user";
const yearId = "google-sync-year";
const now = new Date("2026-08-21T15:00:00.000Z");
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

const publicLookup: ProviderLookup = async () => [
  { address: "8.8.8.8", family: 4 },
];

function credentials(suffix: string) {
  return sealGoogleDriveCredentials({
    version: 1,
    accessToken: `${suffix}-access-token`,
    accessTokenExpiresAt: new Date("2040-01-01T00:00:00.000Z").getTime(),
    refreshToken: `${suffix}-refresh-token`,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    accountId: `${suffix}-account`,
  });
}

async function insertConnection(input: {
  id: string;
  scope?: string[];
  cursor?: string | null;
  subscriptionId?: string | null;
  subscriptionResourceId?: string | null;
  subscriptionExpiresAt?: Date | null;
}) {
  const [connection] = await db
    .insert(schema.contentConnections)
    .values({
      id: input.id,
      provider: "googledrive",
      accountLabel: `${input.id}@example.test`,
      status: "connected",
      cursor: input.cursor ?? null,
      subscriptionId: input.subscriptionId ?? null,
      subscriptionResourceId: input.subscriptionResourceId ?? null,
      subscriptionExpiresAt: input.subscriptionExpiresAt ?? null,
      scopeJson: { folderIds: input.scope ?? [] },
      sealedCredentials: credentials(input.id),
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return connection!;
}

beforeAll(async () => {
  registerSharedTestDatabaseLifecycle(db.$client, {
    directories: [testDirectory],
  });
  const migrationDirectory = join(import.meta.dir, "../../drizzle");
  const migration = readdirSync(migrationDirectory)
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
    .join("\n");
  await db.$client.executeMultiple(migration);
  await db.insert(schema.users).values({
    id: userId,
    name: "Google sync test",
    email: "google-sync@example.test",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.years).values({
    id: yearId,
    name: "2026-2027",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2027-07-01T00:00:00.000Z"),
    userId,
  });
}, databaseHookTimeout);

afterAll(async () => {
  await db.transaction(async (transaction) => {
    await transaction
      .delete(schema.materialDocuments)
      .where(eq(schema.materialDocuments.userId, userId));
    await transaction
      .delete(schema.materialFolders)
      .where(eq(schema.materialFolders.userId, userId));
    await transaction
      .delete(schema.files)
      .where(eq(schema.files.userId, userId));
    await transaction
      .delete(schema.contentConnections)
      .where(eq(schema.contentConnections.userId, userId));
    await transaction.delete(schema.users).where(eq(schema.users.id, userId));
  });
}, databaseHookTimeout);

function snapshotFetch(
  options: { onExport?: () => Promise<void> | void } = {},
) {
  const calls: string[] = [];
  const fetch: ProviderFetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname === "/drive/v3/changes/startPageToken") {
      return Response.json({ startPageToken: "start-before-crawl" });
    }
    if (url.pathname === "/drive/v3/files/root-folder") {
      return Response.json({
        id: "root-folder",
        name: "Cours",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
      });
    }
    if (url.pathname === "/drive/v3/files") {
      return Response.json({
        files: [
          {
            id: "google-doc",
            name: "Chapitre 1",
            mimeType: "application/vnd.google-apps.document",
            version: "1",
            modifiedTime: "2026-08-21T14:00:00.000Z",
            parents: ["root-folder"],
            capabilities: { canDownload: true },
          },
        ],
      });
    }
    if (url.pathname === "/drive/v3/changes") {
      expect(url.searchParams.get("pageToken")).toBe("start-before-crawl");
      return Response.json({
        changes: [
          {
            fileId: "google-doc",
            changeType: "file",
            file: {
              id: "google-doc",
              name: "Chapitre 1 corrigé",
              mimeType: "application/vnd.google-apps.document",
              version: "2",
              modifiedTime: "2026-08-21T14:30:00.000Z",
              parents: ["root-folder"],
              capabilities: { canDownload: true },
            },
          },
        ],
        newStartPageToken: "cursor-after-closure",
      });
    }
    if (url.pathname === "/drive/v3/files/google-doc/export") {
      await options.onExport?.();
      expect(url.searchParams.get("mimeType")).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      return new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200,
        headers: { "content-length": "4" },
      });
    }
    return new Response(null, { status: 404 });
  };
  return { fetch, calls };
}

describe("Google Drive synchronization", () => {
  test("closes the initial snapshot race and exports a native Google Doc", async () => {
    const connectionId = "google-full-snapshot";
    await insertConnection({ id: connectionId, scope: ["root-folder"] });
    const remote = snapshotFetch();
    const result = await runGoogleDriveSyncJob(
      { connectionId },
      {
        fetch: remote.fetch,
        lookup: publicLookup,
        now: () => now,
        enqueuePreview: async () => ({ id: "preview-job" }) as never,
      },
    );
    expect(result.downloaded).toBe(1);
    const [connection] = await db
      .select()
      .from(schema.contentConnections)
      .where(eq(schema.contentConnections.id, connectionId));
    expect(connection?.cursor).toBe("cursor-after-closure");
    const [document] = await db
      .select()
      .from(schema.materialDocuments)
      .where(eq(schema.materialDocuments.connectionId, connectionId));
    expect(document).toMatchObject({
      title: "Chapitre 1 corrigé.docx",
      origin: "googledrive",
      externalId: "google-doc",
      metaVersion: 3,
    });
    expect(document?.metaJson).toMatchObject({
      provider: "googledrive",
      version: "2",
      sourceMimeType: "application/vnd.google-apps.document",
      exportMimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });

  test("fences publication when the folder scope changes during export", async () => {
    const connectionId = "google-scope-cas";
    await insertConnection({ id: connectionId, scope: ["root-folder"] });
    const remote = snapshotFetch({
      onExport: async () => {
        await db
          .update(schema.contentConnections)
          .set({ syncRevision: 1, scopeJson: { folderIds: [] } })
          .where(eq(schema.contentConnections.id, connectionId));
      },
    });
    await expect(
      runGoogleDriveSyncJob(
        { connectionId },
        {
          fetch: remote.fetch,
          lookup: publicLookup,
          now: () => now,
          enqueuePreview: async () => ({ id: "preview-job" }) as never,
        },
      ),
    ).rejects.toThrow("scope changed");
    expect(
      await db
        .select()
        .from(schema.materialDocuments)
        .where(eq(schema.materialDocuments.connectionId, connectionId)),
    ).toHaveLength(0);
  });

  test("replaces a channel by CAS, stops the old one and schedules its successor", async () => {
    const connectionId = "google-channel-renewal";
    await insertConnection({
      id: connectionId,
      cursor: "cursor-1",
      subscriptionId: "old-channel",
      subscriptionResourceId: "old-resource",
      subscriptionExpiresAt: new Date(now.getTime() + 60_000),
    });
    const stopped: Array<{ id: string; resourceId: string }> = [];
    const jobs: Array<{ kind: string; runAt: Date }> = [];
    const renewed = await runGoogleDriveChannelRenewalJob(
      { connectionId },
      {
        now: () => now,
        createChannel: async (_connection, pageToken) => {
          expect(pageToken).toBe("cursor-1");
          return {
            id: "new-channel",
            resourceId: "new-resource",
            expiresAt: new Date(now.getTime() + 6 * 86_400_000),
          };
        },
        deleteChannel: async (_connection, channel) => {
          stopped.push(channel);
        },
        enqueue: async (input) => {
          jobs.push({ kind: input.kind, runAt: input.runAt ?? now });
          return {
            id: "renewal-job",
            kind: input.kind,
            payload: input.payload,
            payloadVersion: 1,
            status: "queued" as const,
            attempts: 0,
            maxAttempts: input.maxAttempts ?? 3,
            runAt: input.runAt ?? now,
            lockedUntil: null,
            lockedBy: null,
            idempotencyKey: input.idempotencyKey ?? null,
            result: null,
            error: null,
            userId: input.userId ?? null,
            createdAt: now,
            updatedAt: now,
          };
        },
      },
    );
    expect(renewed).toMatchObject({
      subscriptionId: "new-channel",
      subscriptionResourceId: "new-resource",
    });
    expect(stopped).toEqual([
      { id: "old-channel", resourceId: "old-resource" },
    ]);
    expect(jobs[0]?.kind).toBe(GOOGLE_DRIVE_CHANNEL_RENEW_JOB_KIND);
    const [stored] = await db
      .select()
      .from(schema.contentConnections)
      .where(eq(schema.contentConnections.id, connectionId));
    expect(stored).toMatchObject({
      subscriptionId: "new-channel",
      subscriptionResourceId: "new-resource",
    });
  });

  test("a sparse removal provider-tombstones only the mapped document", async () => {
    const connectionId = "google-delta-remove";
    await insertConnection({
      id: connectionId,
      cursor: "cursor-before-remove",
      scope: ["remote-root"],
    });
    await db.insert(schema.materialFolders).values({
      id: "google-remove-root",
      name: "Root",
      origin: "googledrive",
      connectionId,
      externalId: "remote-root",
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.materialDocuments).values({
      id: "google-remove-document",
      title: "Old.pdf",
      folderId: "google-remove-root",
      sourceType: "text",
      textContent: "old",
      origin: "googledrive",
      connectionId,
      externalId: "removed-file",
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.materialDocuments).values({
      id: "google-personal-document",
      title: "Mine",
      folderId: "google-remove-root",
      sourceType: "text",
      textContent: "mine",
      origin: "manual",
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    const fetch: ProviderFetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/drive/v3/changes");
      return Response.json({
        changes: [{ fileId: "removed-file", removed: true }],
        newStartPageToken: "cursor-after-remove",
      });
    };
    const result = await runGoogleDriveSyncJob(
      { connectionId },
      { fetch, lookup: publicLookup, now: () => now },
    );
    expect(result.trashed).toBe(1);
    const rows = await db
      .select()
      .from(schema.materialDocuments)
      .where(
        and(
          eq(schema.materialDocuments.userId, userId),
          eq(schema.materialDocuments.folderId, "google-remove-root"),
        ),
      );
    expect(
      rows.find((row) => row.id === "google-remove-document")?.deletedBy,
    ).toBe("provider");
    expect(
      rows.find((row) => row.id === "google-personal-document")?.deletedAt,
    ).toBeNull();
  });

  test("tombstones a selected shared drive when membership is removed", async () => {
    const connectionId = "google-shared-drive-remove";
    await insertConnection({
      id: connectionId,
      cursor: "cursor-before-membership-remove",
      scope: ["shared-drive-1"],
    });
    await db.insert(schema.materialFolders).values({
      id: "google-shared-drive-root",
      name: "Classe",
      origin: "googledrive",
      connectionId,
      externalId: "shared-drive-1",
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    const fetch: ProviderFetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/drive/v3/changes");
      return Response.json({
        changes: [
          {
            changeType: "drive",
            driveId: "shared-drive-1",
            removed: true,
          },
        ],
        newStartPageToken: "cursor-after-membership-remove",
      });
    };
    const result = await runGoogleDriveSyncJob(
      { connectionId },
      { fetch, lookup: publicLookup, now: () => now },
    );
    expect(result.trashed).toBe(1);
    const [folder] = await db
      .select()
      .from(schema.materialFolders)
      .where(eq(schema.materialFolders.id, "google-shared-drive-root"));
    expect(folder?.deletedBy).toBe("provider");
  });
});
