import { and, eq } from "drizzle-orm";
import { mediaSegmentWorkerOutputV1Schema } from "@avermate/agent-contracts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { db } from "../db";
import {
  files,
  materialDocuments,
  type MediaTranscriptMetaV1,
} from "../db/schema";
import { NonRetryableJobError, type JobExecutionIdentity } from "../lib/jobs";
import {
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  resolveTranscriptionProvider,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "../lib/transcription";
import { canonicalJson, sha256 } from "../search/values";
import { readOwnedFileBytes } from "../lib/owned-file-storage";
import { FILE_CONSTRAINTS } from "../lib/storage";
import { runConfiguredSandboxWorker } from "../sandbox/worker-services";
import { requireUserJobExecution } from "./job-authority";
import {
  claimMaterialArtifactGeneration,
  failMaterialArtifactGeneration,
  publishMaterialArtifactGeneration,
} from "./material-artifact-generation";

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
    attempt?: number;
    job?: JobExecutionIdentity;
    extractSegments?: typeof extractAudioSegments;
    readSegment?: typeof readFile;
    readFile?: typeof readOwnedFileBytes;
    writeSource?: typeof writeFile;
    now?: () => number;
  } = {},
) {
  const { documentId } = payloadSchema.parse(payload);
  const authority = await requireUserJobExecution(
    options.job,
    TRANSCRIBE_MATERIAL_MEDIA_JOB_KIND,
    (storedPayload) => {
      const parsed = payloadSchema.safeParse(storedPayload);
      return parsed.success && parsed.data.documentId === documentId;
    },
  );
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
    .where(
      and(
        eq(materialDocuments.id, documentId),
        authority ? eq(materialDocuments.userId, authority.userId) : undefined,
      ),
    )
    .limit(1);
  if (!source || source.document.sourceType !== "file") {
    throw new NonRetryableJobError("Media source document not found");
  }
  if (!isTranscribableMediaMimeType(source.file.mimeType)) {
    throw new NonRetryableJobError(
      "Only audio and video materials can be transcribed",
    );
  }

  const generation = await claimMaterialArtifactGeneration({
    documentId,
    kind: "media-transcript",
    userId: source.document.userId,
    runToken: authority?.runToken ?? `manual:${crypto.randomUUID()}`,
    job: authority,
  });

  const clock = options.now ?? Date.now;
  const startedAt = clock();
  const directory = options.extractSegments
    ? await mkdtemp(join(tmpdir(), "avermate-media-"))
    : null;
  try {
    const sourceBytes = new Uint8Array(
      await (options.readFile ?? readOwnedFileBytes)(
        source.document.userId,
        source.file,
        {
          signal: options.signal,
          maxBytes: FILE_CONSTRAINTS["course-media"].maxBytes,
        },
      ),
    );
    const segmentBytes = options.extractSegments
      ? await (async () => {
          const sourcePath = join(directory!, "source-media");
          await (options.writeSource ?? writeFile)(sourcePath, sourceBytes);
          return Promise.all(
            (
              await options.extractSegments!({
                source: sourcePath,
                directory: directory!,
                signal: options.signal,
              })
            ).map(
              async (path) =>
                new Uint8Array(await (options.readSegment ?? readFile)(path)),
            ),
          );
        })()
      : await extractAudioSegmentsInSandbox({
          bytes: sourceBytes,
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
          attempt: options.attempt,
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
      model: provider.model,
      ...(merged.language ? { language: merged.language } : {}),
      durationMs,
      segmentCount: merged.segments.length,
    };
    await publishMaterialArtifactGeneration({
      generation,
      content: merged.content,
      metaJson: JSON.stringify(meta),
      segments: merged.segments.map((segment) => ({
        text: segment.text,
        locatorJson: canonicalJson({
          kind: source.file.mimeType.startsWith("video/") ? "video" : "audio",
          startMs: segment.startMs,
          endMs: Math.max(segment.startMs + 1, segment.endMs),
        }),
        contentHash: sha256(segment.text),
      })),
    }).catch((error) => {
      throw new NonRetryableJobError(
        "The media source was removed while transcribing",
        { cause: error },
      );
    });
    return {
      artifactId: generation.artifactId,
      segmentCount: merged.segments.length,
      durationMs,
      elapsedMs: Math.max(0, clock() - startedAt),
    };
  } catch (error) {
    await failMaterialArtifactGeneration({
      generation,
      error: safeError(error),
    });
    throw error;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
