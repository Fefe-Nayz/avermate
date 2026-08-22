import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  files,
  jobs,
  materialArtifacts,
  materialDocuments,
  materialFolders,
} from "../../db/schema";
import { OCR_JOB_KIND, isOcrMimeType } from "../../jobs/ocr";
import {
  TRANSCRIBE_MATERIAL_MEDIA_JOB_KIND,
  isTranscribableMediaMimeType,
} from "../../jobs/transcribe-material-media";
import { enqueueMaterialPreview } from "../../jobs/material-preview";
import { enqueueLinkIngestion } from "../../jobs/ingest-link";
import { assertSameYear } from "../../lib/domain-integrity";
import { isProduction } from "../../lib/env";
import { IngestError, parseHttpSourceUrl } from "../../lib/ingest";
import { badRequest, protectedProcedure } from "../../lib/orpc";
import { enqueueJob } from "../../lib/jobs";
import { ocrEnabled } from "../../lib/ocr";
import { transcriptionEnabled } from "../../lib/transcription";
import { reserveDurableRateLimit } from "../../lib/rate-limit";
import {
  requireFile,
  requireLiveMaterialFolder,
  requireMaterialDocument,
  requireYear,
} from "../../lib/ownership";
import {
  deleteFile,
  deleteFilePreview,
  fileAccessUrl,
  COURSE_MATERIAL_EXTENSIONS,
  COURSE_MEDIA_EXTENSIONS,
  FILE_CONSTRAINTS,
  courseUploadPurpose,
  storageEnabled,
  storeFile,
  requireUploadedFile,
} from "../../lib/storage";
import {
  collectMaterialFolderDescendantIds,
  materialLinkTitle,
} from "./shared";
import { materialTagIdsByTarget } from "./tags";
import {
  deleteMaterialTargetTagLinks,
  trashMaterialTarget,
} from "./operations";

const titleSchema = z.string().trim().min(1).max(160);
const textContentSchema = z.string();
const DEFAULT_OCR_SKIP_PATTERNS = ["*_c.*", "*_corrige.*"] as const;
const OCR_BATCH_JOB_KIND = "ocr.batch";
const OCR_BATCH_ENQUEUE_CONCURRENCY = 16;
const OCR_BATCH_STATUS_CHUNK_SIZE = 250;
const MAX_REPORTED_BATCH_FAILURES = 25;
const MAX_OCR_BATCH_ITEMS = 1_000;
const OCR_BATCH_START_LIMIT = isProduction ? 6 : 100;
const OCR_BATCH_START_WINDOW_MS = 60 * 60_000;
const ocrSkipPatternsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(20)
  .default([...DEFAULT_OCR_SKIP_PATTERNS]);

const ocrBatchMetadataShape = {
  version: z.literal(1),
  yearId: z.string().min(1),
  folderId: z.string().min(1).nullable(),
  candidates: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
};
const ocrBatchDocumentSchema = z.object({
  documentId: z.string().min(1),
  title: z.string(),
  mode: z.enum(["ocr", "media"]).default("ocr"),
});
const ocrBatchPayloadSchema = z.discriminatedUnion("phase", [
  z
    .object({
      ...ocrBatchMetadataShape,
      phase: z.literal("preparing"),
      documents: z.array(ocrBatchDocumentSchema),
    })
    .strict(),
  z
    .object({
      ...ocrBatchMetadataShape,
      phase: z.literal("running"),
      items: z.array(
        ocrBatchDocumentSchema.extend({
          jobId: z.string().min(1),
        }),
      ),
    })
    .strict(),
]);

type OcrBatchPayload = z.infer<typeof ocrBatchPayloadSchema>;
type RunningOcrBatchPayload = Extract<OcrBatchPayload, { phase: "running" }>;

function assertTextContentSize(value: string) {
  if (new TextEncoder().encode(value).byteLength > 256 * 1024) {
    badRequest("Pasted material must be 256 KiB or smaller");
  }
}

const publicFile = {
  id: files.id,
  mimeType: files.mimeType,
  byteSize: files.byteSize,
  status: files.status,
  previewStatus: files.previewStatus,
};

/**
 * Lightweight year-list projection. Inline bodies and provider/internal
 * metadata belong to `documents.get`; including them here would duplicate up
 * to 256 KiB per note into the SSR payload and the hydrated query cache.
 */
const publicDocumentSummary = {
  id: materialDocuments.id,
  title: materialDocuments.title,
  folderId: materialDocuments.folderId,
  sourceType: materialDocuments.sourceType,
  sourceUrl: materialDocuments.sourceUrl,
  origin: materialDocuments.origin,
  yearId: materialDocuments.yearId,
  metaVersion: materialDocuments.metaVersion,
  sourceKind: sql<
    "web" | "youtube" | null
  >`CASE WHEN json_extract(${materialDocuments.metaJson}, '$.kind') IN ('web', 'youtube') THEN json_extract(${materialDocuments.metaJson}, '$.kind') ELSE NULL END`.as(
    "sourceKind",
  ),
  thumbnailUrl: sql<string | null>`NULL`.as("thumbnailUrl"),
  starredAt: materialDocuments.starredAt,
  deletedAt: materialDocuments.deletedAt,
  deletedFrom: materialDocuments.deletedFrom,
  createdAt: materialDocuments.createdAt,
  updatedAt: materialDocuments.updatedAt,
};

async function validateDocumentFolder(
  userId: string,
  yearId: string,
  folderId: string | null,
) {
  if (!folderId) return;
  const folder = await requireLiveMaterialFolder(userId, folderId);
  assertSameYear("Material document folder", yearId, folder.yearId);
}

async function selectDocumentWithFile(userId: string, documentId: string) {
  const [row] = await db
    .select({ document: materialDocuments, file: publicFile })
    .from(materialDocuments)
    .leftJoin(files, eq(files.id, materialDocuments.fileId))
    .where(
      and(
        eq(materialDocuments.id, documentId),
        eq(materialDocuments.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findDocumentWithFile(userId: string, documentId: string) {
  return selectDocumentWithFile(userId, documentId);
}

function globMatches(value: string, pattern: string) {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${expression}$`, "i").test(value);
}

async function currentArtifact(
  documentId: string,
  kind: "ocr-markdown" | "web-markdown" | "media-transcript",
) {
  const [artifact] = await db
    .select()
    .from(materialArtifacts)
    .where(
      and(
        eq(materialArtifacts.documentId, documentId),
        eq(materialArtifacts.kind, kind),
      ),
    )
    .limit(1);
  return artifact ?? null;
}

async function enqueueDocumentTranscription(
  userId: string,
  documentId: string,
  mode: "ocr" | "media",
) {
  return enqueueJob({
    kind: mode === "media" ? TRANSCRIBE_MATERIAL_MEDIA_JOB_KIND : OCR_JOB_KIND,
    payload: { documentId },
    userId,
    idempotencyKey: documentId,
    maxAttempts: 3,
  });
}

function transcriptionMode(mimeType: string): "ocr" | "media" | null {
  if (isOcrMimeType(mimeType)) return "ocr";
  if (isTranscribableMediaMimeType(mimeType)) return "media";
  return null;
}

async function requireTranscriptionProviders(
  userId: string,
  selected: Array<{ mode: "ocr" | "media" }>,
) {
  if (
    selected.some(({ mode }) => mode === "ocr") &&
    !(await ocrEnabled(userId))
  ) {
    badRequest(
      "OCR is not configured. Add a Mistral key in Settings → Integrations.",
    );
  }
  if (
    selected.some(({ mode }) => mode === "media") &&
    !(await transcriptionEnabled(userId))
  ) {
    badRequest(
      "Audio transcription is not configured. Add a transcription key in Settings → Integrations.",
    );
  }
}

async function selectOcrBatchCandidates(input: {
  userId: string;
  yearId: string;
  folderIds?: string[];
  skipPatterns: string[];
}) {
  const rows = await db
    .select({ document: materialDocuments, file: publicFile })
    .from(materialDocuments)
    .innerJoin(files, eq(files.id, materialDocuments.fileId))
    .where(
      and(
        eq(materialDocuments.userId, input.userId),
        eq(materialDocuments.yearId, input.yearId),
        isNull(materialDocuments.deletedAt),
        eq(materialDocuments.sourceType, "file"),
        input.folderIds
          ? inArray(materialDocuments.folderId, input.folderIds)
          : undefined,
        eq(files.status, "stored"),
      ),
    )
    .orderBy(asc(materialDocuments.title));
  const ready = new Set(
    (
      await db
        .select({ documentId: materialArtifacts.documentId })
        .from(materialArtifacts)
        .where(
          and(
            eq(materialArtifacts.userId, input.userId),
            or(
              eq(materialArtifacts.kind, "ocr-markdown"),
              eq(materialArtifacts.kind, "media-transcript"),
            ),
            eq(materialArtifacts.status, "ready"),
          ),
        )
    ).map((artifact) => artifact.documentId),
  );
  const candidates = rows.flatMap(({ document, file }) => {
    const mode = transcriptionMode(file.mimeType);
    return !ready.has(document.id) && mode ? [{ document, file, mode }] : [];
  });
  const selected = candidates.filter(
    ({ document }) =>
      !input.skipPatterns.some((pattern) =>
        globMatches(document.title, pattern),
      ),
  );
  return { candidates, selected };
}

function batchActiveKey(yearId: string) {
  return `year:${yearId}`;
}

function chunksOf<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function prepareTranscriptionBatch(
  userId: string,
  batch: typeof jobs.$inferSelect,
) {
  const payload = ocrBatchPayloadSchema.parse(batch.payload);
  if (payload.phase === "running") return { batch, payload };

  const items = [] as RunningOcrBatchPayload["items"];
  for (const documents of chunksOf(
    payload.documents,
    OCR_BATCH_ENQUEUE_CONCURRENCY,
  )) {
    const enqueued = await Promise.all(
      documents.map(async (document) => ({
        document,
        job: await enqueueDocumentTranscription(
          userId,
          document.documentId,
          document.mode,
        ),
      })),
    );
    items.push(
      ...enqueued.map(({ document, job }) => ({
        jobId: job.id,
        documentId: document.documentId,
        title: document.title,
        mode: document.mode,
      })),
    );
  }

  const runningPayload: RunningOcrBatchPayload = {
    version: payload.version,
    phase: "running",
    yearId: payload.yearId,
    folderId: payload.folderId,
    candidates: payload.candidates,
    skipped: payload.skipped,
    items,
  };
  const [prepared] = await db
    .update(jobs)
    .set({ payload: runningPayload, updatedAt: new Date() })
    .where(
      and(
        eq(jobs.id, batch.id),
        eq(jobs.userId, userId),
        eq(jobs.kind, OCR_BATCH_JOB_KIND),
      ),
    )
    .returning();
  if (!prepared) throw new Error("The OCR batch could not be prepared");
  return { batch: prepared, payload: runningPayload };
}

async function transcriptionBatchProgress(
  userId: string,
  batch: typeof jobs.$inferSelect,
) {
  const prepared = await prepareTranscriptionBatch(userId, batch);
  const currentBatch = prepared.batch;
  const payload = prepared.payload;
  const childIds = payload.items.map((item) => item.jobId);
  const childJobs = (
    await Promise.all(
      chunksOf(childIds, OCR_BATCH_STATUS_CHUNK_SIZE).map((ids) =>
        db
          .select({
            id: jobs.id,
            status: jobs.status,
            result: jobs.result,
            error: jobs.error,
          })
          .from(jobs)
          .where(and(eq(jobs.userId, userId), inArray(jobs.id, ids))),
      ),
    )
  ).flat();
  const childById = new Map(childJobs.map((job) => [job.id, job]));
  const items = payload.items.map((item) => {
    const job = childById.get(item.jobId);
    const status = job?.status ?? "failed";
    const result =
      job?.result && typeof job.result === "object"
        ? (job.result as Record<string, unknown>)
        : null;
    return {
      ...item,
      status,
      error: job?.error ?? (job ? null : "Transcription job unavailable"),
      pageCount:
        typeof result?.pageCount === "number" ? result.pageCount : null,
    };
  });
  const queued = items.filter((item) => item.status === "queued").length;
  const running = items.filter((item) => item.status === "running").length;
  const succeeded = items.filter((item) => item.status === "succeeded").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const cancelled = items.filter((item) => item.status === "cancelled").length;
  const unsuccessful = failed + cancelled;
  const processed = succeeded + unsuccessful;
  const status =
    queued + running > 0
      ? ("running" as const)
      : unsuccessful > 0
        ? ("completed_with_errors" as const)
        : ("completed" as const);
  const current =
    items.find((item) => item.status === "running") ??
    items.find((item) => item.status === "queued") ??
    null;

  if (
    status !== "running" &&
    currentBatch.idempotencyKey === batchActiveKey(payload.yearId)
  ) {
    await db
      .update(jobs)
      .set({
        status: unsuccessful > 0 ? "failed" : "succeeded",
        result: {
          outcome: status,
          total: items.length,
          succeeded,
          failed,
          cancelled,
        },
        error:
          unsuccessful > 0
            ? `${unsuccessful} transcription jobs did not succeed`
            : null,
        idempotencyKey: `${batchActiveKey(payload.yearId)}:terminal:${currentBatch.id}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.id, currentBatch.id),
          eq(jobs.idempotencyKey, batchActiveKey(payload.yearId)),
        ),
      );
  }

  return {
    id: currentBatch.id,
    status,
    candidates: payload.candidates,
    skipped: payload.skipped,
    total: items.length,
    processed,
    queued,
    running,
    succeeded,
    failed,
    cancelled,
    currentFile: current?.title ?? null,
    failures: items
      .filter((item) => item.status === "failed" || item.status === "cancelled")
      .map((item) => ({
        documentId: item.documentId,
        title: item.title,
        error: item.error,
      }))
      .slice(0, MAX_REPORTED_BATCH_FAILURES),
    createdAt: currentBatch.createdAt.toISOString(),
  };
}

export async function getTranscriptionBatchProgress(
  userId: string,
  batchId: string,
) {
  const [batch] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.id, batchId),
        eq(jobs.userId, userId),
        eq(jobs.kind, OCR_BATCH_JOB_KIND),
      ),
    )
    .limit(1);
  return batch ? transcriptionBatchProgress(userId, batch) : null;
}

async function findActiveTranscriptionBatch(userId: string, yearId: string) {
  const [batch] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.kind, OCR_BATCH_JOB_KIND),
        eq(jobs.idempotencyKey, batchActiveKey(yearId)),
      ),
    )
    .limit(1);
  return batch ?? null;
}

async function startTranscriptionBatch(input: {
  userId: string;
  yearId: string;
  folderId: string | null;
  candidates: number;
  skipped: number;
  selected: Array<{
    document: typeof materialDocuments.$inferSelect;
    mode: "ocr" | "media";
  }>;
}) {
  const existing = await findActiveTranscriptionBatch(
    input.userId,
    input.yearId,
  );
  if (existing) {
    const progress = await transcriptionBatchProgress(input.userId, existing);
    if (progress.status === "running") {
      return {
        batchId: existing.id,
        enqueued: 0,
        alreadyRunning: true,
      };
    }
  }

  if (input.selected.length === 0) {
    return { batchId: null, enqueued: 0, alreadyRunning: false };
  }
  if (input.selected.length > MAX_OCR_BATCH_ITEMS) {
    badRequest(
      `A transcription batch can contain at most ${MAX_OCR_BATCH_ITEMS} files`,
    );
  }

  await reserveDurableRateLimit({
    subject: input.userId,
    action: "materials.ocr.batch.start",
    limit: OCR_BATCH_START_LIMIT,
    windowMs: OCR_BATCH_START_WINDOW_MS,
  });

  const initialPayload: OcrBatchPayload = {
    version: 1,
    phase: "preparing",
    yearId: input.yearId,
    folderId: input.folderId,
    candidates: input.candidates,
    skipped: input.skipped,
    documents: input.selected.map(({ document, mode }) => ({
      documentId: document.id,
      title: document.title,
      mode,
    })),
  };
  // Claim the year before enqueueing children. The preparation manifest is
  // complete enough to resume after a crash; concurrent requests can only help
  // prepare this same selection and never create invisible child jobs.
  const [batch] = await db
    .insert(jobs)
    .values({
      kind: OCR_BATCH_JOB_KIND,
      payload: initialPayload,
      status: "running",
      maxAttempts: 1,
      idempotencyKey: batchActiveKey(input.yearId),
      userId: input.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (!batch) {
    const raced = await findActiveTranscriptionBatch(
      input.userId,
      input.yearId,
    );
    if (!raced) throw new Error("The active OCR batch could not be resolved");
    await prepareTranscriptionBatch(input.userId, raced);
    return { batchId: raced.id, enqueued: 0, alreadyRunning: true };
  }

  const prepared = await prepareTranscriptionBatch(input.userId, batch);
  return {
    batchId: prepared.batch.id,
    enqueued: prepared.payload.items.length,
    alreadyRunning: false,
  };
}

export interface MaterialDocumentsRouterDependencies {
  storeFile?: typeof storeFile;
  deleteFile?: typeof deleteFile;
  fileAccessUrl?: typeof fileAccessUrl;
  storageEnabled?: typeof storageEnabled;
  reserveUpload?: typeof reserveDurableRateLimit;
  enqueuePreview?: typeof enqueueMaterialPreview;
  requireUploadedFile?: typeof requireUploadedFile;
}

export function createMaterialDocumentsRouter(
  dependencies: MaterialDocumentsRouterDependencies = {},
) {
  const persistFile = dependencies.storeFile ?? storeFile;
  const removeFile = dependencies.deleteFile ?? deleteFile;
  const resolveAccessUrl = dependencies.fileAccessUrl ?? fileAccessUrl;
  const canUpload = dependencies.storageEnabled ?? storageEnabled;
  const reserveUpload = dependencies.reserveUpload ?? reserveDurableRateLimit;
  const queuePreview = dependencies.enqueuePreview ?? enqueueMaterialPreview;
  const resolveUploadedFile =
    dependencies.requireUploadedFile ?? requireUploadedFile;

  return {
    uploadsEnabled: protectedProcedure.handler(() => ({
      enabled: canUpload(),
      // Backward-compatible generic limit for document clients. Media-aware
      // clients use maxMediaBytes below.
      maxBytes: FILE_CONSTRAINTS["course-material"].maxBytes,
      maxDocumentBytes: FILE_CONSTRAINTS["course-material"].maxBytes,
      maxMediaBytes: FILE_CONSTRAINTS["course-media"].maxBytes,
      mimeTypes: [
        ...FILE_CONSTRAINTS["course-material"].mimeTypes,
        ...FILE_CONSTRAINTS["course-media"].mimeTypes,
      ],
      extensions: [...COURSE_MATERIAL_EXTENSIONS, ...COURSE_MEDIA_EXTENSIONS],
    })),

    list: protectedProcedure
      .input(
        z.object({
          yearId: z.string().min(1),
          /** undefined = whole year, null = documents outside a folder. */
          folderId: z.string().nullable().optional(),
          include: z.enum(["live", "trashed"]).default("live"),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        if (typeof input.folderId === "string") {
          await validateDocumentFolder(userId, input.yearId, input.folderId);
        }
        const folderFilter =
          input.folderId === undefined
            ? undefined
            : input.folderId === null
              ? isNull(materialDocuments.folderId)
              : eq(materialDocuments.folderId, input.folderId);
        const rows = await db
          .select({ document: publicDocumentSummary, file: publicFile })
          .from(materialDocuments)
          .leftJoin(files, eq(files.id, materialDocuments.fileId))
          .where(
            and(
              eq(materialDocuments.userId, userId),
              eq(materialDocuments.yearId, input.yearId),
              folderFilter,
              input.include === "trashed"
                ? isNotNull(materialDocuments.deletedAt)
                : isNull(materialDocuments.deletedAt),
            ),
          )
          .orderBy(
            asc(materialDocuments.title),
            asc(materialDocuments.createdAt),
          );
        const tagIds = await materialTagIdsByTarget({
          userId,
          yearId: input.yearId,
          targetKind: "document",
          targetIds: rows.map(({ document }) => document.id),
        });
        return rows.map(({ document, file }) => ({
          document: {
            ...document,
            tagIds: tagIds.get(document.id) ?? [],
          },
          file,
        }));
      }),

    /**
     * Content-only search kept separate from the lightweight list projection.
     * Returning matching ids avoids shipping multi-megabyte OCR/transcript
     * bodies in every materials-list response while still making derived text
     * discoverable from the explorer.
     */
    search: protectedProcedure
      .input(
        z
          .object({
            yearId: z.string().min(1),
            query: z.string().trim().min(1).max(200),
            include: z.enum(["live", "trashed"]).default("live"),
          })
          .strict(),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        const escaped = input.query
          .replaceAll("\\", "\\\\")
          .replaceAll("%", "\\%")
          .replaceAll("_", "\\_");
        const pattern = `%${escaped}%`;
        const matches = await db
          .select({ documentId: materialDocuments.id })
          .from(materialDocuments)
          .leftJoin(
            materialArtifacts,
            and(
              eq(materialArtifacts.documentId, materialDocuments.id),
              eq(materialArtifacts.userId, userId),
              eq(materialArtifacts.status, "ready"),
            ),
          )
          .where(
            and(
              eq(materialDocuments.userId, userId),
              eq(materialDocuments.yearId, input.yearId),
              input.include === "trashed"
                ? isNotNull(materialDocuments.deletedAt)
                : isNull(materialDocuments.deletedAt),
              or(
                sql<boolean>`${materialDocuments.textContent} LIKE ${pattern} ESCAPE '\\' COLLATE NOCASE`,
                sql<boolean>`${materialArtifacts.content} LIKE ${pattern} ESCAPE '\\' COLLATE NOCASE`,
              ),
            ),
          )
          .groupBy(materialDocuments.id)
          .limit(200);
        return matches.map(({ documentId }) => documentId);
      }),

    get: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireMaterialDocument(userId, input.documentId);
        return findDocumentWithFile(userId, input.documentId);
      }),

    transcript: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }))
      .handler(async ({ context, input }) => {
        const document = await requireMaterialDocument(
          context.session.user.id,
          input.documentId,
        );
        if (document.sourceType === "text") {
          return {
            status: "ready" as const,
            content: document.textContent ?? "",
            meta: null,
            error: null,
          };
        }
        let artifactKind: "ocr-markdown" | "web-markdown" | "media-transcript" =
          document.sourceType === "link" ? "web-markdown" : "ocr-markdown";
        if (document.sourceType === "file" && document.fileId) {
          const file = await requireFile(
            context.session.user.id,
            document.fileId,
          );
          if (isTranscribableMediaMimeType(file.mimeType)) {
            artifactKind = "media-transcript";
          }
        }
        const artifact = await currentArtifact(document.id, artifactKind);
        return artifact
          ? {
              status: artifact.status,
              content: artifact.status === "ready" ? artifact.content : null,
              meta: artifact.status === "ready" ? artifact.metaJson : null,
              error: artifact.status === "failed" ? artifact.error : null,
            }
          : {
              status: "idle" as const,
              content: null,
              meta: null,
              error: null,
            };
      }),

    transcribe: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const document = await requireMaterialDocument(
          userId,
          input.documentId,
        );
        if (document.sourceType !== "file" || !document.fileId) {
          badRequest(
            "Only uploaded documents, audio and video can be transcribed",
          );
        }
        const file = await requireFile(userId, document.fileId);
        const mode = transcriptionMode(file.mimeType);
        if (file.status !== "stored" || !mode) {
          badRequest("This available file type cannot be transcribed");
        }
        await requireTranscriptionProviders(userId, [{ mode }]);
        const artifact = await currentArtifact(
          document.id,
          mode === "media" ? "media-transcript" : "ocr-markdown",
        );
        const job = await enqueueDocumentTranscription(
          userId,
          document.id,
          mode,
        );
        return {
          jobId: job.id,
          artifactStatus:
            job.status === "queued" || job.status === "running"
              ? ("pending" as const)
              : (artifact?.status ?? ("pending" as const)),
        };
      }),

    transcribeAll: protectedProcedure
      .input(
        z.object({
          yearId: z.string().min(1),
          skipPatterns: ocrSkipPatternsSchema,
          dryRun: z.boolean().default(false),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        const { candidates, selected } = await selectOcrBatchCandidates({
          userId,
          yearId: input.yearId,
          skipPatterns: input.skipPatterns,
        });
        const skipped = candidates.length - selected.length;
        if (input.dryRun) {
          return {
            candidates: candidates.length,
            enqueued: 0,
            skipped,
            batchId: null,
            alreadyRunning: false,
          };
        }
        if (selected.length > 0) {
          await requireTranscriptionProviders(userId, selected);
        }
        const started = await startTranscriptionBatch({
          userId,
          yearId: input.yearId,
          folderId: null,
          candidates: candidates.length,
          skipped,
          selected,
        });
        return {
          candidates: candidates.length,
          skipped,
          ...started,
        };
      }),

    activeTranscriptionBatch: protectedProcedure
      .input(z.object({ yearId: z.string().min(1) }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        const batch = await findActiveTranscriptionBatch(userId, input.yearId);
        return batch ? transcriptionBatchProgress(userId, batch) : null;
      }),

    transcribeFolder: protectedProcedure
      .input(
        z.object({
          folderId: z.string().min(1),
          skipPatterns: ocrSkipPatternsSchema,
          dryRun: z.boolean().default(false),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const folder = await requireLiveMaterialFolder(userId, input.folderId);
        const folderRows = await db
          .select({
            id: materialFolders.id,
            parentId: materialFolders.parentId,
          })
          .from(materialFolders)
          .where(
            and(
              eq(materialFolders.userId, userId),
              eq(materialFolders.yearId, folder.yearId),
            ),
          );
        const folderIds = [
          folder.id,
          ...collectMaterialFolderDescendantIds(folderRows, folder.id),
        ];
        const { candidates, selected } = await selectOcrBatchCandidates({
          userId,
          yearId: folder.yearId,
          folderIds,
          skipPatterns: input.skipPatterns,
        });
        if (!input.dryRun && selected.length > 0) {
          await requireTranscriptionProviders(userId, selected);
        }
        const jobs = input.dryRun
          ? []
          : await Promise.all(
              selected.map(({ document, mode }) =>
                enqueueDocumentTranscription(userId, document.id, mode),
              ),
            );
        return {
          candidates: candidates.length,
          enqueued: input.dryRun ? 0 : selected.length,
          skipped: candidates.length - selected.length,
          jobIds: jobs.map((job) => job.id),
        };
      }),

    upload: protectedProcedure
      .input(
        z
          .object({
            yearId: z.string().min(1),
            folderId: z.string().nullable().default(null),
            title: titleSchema.optional(),
            file: z.instanceof(File).optional(),
            fileId: z.string().min(1).optional(),
            fileName: z.string().trim().max(160).optional(),
          })
          .refine((input) => Boolean(input.file) !== Boolean(input.fileId), {
            message: "Provide exactly one material upload",
          }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        await validateDocumentFolder(userId, input.yearId, input.folderId);
        await reserveUpload({
          subject: userId,
          action: "materials.document.upload",
          limit: 60,
          windowMs: 60 * 60_000,
        });
        const uploadPurpose = input.file
          ? courseUploadPurpose(input.file)
          : (await requireFile(userId, input.fileId!)).purpose;
        if (
          uploadPurpose !== "course-material" &&
          uploadPurpose !== "course-media"
        ) {
          badRequest("The uploaded file is not a course material");
        }
        const stored = input.fileId
          ? await resolveUploadedFile(userId, input.fileId, uploadPurpose)
          : await persistFile({
              userId,
              purpose: uploadPurpose,
              file: input.file!,
            });
        // A direct-upload id may already have been adopted by a concurrent or
        // replayed request. Only an inline upload is unquestionably this
        // handler's private cleanup candidate.
        const ownsFailureCleanup = input.fileId === undefined;
        try {
          const fallbackTitle =
            input.fileName?.trim().slice(0, 160) ||
            input.file?.name.trim().slice(0, 160) ||
            "Material";
          const [alreadyAdopted] = await db
            .select()
            .from(materialDocuments)
            .where(
              and(
                eq(materialDocuments.fileId, stored.id),
                eq(materialDocuments.userId, userId),
              ),
            )
            .limit(1);
          const [created] = alreadyAdopted
            ? [undefined]
            : await db
                .insert(materialDocuments)
                .values({
                  title: input.title ?? fallbackTitle,
                  folderId: input.folderId,
                  sourceType: "file",
                  fileId: stored.id,
                  adoptionKey: stored.id,
                  sourceUrl: null,
                  textContent: null,
                  origin: "manual",
                  yearId: input.yearId,
                  userId,
                })
                .onConflictDoNothing({ target: materialDocuments.adoptionKey })
                .returning();
          const [document] = alreadyAdopted
            ? [alreadyAdopted]
            : created
              ? [created]
              : await db
                  .select()
                  .from(materialDocuments)
                  .where(
                    and(
                      eq(materialDocuments.adoptionKey, stored.id),
                      eq(materialDocuments.userId, userId),
                    ),
                  )
                  .limit(1);
          if (!document) {
            throw new Error("The uploaded file could not be adopted");
          }
          if (document.yearId !== input.yearId) {
            badRequest("This uploaded file already belongs to another year");
          }
          await queuePreview({ fileId: stored.id, userId }).catch((error) => {
            console.error(
              "[materials] preview enqueue failed",
              error instanceof Error ? error.message : "Unknown queue error",
            );
          });
          return {
            document,
            file: {
              id: stored.id,
              mimeType: stored.mimeType,
              byteSize: stored.byteSize,
              status: stored.status,
            },
          };
        } catch (error) {
          if (ownsFailureCleanup) {
            await removeFile(userId, stored.id).catch(() => undefined);
          }
          throw error;
        }
      }),

    createText: protectedProcedure
      .input(
        z.object({
          yearId: z.string().min(1),
          folderId: z.string().nullable().default(null),
          title: titleSchema,
          textContent: textContentSchema,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        await validateDocumentFolder(userId, input.yearId, input.folderId);
        assertTextContentSize(input.textContent);
        const [document] = await db
          .insert(materialDocuments)
          .values({
            ...input,
            sourceType: "text",
            fileId: null,
            sourceUrl: null,
            origin: "manual",
            userId,
          })
          .returning();
        return { document, file: null };
      }),

    createLink: protectedProcedure
      .input(
        z.object({
          yearId: z.string().min(1),
          folderId: z.string().nullable().default(null),
          title: titleSchema.optional(),
          url: z.url().max(4_096),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        let sourceUrl: string;
        try {
          sourceUrl = parseHttpSourceUrl(input.url).toString();
        } catch (error) {
          if (error instanceof IngestError) badRequest(error.message);
          throw error;
        }
        await requireYear(userId, input.yearId);
        await validateDocumentFolder(userId, input.yearId, input.folderId);
        const titleWasDerived = input.title === undefined;
        const [document] = await db
          .insert(materialDocuments)
          .values({
            title: input.title ?? materialLinkTitle(sourceUrl),
            folderId: input.folderId,
            sourceType: "link",
            fileId: null,
            sourceUrl,
            textContent: null,
            origin: "manual",
            metaVersion: 1,
            metaJson: { externalId: sourceUrl, titleWasDerived },
            yearId: input.yearId,
            userId,
          })
          .returning();
        if (!document) throw new Error("The link source was not returned");
        try {
          const job = await enqueueLinkIngestion({
            documentId: document.id,
            userId,
          });
          return {
            document,
            file: null,
            ingestion: { status: "pending" as const, jobId: job.id },
          };
        } catch (error) {
          await db
            .delete(materialDocuments)
            .where(
              and(
                eq(materialDocuments.id, document.id),
                eq(materialDocuments.userId, userId),
              ),
            );
          throw error;
        }
      }),

    reingest: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }).strict())
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const document = await requireMaterialDocument(
          userId,
          input.documentId,
        );
        if (document.sourceType !== "link" || !document.sourceUrl) {
          badRequest("Only web-link materials can be ingested again");
        }
        const job = await enqueueLinkIngestion({
          documentId: document.id,
          userId,
          idempotencyKey: `${document.id}:${new Date().toISOString()}:${crypto.randomUUID()}`,
        });
        return { status: "pending" as const, jobId: job.id };
      }),

    rename: protectedProcedure
      .input(z.object({ documentId: z.string().min(1), title: titleSchema }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const document = await requireMaterialDocument(
          userId,
          input.documentId,
        );
        if (
          document.origin !== "manual" &&
          !(document.deletedAt && document.deletedBy === "provider")
        ) {
          badRequest("Synchronized materials cannot be renamed locally");
        }
        const [updated] = await db
          .update(materialDocuments)
          .set({
            title: input.title,
            ...(document.sourceType === "link"
              ? {
                  metaVersion: 1,
                  metaJson: {
                    ...document.metaJson,
                    titleWasDerived: false,
                  },
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(materialDocuments.id, input.documentId),
              eq(materialDocuments.userId, userId),
            ),
          )
          .returning();
        return updated;
      }),

    move: protectedProcedure
      .input(
        z.object({
          documentId: z.string().min(1),
          folderId: z.string().nullable(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const document = await requireMaterialDocument(
          userId,
          input.documentId,
        );
        if (document.origin !== "manual") {
          badRequest("Synchronized materials cannot be moved locally");
        }
        await validateDocumentFolder(userId, document.yearId, input.folderId);
        const [updated] = await db
          .update(materialDocuments)
          .set({ folderId: input.folderId, updatedAt: new Date() })
          .where(
            and(
              eq(materialDocuments.id, document.id),
              eq(materialDocuments.userId, userId),
            ),
          )
          .returning();
        return updated;
      }),

    delete: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const document = await requireMaterialDocument(
          userId,
          input.documentId,
        );
        if (document.origin !== "manual") {
          badRequest("Synchronized materials cannot be deleted locally");
        }
        if (!document.deletedAt) {
          await trashMaterialTarget(userId, "document", document.id);
          return { ok: true as const };
        }
        await deleteMaterialTargetTagLinks("document", [document.id]);
        await db
          .delete(materialDocuments)
          .where(
            and(
              eq(materialDocuments.id, document.id),
              eq(materialDocuments.userId, userId),
            ),
          );
        if (document.fileId) {
          await deleteFilePreview(userId, document.fileId).catch(
            () => undefined,
          );
          await removeFile(userId, document.fileId);
        }
        return { ok: true };
      }),

    download: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const document = await requireMaterialDocument(
          userId,
          input.documentId,
        );
        if (document.sourceType !== "file" || !document.fileId) {
          badRequest("Only uploaded materials have a download URL");
        }
        const file = await requireFile(userId, document.fileId);
        if (file.status !== "stored")
          badRequest("This material is unavailable");
        return {
          title: document.title,
          // A PDF viewer can request additional byte ranges long after the
          // first page appears. Keep the owned, short-lived URL valid for the
          // study session instead of expiring it after five minutes.
          url: await resolveAccessUrl(file, { expiresIn: "6h" }),
          mimeType: file.mimeType,
          byteSize: file.byteSize,
        };
      }),
  };
}

export const materialDocumentsRouter = createMaterialDocumentsRouter();
