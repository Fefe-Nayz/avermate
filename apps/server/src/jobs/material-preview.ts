import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import { materialPreviewWorkerOutputV1Schema } from "@avermate/agent-contracts";
import { z } from "zod";
import { db } from "../db";
import { files, type FilePreviewStatus } from "../db/schema";
import { enqueueJob, NonRetryableJobError } from "../lib/jobs";
import {
  readStorageObject,
  type ManagedStorageProvider,
} from "../lib/storage-backend";
import {
  deleteFile,
  FILE_CONSTRAINTS,
  storeFile,
} from "../lib/storage";
import { runConfiguredSandboxWorker } from "../sandbox/worker-services";
import { sha256 } from "../search/values";

export const MATERIAL_PREVIEW_JOB_KIND = "materials.preview";
export const MATERIAL_PREVIEW_MAX_DIMENSION = 512;
export const MATERIAL_PREVIEW_TIMEOUT_MS = 20_000;
const PREVIEW_MIME_TYPE = "image/webp";
const supportedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const payloadSchema = z.object({ fileId: z.string().min(1) }).strict();

export interface MaterialPreviewRenderInput {
  bytes: Uint8Array;
  mimeType: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export type MaterialPreviewRenderer = (
  input: MaterialPreviewRenderInput,
) => Promise<Uint8Array>;

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/gi, "the storage service")
    .replace(/[A-Za-z0-9_-]{80,}/g, "[redacted]")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Production deployments must replace this seam with a broker-backed media
 * worker. The API process never renders untrusted bytes with native tools.
 */
export async function renderMaterialPreview(
  input: MaterialPreviewRenderInput,
): Promise<Uint8Array> {
  input.signal?.throwIfAborted();
  throw new NonRetryableJobError(
    "SANDBOX_EXECUTION_REQUIRED:media: native API execution is disabled",
  );
}

async function renderMaterialPreviewInSandbox(
  input: MaterialPreviewRenderInput & {
    ownerId: string;
    fileId: string;
    operationId: string;
  },
) {
  const digest = `sha256:${sha256(input.bytes)}`;
  const execution = await runConfiguredSandboxWorker({
    workerId: "material-preview.v1",
    ownerId: input.ownerId,
    threadId: input.fileId,
    branchId: `${input.fileId}-preview-v1`,
    operationId: input.operationId,
    manifest: {
      schemaVersion: 1,
      worker: "material-preview.v1",
      source: {
        path: "input/source",
        digest,
        byteSize: input.bytes.byteLength,
        mimeType: input.mimeType,
      },
      maximumDimension: MATERIAL_PREVIEW_MAX_DIMENSION,
    },
    inputFiles: [
      {
        relativePath: "input/source",
        bytes: input.bytes,
        digest,
        mimeType: input.mimeType,
      },
    ],
    maximumReturnBytes: FILE_CONSTRAINTS.preview.maxBytes + 1024 * 1024,
    signal: input.signal,
  });
  const output = materialPreviewWorkerOutputV1Schema.parse(execution.output);
  const preview = execution.files.get(output.preview.path);
  if (!preview) throw new Error("SANDBOX_PREVIEW_OUTPUT_MISSING");
  return preview;
}

function managedProvider(value: string): ManagedStorageProvider | null {
  return value === "local" || value === "s3" ? value : null;
}

async function validExistingPreview(
  source: typeof files.$inferSelect,
) {
  if (source.previewStatus !== "ready" || !source.previewFileId) return null;
  const [preview] = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, source.previewFileId),
        eq(files.userId, source.userId),
        eq(files.purpose, "preview"),
        eq(files.status, "stored"),
      ),
    )
    .limit(1);
  return preview ?? null;
}

async function setPreviewStatus(
  source: Pick<typeof files.$inferSelect, "id" | "userId">,
  status: Exclude<FilePreviewStatus, "ready">,
) {
  await db
    .update(files)
    .set({
      previewFileId: null,
      previewStatus: status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(files.id, source.id),
        eq(files.userId, source.userId),
        // A losing worker must never erase a preview another lease adopted.
        or(ne(files.previewStatus, "ready"), isNull(files.previewFileId)),
      ),
    );
}

async function cleanupCandidate(
  userId: string,
  fileId: string,
  remove: typeof deleteFile,
) {
  await remove(userId, fileId).catch(() => undefined);
}

export async function enqueueMaterialPreview(input: {
  fileId: string;
  userId: string;
}) {
  const [source] = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, input.fileId),
        eq(files.userId, input.userId),
        eq(files.purpose, "course-material"),
        eq(files.status, "stored"),
      ),
    )
    .limit(1);
  if (!source) {
    throw new NonRetryableJobError("Preview source file not found");
  }
  const retryTerminal = source.previewStatus === "failed";
  if (retryTerminal) await setPreviewStatus(source, "pending");
  return enqueueJob({
    kind: MATERIAL_PREVIEW_JOB_KIND,
    payload: { fileId: source.id },
    userId: source.userId,
    idempotencyKey: source.id,
    maxAttempts: 3,
    newAttemptAfterTerminal: retryTerminal,
  });
}

/** Repair missed post-upload enqueues and backfill pre-preview material rows. */
export async function enqueuePendingMaterialPreviews(limit = 1_000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Pending preview scan limit must be between 1 and 1000");
  }
  const candidates = await db
    .select({ id: files.id, userId: files.userId })
    .from(files)
    .where(
      and(
        eq(files.purpose, "course-material"),
        eq(files.status, "stored"),
        eq(files.previewStatus, "pending"),
      ),
    )
    .orderBy(asc(files.createdAt), asc(files.id))
    .limit(limit);

  let enqueued = 0;
  let failed = 0;
  for (let index = 0; index < candidates.length; index += 16) {
    const results = await Promise.allSettled(
      candidates.slice(index, index + 16).map((candidate) =>
        enqueueMaterialPreview({
          fileId: candidate.id,
          userId: candidate.userId,
        }),
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") enqueued += 1;
      else failed += 1;
    }
  }
  return { scanned: candidates.length, enqueued, failed };
}

export async function runMaterialPreviewJob(
  payload: unknown,
  options: {
    signal?: AbortSignal;
    readStorageObject?: typeof readStorageObject;
    renderPreview?: MaterialPreviewRenderer;
    storeFile?: typeof storeFile;
    deleteFile?: typeof deleteFile;
    afterAdopt?: () => Promise<void>;
    /** Current durable queue attempt; omitted direct calls are terminal. */
    attempt?: number;
    maxAttempts?: number;
    operationId?: string;
  } = {},
) {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new NonRetryableJobError("Invalid materials.preview job payload", {
      cause: parsed.error,
    });
  }
  const [source] = await db
    .select()
    .from(files)
    .where(eq(files.id, parsed.data.fileId))
    .limit(1);
  if (!source || source.purpose !== "course-material") {
    throw new NonRetryableJobError("Preview source file not found");
  }
  if (source.status !== "stored") {
    throw new NonRetryableJobError("Preview source file is unavailable");
  }
  const existing = await validExistingPreview(source);
  if (existing) {
    return {
      fileId: source.id,
      previewFileId: existing.id,
      status: "ready" as const,
    };
  }
  if (source.previewStatus === "ready" && source.previewFileId) {
    // Repair a stale ready pointer only if it is still the one we inspected.
    await db
      .update(files)
      .set({
        previewFileId: null,
        previewStatus: "pending",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(files.id, source.id),
          eq(files.userId, source.userId),
          eq(files.previewStatus, "ready"),
          eq(files.previewFileId, source.previewFileId),
        ),
      );
  }
  const provider = managedProvider(source.provider);
  if (!provider) {
    await setPreviewStatus(source, "unsupported");
    return { fileId: source.id, status: "unsupported" as const };
  }
  if (!supportedMimeTypes.has(source.mimeType.toLowerCase())) {
    await setPreviewStatus(source, "unsupported");
    return { fileId: source.id, status: "unsupported" as const };
  }

  const [claimed] = await db
    .update(files)
    .set({ previewFileId: null, previewStatus: "pending", updatedAt: new Date() })
    .where(
      and(
        eq(files.id, source.id),
        eq(files.userId, source.userId),
        eq(files.status, "stored"),
        or(ne(files.previewStatus, "ready"), isNull(files.previewFileId)),
      ),
    )
    .returning({ id: files.id });
  if (!claimed) {
    const [current] = await db
      .select()
      .from(files)
      .where(eq(files.id, source.id))
      .limit(1);
    const winner = current ? await validExistingPreview(current) : null;
    if (winner) {
      return {
        fileId: source.id,
        previewFileId: winner.id,
        status: "ready" as const,
      };
    }
    throw new NonRetryableJobError("Preview source file changed before rendering");
  }

  let candidateId: string | null = null;
  try {
    const buffer = await (options.readStorageObject ?? readStorageObject)(
      provider,
      source.storageKey,
      {
        signal: options.signal,
        maxBytes: FILE_CONSTRAINTS["course-material"].maxBytes,
      },
    );
    const renderInput = {
      bytes: new Uint8Array(buffer),
      mimeType: source.mimeType.toLowerCase(),
      signal: options.signal,
      timeoutMs: MATERIAL_PREVIEW_TIMEOUT_MS,
    };
    const rendered = options.renderPreview
      ? await options.renderPreview(renderInput)
      : await renderMaterialPreviewInSandbox({
          ...renderInput,
          ownerId: source.userId,
          fileId: source.id,
          operationId: options.operationId ?? source.id,
        });
    if (
      rendered.byteLength < 12 ||
      rendered.byteLength > FILE_CONSTRAINTS.preview.maxBytes
    ) {
      throw new Error("The generated preview has an invalid size");
    }
    const renderedHeader = new TextDecoder("ascii").decode(
      rendered.subarray(0, 12),
    );
    if (!renderedHeader.startsWith("RIFF") || !renderedHeader.endsWith("WEBP")) {
      throw new Error("The preview renderer did not return a WebP image");
    }
    const stored = await (options.storeFile ?? storeFile)({
      userId: source.userId,
      purpose: "preview",
      file: new File([exactArrayBuffer(rendered)], `${source.id}.webp`, {
        type: PREVIEW_MIME_TYPE,
      }),
      nameHint: `${source.id}.webp`,
    });
    candidateId = stored.id;

    const [adopted] = await db
      .update(files)
      .set({
        previewFileId: stored.id,
        previewStatus: "ready",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(files.id, source.id),
          eq(files.userId, source.userId),
          eq(files.status, "stored"),
          eq(files.previewStatus, "pending"),
          isNull(files.previewFileId),
        ),
      )
      .returning({ previewFileId: files.previewFileId });
    await options.afterAdopt?.();
    if (adopted?.previewFileId === stored.id) {
      candidateId = null;
      return {
        fileId: source.id,
        previewFileId: stored.id,
        status: "ready" as const,
      };
    }

    const [current] = await db
      .select()
      .from(files)
      .where(eq(files.id, source.id))
      .limit(1);
    if (current) {
      const winner = await validExistingPreview(current);
      if (winner) {
        await cleanupCandidate(
          source.userId,
          stored.id,
          options.deleteFile ?? deleteFile,
        );
        candidateId = null;
        return {
          fileId: source.id,
          previewFileId: winner.id,
          status: "ready" as const,
        };
      }
    }
    throw new Error("The generated preview could not be adopted");
  } catch (error) {
    if (candidateId) {
      const [current] = await db
        .select({ previewFileId: files.previewFileId })
        .from(files)
        .where(eq(files.id, source.id))
        .limit(1);
      if (current?.previewFileId === candidateId) {
        return {
          fileId: source.id,
          previewFileId: candidateId,
          status: "ready" as const,
        };
      }
      await cleanupCandidate(
        source.userId,
        candidateId,
        options.deleteFile ?? deleteFile,
      );
    }
    if (options.signal?.aborted) {
      await setPreviewStatus(source, "pending");
      options.signal.throwIfAborted();
    }
    const message = safeError(error) || "Preview generation failed";
    if (error instanceof NonRetryableJobError) {
      await setPreviewStatus(source, "failed");
      return { fileId: source.id, status: "failed" as const, error: message };
    }
    const attempt = options.attempt ?? 1;
    const maxAttempts = options.maxAttempts ?? 1;
    if (attempt < maxAttempts) {
      await setPreviewStatus(source, "pending");
      throw new Error(message, { cause: error });
    }
    await setPreviewStatus(source, "failed");
    return { fileId: source.id, status: "failed" as const, error: message };
  }
}
