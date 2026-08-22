import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderLookup } from "../sync/provider-network";

const testDirectory = mkdtempSync(join(tmpdir(), "avermate-connectors-"));
const databasePath = join(testDirectory, "connectors.db").replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${databasePath}`;
process.env.BETTER_AUTH_URL = "http://localhost:5000";
process.env.BETTER_AUTH_SECRET =
  "connector-router-test-secret-that-is-at-least-32-characters";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.DISABLE_JOBS = "true";
process.env.ONEDRIVE_CLIENT_ID = "onedrive-client";
process.env.ONEDRIVE_CLIENT_SECRET = "onedrive-secret";
process.env.ONEDRIVE_REDIRECT_URI =
  "http://localhost:5000/api/connectors/onedrive/callback";
process.env.GOOGLE_DRIVE_CLIENT_ID = "google-drive-client";
process.env.GOOGLE_DRIVE_CLIENT_SECRET = "google-drive-secret";
process.env.GOOGLE_DRIVE_REDIRECT_URI =
  "http://localhost:5000/api/connectors/googledrive/callback";

const userA = "connector-owner-a";
const userB = "connector-owner-b";
const yearA = "connector-year-a";
const yearB = "connector-year-b";
const connectionId = "connector-owned-by-a";
const googleConnectionId = "google-connector-owned-by-a";
const now = new Date("2026-08-21T12:00:00.000Z");
const publicLookup: ProviderLookup = async () => [
  { address: "8.8.8.8", family: 4 },
];

const { db, schema } = await import("../db");
const { connectorsRouter } = await import("./connectors");
const { materialsRouter } = await import("./materials");
const { sealOneDriveCredentials } = await import("../lib/onedrive");
const { sealGoogleDriveCredentials } = await import("../lib/googledrive");
const { runOneDriveSyncJob } = await import("../jobs/onedrive-sync");
const { registerSharedTestDatabaseLifecycle } =
  await import("../testing/database-lifecycle");

function sessionFor(id: string) {
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      image: null,
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `session-${id}`,
      token: `token-${id}`,
      userId: id,
      expiresAt: new Date("2027-12-01T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}

const router = { connectors: connectorsRouter, materials: materialsRouter };
const apiA = createRouterClient(router, {
  context: { headers: new Headers(), session: sessionFor(userA) },
});
const apiB = createRouterClient(router, {
  context: { headers: new Headers(), session: sessionFor(userB) },
});

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
  const migrated = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await db.$client.executeMultiple(migration);
  }
  await db.insert(schema.users).values([
    {
      id: userA,
      name: "Connector A",
      email: "connector-a@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: userB,
      name: "Connector B",
      email: "connector-b@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.years).values([
    {
      id: yearA,
      name: "A",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2027-07-01T00:00:00.000Z"),
      userId: userA,
    },
    {
      id: yearB,
      name: "B",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2027-07-01T00:00:00.000Z"),
      userId: userB,
    },
  ]);
  await db.insert(schema.contentConnections).values({
    id: connectionId,
    provider: "onedrive",
    accountLabel: "owner-a@example.test",
    status: "connected",
    scopeJson: { folderIds: ["remote-root"] },
    sealedCredentials: sealOneDriveCredentials({
      version: 1,
      accessToken: "access-token",
      accessTokenExpiresAt: new Date("2040-01-01T00:00:00.000Z").getTime(),
      refreshToken: "refresh-token",
      scope: "Files.Read offline_access",
      accountId: "account-a",
      driveId: "drive-a",
    }),
    yearId: yearA,
    userId: userA,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentConnections).values({
    id: googleConnectionId,
    provider: "googledrive",
    accountLabel: "google-owner-a@example.test",
    status: "connected",
    scopeJson: { folderIds: ["google-remote-root"] },
    sealedCredentials: sealGoogleDriveCredentials({
      version: 1,
      accessToken: "google-access-token",
      accessTokenExpiresAt: new Date("2040-01-01T00:00:00.000Z").getTime(),
      refreshToken: "google-refresh-token",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      accountId: "google-account-a",
    }),
    yearId: yearA,
    userId: userA,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.materialFolders).values({
    id: "connector-remote-folder",
    name: "Imported folder",
    origin: "onedrive",
    connectionId,
    externalId: "remote-root",
    yearId: yearA,
    userId: userA,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.materialDocuments).values([
    {
      id: "connector-remote-document",
      title: "Imported document",
      folderId: "connector-remote-folder",
      sourceType: "text",
      textContent: "cached",
      origin: "onedrive",
      connectionId,
      externalId: "remote-document",
      yearId: yearA,
      userId: userA,
      createdAt: now,
      updatedAt: now,
    },
    ...["direct", "batch"].map((suffix) => ({
      id: `connector-provider-tombstone-${suffix}`,
      title: `Provider tombstone ${suffix}`,
      folderId: null,
      sourceType: "text" as const,
      textContent: "stale cache",
      origin: "onedrive" as const,
      connectionId: null,
      externalId: `remote-tombstone-${suffix}`,
      deletedAt: now,
      deletedFrom: null,
      deletedBy: "provider" as const,
      deletedBatchId: `trash-provider-${suffix}`,
      yearId: yearA,
      userId: userA,
      createdAt: now,
      updatedAt: now,
    })),
  ]);
  await db.insert(schema.studyDocuments).values({
    id: "connector-personal-study",
    title: "Personal notes",
    bodyMarkdown: "Keep me",
    folderId: "connector-remote-folder",
    yearId: yearA,
    userId: userA,
    createdAt: now,
    updatedAt: now,
  });
}, 30_000);

afterAll(async () => {
  await db
    .delete(schema.materialDocuments)
    .where(inArray(schema.materialDocuments.userId, [userA, userB]));
  await db
    .delete(schema.studyDocuments)
    .where(inArray(schema.studyDocuments.userId, [userA, userB]));
  await db
    .delete(schema.materialFolders)
    .where(inArray(schema.materialFolders.userId, [userA, userB]));
  await db
    .delete(schema.contentConnections)
    .where(inArray(schema.contentConnections.userId, [userA, userB]));
  await db.delete(schema.users).where(inArray(schema.users.id, [userA, userB]));
}, 30_000);

describe("connectors ownership and disconnect lifecycle", () => {
  test("never resolves another user's connection for browse/scope/disconnect/sync", async () => {
    for (const foreignConnectionId of [connectionId, googleConnectionId]) {
      await expect(
        apiB.connectors.browse({ connectionId: foreignConnectionId }),
      ).rejects.toThrow("unavailable");
      await expect(
        apiB.connectors.setScope({
          connectionId: foreignConnectionId,
          folderIds: ["remote-root"],
        }),
      ).rejects.toThrow("unavailable");
      await expect(
        apiB.connectors.syncNow({ connectionId: foreignConnectionId }),
      ).rejects.toThrow("unavailable");
      await expect(
        apiB.connectors.disconnect({ connectionId: foreignConnectionId }),
      ).rejects.toThrow("unavailable");
    }
    await expect(
      apiB.connectors.oauthUrl({ provider: "googledrive", yearId: yearA }),
    ).rejects.toThrow("Year not found");

    const [connection] = await db
      .select()
      .from(schema.contentConnections)
      .where(eq(schema.contentConnections.id, connectionId));
    expect(connection?.userId).toBe(userA);
    expect(connection?.scopeJson).toEqual({ folderIds: ["remote-root"] });
    const [googleConnection] = await db
      .select()
      .from(schema.contentConnections)
      .where(eq(schema.contentConnections.id, googleConnectionId));
    expect(googleConnection?.userId).toBe(userA);
    expect(
      await db.select().from(schema.jobs).where(eq(schema.jobs.userId, userB)),
    ).toHaveLength(0);
  });

  test("keeps provider structure read-only while local metadata stays separate", async () => {
    await expect(
      apiA.materials.folders.rename({
        folderId: "connector-remote-folder",
        name: "Local rename",
      }),
    ).rejects.toThrow("cannot be renamed locally");
    await expect(
      apiA.materials.folders.move({
        folderId: "connector-remote-folder",
        parentId: null,
      }),
    ).rejects.toThrow("cannot be moved locally");
    await expect(
      apiA.materials.documents.rename({
        documentId: "connector-remote-document",
        title: "Local rename",
      }),
    ).rejects.toThrow("cannot be renamed locally");
    await expect(
      apiA.materials.documents.move({
        documentId: "connector-remote-document",
        folderId: null,
      }),
    ).rejects.toThrow("cannot be moved locally");

    await expect(
      apiA.materials.star({
        kind: "folder",
        id: "connector-remote-folder",
        starred: true,
      }),
    ).resolves.toMatchObject({ starredAt: expect.any(Date) });
    await expect(
      apiA.materials.star({
        kind: "document",
        id: "connector-remote-document",
        starred: true,
      }),
    ).resolves.toMatchObject({ starredAt: expect.any(Date) });
    const tag = await apiA.materials.tags.create({
      yearId: yearA,
      name: "Imported",
    });
    await expect(
      apiA.materials.tags.assign({
        tagId: tag.id,
        targets: [
          { kind: "folder", id: "connector-remote-folder" },
          { kind: "document", id: "connector-remote-document" },
        ],
        assigned: true,
      }),
    ).resolves.toEqual({ count: 2 });

    for (const target of [
      { kind: "folder" as const, id: "connector-remote-folder" },
      { kind: "document" as const, id: "connector-remote-document" },
    ]) {
      await expect(apiA.materials.trash(target)).rejects.toThrow(
        "cannot be deleted locally",
      );
      await expect(apiA.materials.purge(target)).rejects.toThrow(
        "cannot be deleted locally",
      );
    }
    await expect(
      apiA.materials.folders.delete({
        folderId: "connector-remote-folder",
      }),
    ).rejects.toThrow("cannot be deleted locally");
    await expect(
      apiA.materials.documents.delete({
        documentId: "connector-remote-document",
      }),
    ).rejects.toThrow("cannot be deleted locally");

    await expect(
      apiA.materials.restore({
        kind: "document",
        id: "connector-provider-tombstone-direct",
      }),
    ).rejects.toThrow("cannot be deleted locally");
    await expect(
      apiA.materials.purge({
        kind: "document",
        id: "connector-provider-tombstone-direct",
      }),
    ).resolves.toEqual({ ok: true });
    expect(
      await db
        .select()
        .from(schema.materialDocuments)
        .where(
          eq(
            schema.materialDocuments.id,
            "connector-provider-tombstone-direct",
          ),
        ),
    ).toHaveLength(0);
    await expect(apiA.materials.emptyTrash({ yearId: yearA })).resolves.toEqual(
      { purged: 1 },
    );
    expect(
      await db
        .select()
        .from(schema.materialDocuments)
        .where(
          eq(schema.materialDocuments.id, "connector-provider-tombstone-batch"),
        ),
    ).toHaveLength(0);
  });

  test("disconnect tombstones provider mappings and preserves personal content", async () => {
    await expect(apiA.connectors.disconnect({ connectionId })).resolves.toEqual(
      { ok: true },
    );

    expect(
      await db
        .select()
        .from(schema.contentConnections)
        .where(eq(schema.contentConnections.id, connectionId)),
    ).toHaveLength(0);
    const [folder] = await db
      .select()
      .from(schema.materialFolders)
      .where(eq(schema.materialFolders.id, "connector-remote-folder"));
    const [document] = await db
      .select()
      .from(schema.materialDocuments)
      .where(eq(schema.materialDocuments.id, "connector-remote-document"));
    const [study] = await db
      .select()
      .from(schema.studyDocuments)
      .where(eq(schema.studyDocuments.id, "connector-personal-study"));
    expect(folder).toMatchObject({
      connectionId: null,
      deletedBy: "provider",
    });
    expect(document).toMatchObject({
      connectionId: null,
      deletedBy: "provider",
      deletedBatchId: folder?.deletedBatchId,
    });
    await expect(
      apiA.materials.restore({
        kind: "folder",
        id: "connector-remote-folder",
      }),
    ).rejects.toThrow("cannot be deleted locally");
    await expect(
      apiA.materials.restore({
        kind: "document",
        id: "connector-remote-document",
      }),
    ).rejects.toThrow("cannot be deleted locally");
    expect(folder?.deletedBatchId).toBeTruthy();
    expect(study).toMatchObject({
      folderId: null,
      deletedAt: null,
      deletedBy: null,
    });
    expect(
      await db
        .select()
        .from(schema.materialDocuments)
        .where(
          and(
            eq(schema.materialDocuments.userId, userA),
            isNull(schema.materialDocuments.deletedAt),
            eq(schema.materialDocuments.origin, "onedrive"),
          ),
        ),
    ).toHaveLength(0);

    const reconnectId = "connector-reconnected-a";
    await db.insert(schema.contentConnections).values({
      id: reconnectId,
      provider: "onedrive",
      accountLabel: "owner-a@example.test",
      status: "connected",
      scopeJson: { folderIds: ["remote-root"] },
      sealedCredentials: sealOneDriveCredentials({
        version: 1,
        accessToken: "reconnected-access-token",
        accessTokenExpiresAt: new Date("2040-01-01T00:00:00.000Z").getTime(),
        refreshToken: "reconnected-refresh-token",
        scope: "Files.Read offline_access",
        accountId: "account-a",
        driveId: "drive-a",
      }),
      yearId: yearA,
      userId: userA,
      createdAt: now,
      updatedAt: now,
    });
    await runOneDriveSyncJob(
      { connectionId: reconnectId },
      {
        lookup: publicLookup,
        now: () => now,
        fetch: async () =>
          Response.json({
            value: [
              {
                id: "remote-root",
                name: "Imported folder",
                folder: { childCount: 0 },
              },
            ],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=reconnected",
          }),
      },
    );
    const liveCopies = await db
      .select()
      .from(schema.materialFolders)
      .where(
        and(
          eq(schema.materialFolders.userId, userA),
          eq(schema.materialFolders.origin, "onedrive"),
          eq(schema.materialFolders.externalId, "remote-root"),
          isNull(schema.materialFolders.deletedAt),
        ),
      );
    expect(liveCopies).toHaveLength(1);
    expect(liveCopies[0]?.connectionId).toBe(reconnectId);
  });
});
