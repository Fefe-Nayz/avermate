import { and, eq } from "drizzle-orm";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
  signedStorageObjectUrl,
} from "../lib/storage-backend";

export const TRANSCRIBE_MATERIAL_MEDIA_JOB_KIND =
  "materials.media.transcribe";
export const MEDIA_SEGMENT_SECONDS = 20 * 60;
export const MEDIA_EXTRACTION_TIMEOUT_MS = 15 * 60_000;

const payloadSchema = z.object({ documentId: z.string().min(1) }).strict();
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_DURATION_SECONDS = 8 * 60 * 60;
const MAX_FFMPEG_LOG_BYTES = 16 * 1024;
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

async function boundedText(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let retained = 0;
  let text = "";
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    const remaining = Math.max(0, maxBytes - retained);
    if (remaining > 0) {
      const kept = part.value.subarray(0, remaining);
      retained += kept.byteLength;
      text += decoder.decode(kept, { stream: true });
    }
  }
  return `${text}${decoder.decode()}`.trim();
}

function sourceUrl(file: typeof files.$inferSelect) {
  if (file.provider === "local") return localObjectPath(file.storageKey);
  if (file.provider === "s3") {
    // ffmpeg reads the private object as a stream. This avoids buffering a
    // potentially 500 MiB lecture in the worker merely to extract its audio.
    return signedStorageObjectUrl(file.storageKey, 60 * 60);
  }
  throw new NonRetryableJobError(
    "Media transcription requires local or S3-backed storage",
  );
}

async function extractAudioSegments(input: {
  source: string;
  directory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  input.signal?.throwIfAborted();
  const outputPattern = join(input.directory, "segment-%03d.mp3");
  const child = Bun.spawn(
    [
      process.env.FFMPEG_BIN?.trim() || "ffmpeg",
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-threads",
      "1",
      "-t",
      String(MAX_MEDIA_DURATION_SECONDS),
      "-i",
      input.source,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "48k",
      "-f",
      "segment",
      "-segment_time",
      String(MEDIA_SEGMENT_SECONDS),
      "-reset_timestamps",
      "1",
      outputPattern,
    ],
    {
      cwd: input.directory,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    },
  );
  let timedOut = false;
  const stop = () => child.kill("SIGKILL");
  input.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, input.timeoutMs ?? MEDIA_EXTRACTION_TIMEOUT_MS);
  try {
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      boundedText(child.stderr, MAX_FFMPEG_LOG_BYTES),
    ]);
    input.signal?.throwIfAborted();
    if (timedOut) throw new Error("Media audio extraction timed out");
    if (exitCode !== 0) {
      throw new Error(stderr || `ffmpeg exited with status ${exitCode}`);
    }
    const entries = (await readdir(input.directory))
      .filter((name) => /^segment-\d{3}\.mp3$/.test(name))
      .sort();
    if (entries.length === 0) {
      throw new NonRetryableJobError("This media file has no audio track");
    }
    return entries.map((name) => join(input.directory, name));
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", stop);
  }
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

export function mergeMediaTranscriptionResults(
  results: TranscriptionResult[],
) {
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
    throw new NonRetryableJobError("Only audio and video materials can be transcribed");
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
  const directory = await mkdtemp(join(tmpdir(), "avermate-media-"));
  try {
    const paths = await (options.extractSegments ?? extractAudioSegments)({
      source: await sourceUrl(source.file),
      directory,
      signal: options.signal,
    });
    const provider = await (
      options.resolveProvider ?? resolveTranscriptionProvider
    )(source.document.userId);
    const results: TranscriptionResult[] = [];
    for (const path of paths) {
      options.signal?.throwIfAborted();
      const bytes = await (options.readSegment ?? readFile)(path);
      if (bytes.byteLength > MAX_TRANSCRIPTION_AUDIO_BYTES) {
        throw new Error("An extracted audio segment is larger than 32 MiB");
      }
      results.push(
        await provider.transcribeSegment({
          blob: new Blob([bytes], { type: "audio/mpeg" }),
          mimeType: "audio/mpeg",
          signal: options.signal,
        }),
      );
    }
    const merged = mergeMediaTranscriptionResults(results);
    if (!merged.content) throw new Error("The media transcript is empty");
    if (new TextEncoder().encode(merged.content).byteLength > MAX_TRANSCRIPT_BYTES) {
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
    const [published] = await db
      .update(materialArtifacts)
      .set({
        status: "ready",
        content: merged.content,
        metaVersion: 1,
        metaJson: meta,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(materialArtifacts.id, artifact.id))
      .returning({ id: materialArtifacts.id });
    if (!published) {
      throw new NonRetryableJobError("The media source was removed while transcribing");
    }
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
    await rm(directory, { recursive: true, force: true });
  }
}
