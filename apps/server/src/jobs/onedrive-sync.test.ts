import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderFetch, ProviderLookup } from "../sync/provider-network";

const testDirectory = mkdtempSync(join(tmpdir(), "avermate-onedrive-sync-"));
const databasePath = join(testDirectory, "onedrive.db").replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${databasePath}`;
process.env.BETTER_AUTH_URL = "http://localhost:5000";
process.env.BETTER_AUTH_SECRET =
  "onedrive-sync-test-secret-that-is-at-least-32-characters";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.NODE_ENV = "test";
process.env.DISABLE_JOBS = "true";

const { db, schema } = await import("../db");
const { registerSharedTestDatabaseLifecycle } =
  await import("../testing/database-lifecycle");
const { sealOneDriveCredentials } = await import("../lib/onedrive");
const {
  enqueueOneDriveSync,
  ONEDRIVE_SUBSCRIPTION_RENEW_JOB_KIND,
  reconcileOneDriveSubscriptions,
  resolveOneDriveMaterialMimeType,
  runOneDriveSyncJob,
} = await import("./onedrive-sync");
const { purgeExpiredMaterialTrash } =
  await import("../routers/materials/operations");

const userId = "onedrive-trash-user";
const yearId = "onedrive-trash-year";
const connectionId = "onedrive-trash-connection";
const remoteRootId = "remote-root";
const rootFolderId = "onedrive-root-folder";
const childFolderId = "onedrive-child-folder";
const outsideFolderId = "manual-outside-folder";
const nestedManualFolderId = "manual-nested-folder";
const materialId = "onedrive-child-material";
const studyId = "onedrive-child-study";
const recordingId = "onedrive-child-recording";
const outsideStudyId = "manual-outside-study";
const nestedStudyId = "manual-nested-study";
const now = new Date("2026-08-21T15:00:00.000Z");

const publicLookup: ProviderLookup = async () => [
  { address: "8.8.8.8", family: 4 },
];

function testCredentials(suffix: string) {
  return sealOneDriveCredentials({
    version: 1,
    accessToken: `${suffix}-access-token`,
    accessTokenExpiresAt: new Date("2040-01-01T00:00:00.000Z").getTime(),
    refreshToken: `${suffix}-refresh-token`,
    scope: "Files.Read User.Read offline_access",
    accountId: `${suffix}-account`,
    driveId: `${suffix}-drive`,
  });
}

async function insertConnection(input: {
  id: string;
  cursor?: string | null;
  scope?: string[];
  status?: "connected" | "expired" | "error";
  subscriptionId?: string | null;
  subscriptionExpiresAt?: Date | null;
  lastError?: string | null;
}) {
  const [connection] = await db
    .insert(schema.contentConnections)
    .values({
      id: input.id,
      provider: "onedrive",
      accountLabel: `${input.id}@example.test`,
      status: input.status ?? "connected",
      cursor: input.cursor ?? null,
      subscriptionId: input.subscriptionId ?? null,
      subscriptionExpiresAt: input.subscriptionExpiresAt ?? null,
      lastError: input.lastError ?? null,
      scopeJson: { folderIds: input.scope ?? [] },
      sealedCredentials: testCredentials(input.id),
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
    name: "OneDrive trash test",
    email: "onedrive-trash@example.test",
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
  await db.insert(schema.contentConnections).values({
    id: connectionId,
    provider: "onedrive",
    accountLabel: "ada@example.test",
    status: "connected",
    cursor: "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=before",
    scopeJson: { folderIds: [remoteRootId] },
    sealedCredentials: sealOneDriveCredentials({
      version: 1,
      accessToken: "test-access-token",
      accessTokenExpiresAt: new Date("2040-01-01T00:00:00.000Z").getTime(),
      refreshToken: "test-refresh-token",
      scope: "Files.Read User.Read offline_access",
      accountId: "account-1",
      driveId: "drive-1",
    }),
    yearId,
    userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.materialFolders).values([
    {
      id: rootFolderId,
      name: "Remote root",
      parentId: null,
      origin: "onedrive",
      connectionId,
      externalId: remoteRootId,
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: childFolderId,
      name: "Remote child",
      parentId: rootFolderId,
      origin: "onedrive",
      connectionId,
      externalId: "remote-child",
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: outsideFolderId,
      name: "Manual outside",
      parentId: null,
      origin: "manual",
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: nestedManualFolderId,
      name: "Personal subtree",
      parentId: childFolderId,
      origin: "manual",
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.materialDocuments).values({
    id: materialId,
    title: "Imported text",
    folderId: childFolderId,
    sourceType: "text",
    textContent: "Imported",
    origin: "onedrive",
    connectionId,
    externalId: "remote-material",
    yearId,
    userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.studyDocuments).values([
    {
      id: studyId,
      title: "Notes beside imported files",
      bodyMarkdown: "Notes",
      folderId: childFolderId,
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: outsideStudyId,
      title: "Unrelated notes",
      bodyMarkdown: "Keep me",
      folderId: outsideFolderId,
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: nestedStudyId,
      title: "Notes in a personal subtree",
      bodyMarkdown: "Keep the subtree",
      folderId: nestedManualFolderId,
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.lectureRecordings).values({
    id: recordingId,
    title: "Lecture beside imported files",
    status: "ready",
    recordedAt: now,
    durationMs: 1_000,
    folderId: childFolderId,
    yearId,
    userId,
    createdAt: now,
    updatedAt: now,
  });
}, 30_000);

afterAll(async () => {
  await db.transaction(async (tx) => {
    // Delete restricted file consumers before their owning user. Relying on
    // two parallel cascades (documents -> files) is rejected by SQLite's
    // immediate RESTRICT check.
    await tx
      .delete(schema.materialDocuments)
      .where(eq(schema.materialDocuments.userId, userId));
    await tx
      .delete(schema.studyDocuments)
      .where(eq(schema.studyDocuments.userId, userId));
    await tx
      .delete(schema.lectureRecordings)
      .where(eq(schema.lectureRecordings.userId, userId));
    await tx
      .delete(schema.materialFolders)
      .where(eq(schema.materialFolders.userId, userId));
    await tx.delete(schema.files).where(eq(schema.files.userId, userId));
    await tx
      .delete(schema.contentConnections)
      .where(eq(schema.contentConnections.userId, userId));
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
}, 30_000);

describe("OneDrive folder deletion", () => {
  test("uses Graph MIME when it conflicts with a misleading extension", () => {
    expect(
      resolveOneDriveMaterialMimeType({
        id: "misleading-image",
        name: "photo.pdf",
        file: { mimeType: "image/png" },
      }),
    ).toBe("image/png");
    expect(
      resolveOneDriveMaterialMimeType({
        id: "neutral-pdf",
        name: "cours.pdf",
        file: { mimeType: "application/octet-stream" },
      }),
    ).toBe("application/pdf");
  });

  test("tombstones only provider mappings and preserves personal boundaries through purge", async () => {
    const fetch: ProviderFetch = async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://graph.microsoft.com");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer test-access-token",
      );
      return Response.json({
        value: [
          {
            id: remoteRootId,
            name: "Remote root",
            folder: { childCount: 1 },
            deleted: { state: "deleted" },
          },
        ],
        "@odata.deltaLink":
          "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=after",
      });
    };

    const result = await runOneDriveSyncJob(
      { connectionId },
      { fetch, lookup: publicLookup, now: () => now },
    );
    expect(result.trashed).toBe(3);

    const [
      folders,
      material,
      study,
      recording,
      outsideStudy,
      nestedFolder,
      nestedStudy,
    ] = await Promise.all([
      db
        .select()
        .from(schema.materialFolders)
        .where(eq(schema.materialFolders.connectionId, connectionId)),
      db
        .select()
        .from(schema.materialDocuments)
        .where(eq(schema.materialDocuments.id, materialId))
        .then((rows) => rows[0]),
      db
        .select()
        .from(schema.studyDocuments)
        .where(eq(schema.studyDocuments.id, studyId))
        .then((rows) => rows[0]),
      db
        .select()
        .from(schema.lectureRecordings)
        .where(eq(schema.lectureRecordings.id, recordingId))
        .then((rows) => rows[0]),
      db
        .select()
        .from(schema.studyDocuments)
        .where(eq(schema.studyDocuments.id, outsideStudyId))
        .then((rows) => rows[0]),
      db
        .select()
        .from(schema.materialFolders)
        .where(eq(schema.materialFolders.id, nestedManualFolderId))
        .then((rows) => rows[0]),
      db
        .select()
        .from(schema.studyDocuments)
        .where(eq(schema.studyDocuments.id, nestedStudyId))
        .then((rows) => rows[0]),
    ]);

    expect(folders).toHaveLength(2);
    expect(
      folders.every((folder) => folder.deletedAt?.getTime() === now.getTime()),
    ).toBeTrue();
    expect(
      folders.every((folder) => folder.deletedBy === "provider"),
    ).toBeTrue();
    expect(
      folders.find((folder) => folder.id === rootFolderId)?.deletedFrom,
    ).toBeNull();
    expect(
      folders.find((folder) => folder.id === childFolderId)?.deletedFrom,
    ).toBe(rootFolderId);
    expect(material?.deletedAt).toEqual(now);
    expect(material?.deletedFrom).toBe(childFolderId);
    expect(material?.deletedBy).toBe("provider");
    expect(study?.deletedAt).toBeNull();
    expect(study?.folderId).toBeNull();
    expect(recording?.deletedAt).toBeNull();
    expect(recording?.folderId).toBeNull();
    expect(outsideStudy?.deletedAt).toBeNull();
    expect(outsideStudy?.folderId).toBe(outsideFolderId);
    expect(nestedFolder?.deletedAt).toBeNull();
    expect(nestedFolder?.parentId).toBeNull();
    expect(nestedStudy?.deletedAt).toBeNull();
    expect(nestedStudy?.folderId).toBe(nestedManualFolderId);

    await purgeExpiredMaterialTrash(
      new Date(now.getTime() + 31 * 24 * 60 * 60_000),
    );
    const [survivingStudies, survivingRecording, survivingNestedFolder] =
      await Promise.all([
        db
          .select({ id: schema.studyDocuments.id })
          .from(schema.studyDocuments)
          .where(inArray(schema.studyDocuments.id, [studyId, nestedStudyId])),
        db
          .select({ id: schema.lectureRecordings.id })
          .from(schema.lectureRecordings)
          .where(eq(schema.lectureRecordings.id, recordingId)),
        db
          .select({ id: schema.materialFolders.id })
          .from(schema.materialFolders)
          .where(eq(schema.materialFolders.id, nestedManualFolderId)),
      ]);
    expect(survivingStudies).toHaveLength(2);
    expect(survivingRecording).toHaveLength(1);
    expect(survivingNestedFolder).toHaveLength(1);
  });

  test("rebuilds an expired delta cursor from a safe Graph Location", async () => {
    const resetConnectionId = "onedrive-expired-cursor-connection";
    const staleFolderId = "onedrive-stale-folder";
    const staleExternalId = "remote-stale-folder";
    const oldCursor =
      "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=expired";
    const resetCursor =
      "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=reset";
    const nextCursor =
      "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=fresh";
    await db.insert(schema.contentConnections).values({
      id: resetConnectionId,
      provider: "onedrive",
      accountLabel: "cursor@example.test",
      status: "connected",
      cursor: oldCursor,
      scopeJson: { folderIds: [staleExternalId] },
      sealedCredentials: sealOneDriveCredentials({
        version: 1,
        accessToken: "cursor-access-token",
        accessTokenExpiresAt: new Date("2040-01-01T00:00:00.000Z").getTime(),
        refreshToken: "cursor-refresh-token",
        scope: "Files.Read User.Read offline_access",
        accountId: "account-2",
        driveId: "drive-2",
      }),
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.materialFolders).values({
      id: staleFolderId,
      name: "Stale remote folder",
      parentId: null,
      origin: "onedrive",
      connectionId: resetConnectionId,
      externalId: staleExternalId,
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    });

    const requests: string[] = [];
    const fetch: ProviderFetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (requests.length === 1) {
        expect(url).toBe(oldCursor);
        return Response.json(
          { error: { code: "resyncChangesApplyDifferences" } },
          { status: 410, headers: { location: resetCursor } },
        );
      }
      expect(url).toBe(resetCursor);
      return Response.json({ value: [], "@odata.deltaLink": nextCursor });
    };

    const result = await runOneDriveSyncJob(
      { connectionId: resetConnectionId },
      { fetch, lookup: publicLookup, now: () => now },
    );
    expect(requests).toHaveLength(2);
    expect(result.trashed).toBe(1);

    const [connection] = await db
      .select()
      .from(schema.contentConnections)
      .where(eq(schema.contentConnections.id, resetConnectionId));
    const [folder] = await db
      .select()
      .from(schema.materialFolders)
      .where(eq(schema.materialFolders.id, staleFolderId));
    expect(connection?.cursor).toBe(nextCursor);
    expect(folder?.deletedAt).toEqual(now);
    expect(folder?.deletedBy).toBe("provider");
  });

  test("drains dirty generations with one active job, including a request during the follow-up pass", async () => {
    const dirtyConnectionId = "onedrive-dirty-generation";
    const cursors = [
      "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=dirty-0",
      "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=dirty-1",
      "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=dirty-2",
      "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=dirty-3",
    ];
    await insertConnection({ id: dirtyConnectionId, cursor: cursors[0] });
    const active = await enqueueOneDriveSync(userId, dirtyConnectionId);
    await db
      .update(schema.jobs)
      .set({
        status: "running",
        lockedBy: "onedrive-test-worker",
        lockedUntil: new Date(now.getTime() + 60_000),
      })
      .where(eq(schema.jobs.id, active.id));

    let calls = 0;
    const fetch: ProviderFetch = async (input) => {
      expect(String(input)).toBe(cursors[calls]);
      calls += 1;
      if (calls <= 2) {
        const coalesced = await enqueueOneDriveSync(userId, dirtyConnectionId);
        expect(coalesced.id).toBe(active.id);
      }
      return Response.json({ value: [], "@odata.deltaLink": cursors[calls] });
    };
    await runOneDriveSyncJob(
      { connectionId: dirtyConnectionId },
      {
        fetch,
        lookup: publicLookup,
        now: () => now,
        jobId: active.id,
      },
    );

    const [connection] = await db
      .select()
      .from(schema.contentConnections)
      .where(eq(schema.contentConnections.id, dirtyConnectionId));
    const relatedJobs = (
      await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.kind, "connectors.onedrive.sync"),
            eq(schema.jobs.userId, userId),
          ),
        )
    ).filter(
      (job) =>
        (job.payload as { connectionId?: string } | null)?.connectionId ===
        dirtyConnectionId,
    );
    expect(calls).toBe(3);
    expect(connection?.cursor).toBe(cursors[3]);
    expect(connection?.syncRequestedGeneration).toBe(3);
    expect(connection?.syncActiveJobId).toBeNull();
    expect(relatedJobs).toHaveLength(1);
    expect(relatedJobs.filter((job) => job.status === "queued")).toHaveLength(
      0,
    );
    await db
      .update(schema.jobs)
      .set({ status: "succeeded", lockedBy: null, lockedUntil: null })
      .where(eq(schema.jobs.id, active.id));
  }, 15_000);

  test("materializes a deep parent-first folder snapshot without a shrinking pass bound", async () => {
    const deepConnectionId = "onedrive-deep-folders";
    const depth = 12;
    const remoteIds = Array.from(
      { length: depth },
      (_, index) => `deep-remote-${index}`,
    );
    await insertConnection({
      id: deepConnectionId,
      scope: [remoteIds[0]!],
    });
    const items = remoteIds.map((id, index) => ({
      id,
      name: `Level ${index}`,
      folder: { childCount: index === depth - 1 ? 0 : 1 },
      ...(index === 0 ? {} : { parentReference: { id: remoteIds[index - 1] } }),
    }));
    const startedAt = performance.now();
    await runOneDriveSyncJob(
      { connectionId: deepConnectionId },
      {
        lookup: publicLookup,
        now: () => now,
        fetch: async () =>
          Response.json({
            value: items,
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=deep",
          }),
      },
    );
    const elapsedMs = performance.now() - startedAt;
    const folders = await db
      .select()
      .from(schema.materialFolders)
      .where(eq(schema.materialFolders.connectionId, deepConnectionId));
    expect(folders).toHaveLength(depth);
    const byExternal = new Map(
      folders.map((folder) => [folder.externalId, folder]),
    );
    for (let index = 1; index < depth; index += 1) {
      expect(byExternal.get(remoteIds[index]!)?.parentId).toBe(
        byExternal.get(remoteIds[index - 1]!)?.id,
      );
    }
    expect(elapsedMs).toBeLessThan(3_000);
  });

  test("provider-tombstones an imported binary that becomes oversized", async () => {
    const unsupportedConnectionId = "onedrive-unsupported-transition";
    const remoteFolder = "unsupported-remote-folder";
    const localFolder = "unsupported-local-folder";
    const fileId = "unsupported-existing-file";
    const documentId = "unsupported-existing-document";
    await insertConnection({
      id: unsupportedConnectionId,
      cursor:
        "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=unsupported-old",
      scope: [remoteFolder],
    });
    await db.insert(schema.materialFolders).values({
      id: localFolder,
      name: "Imported",
      origin: "onedrive",
      connectionId: unsupportedConnectionId,
      externalId: remoteFolder,
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.files).values({
      id: fileId,
      storageKey: fileId,
      url: `https://example.invalid/${fileId}`,
      mimeType: "application/pdf",
      byteSize: 42,
      purpose: "course-material",
      provider: "test",
      userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.materialDocuments).values({
      id: documentId,
      title: "Was supported.pdf",
      folderId: localFolder,
      sourceType: "file",
      fileId,
      origin: "onedrive",
      connectionId: unsupportedConnectionId,
      externalId: "unsupported-remote-file",
      yearId,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    const result = await runOneDriveSyncJob(
      { connectionId: unsupportedConnectionId },
      {
        lookup: publicLookup,
        now: () => now,
        fetch: async () =>
          Response.json({
            value: [
              {
                id: "unsupported-remote-file",
                name: "Now too large.pdf",
                size: 60 * 1024 * 1024,
                eTag: "oversized-etag",
                file: { mimeType: "application/pdf" },
                parentReference: { id: remoteFolder },
              },
            ],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=unsupported-new",
          }),
      },
    );
    const [document] = await db
      .select()
      .from(schema.materialDocuments)
      .where(eq(schema.materialDocuments.id, documentId));
    expect(result.unsupported).toBe(1);
    expect(result.trashed).toBe(1);
    expect(document?.deletedAt).toEqual(now);
    expect(document?.deletedBy).toBe("provider");
  });

  test("restores only provider tombstones when a scoped folder returns", async () => {
    const restoreConnectionId = "onedrive-provider-restore";
    const restoreRemoteRoot = "restore-remote-root";
    const restoreRemoteChild = "restore-remote-child";
    const restoreRoot = "restore-local-root";
    const restoreChild = "restore-local-child";
    const providerStudy = "restore-provider-study";
    const userStudy = "restore-user-study";
    const tombstonedAt = new Date(now.getTime() - 60_000);
    await insertConnection({
      id: restoreConnectionId,
      scope: [restoreRemoteRoot],
    });
    await db.insert(schema.materialFolders).values([
      {
        id: restoreRoot,
        name: "Restore root",
        origin: "onedrive",
        connectionId: restoreConnectionId,
        externalId: restoreRemoteRoot,
        yearId,
        userId,
        deletedAt: tombstonedAt,
        deletedBy: "provider",
        createdAt: now,
        updatedAt: tombstonedAt,
      },
      {
        id: restoreChild,
        name: "Restore child",
        parentId: restoreRoot,
        origin: "onedrive",
        connectionId: restoreConnectionId,
        externalId: restoreRemoteChild,
        yearId,
        userId,
        deletedAt: tombstonedAt,
        deletedFrom: restoreRoot,
        deletedBy: "provider",
        createdAt: now,
        updatedAt: tombstonedAt,
      },
    ]);
    await db.insert(schema.studyDocuments).values([
      {
        id: providerStudy,
        title: "Provider-hidden notes",
        bodyMarkdown: "restore",
        folderId: restoreChild,
        yearId,
        userId,
        deletedAt: tombstonedAt,
        deletedFrom: restoreChild,
        deletedBy: "provider",
        createdAt: now,
        updatedAt: tombstonedAt,
      },
      {
        id: userStudy,
        title: "User-hidden notes",
        bodyMarkdown: "keep hidden",
        folderId: restoreChild,
        yearId,
        userId,
        deletedAt: tombstonedAt,
        deletedFrom: restoreChild,
        deletedBy: "user",
        createdAt: now,
        updatedAt: tombstonedAt,
      },
    ]);
    await runOneDriveSyncJob(
      { connectionId: restoreConnectionId },
      {
        lookup: publicLookup,
        now: () => now,
        fetch: async () =>
          Response.json({
            value: [
              {
                id: restoreRemoteRoot,
                name: "Restore root",
                folder: { childCount: 1 },
              },
              {
                id: restoreRemoteChild,
                name: "Restore child",
                folder: { childCount: 0 },
                parentReference: { id: restoreRemoteRoot },
              },
            ],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=restored",
          }),
      },
    );
    const [providerRow, userRow] = await Promise.all([
      db
        .select()
        .from(schema.studyDocuments)
        .where(eq(schema.studyDocuments.id, providerStudy))
        .then((rows) => rows[0]),
      db
        .select()
        .from(schema.studyDocuments)
        .where(eq(schema.studyDocuments.id, userStudy))
        .then((rows) => rows[0]),
    ]);
    expect(providerRow?.deletedAt).toBeNull();
    expect(providerRow?.deletedBy).toBeNull();
    expect(userRow?.deletedAt).toEqual(tombstonedAt);
    expect(userRow?.deletedBy).toBe("user");
  });

  test("fences publication when setScope changes during a download and the follow-up reconciles", async () => {
    const revisionConnectionId = "onedrive-scope-revision";
    const revisionRemoteFolder = "revision-remote-folder";
    await insertConnection({
      id: revisionConnectionId,
      scope: [revisionRemoteFolder],
    });
    let scopeChanged = false;
    const firstFetch: ProviderFetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/content")) {
        scopeChanged = true;
        await db
          .update(schema.contentConnections)
          .set({
            scopeJson: { folderIds: [] },
            cursor: null,
            syncRevision: 1,
            status: "connected",
            lastError: null,
            updatedAt: now,
          })
          .where(eq(schema.contentConnections.id, revisionConnectionId));
        return new Response("%PDF-1.4", {
          status: 200,
          headers: { "content-length": "8" },
        });
      }
      return Response.json({
        value: [
          {
            id: revisionRemoteFolder,
            name: "Old scope",
            folder: { childCount: 1 },
          },
          {
            id: "revision-remote-file",
            name: "Old.pdf",
            size: 8,
            eTag: "revision-etag",
            file: { mimeType: "application/pdf" },
            parentReference: { id: revisionRemoteFolder },
          },
        ],
        "@odata.deltaLink":
          "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=old-scope",
      });
    };
    await expect(
      runOneDriveSyncJob(
        { connectionId: revisionConnectionId },
        { fetch: firstFetch, lookup: publicLookup, now: () => now },
      ),
    ).rejects.toThrow("scope changed");
    expect(scopeChanged).toBeTrue();
    const [afterConflict, documents] = await Promise.all([
      db
        .select()
        .from(schema.contentConnections)
        .where(eq(schema.contentConnections.id, revisionConnectionId))
        .then((rows) => rows[0]),
      db
        .select()
        .from(schema.materialDocuments)
        .where(eq(schema.materialDocuments.connectionId, revisionConnectionId)),
    ]);
    expect(afterConflict?.status).toBe("connected");
    expect(afterConflict?.lastError).toBeNull();
    expect(documents).toHaveLength(0);

    await runOneDriveSyncJob(
      { connectionId: revisionConnectionId },
      {
        lookup: publicLookup,
        now: () => now,
        fetch: async () =>
          Response.json({
            value: [],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=new-scope",
          }),
      },
    );
    const [oldFolder] = await db
      .select()
      .from(schema.materialFolders)
      .where(eq(schema.materialFolders.connectionId, revisionConnectionId));
    expect(oldFolder?.deletedBy).toBe("provider");
  });

  test("paginates subscription repair, rearms a terminal renewal and skips no-webhook sources safely", async () => {
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
    const repairA = "onedrive-maintenance-a";
    const repairB = "onedrive-maintenance-b";
    const noWebhook = "onedrive-maintenance-no-webhook";
    const expired = "onedrive-maintenance-expired";
    await insertConnection({
      id: repairA,
      status: "error",
      subscriptionId: "subscription-a",
      subscriptionExpiresAt: expiresAt,
      lastError: "Previous terminal renewal failure",
    });
    await insertConnection({
      id: repairB,
      subscriptionId: "subscription-b",
      subscriptionExpiresAt: expiresAt,
    });
    await insertConnection({ id: noWebhook });
    await insertConnection({
      id: expired,
      status: "expired",
      subscriptionId: "subscription-expired",
      subscriptionExpiresAt: expiresAt,
    });
    const renewalKeyA = `${repairA}:${expiresAt.toISOString()}`;
    await db.insert(schema.jobs).values({
      id: "terminal-renewal-a",
      kind: ONEDRIVE_SUBSCRIPTION_RENEW_JOB_KIND,
      payload: { connectionId: repairA },
      status: "failed",
      attempts: 6,
      maxAttempts: 6,
      runAt: now,
      idempotencyKey: renewalKeyA,
      error: "terminal",
      userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentOauthStates).values({
      id: "expired-onedrive-oauth-state",
      stateHash: "expired-onedrive-oauth-state-hash",
      provider: "onedrive",
      expiresAt: new Date(now.getTime() - 1),
      yearId,
      userId,
      createdAt: new Date(now.getTime() - 60_000),
    });

    const result = await reconcileOneDriveSubscriptions({
      now: () => now,
      batchSize: 1,
      createSubscription: async () => null,
    });
    const renewalJobs = await db
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, ONEDRIVE_SUBSCRIPTION_RENEW_JOB_KIND),
          eq(schema.jobs.userId, userId),
        ),
      );
    const currentA = renewalJobs.find(
      (job) => job.idempotencyKey === renewalKeyA,
    );
    const currentB = renewalJobs.find(
      (job) => job.idempotencyKey === `${repairB}:${expiresAt.toISOString()}`,
    );
    const expiredJob = renewalJobs.find(
      (job) => job.idempotencyKey === `${expired}:${expiresAt.toISOString()}`,
    );
    const [noWebhookRow] = await db
      .select()
      .from(schema.contentConnections)
      .where(eq(schema.contentConnections.id, noWebhook));
    const [oauthState] = await db
      .select()
      .from(schema.contentOauthStates)
      .where(eq(schema.contentOauthStates.id, "expired-onedrive-oauth-state"));
    expect(result.examined).toBeGreaterThanOrEqual(3);
    expect(result.skippedWithoutWebhook).toBeGreaterThanOrEqual(1);
    expect(result.purgedOauthStates).toBe(1);
    expect(currentA?.status).toBe("queued");
    expect(currentA?.id).not.toBe("terminal-renewal-a");
    expect(currentB?.status).toBe("queued");
    expect(expiredJob).toBeUndefined();
    expect(noWebhookRow?.status).toBe("connected");
    expect(oauthState).toBeUndefined();
  });
});
