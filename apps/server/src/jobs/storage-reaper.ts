import { and, asc, eq, lte, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { db } from "../db";
import {
  documentArtifacts,
  feedback,
  files,
  gradeAttachments,
  jobs,
  materialDocuments,
  recordingSegments,
  studyDocumentBuilds,
  studyDocumentExports,
  users,
} from "../db/schema";
import { enqueueJob } from "../lib/jobs";
import { CLEANUP_UNOWNED_FILE_JOB_KIND } from "./ingest-link";

export const REAP_UNOWNED_FILES_JOB_KIND = "maintenance.reapUnownedStoredFiles";
export const STORAGE_REAPER_INTERVAL_MS = 60 * 60 * 1_000;
export const STORAGE_REAPER_GRACE_MS = 24 * 60 * 60 * 1_000;
export const STORAGE_REAPER_BATCH_SIZE = 100;

const scheduledPayloadSchema = z
  .object({ scheduledFor: z.string().datetime() })
  .strict();

type Enqueue = typeof enqueueJob;
type StoredFileCandidate = Pick<typeof files.$inferSelect, "id" | "userId">;

function utcHourKey(date: Date) {
  return `${date.toISOString().slice(0, 13)}:00Z`;
}

/**
 * Enqueue one deterministic system job per UTC hour. A failed bucket is
 * explicitly rearmed by enqueueJob, while a succeeded bucket remains the
 * authoritative acknowledgement for that hour.
 */
export function enqueueStorageReaperJob(
  runAt = new Date(),
  options: { enqueue?: Enqueue } = {},
) {
  return (options.enqueue ?? enqueueJob)({
    kind: REAP_UNOWNED_FILES_JOB_KIND,
    payload: { scheduledFor: runAt.toISOString() },
    userId: null,
    idempotencyKey: utcHourKey(runAt),
    runAt,
    maxAttempts: 6,
  });
}

async function oldUnownedStoredFiles(cutoff: Date, limit: number) {
  const previewSources = alias(files, "preview_sources");
  const materialReference = db
    .select({ id: materialDocuments.id })
    .from(materialDocuments)
    .where(eq(materialDocuments.fileId, files.id));
  const exportReference = db
    .select({ id: studyDocumentExports.documentId })
    .from(studyDocumentExports)
    .where(eq(studyDocumentExports.fileId, files.id));
  const artifactReference = db
    .select({ id: documentArtifacts.id })
    .from(documentArtifacts)
    .where(eq(documentArtifacts.fileId, files.id));
  const buildReference = db
    .select({ id: studyDocumentBuilds.id })
    .from(studyDocumentBuilds)
    .where(eq(studyDocumentBuilds.pdfFileId, files.id));
  const previewReference = db
    .select({ id: previewSources.id })
    .from(previewSources)
    .where(
      and(
        eq(previewSources.previewFileId, files.id),
        eq(previewSources.status, "stored"),
      ),
    );
  const recordingReference = db
    .select({ id: recordingSegments.id })
    .from(recordingSegments)
    .where(eq(recordingSegments.fileId, files.id));
  const gradeReference = db
    .select({ id: gradeAttachments.id })
    .from(gradeAttachments)
    .where(eq(gradeAttachments.fileId, files.id));
  // Avatars and feedback attachments predate relational file ids and retain
  // their provider URL. They are live references just as much as the four FKs.
  const avatarReference = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.avatarUrl, files.url));
  const feedbackReference = db
    .select({ id: feedback.id })
    .from(feedback)
    .where(eq(feedback.attachmentUrl, files.url));

  return db
    .select({ id: files.id, userId: files.userId })
    .from(files)
    .where(
      and(
        eq(files.status, "stored"),
        lte(files.createdAt, cutoff),
        notExists(materialReference),
        notExists(exportReference),
        notExists(artifactReference),
        notExists(buildReference),
        notExists(previewReference),
        notExists(recordingReference),
        notExists(gradeReference),
        notExists(avatarReference),
        notExists(feedbackReference),
      ),
    )
    .orderBy(asc(files.createdAt), asc(files.id))
    .limit(limit);
}

async function resolveCleanupJob(
  candidate: StoredFileCandidate,
  runAt: Date,
  enqueue: Enqueue,
) {
  const job = await enqueue({
    kind: CLEANUP_UNOWNED_FILE_JOB_KIND,
    payload: { userId: candidate.userId, fileId: candidate.id },
    userId: candidate.userId,
    // Recording adoption uses this exact ledger key. A cleanup claim and the
    // append transaction therefore serialize instead of racing provider delete.
    idempotencyKey: candidate.id,
    runAt,
    maxAttempts: 6,
  });
  if (job.status !== "succeeded") return job;

  // A previous run may have succeeded only because the file was referenced at
  // that time. The reaper's fresh no-reference observation deliberately rearms
  // that same durable row instead of creating an unbounded series of jobs.
  const [rearmed] = await db
    .update(jobs)
    .set({
      payload: { userId: candidate.userId, fileId: candidate.id },
      payloadVersion: 1,
      status: "queued",
      attempts: 0,
      maxAttempts: 6,
      runAt,
      lockedBy: null,
      lockedUntil: null,
      result: null,
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.kind, CLEANUP_UNOWNED_FILE_JOB_KIND),
        eq(jobs.userId, candidate.userId),
        eq(jobs.idempotencyKey, candidate.id),
        eq(jobs.status, "succeeded"),
      ),
    )
    .returning();
  if (rearmed) return rearmed;

  const [raced] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.kind, CLEANUP_UNOWNED_FILE_JOB_KIND),
        eq(jobs.userId, candidate.userId),
        eq(jobs.idempotencyKey, candidate.id),
      ),
    )
    .limit(1);
  if (!raced) {
    throw new Error(`Cleanup ledger for file ${candidate.id} disappeared`);
  }
  return raced;
}

export async function reapUnownedStoredFiles(
  options: {
    now?: () => Date;
    enqueue?: Enqueue;
    graceMs?: number;
    limit?: number;
  } = {},
) {
  const now = options.now?.() ?? new Date();
  const graceMs = options.graceMs ?? STORAGE_REAPER_GRACE_MS;
  const limit = options.limit ?? STORAGE_REAPER_BATCH_SIZE;
  if (!Number.isSafeInteger(graceMs) || graceMs < 1) {
    throw new Error("Storage reaper graceMs must be a positive integer");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Storage reaper limit must be between 1 and 1000");
  }

  const candidates = await oldUnownedStoredFiles(
    new Date(now.getTime() - graceMs),
    limit,
  );
  const enqueue = options.enqueue ?? enqueueJob;
  const cleanupJobs = [];
  for (const candidate of candidates) {
    const job = await resolveCleanupJob(candidate, now, enqueue);
    cleanupJobs.push({
      fileId: candidate.id,
      jobId: job.id,
      status: job.status,
    });
  }
  return { examined: candidates.length, cleanupJobs };
}

/**
 * Handler entrypoint. The successor is durably enqueued before the scan, so a
 * terminal failure in this bucket cannot silently stop future repair passes.
 */
export async function runScheduledStorageReaperJob(
  payload: unknown,
  options: {
    now?: () => Date;
    enqueue?: Enqueue;
    graceMs?: number;
    limit?: number;
  } = {},
) {
  scheduledPayloadSchema.parse(payload);
  const now = options.now?.() ?? new Date();
  const enqueue = options.enqueue ?? enqueueJob;
  const next = await enqueueStorageReaperJob(
    new Date(now.getTime() + STORAGE_REAPER_INTERVAL_MS),
    { enqueue },
  );
  const result = await reapUnownedStoredFiles({
    now: () => now,
    enqueue,
    graceMs: options.graceMs,
    limit: options.limit,
  });
  return { ...result, nextJobId: next.id };
}
