import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";

export type JobStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";

/**
 * Durable deferred work shared by the HTTP process and future workers.
 *
 * A null `userId` denotes a system maintenance job. Such rows are never
 * exposed by the user-facing router. Separate partial uniqueness constraints
 * are intentional: SQLite considers every null distinct, which would make a
 * plain `(userId, kind, idempotencyKey)` index fail to deduplicate system jobs.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("job")),
    kind: text().notNull(),
    payload: text({ mode: "json" }).$type<unknown>(),
    payloadVersion: integer().notNull().default(1),
    status: text().$type<JobStatus>().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(3),
    runAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lockedUntil: integer({ mode: "timestamp" }),
    lockedBy: text(),
    idempotencyKey: text(),
    result: text({ mode: "json" }).$type<unknown>(),
    error: text(),
    userId: text().references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("jobs_status_run_at_idx").on(t.status, t.runAt),
    index("jobs_user_id_idx").on(t.userId),
    uniqueIndex("jobs_user_kind_key_unique")
      .on(t.userId, t.kind, t.idempotencyKey)
      .where(sql`${t.userId} is not null and ${t.idempotencyKey} is not null`),
    uniqueIndex("jobs_system_kind_key_unique")
      .on(t.kind, t.idempotencyKey)
      .where(sql`${t.userId} is null and ${t.idempotencyKey} is not null`),
  ],
);

export type JobRuntimeStage =
  | "queued"
  | "leased"
  | "provisioning"
  | "running"
  | "snapshotting"
  | "adopting"
  | "terminal";

export type JobCancellationState = "none" | "requested" | "acknowledged";

/** Restart-safe orchestration metadata layered over the existing job queue. */
export const jobRuntimeMetadata = sqliteTable(
  "job_runtime_metadata",
  {
    jobId: text()
      .primaryKey()
      .references(() => jobs.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    stage: text().$type<JobRuntimeStage>().notNull().default("queued"),
    cancellation: text()
      .$type<JobCancellationState>()
      .notNull()
      .default("none"),
    leaseToken: text(),
    lastEventSequence: integer().notNull().default(0),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("job_runtime_metadata_stage_idx").on(table.stage, table.cancellation),
    check(
      "job_runtime_metadata_stage_check",
      sql`${table.stage} in ('queued', 'leased', 'provisioning', 'running', 'snapshotting', 'adopting', 'terminal')`,
    ),
    check(
      "job_runtime_metadata_cancellation_check",
      sql`${table.cancellation} in ('none', 'requested', 'acknowledged')`,
    ),
    check(
      "job_runtime_metadata_sequence_check",
      sql`${table.lastEventSequence} >= 0`,
    ),
  ],
);

export const jobRuntimeEvents = sqliteTable(
  "job_runtime_events",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("jevt")),
    jobId: text()
      .notNull()
      .references(() => jobs.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sequence: integer().notNull(),
    type: text().notNull(),
    eventJson: text().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("job_runtime_events_job_sequence_unique").on(
      table.jobId,
      table.sequence,
    ),
    index("job_runtime_events_user_job_sequence_idx").on(
      table.userId,
      table.jobId,
      table.sequence,
    ),
    check("job_runtime_events_sequence_check", sql`${table.sequence} >= 1`),
  ],
);
