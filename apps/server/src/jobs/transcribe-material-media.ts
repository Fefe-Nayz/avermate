import { and, eq } from "drizzle-orm";
import { mediaSegmentWorkerOutputV1Schema } from "@avermate/agent-contracts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { db } from "../db";
import {
  files,
  materialArtifacts,
  materialDocuments,
  type MediaTranscriptMetaV1,
} from "../db/schema";
import { NonRetryableJobError } from "../lib/jobs";
import {
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  resolveTranscriptionProvider,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "../lib/transcription";
import {
  localObjectPath,
  readStorageObject,
  signedStorageObjectUrl,
  type ManagedStorageProvider,
} from "../lib/storage-backend";
import { newId } from "../lib/id";
import { canonicalJson, sha256 } from "../search/values";
import { FILE_CONSTRAINTS } from "../lib/storage";
import { runConfiguredSandboxWorker } from "../sandbox/worker-services";

export const TRANSCRIBE_MATERIAL_MEDIA_JOB_KIND = "materials.media.transcribe";
export const MEDIA_SEGMENT_SECONDS = 20 * 60;
export const MEDIA_EXTRACTION_TIMEOUT_MS = 15 * 60_000;

const payloadSchema = z.object({ documentId: z.string().min(1) }).strict();
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const MEDIA_MIME_PREFIXES = ["audio/", "video/"] as const;

export function isTranscribableMediaMimeType(value: string) {
  return MEDIA_MIME_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/gi, "the storage service")
    .replace(/[A-Za-z0-9_-]{80,}/g, "[redacted]")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 8_000);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function managedProvider(value: string): ManagedStorageProvider {
  if (value === "local" || value === "s3") return value;
  throw new NonRetryableJobError(
    "Media transcription requires local or S3-backed storage",
  );
}

function sourceUrl(file: typeof files.$inferSelect) {
  if (file.provider === "local") return localObjectPath(file.storageKey);
  if (file.provider === "s3") return signedStorageObjectUrl(file.storageKey, 60 * 60);
  throw new NonRetryableJobError(
    "Media transcription requires local or S3-backed storage",
  );
}

export async function extractAudioSegments(input: {
  source: string;
  directory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<string[]> {
  input.signal?.throwIfAborted();
  void input;
  throw new NonRetryableJobError(
    "SANDBOX_EXECUTION_REQUIRED:media: native API execution is disabled",
  );
}

async function extractAudioSegmentsInSandbox(input: {
  bytes: Uint8Array;
  mimeType: string;
  ownerId: string;
  documentId: string;
  operationId: string;
  signal?: AbortSignal;
}) {
  const digest = `sha256:${sha256(input.bytes)}`;
  const execution = await runConfiguredSandboxWorker({
    workerId: "media-segment.v1",
    ownerId: input.ownerId,
    threadId: input.documentId,
    branchId: `${input.documentId}-media-transcription-v1`,
    operationId: input.operationId,
    manifest: {
      schemaVersion: 1,
      worker: "media-segment.v1",
      source: {
        path: "input/source",
        digest,
        byteSize: input.bytes.byteLength,
        mimeType: input.mimeType,
      },
      segmentSeconds: MEDIA_SEGMENT_SECONDS,
      maxDurationSeconds: 8 * 60 * 60,
      outputCodec: "mp3-mono-16khz",
    },
    inputFiles: [
      {
        relativePath: "input/source",
        bytes: input.bytes,
        digest,
        mimeType: input.mimeType,
      },
    ],
    maximumReturnBytes:
      FILE_CONSTRAINTS["course-media"].maxBytes + 8 * 1024 * 1024,
    signal: input.signal,
  });
  const output = mediaSegmentWorkerOutputV1Schema.parse(execution.output);
  return output.segments.map((segment) => {
    const bytes = execution.files.get(segment.file.path);
    if (!bytes) throw new Error("SANDBOX_MEDIA_SEGMENT_OUTPUT_MISSING");
    return bytes;
  });
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function transcriptTimestamp(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function mergeMediaTranscriptionResults(results: TranscriptionResult[]) {
  const segments = results.flatMap((result, index) => {
    const offsetMs = index * MEDIA_SEGMENT_SECONDS * 1_000;
    const sourceSegments = result.segments.length
      ? result.segments
      : result.text.trim()
        ? [{ startMs: 0, endMs: 0, text: result.text }]
        : [];
    return sourceSegments
      .map((segment) => ({
        startMs: offsetMs + Math.max(0, segment.startMs),
        endMs: offsetMs + Math.max(segment.startMs, segment.endMs),
        text: segment.text.trim(),
      }))
      .filter((segment) => segment.text);
  });
  const content = segments
    .map(
      (segment) =>
        `## ${transcriptTimestamp(segment.startMs)}\n\n${segment.text}`,
    )
    .join("\n\n");
  const languages = results
    .map((result) => result.language)
    .filter((value): value is string => Boolean(value));
  return {
    content,
    segments,
    language:
      languages.length > 0 && languages.every((value) => value === languages[0])
        ? languages[0]
        : undefined,
  };
}

export async function runTranscribeMaterialMediaJob(
  payload: unknown,
  options: {
    signal?: AbortSignal;
    resolveProvider?: (userId: string) => Promise<TranscriptionProvider>;
    operationId?: string;
    extractSegments?: typeof extractAudioSegments;
    readSegment?: typeof readFile;
    now?: () => number;
  } = {},
) {
  const { documentId } = payloadSchema.parse(payload);
  const [source] = await db
    .select({ document: materialDocuments, file: files })
    .from(materialDocuments)
    .innerJoin(
      files,
      and(
        eq(files.id, materialDocuments.fileId),
        eq(files.userId, materialDocuments.userId),
        eq(files.status, "stored"),
      ),
    )
    .where(eq(materialDocuments.id, documentId))
    .limit(1);
  if (!source || source.document.sourceType !== "file") {
    throw new NonRetryableJobError("Media source document not found");
  }
  if (!isTranscribableMediaMimeType(source.file.mimeType)) {
    throw new NonRetryableJobError(
      "Only audio and video materials can be transcribed",
    );
  }

  const now = new Date();
  const [artifact] = await db
    .insert(materialArtifacts)
    .values({
      documentId,
      kind: "media-transcript",
      status: "pending",
      content: null,
      metaVersion: 1,
      metaJson: null,
      error: null,
      userId: source.document.userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [materialArtifacts.documentId, materialArtifacts.kind],
      set: {
        status: "pending",
        content: null,
        metaVersion: 1,
        metaJson: null,
        error: null,
        updatedAt: now,
      },
    })
    .returning({ id: materialArtifacts.id });
  if (!artifact) throw new Error("Media transcript could not be initialized");

  const clock = options.now ?? Date.now;
  const startedAt = clock();
  const directory = options.extractSegments
    ? await mkdtemp(join(tmpdir(), "avermate-media-"))
    : null;
  try {
    const segmentBytes = options.extractSegments
      ? await Promise.all(
          (
            await options.extractSegments({
              source: await sourceUrl(source.file),
              directory: directory!,
              signal: options.signal,
            })
          ).map(async (path) =>
            new Uint8Array(await (options.readSegment ?? readFile)(path)),
          ),
        )
      : await extractAudioSegmentsInSandbox({
          bytes: new Uint8Array(
            await readStorageObject(
              managedProvider(source.file.provider),
              source.file.storageKey,
              {
                signal: options.signal,
                maxBytes: FILE_CONSTRAINTS["course-media"].maxBytes,
              },
            ),
          ),
          mimeType: source.file.mimeType,
          ownerId: source.document.userId,
          documentId,
          operationId: options.operationId ?? documentId,
          signal: options.signal,
        });
    const provider = await (
      options.resolveProvider ?? resolveTranscriptionProvider
    )(source.document.userId);
    const results: TranscriptionResult[] = [];
    for (const [segmentIndex, bytes] of segmentBytes.entries()) {
      options.signal?.throwIfAborted();
      if (bytes.byteLength > MAX_TRANSCRIPTION_AUDIO_BYTES) {
        throw new Error("An extracted audio segment is larger than 32 MiB");
      }
      results.push(
        await provider.transcribeSegment({
          blob: new Blob([exactArrayBuffer(bytes)], { type: "audio/mpeg" }),
          mimeType: "audio/mpeg",
          operationId: options.operationId
            ? `${options.operationId}:segment:${segmentIndex}`
            : undefined,
          maximumSeconds: MEDIA_SEGMENT_SECONDS,
          signal: options.signal,
        }),
      );
    }
    const merged = mergeMediaTranscriptionResults(results);
    if (!merged.content) throw new Error("The media transcript is empty");
    if (
      new TextEncoder().encode(merged.content).byteLength > MAX_TRANSCRIPT_BYTES
    ) {
      throw new Error("Media transcript is larger than 2 MiB");
    }
    const durationMs = merged.segments.reduce(
      (maximum, segment) => Math.max(maximum, segment.endMs),
      0,
    );
    const meta: MediaTranscriptMetaV1 = {
      provider: provider.id,
      ...(merged.language ? { language: merged.language } : {}),
      durationMs,
      segmentCount: merged.segments.length,
    };
    const publishedAt = Math.floor(Date.now() / 1_000);
    await db.$client
      .batch(
        [
          {
            sql: `DELETE FROM material_artifact_segments WHERE artifactId = ?`,
            args: [artifact.id],
          },
          ...merged.segments.map((segment, ordinal) => ({
            sql: `
            INSERT INTO material_artifact_segments (
              id, artifactId, ordinal, text, locatorJson, contentHash
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
            args: [
              newId("maseg"),
              artifact.id,
              ordinal,
              segment.text,
              canonicalJson({
                kind: source.file.mimeType.startsWith("video/")
                  ? "video"
                  : "audio",
                startMs: segment.startMs,
                endMs: Math.max(segment.startMs + 1, segment.endMs),
              }),
              sha256(segment.text),
            ],
          })),
          {
            sql: `
            UPDATE material_artifacts
            SET status = 'ready', content = ?, metaVersion = 1,
              metaJson = ?, error = NULL, updatedAt = ?
            WHERE id = ? AND status = 'pending'
          `,
            args: [
              merged.content,
              JSON.stringify(meta),
              publishedAt,
              artifact.id,
            ],
          },
          {
            sql: `
            INSERT INTO material_artifact_segments (
              id, artifactId, ordinal, text, locatorJson, contentHash
            )
            SELECT NULL, ?, 0, '', '{}', ? WHERE changes() = 0
          `,
            args: [artifact.id, sha256("")],
          },
        ],
        "write",
      )
      .catch((error) => {
        throw new NonRetryableJobError(
          "The media source was removed while transcribing",
          { cause: error },
        );
      });
    return {
      artifactId: artifact.id,
      segmentCount: merged.segments.length,
      durationMs,
      elapsedMs: Math.max(0, clock() - startedAt),
    };
  } catch (error) {
    await db
      .update(materialArtifacts)
      .set({
        status: "failed",
        content: null,
        metaJson: null,
        error: safeError(error),
        updatedAt: new Date(),
      })
      .where(eq(materialArtifacts.id, artifact.id));
    throw error;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
