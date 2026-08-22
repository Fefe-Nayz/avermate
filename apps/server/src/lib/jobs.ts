import { and, asc, eq, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { jobs } from "../db/schema";
import { env } from "./env";

/**
 * The in-process durable queue.
 *
 * Claims use a one-minute lease. Work that cannot reliably finish inside that
 * window must be split into resumable jobs; silently extending the lease would
 * make crash recovery unpredictable.
 */

export const JOB_LEASE_MS = 60_000;
export const DEFAULT_JOB_RUNNER_CONCURRENCY = 4;
const MAX_BACKOFF_MS = 5 * 60_000;
const BASE_BACKOFF_MS = 2_000;

export type JobHandler = (context: {
  payload: unknown;
  jobId: string;
  attempts: number;
  maxAttempts: number;
  signal?: AbortSignal;
}) => Promise<unknown>;

export interface JobRunnerHandle {
  stop(): void;
}

/** A handler failure that must be recorded once instead of retried. */
export class NonRetryableJobError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NonRetryableJobError";
  }
}

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(kind: string, handler: JobHandler) {
  const normalized = kind.trim();
  if (!normalized) throw new Error("A job handler kind is required");
  if (handlers.has(normalized)) {
    throw new Error(
      `A handler is already registered for job kind ${normalized}`,
    );
  }
  handlers.set(normalized, handler);
}

export interface EnqueueJobInput {
  kind: string;
  payload?: unknown;
  payloadVersion?: number;
  userId?: string | null;
  idempotencyKey?: string | null;
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Keep idempotency only while work is active. A later explicit request
   * archives the terminal ledger key and receives a fresh job id.
   */
  newAttemptAfterTerminal?: boolean;
}

export async function enqueueJob(input: EnqueueJobInput) {
  const kind = input.kind.trim();
  if (!kind) throw new Error("A job kind is required");
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new Error("maxAttempts must be an integer between 1 and 100");
  }
  const payloadVersion = input.payloadVersion ?? 1;
  if (!Number.isInteger(payloadVersion) || payloadVersion < 1) {
    throw new Error("payloadVersion must be a positive integer");
  }

  const userId = input.userId ?? null;
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const [created] = await db
    .insert(jobs)
    .values({
      kind,
      payload: input.payload ?? null,
      payloadVersion,
      userId,
      idempotencyKey,
      runAt: input.runAt ?? new Date(),
      maxAttempts,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  if (!idempotencyKey) {
    throw new Error(`The ${kind} job could not be enqueued`);
  }
  const [existing] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, kind),
        eq(jobs.idempotencyKey, idempotencyKey),
        userId === null ? isNull(jobs.userId) : eq(jobs.userId, userId),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error(`The idempotent ${kind} job could not be resolved`);
  }
  if (
    input.newAttemptAfterTerminal &&
    (existing.status === "succeeded" ||
      existing.status === "failed" ||
      existing.status === "cancelled")
  ) {
    // Move the immutable terminal history away from the canonical active key.
    // The conditional update is the mutex: concurrent explicit requests race
    // here, then all resolve the one newly inserted canonical job below.
    await db
      .update(jobs)
      .set({
        idempotencyKey: `${idempotencyKey}:terminal:${existing.id}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.id, existing.id),
          eq(jobs.idempotencyKey, idempotencyKey),
          or(
            eq(jobs.status, "succeeded"),
            eq(jobs.status, "failed"),
            eq(jobs.status, "cancelled"),
          ),
        ),
      );
    return enqueueJob(input);
  }
  // A terminal failure fences concurrent duplicates, not an explicit retry.
  // Reuse the row so the unique idempotency ledger remains authoritative while
  // giving a person one clean new attempt after fixing a key or provider issue.
  if (existing.status === "failed" || existing.status === "cancelled") {
    const [requeued] = await db
      .update(jobs)
      .set({
        payload: input.payload ?? null,
        payloadVersion,
        status: "queued",
        attempts: 0,
        maxAttempts,
        runAt: input.runAt ?? new Date(),
        lockedBy: null,
        lockedUntil: null,
        result: null,
        error: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.id, existing.id),
          or(eq(jobs.status, "failed"), eq(jobs.status, "cancelled")),
        ),
      )
      .returning();
    if (requeued) return requeued;
    const [raced] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, existing.id))
      .limit(1);
    if (raced) return raced;
  }
  return existing;
}

function claimableAt(now: Date) {
  return or(
    and(eq(jobs.status, "queued"), lte(jobs.runAt, now)),
    and(
      eq(jobs.status, "running"),
      isNotNull(jobs.lockedUntil),
      lt(jobs.lockedUntil, now),
    ),
  );
}

/** Atomically leases the oldest runnable row to one runner instance. */
export async function claimNextJob(instanceId: string, now = new Date()) {
  const candidate = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(claimableAt(now))
    .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
    .limit(1);

  const [claimed] = await db
    .update(jobs)
    .set({
      status: "running",
      lockedBy: instanceId,
      lockedUntil: new Date(now.getTime() + JOB_LEASE_MS),
      attempts: sql`${jobs.attempts} + 1`,
      error: null,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, candidate), claimableAt(now)))
    .returning();
  return claimed ?? null;
}

export async function renewJobLease(
  jobId: string,
  instanceId: string,
  now = new Date(),
) {
  const [renewed] = await db
    .update(jobs)
    .set({
      lockedUntil: new Date(now.getTime() + JOB_LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        eq(jobs.lockedBy, instanceId),
      ),
    )
    .returning({ id: jobs.id });
  return Boolean(renewed);
}

export async function completeJob(
  jobId: string,
  result: unknown,
  options: { instanceId?: string } = {},
) {
  const now = new Date();
  const [completed] = await db
    .update(jobs)
    .set({
      status: "succeeded",
      result: result ?? null,
      error: null,
      lockedBy: null,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        options.instanceId ? eq(jobs.lockedBy, options.instanceId) : undefined,
      ),
    )
    .returning();
  if (!completed) throw new Error(`Running job ${jobId} was not found`);
  return completed;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 8_000) || "Unknown job failure";
}

export async function failJob(
  jobId: string,
  error: unknown,
  options: { retry?: boolean; now?: Date; instanceId?: string } = {},
) {
  const now = options.now ?? new Date();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (
    !job ||
    job.status !== "running" ||
    (options.instanceId && job.lockedBy !== options.instanceId)
  ) {
    throw new Error(`Running job ${jobId} was not found`);
  }

  const retry = options.retry !== false && job.attempts < job.maxAttempts;
  const backoff = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** Math.max(0, job.attempts - 1),
  );
  const [failed] = await db
    .update(jobs)
    .set({
      status: retry ? "queued" : "failed",
      runAt: retry ? new Date(now.getTime() + backoff) : job.runAt,
      lockedBy: null,
      lockedUntil: null,
      error: errorMessage(error),
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        options.instanceId ? eq(jobs.lockedBy, options.instanceId) : undefined,
      ),
    )
    .returning();
  if (!failed) throw new Error(`Running job ${jobId} changed while failing`);
  return failed;
}

/** Claims and executes at most one job. Exported for deterministic workers/tests. */
export async function runNextJob(instanceId: string, now = new Date()) {
  const job = await claimNextJob(instanceId, now);
  if (!job) return null;
  const handler = handlers.get(job.kind);
  if (!handler) {
    return failJob(job.id, `No handler is registered for ${job.kind}`, {
      retry: false,
      now,
      instanceId,
    });
  }

  const controller = new AbortController();
  let renewing = false;
  const renewal = setInterval(
    () => {
      if (renewing) return;
      renewing = true;
      void renewJobLease(job.id, instanceId)
        .then((renewed) => {
          if (!renewed) controller.abort("The job lease was lost");
        })
        .catch(() => controller.abort("The job lease could not be renewed"))
        .finally(() => {
          renewing = false;
        });
    },
    Math.floor(JOB_LEASE_MS / 3),
  );
  try {
    const result = await handler({
      payload: job.payload,
      jobId: job.id,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      signal: controller.signal,
    });
    return await completeJob(job.id, result, { instanceId });
  } catch (error) {
    return failJob(job.id, error, {
      instanceId,
      retry: !(error instanceof NonRetryableJobError),
    });
  } finally {
    clearInterval(renewal);
  }
}

export function startJobRunner({
  instanceId,
  intervalMs = 2_000,
  concurrency = DEFAULT_JOB_RUNNER_CONCURRENCY,
}: {
  instanceId: string;
  intervalMs?: number;
  concurrency?: number;
}): JobRunnerHandle {
  if (env.DISABLE_JOBS) return { stop() {} };
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("Job runner concurrency must be between 1 and 16");
  }

  let active = true;
  const lanes = Array.from({ length: concurrency }, () => false);
  const tickLane = async (lane: number) => {
    if (!active || lanes[lane]) return;
    lanes[lane] = true;
    try {
      await runNextJob(`${instanceId}:${lane}`);
    } catch (error) {
      console.error(`[jobs] runner lane ${lane} failed`, error);
    } finally {
      lanes[lane] = false;
    }
  };
  const tick = () => {
    for (let lane = 0; lane < concurrency; lane += 1) {
      void tickLane(lane);
    }
  };
  tick();
  const interval = setInterval(tick, intervalMs);
  return {
    stop() {
      active = false;
      clearInterval(interval);
    },
  };
}
