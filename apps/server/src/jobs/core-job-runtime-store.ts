import { randomBytes } from "node:crypto";
import type { Client, InValue, Transaction } from "@libsql/client";
import { db } from "../db";
import { newId } from "../lib/id";
import { canonicalJson, isoFromSqlite } from "../search/values";
import type {
  DurableJobRuntimeStore,
  JobExecutionFence,
  JobRuntimeEvent,
  JobRuntimeEventInput,
  JobRuntimeRecord,
  JobRuntimeStage,
  JobRuntimeStatus,
} from "./job-runtime";
import { StoreBackedJobRuntime } from "./job-runtime";

type SqlClient = Pick<Client, "execute" | "transaction">;
type SqlExecutor = Pick<Client, "execute"> | Pick<Transaction, "execute">;
type Row = Record<string, InValue>;

const TERMINAL = new Set<JobRuntimeStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

function seconds(value: Date) {
  return Math.floor(value.getTime() / 1_000);
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  return JSON.parse(value) as unknown;
}

function runtimeRecord(row: Row): JobRuntimeRecord {
  return Object.freeze({
    id: String(row.id),
    ownerId: String(row.userId),
    kind: String(row.kind),
    status: row.status as JobRuntimeStatus,
    stage: row.stage as JobRuntimeStage,
    payloadVersion: Number(row.payloadVersion),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.maxAttempts),
    cancellation: row.cancellation as JobRuntimeRecord["cancellation"],
    createdAt: isoFromSqlite(row.createdAt),
    updatedAt: isoFromSqlite(row.updatedAt),
  });
}

function runtimeEvent(row: Row): JobRuntimeEvent {
  const value = parseJson(row.eventJson) as Omit<JobRuntimeEvent, "sequence">;
  return Object.freeze({
    ...value,
    sequence: Number(row.sequence),
  }) as JobRuntimeEvent;
}

async function joinedJob(executor: SqlExecutor, jobId: string) {
  return (
    await executor.execute({
      sql: `SELECT jobs.*, metadata.stage, metadata.cancellation,
          metadata.leaseToken, metadata.lastEventSequence
        FROM jobs
        JOIN job_runtime_metadata AS metadata ON metadata.jobId = jobs.id
        WHERE jobs.id = ? LIMIT 1`,
      args: [jobId],
    })
  ).rows[0] as Row | undefined;
}

async function requireOwnedJob(
  executor: SqlExecutor,
  jobId: string,
  ownerId: string,
) {
  const row = await joinedJob(executor, jobId);
  if (!row || row.userId !== ownerId) throw new Error("Job not found.");
  return row;
}

/**
 * Durable adapter over Avermate's existing SQLite/libSQL queue. It keeps the
 * canonical job row, orchestration metadata and every replayable event in one
 * transaction domain and exposes explicit lease fences to sandbox workers.
 */
export class CoreDurableJobRuntimeStore implements DurableJobRuntimeStore {
  readonly durability = "durable" as const;

  constructor(private readonly client: SqlClient) {}

  async enqueue(input: {
    ownerId: string;
    kind: string;
    payload: unknown;
    payloadVersion: number;
    idempotencyKey: string;
    maxAttempts: number;
  }) {
    return this.write(async (transaction) => {
      const now = new Date();
      const timestamp = seconds(now);
      const id = newId("job");
      const payloadJson = canonicalJson(input.payload);
      await transaction.execute({
        sql: `INSERT OR IGNORE INTO jobs
          (id, kind, payload, payloadVersion, status, attempts, maxAttempts,
           runAt, idempotencyKey, userId, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.kind,
          payloadJson,
          input.payloadVersion,
          input.maxAttempts,
          timestamp,
          input.idempotencyKey,
          input.ownerId,
          timestamp,
          timestamp,
        ],
      });
      const result = await transaction.execute({
        sql: `SELECT * FROM jobs
          WHERE userId = ? AND kind = ? AND idempotencyKey = ? LIMIT 1`,
        args: [input.ownerId, input.kind, input.idempotencyKey],
      });
      const job = result.rows[0] as Row | undefined;
      if (!job) throw new Error("The durable job could not be enqueued.");
      if (
        Number(job.payloadVersion) !== input.payloadVersion ||
        Number(job.maxAttempts) !== input.maxAttempts ||
        canonicalJson(parseJson(job.payload)) !== payloadJson
      ) {
        throw new Error(
          "Job idempotency key was reused with a different request.",
        );
      }
      await transaction.execute({
        sql: `INSERT INTO job_runtime_metadata
          (jobId, stage, cancellation, leaseToken, lastEventSequence,
           createdAt, updatedAt)
          VALUES (?, 'queued', 'none', NULL, 0, ?, ?)
          ON CONFLICT(jobId) DO NOTHING`,
        args: [String(job.id), timestamp, timestamp],
      });
      const metadata = await joinedJob(transaction, String(job.id));
      if (!metadata) throw new Error("The durable job metadata is missing.");
      if (Number(metadata.lastEventSequence) === 0) {
        await this.appendEventInTransaction(transaction, metadata, {
          type: "state",
          at: now.toISOString(),
          status: "queued",
          stage: "queued",
          attempt: 0,
        });
      }
      return runtimeRecord((await joinedJob(transaction, String(job.id)))!);
    });
  }

  async inspect(jobId: string) {
    const row = await joinedJob(this.client, jobId);
    return row ? runtimeRecord(row) : null;
  }

  async appendEvent(input: {
    jobId: string;
    ownerId: string;
    event: JobRuntimeEventInput;
  }) {
    return this.write(async (transaction) => {
      const row = await requireOwnedJob(
        transaction,
        input.jobId,
        input.ownerId,
      );
      if (TERMINAL.has(row.status as JobRuntimeStatus)) {
        throw new Error("Terminal jobs cannot publish more events.");
      }
      return this.appendEventInTransaction(transaction, row, input.event);
    });
  }

  async replayEvents(input: {
    jobId: string;
    ownerId: string;
    afterSequence: number;
    limit: number;
  }) {
    await requireOwnedJob(this.client, input.jobId, input.ownerId);
    const result = await this.client.execute({
      sql: `SELECT * FROM job_runtime_events
        WHERE jobId = ? AND userId = ? AND sequence > ?
        ORDER BY sequence LIMIT ?`,
      args: [input.jobId, input.ownerId, input.afterSequence, input.limit],
    });
    return Object.freeze(result.rows.map((row) => runtimeEvent(row as Row)));
  }

  async *streamEvents(input: {
    jobId: string;
    ownerId: string;
    afterSequence: number;
    signal?: AbortSignal;
  }): AsyncIterable<JobRuntimeEvent> {
    let cursor = input.afterSequence;
    while (!input.signal?.aborted) {
      const events = await this.replayEvents({
        jobId: input.jobId,
        ownerId: input.ownerId,
        afterSequence: cursor,
        limit: 250,
      });
      for (const event of events) {
        cursor = event.sequence;
        yield event;
      }
      const current = await this.inspect(input.jobId);
      if (!current || current.ownerId !== input.ownerId) {
        throw new Error("Job not found.");
      }
      if (events.length === 0 && TERMINAL.has(current.status)) return;
      if (events.length === 250) continue;
      await abortableDelay(250, input.signal);
    }
  }

  async verifyLease(fence: JobExecutionFence) {
    const row = await joinedJob(this.client, fence.jobId);
    return Boolean(
      row &&
      row.userId === fence.ownerId &&
      row.status === "running" &&
      Number(row.attempts) === fence.attempt &&
      row.lockedBy === fence.leaseOwner &&
      row.leaseToken === fence.leaseToken &&
      row.lockedUntil !== null &&
      Number(row.lockedUntil) > Math.floor(Date.now() / 1_000),
    );
  }

  async requestCancellation(input: {
    jobId: string;
    ownerId: string;
    reason: string;
  }) {
    return this.write(async (transaction) => {
      let row = await requireOwnedJob(transaction, input.jobId, input.ownerId);
      if (TERMINAL.has(row.status as JobRuntimeStatus))
        return runtimeRecord(row);
      const now = new Date();
      const reason = input.reason.slice(0, 1_000) || "Cancellation requested";
      if (row.status === "queued") {
        await transaction.execute({
          sql: `UPDATE jobs SET status = 'cancelled', lockedBy = NULL,
              lockedUntil = NULL, updatedAt = ?
            WHERE id = ? AND userId = ? AND status = 'queued'`,
          args: [seconds(now), input.jobId, input.ownerId],
        });
        await transaction.execute({
          sql: `UPDATE job_runtime_metadata
            SET stage = 'terminal', cancellation = 'acknowledged',
              leaseToken = NULL, updatedAt = ? WHERE jobId = ?`,
          args: [seconds(now), input.jobId],
        });
        row = (await joinedJob(transaction, input.jobId))!;
        await this.appendEventInTransaction(transaction, row, {
          type: "cancellation",
          at: now.toISOString(),
          state: "acknowledged",
          safeReason: reason,
        });
        row = (await joinedJob(transaction, input.jobId))!;
        await this.appendEventInTransaction(transaction, row, {
          type: "terminal",
          at: now.toISOString(),
          status: "cancelled",
          error: reason,
        });
      } else {
        await transaction.execute({
          sql: `UPDATE job_runtime_metadata
            SET cancellation = 'requested', updatedAt = ? WHERE jobId = ?`,
          args: [seconds(now), input.jobId],
        });
        row = (await joinedJob(transaction, input.jobId))!;
        await this.appendEventInTransaction(transaction, row, {
          type: "cancellation",
          at: now.toISOString(),
          state: "requested",
          safeReason: reason,
        });
      }
      return runtimeRecord((await joinedJob(transaction, input.jobId))!);
    });
  }

  async claimNext(input: {
    workerId: string;
    leaseMs?: number;
    now?: Date;
  }): Promise<{
    record: JobRuntimeRecord;
    payload: unknown;
    fence: JobExecutionFence;
  } | null> {
    const leaseMs = input.leaseMs ?? 60_000;
    if (!input.workerId || leaseMs < 1_000 || leaseMs > 10 * 60_000) {
      throw new Error("A worker and bounded lease are required.");
    }
    return this.write(async (transaction) => {
      const now = input.now ?? new Date();
      const timestamp = seconds(now);
      const selected = await transaction.execute({
        sql: `SELECT jobs.id FROM jobs
          JOIN job_runtime_metadata AS metadata ON metadata.jobId = jobs.id
          WHERE metadata.cancellation = 'none' AND
            ((jobs.status = 'queued' AND jobs.runAt <= ?) OR
             (jobs.status = 'running' AND jobs.lockedUntil IS NOT NULL
              AND jobs.lockedUntil <= ?))
          ORDER BY jobs.runAt, jobs.createdAt, jobs.id LIMIT 1`,
        args: [timestamp, timestamp],
      });
      const jobId = selected.rows[0]?.id;
      if (jobId === undefined) return null;
      const leaseToken = randomBytes(24).toString("base64url");
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const claimed = await transaction.execute({
        sql: `UPDATE jobs SET status = 'running', attempts = attempts + 1,
            lockedBy = ?, lockedUntil = ?, error = NULL, updatedAt = ?
          WHERE id = ? AND
            ((status = 'queued' AND runAt <= ?) OR
             (status = 'running' AND lockedUntil IS NOT NULL
              AND lockedUntil <= ?))`,
        args: [
          input.workerId,
          seconds(leaseExpiresAt),
          timestamp,
          String(jobId),
          timestamp,
          timestamp,
        ],
      });
      if (claimed.rowsAffected !== 1) return null;
      await transaction.execute({
        sql: `UPDATE job_runtime_metadata
          SET stage = 'leased', leaseToken = ?, updatedAt = ? WHERE jobId = ?`,
        args: [leaseToken, timestamp, String(jobId)],
      });
      let row = (await joinedJob(transaction, String(jobId)))!;
      await this.appendEventInTransaction(transaction, row, {
        type: "state",
        at: now.toISOString(),
        status: "running",
        stage: "leased",
        attempt: Number(row.attempts),
      });
      row = (await joinedJob(transaction, String(jobId)))!;
      return {
        record: runtimeRecord(row),
        payload: parseJson(row.payload),
        fence: Object.freeze({
          jobId: String(jobId),
          ownerId: String(row.userId),
          attempt: Number(row.attempts),
          leaseOwner: input.workerId,
          leaseToken,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        }),
      };
    });
  }

  async renewLease(input: {
    fence: JobExecutionFence;
    leaseMs?: number;
    now?: Date;
  }): Promise<JobExecutionFence> {
    const leaseMs = input.leaseMs ?? 60_000;
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const updated = await this.client.execute({
      sql: `UPDATE jobs SET lockedUntil = ?, updatedAt = ?
        WHERE id = ? AND userId = ? AND status = 'running'
          AND attempts = ? AND lockedBy = ?
          AND EXISTS (SELECT 1 FROM job_runtime_metadata
            WHERE jobId = jobs.id AND leaseToken = ?)`,
      args: [
        seconds(leaseExpiresAt),
        seconds(now),
        input.fence.jobId,
        input.fence.ownerId,
        input.fence.attempt,
        input.fence.leaseOwner,
        input.fence.leaseToken,
      ],
    });
    if (updated.rowsAffected !== 1) throw new Error("The job lease was lost.");
    return Object.freeze({
      ...input.fence,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    });
  }

  async acknowledgeCancellation(input: {
    fence: JobExecutionFence;
    reason: string;
    now?: Date;
  }) {
    if (!(await this.verifyLease(input.fence))) {
      throw new Error("The job lease was lost.");
    }
    return this.write(async (transaction) => {
      const row = await requireOwnedJob(
        transaction,
        input.fence.jobId,
        input.fence.ownerId,
      );
      if (row.cancellation !== "requested") {
        throw new Error("Job cancellation was not requested.");
      }
      const now = input.now ?? new Date();
      await transaction.execute({
        sql: `UPDATE jobs SET status = 'cancelled', lockedBy = NULL,
            lockedUntil = NULL, updatedAt = ? WHERE id = ?`,
        args: [seconds(now), input.fence.jobId],
      });
      await transaction.execute({
        sql: `UPDATE job_runtime_metadata SET stage = 'terminal',
            cancellation = 'acknowledged', leaseToken = NULL, updatedAt = ?
          WHERE jobId = ?`,
        args: [seconds(now), input.fence.jobId],
      });
      const cancelled = (await joinedJob(transaction, input.fence.jobId))!;
      await this.appendEventInTransaction(transaction, cancelled, {
        type: "terminal",
        at: now.toISOString(),
        status: "cancelled",
        error: input.reason.slice(0, 1_000),
      });
      return runtimeRecord((await joinedJob(transaction, input.fence.jobId))!);
    });
  }

  private async appendEventInTransaction(
    transaction: Transaction,
    row: Row,
    event: JobRuntimeEventInput,
  ) {
    const advanced = await transaction.execute({
      sql: `UPDATE job_runtime_metadata
        SET lastEventSequence = lastEventSequence + 1, updatedAt = ?
        WHERE jobId = ? RETURNING lastEventSequence`,
      args: [seconds(new Date(event.at)), String(row.id)],
    });
    const sequence = Number(advanced.rows[0]?.lastEventSequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("The job event sequence could not advance.");
    }
    await transaction.execute({
      sql: `INSERT INTO job_runtime_events
        (id, jobId, userId, sequence, type, eventJson, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        newId("jevt"),
        String(row.id),
        String(row.userId),
        sequence,
        event.type,
        canonicalJson(event),
        seconds(new Date(event.at)),
      ],
    });
    if (event.type === "state") {
      await transaction.execute({
        sql: `UPDATE jobs SET status = ?, updatedAt = ? WHERE id = ?`,
        args: [event.status, seconds(new Date(event.at)), String(row.id)],
      });
      await transaction.execute({
        sql: `UPDATE job_runtime_metadata SET stage = ?, updatedAt = ?
          WHERE jobId = ?`,
        args: [event.stage, seconds(new Date(event.at)), String(row.id)],
      });
    } else if (event.type === "cancellation") {
      await transaction.execute({
        sql: `UPDATE job_runtime_metadata SET cancellation = ?, updatedAt = ?
          WHERE jobId = ?`,
        args: [event.state, seconds(new Date(event.at)), String(row.id)],
      });
    } else if (event.type === "terminal") {
      await transaction.execute({
        sql: `UPDATE jobs SET status = ?, lockedBy = NULL, lockedUntil = NULL,
            updatedAt = ? WHERE id = ?`,
        args: [event.status, seconds(new Date(event.at)), String(row.id)],
      });
      await transaction.execute({
        sql: `UPDATE job_runtime_metadata SET stage = 'terminal',
            leaseToken = NULL,
            cancellation = CASE WHEN ? = 'cancelled' THEN 'acknowledged'
              ELSE cancellation END,
            updatedAt = ? WHERE jobId = ?`,
        args: [event.status, seconds(new Date(event.at)), String(row.id)],
      });
    }
    return Object.freeze({ ...event, sequence }) as JobRuntimeEvent;
  }

  private async write<T>(operation: (transaction: Transaction) => Promise<T>) {
    const transaction = await this.client.transaction("write");
    try {
      const value = await operation(transaction);
      await transaction.commit();
      return value;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export const coreDurableJobRuntimeStore = new CoreDurableJobRuntimeStore(
  db.$client,
);
export const coreJobRuntime = new StoreBackedJobRuntime(
  coreDurableJobRuntimeStore,
);
