import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

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
      .where(
        sql`${t.userId} is not null and ${t.idempotencyKey} is not null`,
      ),
    uniqueIndex("jobs_system_kind_key_unique")
      .on(t.kind, t.idempotencyKey)
      .where(sql`${t.userId} is null and ${t.idempotencyKey} is not null`),
  ],
);
