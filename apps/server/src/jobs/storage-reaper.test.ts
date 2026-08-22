import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

const testDatabase = join(
  tmpdir(),
  `avermate-storage-reaper-${process.pid}-${crypto.randomUUID()}.db`,
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

const userId = "storage-reaper-user";
const yearId = "storage-reaper-year";
const subjectId = "storage-reaper-subject";
const gradeId = "storage-reaper-grade";
const studyDocumentId = "storage-reaper-study-document";
const recordingId = "storage-reaper-recording";

const now = new Date("2026-08-20T12:30:00.000Z");
const old = new Date(now.getTime() - 48 * 60 * 60 * 1_000);

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  registerSharedTestDatabaseLifecycle(database.$client, {
    files: [testDatabase],
  });
  await database.$client.executeMultiple(migration);

  await database.insert(schema.users).values({
    id: userId,
    name: "Storage reaper user",
    email: "storage-reaper@example.com",
    emailVerified: true,
    role: "user",
    banned: false,
    createdAt: old,
    updatedAt: old,
  });
  await database.insert(schema.years).values({
    id: yearId,
    name: "Storage reaper year",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2027-07-01T00:00:00.000Z"),
    userId,
    createdAt: old,
    updatedAt: old,
  });
  await database.insert(schema.subjects).values({
    id: subjectId,
    name: "Storage reaper subject",
    yearId,
    userId,
    createdAt: old,
    updatedAt: old,
  });
  await database.insert(schema.grades).values({
    id: gradeId,
    name: "Storage reaper grade",
    value: 15,
    outOf: 20,
    passedAt: old,
    subjectId,
    yearId,
    userId,
    createdAt: old,
    updatedAt: old,
  });
  await database.insert(schema.studyDocuments).values({
    id: studyDocumentId,
    title: "Storage reaper document",
    bodyMarkdown: "",
    revision: 1,
    metaVersion: 1,
    yearId,
    userId,
    createdAt: old,
    updatedAt: old,
  });
  await database.insert(schema.lectureRecordings).values({
    id: recordingId,
    title: "Storage reaper recording",
    status: "uploaded",
    recordedAt: old,
    durationMs: 1_000,
    yearId,
    userId,
    createdAt: old,
    updatedAt: old,
  });
});

afterAll(async () => {
  await database
    .delete(schema.studyDocumentBuilds)
    .where(eq(schema.studyDocumentBuilds.userId, userId));
  await database
    .delete(schema.studyDocumentExports)
    .where(eq(schema.studyDocumentExports.userId, userId));
  await database
    .delete(schema.recordingSegments)
    .where(eq(schema.recordingSegments.userId, userId));
  await database
    .delete(schema.gradeAttachments)
    .where(eq(schema.gradeAttachments.userId, userId));
  await database
    .delete(schema.materialDocuments)
    .where(eq(schema.materialDocuments.userId, userId));
  await database
    .update(schema.files)
    .set({ previewFileId: null })
    .where(eq(schema.files.userId, userId));
  await database.delete(schema.files).where(eq(schema.files.userId, userId));
  await database.delete(schema.users).where(eq(schema.users.id, userId));
});

async function storedFile(
  label: string,
  purpose: typeof schema.files.$inferInsert.purpose,
  createdAt = old,
) {
  const id = `file_reaper_${label}_${crypto.randomUUID()}`;
  const [file] = await database
    .insert(schema.files)
    .values({
      id,
      provider: "s3",
      storageKey: `storage-reaper-${label}-${crypto.randomUUID()}`,
      url: `https://example.invalid/storage-reaper/${id}`,
      mimeType:
        purpose === "lecture-audio-segment" ? "audio/webm" : "image/png",
      byteSize: 8,
      purpose,
      status: "stored",
      userId,
      createdAt,
      updatedAt: createdAt,
    })
    .returning();
  if (!file) throw new Error("Storage reaper fixture file was not inserted");
  return file;
}

async function markDeleted(fileIds: readonly string[]) {
  if (fileIds.length === 0) return;
  await database
    .update(schema.files)
    .set({ status: "deleted", updatedAt: now })
    .where(inArray(schema.files.id, [...fileIds]));
}

describe("durable unowned-file reaper", () => {
  test("preserves every relational and legacy URL reference", async () => {
    const materialFile = await storedFile("material", "course-material");
    const exportFile = await storedFile("export", "document-export");
    const recordingFile = await storedFile(
      "recording",
      "lecture-audio-segment",
    );
    const gradeFile = await storedFile("grade", "grade-copy");
    const avatarFile = await storedFile("avatar", "avatar");
    const feedbackFile = await storedFile("feedback", "feedback-attachment");
    const previewSourceFile = await storedFile(
      "preview-source",
      "course-material",
      new Date(now.getTime() - 5 * 60_000),
    );
    const previewFile = await storedFile("preview", "preview");
    const latexBuildFile = await storedFile("latex-build", "latex-build");
    const unownedFile = await storedFile("unowned", "course-material");
    const freshFile = await storedFile(
      "fresh",
      "course-material",
      new Date(now.getTime() - 5 * 60_000),
    );

    await database.insert(schema.materialDocuments).values({
      title: "Referenced material",
      sourceType: "file",
      fileId: materialFile.id,
      yearId,
      userId,
    });
    await database.insert(schema.studyDocumentExports).values({
      documentId: studyDocumentId,
      revision: 1,
      fileId: exportFile.id,
      userId,
    });
    await database.insert(schema.recordingSegments).values({
      recordingId,
      seq: 0,
      fileId: recordingFile.id,
      startOffsetMs: 0,
      durationMs: 1_000,
      userId,
    });
    await database.insert(schema.gradeAttachments).values({
      gradeId,
      fileId: gradeFile.id,
      userId,
    });
    await database
      .update(schema.files)
      .set({ previewFileId: previewFile.id, previewStatus: "ready" })
      .where(eq(schema.files.id, previewSourceFile.id));
    await database.insert(schema.studyDocumentBuilds).values({
      documentId: studyDocumentId,
      revision: 1,
      status: "succeeded",
      pdfFileId: latexBuildFile.id,
      userId,
    });
    await database
      .update(schema.users)
      .set({ avatarUrl: avatarFile.url, updatedAt: now })
      .where(eq(schema.users.id, userId));
    await database.insert(schema.feedback).values({
      kind: "bug",
      subject: "Referenced feedback image",
      message: "Keep this attachment",
      attachmentUrl: feedbackFile.url,
      context: "{}",
      source: "form",
      userId,
    });

    const { reapUnownedStoredFiles } = await import("./storage-reaper");
    const result = await reapUnownedStoredFiles({ now: () => now });
    expect(result.cleanupJobs.map((job) => job.fileId)).toEqual([
      unownedFile.id,
    ]);
    expect(result.cleanupJobs[0]).toMatchObject({ status: "queued" });

    const cleanupRows = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.kind, "cleanup.unownedFile"));
    expect(cleanupRows).toHaveLength(1);
    expect(cleanupRows[0]).toMatchObject({
      userId,
      idempotencyKey: unownedFile.id,
      maxAttempts: 6,
      payload: { userId, fileId: unownedFile.id },
    });
    expect(cleanupRows[0]!.runAt.toISOString()).toBe(now.toISOString());

    const untouched = await database
      .select({ id: schema.files.id, status: schema.files.status })
      .from(schema.files)
      .where(
        inArray(schema.files.id, [
          materialFile.id,
          exportFile.id,
          recordingFile.id,
          gradeFile.id,
          avatarFile.id,
          feedbackFile.id,
          previewSourceFile.id,
          previewFile.id,
          latexBuildFile.id,
          freshFile.id,
        ]),
    );
    expect(untouched.every((file) => file.status === "stored")).toBe(true);

    const { runCleanupUnownedFileJob } = await import("./ingest-link");
    for (const referencedFile of [previewFile, latexBuildFile]) {
      await expect(
        runCleanupUnownedFileJob(
          { userId, fileId: referencedFile.id },
          {
            deleteFile: async () => {
              throw new Error("a referenced derivative must not be deleted");
            },
          },
        ),
      ).resolves.toEqual({ deleted: false, referenced: true });
    }
    await markDeleted([unownedFile.id, freshFile.id]);
  });

  test("cleans a source derivative before deleting an unowned source", async () => {
    const source = await storedFile("source-with-preview", "course-material");
    const preview = await storedFile("source-owned-preview", "preview");
    await database
      .update(schema.files)
      .set({ previewFileId: preview.id, previewStatus: "ready" })
      .where(eq(schema.files.id, source.id));

    const { runCleanupUnownedFileJob } = await import("./ingest-link");
    const { deleteFile, deleteFilePreview } = await import("../lib/storage");
    const confirmProviderDeletion = async () => ({
      success: true,
      deletedCount: 1,
    });
    await expect(
      runCleanupUnownedFileJob(
        { userId, fileId: source.id },
        {
          deleteFile: (ownedUserId, fileId, options) =>
            deleteFile(ownedUserId, fileId, {
              ...options,
              deleteProviderFile: confirmProviderDeletion,
            }),
          deleteFilePreview: (ownedUserId, fileId, options) =>
            deleteFilePreview(ownedUserId, fileId, {
              ...options,
              deleteProviderFile: confirmProviderDeletion,
            }),
        },
      ),
    ).resolves.toEqual({ deleted: true, referenced: false });

    const rows = await database
      .select({
        id: schema.files.id,
        status: schema.files.status,
        previewFileId: schema.files.previewFileId,
      })
      .from(schema.files)
      .where(inArray(schema.files.id, [source.id, preview.id]));
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: source.id, status: "deleted", previewFileId: null },
        { id: preview.id, status: "deleted", previewFileId: null },
      ]),
    );
  });

  test("rearms the stable per-file ledger after a referenced success", async () => {
    const file = await storedFile("rearm", "lecture-audio-segment");
    const { reapUnownedStoredFiles } = await import("./storage-reaper");
    const first = await reapUnownedStoredFiles({ now: () => now });
    const firstJob = first.cleanupJobs.find((job) => job.fileId === file.id);
    expect(firstJob).toBeDefined();

    await database
      .update(schema.jobs)
      .set({
        status: "succeeded",
        attempts: 6,
        result: { deleted: false, referenced: true },
        error: "old error",
      })
      .where(eq(schema.jobs.id, firstJob!.jobId));

    const second = await reapUnownedStoredFiles({ now: () => now });
    expect(second.cleanupJobs).toContainEqual({
      fileId: file.id,
      jobId: firstJob!.jobId,
      status: "queued",
    });
    const [rearmed] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, firstJob!.jobId));
    expect(rearmed).toMatchObject({
      status: "queued",
      attempts: 0,
      maxAttempts: 6,
      result: null,
      error: null,
    });
    await markDeleted([file.id]);
  });

  test("schedules its successor before a candidate enqueue failure", async () => {
    const file = await storedFile("successor", "course-material");
    const {
      REAP_UNOWNED_FILES_JOB_KIND,
      STORAGE_REAPER_INTERVAL_MS,
      runScheduledStorageReaperJob,
    } = await import("./storage-reaper");
    const { enqueueJob } = await import("../lib/jobs");
    const calls: string[] = [];
    const enqueue: typeof enqueueJob = async (input) => {
      calls.push(input.kind);
      if (input.kind === "cleanup.unownedFile") {
        throw new Error("simulated cleanup ledger outage");
      }
      return enqueueJob(input);
    };

    await expect(
      runScheduledStorageReaperJob(
        { scheduledFor: now.toISOString() },
        { now: () => now, enqueue },
      ),
    ).rejects.toThrow("simulated cleanup ledger outage");
    expect(calls[0]).toBe(REAP_UNOWNED_FILES_JOB_KIND);

    const nextRunAt = new Date(now.getTime() + STORAGE_REAPER_INTERVAL_MS);
    const [successor] = await database
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, REAP_UNOWNED_FILES_JOB_KIND),
          isNull(schema.jobs.userId),
        ),
      );
    expect(successor).toMatchObject({ status: "queued", maxAttempts: 6 });
    expect(successor?.runAt.toISOString()).toBe(nextRunAt.toISOString());
    await markDeleted([file.id]);
  });

  test("leaves provider failures retryable in the cleanup job", async () => {
    const file = await storedFile("strict-provider", "course-material");
    const { runCleanupUnownedFileJob } = await import("./ingest-link");
    await expect(
      runCleanupUnownedFileJob(
        { userId, fileId: file.id },
        {
          deleteFile: async () => {
            throw new Error("provider still unavailable");
          },
        },
      ),
    ).rejects.toThrow("provider still unavailable");
    const [row] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, file.id));
    expect(row?.status).toBe("stored");
    await markDeleted([file.id]);
  });
});
