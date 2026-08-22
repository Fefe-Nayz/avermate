import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  files,
  jobs,
  lectureRecordings,
  recordingSegments,
  recordingTranscripts,
  type TranscriptSegmentV1,
} from "../db/schema";
import {
  enqueueJob,
  NonRetryableJobError,
  type JobExecutionIdentity,
} from "../lib/jobs";
import {
  isInternalOwnedFileProvider,
  readOwnedFileBytes,
} from "../lib/owned-file-storage";
import { fileAccessUrl } from "../lib/storage";
import { readStorageObject } from "../lib/storage-backend";
import {
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  resolveTranscriptionProvider,
  type TranscriptionProvider,
} from "../lib/transcription";
import {
  activeUserJobExecutionSql,
  requireUserJobExecution,
  supersededJobExecution,
} from "./job-authority";

export const TRANSCRIBE_SEGMENT_JOB_KIND = "transcribe.segment";
export const TRANSCRIBE_FINALIZE_JOB_KIND = "transcribe.finalize";
export const MAX_FINALIZE_POLLS = 24;
export const FINALIZE_POLL_DELAY_MS = 60_000;
export const TRANSCRIPTION_SOURCE_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1_000;

const MAX_TRANSCRIPT_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_SEGMENTS = 50_000;
const MAX_TRANSCRIPT_JSON_BYTES = 8 * 1024 * 1024;
const TIMESTAMP_DURATION_TOLERANCE_MS = 10_000;

const segmentPayloadSchema = z
  .object({
    segmentId: z.string().min(1),
    runId: z.string().min(1),
  })
  .strict();
const finalizePayloadSchema = z
  .object({
    recordingId: z.string().min(1),
    runId: z.string().min(1),
    pollAttempt: z
      .number()
      .int()
      .min(0)
      .max(MAX_FINALIZE_POLLS - 1)
      .default(0),
  })
  .strict();

export const segmentJobResultSchema = z
  .object({
    segmentId: z.string().min(1),
    provider: z.enum(["mistral", "openai", "node-local"]),
    model: z.string().trim().min(1).max(512),
    text: z.string(),
    segments: z
      .array(
        z
          .object({
            startMs: z.number().int().nonnegative(),
            endMs: z.number().int().nonnegative(),
            text: z.string(),
          })
          .strict(),
      )
      .max(20_000),
    language: z.string().max(64).optional(),
  })
  .strict();

export type SegmentJobResult = z.infer<typeof segmentJobResultSchema>;

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function errorMessage(error: unknown) {
  return (
    (error instanceof Error ? error.message : String(error))
      .trim()
      .slice(0, 8_000) || "Unknown transcription failure"
  );
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Stored lecture audio download was cancelled");
}

function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function sourceDownloadDeadline(
  parent: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const abortFromParent = () =>
    controller.abort(
      parent?.reason instanceof Error
        ? parent.reason
        : new Error("Stored lecture audio download was cancelled"),
    );
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(new Error("Stored lecture audio download timed out")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function boundedResponseBytes(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("A transcription segment must be 32 MiB or smaller");
  }
  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await awaitWithSignal(reader.read(), signal);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("A transcription segment must be 32 MiB or smaller");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (signal.aborted) {
      await reader.cancel(signal.reason).catch(() => undefined);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function succeededSegmentJob(segmentId: string, userId: string) {
  const completed = await db
    .select({ id: jobs.id, status: jobs.status, result: jobs.result })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, TRANSCRIBE_SEGMENT_JOB_KIND),
        or(
          eq(jobs.idempotencyKey, segmentId),
          like(jobs.idempotencyKey, `${segmentId}:%`),
        ),
        eq(jobs.userId, userId),
        eq(jobs.status, "succeeded"),
      ),
    )
    .limit(100);
  for (const job of completed) {
    const parsed = segmentJobResultSchema.safeParse(job.result);
    if (parsed.success && parsed.data.segmentId === segmentId) {
      return { ...job, result: parsed.data };
    }
  }
  return null;
}

async function succeededSegmentResult(segmentId: string, userId: string) {
  return (await succeededSegmentJob(segmentId, userId))?.result ?? null;
}

export async function runTranscribeSegmentJob(
  payload: unknown,
  options: {
    fetch?: Fetcher;
    getProvider?: (userId: string) => Promise<TranscriptionProvider>;
    operationId?: string;
    attempt?: number;
    job?: JobExecutionIdentity;
    signal?: AbortSignal;
    downloadTimeoutMs?: number;
    fileAccessUrl?: typeof fileAccessUrl;
    readStorageObject?: typeof readStorageObject;
    readOwnedFile?: typeof readOwnedFileBytes;
  } = {},
): Promise<SegmentJobResult> {
  const { segmentId, runId } = segmentPayloadSchema.parse(payload);
  const authority = await requireUserJobExecution(
    options.job,
    TRANSCRIBE_SEGMENT_JOB_KIND,
    (storedPayload) => {
      const parsed = segmentPayloadSchema.safeParse(storedPayload);
      return (
        parsed.success &&
        parsed.data.segmentId === segmentId &&
        parsed.data.runId === runId
      );
    },
  );
  const [source] = await db
    .select({
      segment: recordingSegments,
      recording: lectureRecordings,
      file: files,
    })
    .from(recordingSegments)
    .innerJoin(
      lectureRecordings,
      and(
        eq(lectureRecordings.id, recordingSegments.recordingId),
        eq(lectureRecordings.userId, recordingSegments.userId),
      ),
    )
    .innerJoin(
      files,
      and(
        eq(files.id, recordingSegments.fileId),
        eq(files.userId, recordingSegments.userId),
        eq(files.status, "stored"),
      ),
    )
    .where(
      and(
        eq(recordingSegments.id, segmentId),
        authority ? eq(recordingSegments.userId, authority.userId) : undefined,
      ),
    )
    .limit(1);
  if (!source || source.file.purpose !== "lecture-audio-segment") {
    throw authority
      ? new NonRetryableJobError("Lecture recording segment not found")
      : new Error("Lecture recording segment not found");
  }

  if (
    source.recording.status !== "transcribing" ||
    source.recording.transcriptionRunId !== runId
  ) {
    throw new Error("This transcription execution has been superseded");
  }
  const completed = await succeededSegmentResult(
    source.segment.id,
    source.recording.userId,
  );
  if (completed) return completed;
  if (source.file.byteSize > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    throw new Error("A transcription segment must be 32 MiB or smaller");
  }

  try {
    const deadline = sourceDownloadDeadline(
      options.signal,
      options.downloadTimeoutMs ?? TRANSCRIPTION_SOURCE_DOWNLOAD_TIMEOUT_MS,
    );
    let bytes: ArrayBuffer;
    try {
      if (
        isInternalOwnedFileProvider(source.file.provider) ||
        options.readOwnedFile
      ) {
        bytes = await awaitWithSignal(
          (options.readOwnedFile ?? readOwnedFileBytes)(
            source.recording.userId,
            source.file,
            {
              signal: deadline.signal,
              maxBytes: MAX_TRANSCRIPTION_AUDIO_BYTES,
              dependencies: options.readStorageObject
                ? { readManagedObject: options.readStorageObject }
                : undefined,
            },
          ),
          deadline.signal,
        );
      } else {
        if (!options.fetch || !options.fileAccessUrl) {
          throw new Error("Lecture audio uses an unsupported storage provider");
        }
        const sourceUrl = await options.fileAccessUrl(source.file, {
          expiresIn: "6h",
        });
        const response = await awaitWithSignal(
          options.fetch(sourceUrl, {
            signal: deadline.signal,
          }),
          deadline.signal,
        );
        if (!response.ok) {
          throw new Error(
            `Stored lecture audio download returned ${response.status}`,
          );
        }
        bytes = await boundedResponseBytes(
          response,
          MAX_TRANSCRIPTION_AUDIO_BYTES,
          deadline.signal,
        );
      }
    } finally {
      deadline.dispose();
    }
    const provider = await (
      options.getProvider ??
      ((userId: string) => resolveTranscriptionProvider(userId))
    )(source.recording.userId);
    const result = await provider.transcribeSegment({
      blob: new Blob([bytes], { type: source.file.mimeType }),
      mimeType: source.file.mimeType,
      operationId: options.operationId,
      attempt: options.attempt,
      maximumSeconds: Math.max(1, Math.ceil(source.segment.durationMs / 1_000)),
      signal: options.signal,
    });
    const normalized = segmentJobResultSchema.parse({
      segmentId: source.segment.id,
      provider: provider.id,
      model: provider.model,
      text: result.text,
      segments: result.segments,
      ...(result.language ? { language: result.language } : {}),
    });
    if (utf8Bytes(normalized.text) > MAX_TRANSCRIPT_TEXT_BYTES) {
      throw new Error("A segment transcript is larger than 2 MiB");
    }
    if (
      normalized.segments.some(
        (segment) =>
          segment.endMs < segment.startMs ||
          segment.endMs >
            source.segment.durationMs + TIMESTAMP_DURATION_TOLERANCE_MS,
      )
    ) {
      throw new Error(
        "The provider returned timestamps outside the audio segment",
      );
    }

    const [published] = await db
      .update(recordingSegments)
      .set({
        transcriptStatus: "ready",
        transcriptError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(recordingSegments.id, source.segment.id),
          inArray(recordingSegments.transcriptStatus, ["pending", "failed"]),
          sql`exists (select 1 from ${lectureRecordings} where ${lectureRecordings.id} = ${recordingSegments.recordingId} and ${lectureRecordings.userId} = ${source.recording.userId} and ${lectureRecordings.status} = 'transcribing' and ${lectureRecordings.transcriptionRunId} = ${runId})`,
          activeUserJobExecutionSql(authority),
        ),
      )
      .returning({ id: recordingSegments.id });
    if (!published && authority) throw supersededJobExecution();
    return normalized;
  } catch (error) {
    await db
      .update(recordingSegments)
      .set({
        transcriptStatus: "failed",
        transcriptError: errorMessage(error),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(recordingSegments.id, source.segment.id),
          eq(recordingSegments.transcriptStatus, "pending"),
          sql`exists (select 1 from ${lectureRecordings} where ${lectureRecordings.id} = ${recordingSegments.recordingId} and ${lectureRecordings.userId} = ${source.recording.userId} and ${lectureRecordings.status} = 'transcribing' and ${lectureRecordings.transcriptionRunId} = ${runId})`,
          activeUserJobExecutionSql(authority),
        ),
      );
    throw error;
  }
}

type Enqueue = typeof enqueueJob;

export async function enqueueFinalizePoll(
  userId: string,
  recordingId: string,
  runId: string,
  pollAttempt: number,
  options: { enqueue?: Enqueue; runAt?: Date } = {},
) {
  return (options.enqueue ?? enqueueJob)({
    kind: TRANSCRIBE_FINALIZE_JOB_KIND,
    payload: { recordingId, runId, pollAttempt },
    userId,
    idempotencyKey: `${recordingId}:${runId}:${pollAttempt}`,
    runAt: options.runAt,
    maxAttempts: 3,
  });
}

function finalizeIdempotencyKeys(recordingId: string, runId: string) {
  return Array.from(
    { length: MAX_FINALIZE_POLLS },
    (_, pollAttempt) => `${recordingId}:${runId}:${pollAttempt}`,
  );
}

export async function purgeRecordingTranscriptionJobs(input: {
  userId: string;
  recordingId: string;
  segmentIds: readonly string[];
  /** Omit only for deletion, where every historical run must be purged. */
  runId?: string;
}) {
  const finalizeJobs = and(
    eq(jobs.kind, TRANSCRIBE_FINALIZE_JOB_KIND),
    like(
      jobs.idempotencyKey,
      input.runId
        ? `${input.recordingId}:${input.runId}:%`
        : `${input.recordingId}:%`,
    ),
  );
  const transcriptionJobs =
    input.segmentIds.length > 0
      ? or(
          finalizeJobs,
          and(
            eq(jobs.kind, TRANSCRIBE_SEGMENT_JOB_KIND),
            input.runId
              ? inArray(
                  jobs.idempotencyKey,
                  input.segmentIds.map(
                    (segmentId) => `${segmentId}:${input.runId}`,
                  ),
                )
              : or(
                  ...input.segmentIds.flatMap((segmentId) => [
                    eq(jobs.idempotencyKey, segmentId),
                    like(jobs.idempotencyKey, `${segmentId}:%`),
                  ]),
                ),
          ),
        )
      : finalizeJobs;
  return db
    .delete(jobs)
    .where(and(eq(jobs.userId, input.userId), transcriptionJobs))
    .returning({ id: jobs.id });
}

async function enqueueOrResumeFinalizePoll(
  userId: string,
  recordingId: string,
  runId: string,
  options: { enqueue?: Enqueue } = {},
) {
  const existing = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      payload: jobs.payload,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, TRANSCRIBE_FINALIZE_JOB_KIND),
        eq(jobs.userId, userId),
        inArray(
          jobs.idempotencyKey,
          finalizeIdempotencyKeys(recordingId, runId),
        ),
      ),
    );
  const polls = existing
    .map((job) => {
      const parsed = finalizePayloadSchema.safeParse(job.payload);
      return parsed.success &&
        parsed.data.recordingId === recordingId &&
        parsed.data.runId === runId
        ? { ...job, pollAttempt: parsed.data.pollAttempt }
        : null;
    })
    .filter((job): job is NonNullable<typeof job> => job !== null)
    .sort((left, right) => right.pollAttempt - left.pollAttempt);
  const latest = polls[0];
  if (!latest) {
    return enqueueFinalizePoll(userId, recordingId, runId, 0, options);
  }
  if (latest.status === "queued" || latest.status === "running") {
    return latest;
  }
  if (latest.status === "failed" || latest.status === "cancelled") {
    // enqueueJob deliberately rearms an explicitly retried terminal failure.
    return enqueueFinalizePoll(
      userId,
      recordingId,
      runId,
      latest.pollAttempt,
      options,
    );
  }
  if (latest.pollAttempt < MAX_FINALIZE_POLLS - 1) {
    // A succeeded poll normally creates its successor before returning. This
    // repairs a torn completion/scheduling acknowledgement without restarting
    // from the already-consumed poll-zero ledger key.
    return enqueueFinalizePoll(
      userId,
      recordingId,
      runId,
      latest.pollAttempt + 1,
      options,
    );
  }
  throw new Error("The transcription finalization chain cannot be resumed");
}

export async function enqueueRecordingTranscription(
  input: {
    userId: string;
    recordingId: string;
    runId: string;
    segmentIds: readonly string[];
  },
  options: { enqueue?: Enqueue } = {},
) {
  const enqueue = options.enqueue ?? enqueueJob;
  const segmentJobs = await Promise.all(
    input.segmentIds.map(async (segmentId) => {
      const succeeded = await succeededSegmentJob(segmentId, input.userId);
      if (succeeded) {
        return {
          segmentId,
          jobId: succeeded.id,
          status: "succeeded" as const,
        };
      }
      const job = await enqueue({
        kind: TRANSCRIBE_SEGMENT_JOB_KIND,
        payload: { segmentId, runId: input.runId },
        userId: input.userId,
        idempotencyKey: `${segmentId}:${input.runId}`,
        maxAttempts: 1,
      });
      return { segmentId, jobId: job.id, status: job.status };
    }),
  );
  const finalize = await enqueueOrResumeFinalizePoll(
    input.userId,
    input.recordingId,
    input.runId,
    { enqueue },
  );
  return {
    segmentJobs,
    finalizeJob: { jobId: finalize.id, status: finalize.status },
  };
}

async function markRecordingFailed(
  recordingId: string,
  runId: string,
  message: string,
) {
  await db
    .update(lectureRecordings)
    .set({
      status: "failed",
      error: message.slice(0, 8_000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(lectureRecordings.id, recordingId),
        eq(lectureRecordings.status, "transcribing"),
        eq(lectureRecordings.transcriptionRunId, runId),
      ),
    );
  return { status: "failed" as const, error: message };
}

export async function runFinalizeTranscriptionJob(
  payload: unknown,
  options: {
    enqueue?: Enqueue;
    now?: () => Date;
  } = {},
) {
  const { recordingId, runId, pollAttempt } =
    finalizePayloadSchema.parse(payload);
  const [recording] = await db
    .select()
    .from(lectureRecordings)
    .where(eq(lectureRecordings.id, recordingId))
    .limit(1);
  if (!recording || recording.transcriptionRunId !== runId) {
    return { status: "superseded" as const, recordingId, runId };
  }
  if (recording.status === "ready") {
    const [transcript] = await db
      .select({ recordingId: recordingTranscripts.recordingId })
      .from(recordingTranscripts)
      .where(eq(recordingTranscripts.recordingId, recording.id))
      .limit(1);
    if (transcript) {
      return { status: "ready" as const, recordingId: recording.id, runId };
    }
  }
  if (recording.status === "failed") {
    return {
      status: "failed" as const,
      recordingId: recording.id,
      runId,
      error: recording.error,
    };
  }
  if (recording.status !== "transcribing") {
    return { status: "superseded" as const, recordingId, runId };
  }

  const segments = await db
    .select()
    .from(recordingSegments)
    .where(eq(recordingSegments.recordingId, recording.id))
    .orderBy(asc(recordingSegments.seq));
  if (segments.length === 0) {
    return {
      ...(await markRecordingFailed(
        recording.id,
        runId,
        "The recording has no audio segments",
      )),
      recordingId: recording.id,
      runId,
    };
  }

  const segmentIds = segments.map((segment) => segment.id);
  const jobRows = await db
    .select({
      idempotencyKey: jobs.idempotencyKey,
      status: jobs.status,
      result: jobs.result,
      error: jobs.error,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, TRANSCRIBE_SEGMENT_JOB_KIND),
        eq(jobs.userId, recording.userId),
        or(
          ...segmentIds.flatMap((segmentId) => [
            eq(jobs.idempotencyKey, segmentId),
            like(jobs.idempotencyKey, `${segmentId}:%`),
          ]),
        ),
      ),
    );
  const results = new Map<string, SegmentJobResult>();
  const failedSeqs: number[] = [];
  for (const segment of segments) {
    const succeeded = jobRows
      .filter((job) => job.status === "succeeded")
      .map((job) => segmentJobResultSchema.safeParse(job.result))
      .find((parsed) => parsed.success && parsed.data.segmentId === segment.id);
    const currentJob = jobRows.find(
      (job) => job.idempotencyKey === `${segment.id}:${runId}`,
    );
    if (succeeded?.success) {
      results.set(segment.id, succeeded.data);
      if (
        segment.transcriptStatus !== "ready" ||
        segment.transcriptError !== null
      ) {
        await db
          .update(recordingSegments)
          .set({
            transcriptStatus: "ready",
            transcriptError: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(recordingSegments.id, segment.id),
              sql`exists (select 1 from ${lectureRecordings} where ${lectureRecordings.id} = ${recordingSegments.recordingId} and ${lectureRecordings.userId} = ${recording.userId} and ${lectureRecordings.status} = 'transcribing' and ${lectureRecordings.transcriptionRunId} = ${runId})`,
            ),
          );
      }
      continue;
    }
    if (currentJob?.status === "succeeded") {
      failedSeqs.push(segment.seq);
      await db
        .update(recordingSegments)
        .set({
          transcriptStatus: "failed",
          transcriptError: "The transcription job returned an invalid result",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(recordingSegments.id, segment.id),
            sql`exists (select 1 from ${lectureRecordings} where ${lectureRecordings.id} = ${recordingSegments.recordingId} and ${lectureRecordings.userId} = ${recording.userId} and ${lectureRecordings.status} = 'transcribing' and ${lectureRecordings.transcriptionRunId} = ${runId})`,
          ),
        );
      continue;
    }
    if (currentJob?.status === "failed") {
      failedSeqs.push(segment.seq);
      await db
        .update(recordingSegments)
        .set({
          transcriptStatus: "failed",
          transcriptError: errorMessage(currentJob.error),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(recordingSegments.id, segment.id),
            sql`exists (select 1 from ${lectureRecordings} where ${lectureRecordings.id} = ${recordingSegments.recordingId} and ${lectureRecordings.userId} = ${recording.userId} and ${lectureRecordings.status} = 'transcribing' and ${lectureRecordings.transcriptionRunId} = ${runId})`,
          ),
        );
    }
  }
  if (failedSeqs.length > 0) {
    const error = `Transcription failed for segments: ${failedSeqs.join(", ")}`;
    return {
      ...(await markRecordingFailed(recording.id, runId, error)),
      recordingId: recording.id,
      runId,
      failedSeqs,
    };
  }

  const pendingSeqs = segments
    .filter((segment) => !results.has(segment.id))
    .map((segment) => segment.seq);
  if (pendingSeqs.length > 0) {
    if (pollAttempt >= MAX_FINALIZE_POLLS - 1) {
      const error = `Transcription timed out waiting for segments: ${pendingSeqs.join(", ")}`;
      return {
        ...(await markRecordingFailed(recording.id, runId, error)),
        recordingId: recording.id,
        runId,
        pendingSeqs,
      };
    }
    const nextAttempt = pollAttempt + 1;
    const now = options.now?.() ?? new Date();
    const next = await enqueueFinalizePoll(
      recording.userId,
      recording.id,
      runId,
      nextAttempt,
      {
        enqueue: options.enqueue,
        runAt: new Date(now.getTime() + FINALIZE_POLL_DELAY_MS),
      },
    );
    return {
      status: "pending" as const,
      recordingId: recording.id,
      runId,
      pendingSeqs,
      pollAttempt: nextAttempt,
      nextJobId: next.id,
    };
  }

  const transcriptSegments: TranscriptSegmentV1[] = [];
  const paragraphs: string[] = [];
  const languages = new Set<string>();
  let everySegmentHasLanguage = true;
  const provenances = new Set<string>();
  for (const segment of segments) {
    const result = results.get(segment.id) as SegmentJobResult;
    const paragraph = result.text.trim();
    if (paragraph) paragraphs.push(paragraph);
    if (result.language) languages.add(result.language);
    else everySegmentHasLanguage = false;
    provenances.add(`${result.provider}\0${result.model}`);
    for (const window of result.segments) {
      transcriptSegments.push({
        startMs: segment.startOffsetMs + window.startMs,
        endMs: segment.startOffsetMs + window.endMs,
        text: window.text,
      });
    }
  }
  const text = paragraphs.join("\n\n");
  if (utf8Bytes(text) > MAX_TRANSCRIPT_TEXT_BYTES) {
    return {
      ...(await markRecordingFailed(
        recording.id,
        runId,
        "The assembled transcript is larger than 2 MiB",
      )),
      recordingId: recording.id,
      runId,
    };
  }
  if (transcriptSegments.length > MAX_TRANSCRIPT_SEGMENTS) {
    return {
      ...(await markRecordingFailed(
        recording.id,
        runId,
        "The assembled transcript has too many timestamp windows",
      )),
      recordingId: recording.id,
      runId,
    };
  }
  if (
    utf8Bytes(JSON.stringify(transcriptSegments)) > MAX_TRANSCRIPT_JSON_BYTES
  ) {
    return {
      ...(await markRecordingFailed(
        recording.id,
        runId,
        "The assembled timestamp index is larger than 8 MiB",
      )),
      recordingId: recording.id,
      runId,
    };
  }

  const [exactProvenance] = provenances;
  const [provider, model] =
    provenances.size === 1 && exactProvenance
      ? exactProvenance.split("\0", 2)
      : ["mixed", "mixed"];
  const language =
    everySegmentHasLanguage && languages.size === 1
      ? ([...languages][0] as string)
      : null;
  const now = Math.floor(Date.now() / 1_000);
  await db.$client.batch(
    [
      {
        sql: `INSERT INTO "recording_transcripts" ("recordingId", "text", "segmentsVersion", "segmentsJson", "language", "provider", "model", "userId", "createdAt", "updatedAt") SELECT ?, ?, 1, ?, ?, ?, ?, ?, ?, ? FROM "lecture_recordings" WHERE "id" = ? AND "userId" = ? AND "status" = 'transcribing' AND "transcriptionRunId" = ? ON CONFLICT("recordingId") DO UPDATE SET "text" = excluded."text", "segmentsVersion" = 1, "segmentsJson" = excluded."segmentsJson", "language" = excluded."language", "provider" = excluded."provider", "model" = excluded."model", "userId" = excluded."userId", "updatedAt" = excluded."updatedAt"`,
        args: [
          recording.id,
          text,
          JSON.stringify(transcriptSegments),
          language,
          provider,
          model,
          recording.userId,
          now,
          now,
          recording.id,
          recording.userId,
          runId,
        ],
      },
      {
        sql: `UPDATE "lecture_recordings" SET "status" = 'ready', "error" = NULL, "updatedAt" = ? WHERE "id" = ? AND "userId" = ? AND "status" = 'transcribing' AND "transcriptionRunId" = ? AND EXISTS (SELECT 1 FROM "recording_transcripts" WHERE "recordingId" = ? AND "userId" = ?)`,
        args: [
          now,
          recording.id,
          recording.userId,
          runId,
          recording.id,
          recording.userId,
        ],
      },
      {
        sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__recording_finalize_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM "lecture_recordings" WHERE "id" = ? AND "userId" = ? AND "status" = 'ready' AND "transcriptionRunId" = ?)`,
        args: [
          now,
          recording.userId,
          now,
          now,
          recording.id,
          recording.userId,
          runId,
        ],
      },
    ],
    "write",
  );
  return {
    status: "ready" as const,
    recordingId: recording.id,
    runId,
    transcriptSegments: transcriptSegments.length,
  };
}
