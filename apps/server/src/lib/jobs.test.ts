import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { eq, inArray, like, or } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

type AppRouter = typeof import("../routers").appRouter;
type Api = ReturnType<
  typeof createRouterClient<AppRouter, Record<never, never>>
>;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let queue: typeof import("./jobs");
let handlers: typeof import("../jobs/handlers");
let apiA: Api;
let apiB: Api;

function sessionFor(id: string) {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      image: null,
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `session-${id}`,
      token: `token-${id}`,
      userId: id,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  queue = await import("./jobs");
  handlers = await import("../jobs/handlers");
  const { appRouter } = await import("../routers");
  const now = new Date("2026-08-01T00:00:00.000Z");
  await database
    .insert(schema.users)
    .values([
      {
        id: "jobs-user-a",
        name: "Jobs User A",
        email: "jobs-user-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "jobs-user-b",
        name: "Jobs User B",
        email: "jobs-user-b@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();
  apiA = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor("jobs-user-a") },
  });
  apiB = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor("jobs-user-b") },
  });
});

afterAll(async () => {
  await database
    .delete(schema.jobs)
    .where(
      or(
        like(schema.jobs.kind, "test.jobs.%"),
        inArray(schema.jobs.kind, [...handlers.MAINTENANCE_JOB_KINDS]),
      ),
    );
});

describe("durable jobs", () => {
  test("enqueue, claim and complete preserve state and result", async () => {
    const runAt = new Date("2026-08-10T10:00:00.000Z");
    const job = await queue.enqueueJob({
      kind: "test.jobs.happy",
      payload: { value: 42 },
      userId: "jobs-user-a",
      runAt,
    });
    expect(job.status).toBe("queued");

    const claimed = await queue.claimNextJob("runner-happy", runAt);
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.attempts).toBe(1);
    const completed = await queue.completeJob(job.id, { answer: 42 });
    expect(completed.status).toBe("succeeded");
    expect(completed.result).toEqual({ answer: 42 });
    expect(completed.lockedBy).toBeNull();
  });

  test("idempotency deduplicates both user and null-owner system jobs", async () => {
    const future = new Date("2030-01-01T00:00:00.000Z");
    const userFirst = await queue.enqueueJob({
      kind: "test.jobs.idempotent-user",
      userId: "jobs-user-a",
      idempotencyKey: "same-user-key",
      runAt: future,
    });
    const userSecond = await queue.enqueueJob({
      kind: "test.jobs.idempotent-user",
      userId: "jobs-user-a",
      idempotencyKey: "same-user-key",
      runAt: future,
    });
    expect(userSecond.id).toBe(userFirst.id);

    const systemFirst = await queue.enqueueJob({
      kind: "test.jobs.idempotent-system",
      userId: null,
      idempotencyKey: "same-system-key",
      runAt: future,
    });
    const systemSecond = await queue.enqueueJob({
      kind: "test.jobs.idempotent-system",
      userId: null,
      idempotencyKey: "same-system-key",
      runAt: future,
    });
    expect(systemSecond.id).toBe(systemFirst.id);
  });

  test("an explicit enqueue reuses and resets a terminal failed ledger row", async () => {
    const runAt = new Date("2035-01-01T00:00:00.000Z");
    const first = await queue.enqueueJob({
      kind: "test.jobs.explicit-retry",
      payload: { revision: 1 },
      userId: "jobs-user-a",
      idempotencyKey: "retry-after-fix",
      runAt,
      maxAttempts: 2,
    });
    await database
      .update(schema.jobs)
      .set({ status: "failed", attempts: 2, error: "bad key" })
      .where(eq(schema.jobs.id, first.id));

    const retried = await queue.enqueueJob({
      kind: "test.jobs.explicit-retry",
      payload: { revision: 2 },
      userId: "jobs-user-a",
      idempotencyKey: "retry-after-fix",
      runAt,
      maxAttempts: 4,
    });
    expect(retried.id).toBe(first.id);
    expect(retried).toMatchObject({
      status: "queued",
      attempts: 0,
      maxAttempts: 4,
      payload: { revision: 2 },
      error: null,
    });
  });

  test("failures back off until maxAttempts then become terminal", async () => {
    const firstRun = new Date("2026-08-11T10:00:00.000Z");
    const job = await queue.enqueueJob({
      kind: "test.jobs.retry",
      userId: "jobs-user-a",
      runAt: firstRun,
      maxAttempts: 2,
    });
    await queue.claimNextJob("runner-retry", firstRun);
    const retried = await queue.failJob(job.id, new Error("first failure"), {
      now: firstRun,
    });
    expect(retried.status).toBe("queued");
    expect(retried.runAt.getTime()).toBeGreaterThan(firstRun.getTime());

    await queue.claimNextJob("runner-retry", retried.runAt);
    const terminal = await queue.failJob(job.id, new Error("second failure"), {
      now: retried.runAt,
    });
    expect(terminal.status).toBe("failed");
    expect(terminal.attempts).toBe(2);
    expect(terminal.error).toBe("second failure");
  });

  test("only an expired running lease can be taken over", async () => {
    const firstRun = new Date("2026-08-12T10:00:00.000Z");
    const job = await queue.enqueueJob({
      kind: "test.jobs.lease",
      userId: "jobs-user-a",
      runAt: firstRun,
    });
    await queue.claimNextJob("runner-one", firstRun);
    expect(
      await queue.claimNextJob(
        "runner-two",
        new Date(firstRun.getTime() + 30_000),
      ),
    ).toBeNull();
    const reclaimed = await queue.claimNextJob(
      "runner-two",
      new Date(firstRun.getTime() + queue.JOB_LEASE_MS + 1_000),
    );
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.lockedBy).toBe("runner-two");
    expect(reclaimed?.attempts).toBe(2);
    await queue.completeJob(job.id, { reclaimed: true });
  });

  test("a running worker can renew its lease without changing attempts", async () => {
    const firstRun = new Date("2026-08-12T12:00:00.000Z");
    const job = await queue.enqueueJob({
      kind: "test.jobs.long-running",
      userId: "jobs-user-a",
      runAt: firstRun,
    });
    await queue.claimNextJob("runner-long", firstRun);
    expect(
      await queue.renewJobLease(
        job.id,
        "runner-long",
        new Date(firstRun.getTime() + 50_000),
      ),
    ).toBe(true);
    expect(
      await queue.claimNextJob(
        "runner-steal",
        new Date(firstRun.getTime() + 70_000),
      ),
    ).toBeNull();
    const reclaimed = await queue.claimNextJob(
      "runner-steal",
      new Date(firstRun.getTime() + 111_000),
    );
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.attempts).toBe(2);
    await queue.completeJob(job.id, { reclaimed: true });
  });

  test("an unknown kind fails immediately without retry", async () => {
    const runAt = new Date("2026-08-13T10:00:00.000Z");
    const job = await queue.enqueueJob({
      kind: `test.jobs.unknown.${crypto.randomUUID()}`,
      userId: "jobs-user-a",
      runAt,
      maxAttempts: 10,
    });
    const result = await queue.runNextJob("runner-unknown", runAt);
    expect(result?.id).toBe(job.id);
    expect(result?.status).toBe("failed");
    expect(result?.attempts).toBe(1);
    expect(result?.error).toContain("No handler is registered");
  });

  test("a non-retryable handler failure is terminal on its first attempt", async () => {
    const kind = `test.jobs.non-retryable.${crypto.randomUUID()}`;
    queue.registerJobHandler(kind, async () => {
      throw new queue.NonRetryableJobError("terminal source response");
    });
    const runAt = new Date("2026-08-14T10:00:00.000Z");
    const job = await queue.enqueueJob({
      kind,
      userId: "jobs-user-a",
      runAt,
      maxAttempts: 10,
    });

    const result = await queue.runNextJob("runner-non-retryable", runAt);
    expect(result).toMatchObject({
      id: job.id,
      status: "failed",
      attempts: 1,
      error: "terminal source response",
    });
    expect(result?.lockedBy).toBeNull();
    expect(result?.lockedUntil).toBeNull();
  });

  test("the router enforces ownership and hides system jobs", async () => {
    const owned = await queue.enqueueJob({
      kind: "export.documentPptx",
      userId: "jobs-user-a",
      runAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    const internal = await queue.enqueueJob({
      kind: "cleanup.unownedFile",
      payload: { userId: "jobs-user-a", fileId: "unowned-file" },
      userId: "jobs-user-a",
      runAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    await queue.enqueueJob({
      kind: "test.jobs.router-system",
      userId: null,
      runAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    await expect(apiB.jobs.get({ jobId: owned.id })).rejects.toThrow();
    await expect(apiB.jobs.cancel({ jobId: owned.id })).rejects.toThrow();
    const listed = await apiA.jobs.list({});
    expect(listed.some((job) => job.kind === "test.jobs.router-system")).toBe(
      false,
    );
    expect(listed.find((job) => job.id === owned.id)).not.toHaveProperty(
      "lockedBy",
    );
    const cancelled = await apiA.jobs.cancel({ jobId: owned.id });
    expect(cancelled.status).toBe("cancelled");
    await expect(apiA.jobs.cancel({ jobId: internal.id })).rejects.toThrow(
      "internal job",
    );
    expect((await apiA.jobs.get({ jobId: internal.id })).status).toBe("queued");
  });

  test("boot scheduling includes one idempotent hourly storage reaper", async () => {
    const { REAP_UNOWNED_FILES_JOB_KIND } =
      await import("../jobs/storage-reaper");
    const now = new Date("2031-02-03T04:05:00.000Z");
    const first = await handlers.scheduleDailyMaintenanceJobs(now);
    const replay = await handlers.scheduleDailyMaintenanceJobs(now);
    // Four generic daily jobs plus the independently self-scheduling storage
    // reaper and both drive channel/subscription reconcilers.
    expect(first).toHaveLength(handlers.MAINTENANCE_JOB_KINDS.length + 3);
    expect(replay.map((job) => job.id)).toEqual(first.map((job) => job.id));
    expect(first.some((job) => job.kind === REAP_UNOWNED_FILES_JOB_KIND)).toBe(
      true,
    );
  });

  test("maintenance handlers reap old MCP operations and automatic feedback", async () => {
    handlers.registerAllJobHandlers();
    const now = new Date();
    const old = new Date(now.getTime() - 100 * 86_400_000);
    const mcpId = `mop-jobs-${crypto.randomUUID()}`;
    const feedbackId = `fb-jobs-${crypto.randomUUID()}`;
    await database.insert(schema.mcpOperations).values({
      id: mcpId,
      userId: "jobs-user-a",
      toolName: "test.jobs.old-operation",
      idempotencyKey: crypto.randomUUID(),
      argumentsHash: "hash",
      status: "completed",
      createdAt: old,
      completedAt: old,
    });
    await database.insert(schema.feedback).values({
      id: feedbackId,
      kind: "bug",
      subject: "Expired automatic feedback",
      message: "old",
      source: "auto:server",
      lastSeenAt: old,
      userId: "jobs-user-a",
      createdAt: old,
      updatedAt: old,
    });
    await queue.enqueueJob({
      kind: handlers.MAINTENANCE_JOB_KINDS[0],
      idempotencyKey: `test-${crypto.randomUUID()}`,
      runAt: now,
    });
    await queue.enqueueJob({
      kind: handlers.MAINTENANCE_JOB_KINDS[1],
      idempotencyKey: `test-${crypto.randomUUID()}`,
      runAt: now,
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await queue.runNextJob("runner-maintenance", now);
      const [mcp, automaticFeedback] = await Promise.all([
        database
          .select({ id: schema.mcpOperations.id })
          .from(schema.mcpOperations)
          .where(eq(schema.mcpOperations.id, mcpId)),
        database
          .select({ id: schema.feedback.id })
          .from(schema.feedback)
          .where(eq(schema.feedback.id, feedbackId)),
      ]);
      if (mcp.length === 0 && automaticFeedback.length === 0) break;
    }

    expect(
      await database
        .select({ id: schema.mcpOperations.id })
        .from(schema.mcpOperations)
        .where(eq(schema.mcpOperations.id, mcpId)),
    ).toHaveLength(0);
    expect(
      await database
        .select({ id: schema.feedback.id })
        .from(schema.feedback)
        .where(eq(schema.feedback.id, feedbackId)),
    ).toHaveLength(0);
  });
});
