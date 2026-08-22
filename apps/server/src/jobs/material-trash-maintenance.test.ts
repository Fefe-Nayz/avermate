import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

const testDatabase = join(
  tmpdir(),
  `avermate-material-trash-${process.pid}-${crypto.randomUUID()}.db`,
).replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${testDatabase}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let maintenance: typeof import("./material-trash-maintenance");
let storage: typeof import("../lib/storage");

const userId = "material-trash-maintenance-user";
const yearId = "material-trash-maintenance-year";
const now = new Date("2026-08-21T10:00:00.000Z");
const cutoff = new Date("2026-07-22T10:00:00.000Z");
const expiredAt = new Date("2026-07-01T10:00:00.000Z");

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  registerSharedTestDatabaseLifecycle(database.$client, {
    files: [testDatabase],
  });
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  await database.insert(schema.users).values({
    id: userId,
    name: "Material trash maintenance",
    email: "material-trash-maintenance@example.test",
    emailVerified: true,
    role: "user",
    banned: false,
  });
  await database.insert(schema.years).values({
    id: yearId,
    name: "Material trash year",
    startsAt: new Date("2025-09-01T00:00:00.000Z"),
    endsAt: new Date("2026-08-31T00:00:00.000Z"),
    userId,
  });
  maintenance = await import("./material-trash-maintenance");
  storage = await import("../lib/storage");
}, 30_000);

afterAll(async () => {
  await database
    .delete(schema.jobs)
    .where(eq(schema.jobs.kind, maintenance.PURGE_MATERIAL_TRASH_JOB_KIND));
  await database
    .delete(schema.materialDocuments)
    .where(eq(schema.materialDocuments.userId, userId));
  await database.delete(schema.files).where(eq(schema.files.userId, userId));
  await database.delete(schema.users).where(eq(schema.users.id, userId));
});

async function insertTrashedDocument(input: { id: string; fileId?: string }) {
  await database.insert(schema.materialDocuments).values({
    id: input.id,
    title: input.id,
    sourceType: input.fileId ? "file" : "text",
    fileId: input.fileId ?? null,
    textContent: input.fileId ? null : "expired fixture",
    yearId,
    userId,
    deletedAt: expiredAt,
    deletedBy: "user",
    deletedBatchId: `trash_${input.id}`,
  });
}

describe("material trash maintenance", () => {
  test("drains more than one batch through immediate durable continuations", async () => {
    const documentIds = Array.from(
      { length: 5 },
      (_, index) => `batch_${index}_${crypto.randomUUID()}`,
    ).sort();
    for (const id of documentIds) await insertTrashedDocument({ id });

    let payload: unknown = {
      scheduledFor: now.toISOString(),
      cutoff: cutoff.toISOString(),
    };
    const examined: number[] = [];
    const continuationIds: string[] = [];
    for (;;) {
      const result = await maintenance.runMaterialTrashMaintenanceJob(payload, {
        now: () => now,
        batchSize: 2,
      });
      examined.push(result.examined);
      if (!result.continuationJobId) {
        expect(result.hasMore).toBe(false);
        break;
      }
      expect(result.hasMore).toBe(true);
      continuationIds.push(result.continuationJobId);
      const [continuation] = await database
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, result.continuationJobId));
      expect(continuation).toMatchObject({
        kind: maintenance.PURGE_MATERIAL_TRASH_JOB_KIND,
        status: "queued",
        runAt: now,
      });
      payload = continuation?.payload;
    }

    expect(examined).toEqual([2, 2, 1]);
    expect(continuationIds).toHaveLength(2);
    const remaining = await database
      .select({ id: schema.materialDocuments.id })
      .from(schema.materialDocuments)
      .where(inArray(schema.materialDocuments.id, documentIds));
    expect(remaining).toHaveLength(0);
  });

  test("isolates one storage cleanup failure and continues with later targets", async () => {
    const suffix = crypto.randomUUID();
    const badFileId = `file_bad_${suffix}`;
    const goodFileId = `file_good_${suffix}`;
    const badDocumentId = `fault_a_${suffix}`;
    const goodDocumentId = `fault_b_${suffix}`;
    await database.insert(schema.files).values([
      {
        id: badFileId,
        provider: "local",
        storageKey: `trash/${badFileId}.pdf`,
        url: `https://example.invalid/${badFileId}.pdf`,
        mimeType: "application/pdf",
        byteSize: 10,
        purpose: "course-material",
        previewStatus: "unsupported",
        userId,
      },
      {
        id: goodFileId,
        provider: "local",
        storageKey: `trash/${goodFileId}.pdf`,
        url: `https://example.invalid/${goodFileId}.pdf`,
        mimeType: "application/pdf",
        byteSize: 10,
        purpose: "course-material",
        previewStatus: "unsupported",
        userId,
      },
    ]);
    await insertTrashedDocument({ id: badDocumentId, fileId: badFileId });
    await insertTrashedDocument({ id: goodDocumentId, fileId: goodFileId });

    const removePreview: typeof storage.deleteFilePreview = async (
      _targetUserId,
      fileId,
    ) => {
      if (fileId === badFileId) {
        throw new Error("preview storage is unavailable");
      }
      return null;
    };
    const removeFile: typeof storage.deleteFile = async (
      targetUserId,
      fileId,
    ) => {
      const [deleted] = await database
        .update(schema.files)
        .set({ status: "deleted", updatedAt: now })
        .where(
          and(
            eq(schema.files.id, fileId),
            eq(schema.files.userId, targetUserId),
          ),
        )
        .returning();
      if (!deleted) throw new Error("file fixture disappeared");
      return deleted;
    };
    const first = await maintenance.runMaterialTrashMaintenanceJob(
      {
        scheduledFor: now.toISOString(),
        cutoff: cutoff.toISOString(),
      },
      {
        now: () => now,
        batchSize: 1,
        deleteFile: removeFile,
        deleteFilePreview: removePreview,
      },
    );
    expect(first).toMatchObject({
      examined: 1,
      purged: 0,
      failed: 1,
      hasMore: true,
    });
    expect(first.failures).toEqual([
      {
        kind: "document",
        id: badDocumentId,
        error: "preview storage is unavailable",
      },
    ]);
    const [continuation] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, first.continuationJobId!));
    const second = await maintenance.runMaterialTrashMaintenanceJob(
      continuation?.payload,
      {
        now: () => now,
        batchSize: 1,
        deleteFile: removeFile,
        deleteFilePreview: removePreview,
      },
    );
    expect(second).toMatchObject({
      examined: 1,
      purged: 1,
      failed: 0,
      hasMore: false,
      continuationJobId: null,
    });

    const documents = await database
      .select({ id: schema.materialDocuments.id })
      .from(schema.materialDocuments)
      .where(
        inArray(schema.materialDocuments.id, [badDocumentId, goodDocumentId]),
      );
    expect(documents).toEqual([{ id: badDocumentId }]);
  });
});
