import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

process.env.DATABASE_URL = "file::memory:?cache=shared";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";
process.env.DISABLE_OCR = "false";
process.env.STORAGE_DRIVER = "local";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");
const databaseHookTimeout = 120_000;

type LearningRouter = typeof import("../routers/learning").learningRouter;
type Api = ReturnType<
  typeof createRouterClient<
    { learning: LearningRouter },
    Record<never, never>
  >
>;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let runGradeCopyAnalysisJob: typeof import("./copy-analysis").runGradeCopyAnalysisJob;
let modelRevision: string;
let api: Api;

const userA = "copy-fence-user-a";
const userB = "copy-fence-user-b";
const yearA = "copy-fence-year-a";
const subjectA = "copy-fence-subject-a";

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
      expiresAt: new Date("2028-01-01T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function createSource(label: string) {
  const suffix = `${label}-${crypto.randomUUID()}`;
  const gradeId = `grade-${suffix}`;
  const fileId = `file-${suffix}`;
  const attachmentId = `attachment-${suffix}`;
  await database.insert(schema.grades).values({
    id: gradeId,
    name: "Copy fencing test",
    value: 14,
    outOf: 20,
    passedAt: new Date("2026-10-15T10:00:00.000Z"),
    subjectId: subjectA,
    yearId: yearA,
    userId: userA,
  });
  await database.insert(schema.files).values({
    id: fileId,
    provider: "local",
    storageKey: `copy-fence/${suffix}.pdf`,
    url: `https://example.invalid/${suffix}.pdf`,
    mimeType: "application/pdf",
    byteSize: 128,
    purpose: "grade-copy",
    status: "stored",
    userId: userA,
  });
  await database.insert(schema.gradeAttachments).values({
    id: attachmentId,
    gradeId,
    fileId,
    userId: userA,
  });
  const sourceDigest = (
    await import("../search/values")
  ).sha256(`local:copy-fence/${suffix}.pdf:128`);
  return { attachmentId, fileId, gradeId, sourceDigest };
}

async function createAnalysis(input: {
  label: string;
  revision?: number;
  status?: "queued" | "running" | "failed" | "cancelled";
  modelRevision?: string;
}) {
  const source = await createSource(input.label);
  const [analysis] = await database
    .insert(schema.learningCopyAnalyses)
    .values({
      id: `analysis-${input.label}-${crypto.randomUUID()}`,
      attachmentId: source.attachmentId,
      gradeId: source.gradeId,
      sourceFileId: source.fileId,
      sourceDigest: source.sourceDigest,
      provider: "pending",
      model: "pending",
      modelRevision: input.modelRevision ?? modelRevision,
      status: input.status ?? "queued",
      revision: input.revision ?? 1,
      jobId: null,
      yearId: yearA,
      subjectId: subjectA,
      userId: userA,
    })
    .returning();
  if (!analysis) throw new Error("Analysis fixture was not returned");
  return { analysis, source };
}

async function attachJob(analysisId: string, jobId: string) {
  const [attached] = await database
    .update(schema.learningCopyAnalyses)
    .set({ jobId })
    .where(eq(schema.learningCopyAnalyses.id, analysisId))
    .returning();
  if (!attached) throw new Error("Analysis job fence was not attached");
  return attached;
}

async function createJob(
  id: string,
  userId: string,
  payload: unknown,
  status: "queued" | "running" = "running",
) {
  await database.insert(schema.jobs).values({
    id,
    kind: "grade-copy.analyze",
    payload,
    payloadVersion: 2,
    status,
    attempts: status === "running" ? 1 : 0,
    maxAttempts: 3,
    userId,
  });
}

function payloadFor(analysis: {
  id: string;
  revision: number;
  sourceDigest: string;
  modelRevision: string;
}) {
  return {
    analysisId: analysis.id,
    expectedRevision: analysis.revision,
    sourceDigest: analysis.sourceDigest,
    modelRevision: analysis.modelRevision,
  };
}

const ocrResult = {
  markdown: "Question\n\n14/20",
  pageCount: 1,
  providerFileId: "provider-copy",
  pages: [{ providerIndex: 0, markdown: "Question\n\n14/20" }],
};
const ocrExecution = {
  result: ocrResult,
  provider: "mistral" as const,
  model: "mistral-ocr-latest",
};

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  registerSharedTestDatabaseLifecycle(database.$client);
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  const now = new Date("2026-08-01T00:00:00.000Z");
  await database
    .insert(schema.users)
    .values([
      {
        id: userA,
        name: "Copy Fence A",
        email: "copy-fence-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: "Copy Fence B",
        email: "copy-fence-b@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();
  await database.insert(schema.years).values({
    id: yearA,
    name: "2026–2027",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2027-07-01T00:00:00.000Z"),
    userId: userA,
  });
  await database.insert(schema.subjects).values({
    id: subjectA,
    name: "Mathematics",
    yearId: yearA,
    userId: userA,
  });
  await database.insert(schema.learningPreferences).values({
    userId: userA,
    analysisEnabled: true,
  });

  const copyModule = await import("./copy-analysis");
  runGradeCopyAnalysisJob = copyModule.runGradeCopyAnalysisJob;
  modelRevision = copyModule.GRADE_COPY_ANALYSIS_MODEL_REVISION;
  const { learningRouter } = await import("../routers/learning");
  api = createRouterClient(
    { learning: learningRouter },
    { context: { headers: new Headers(), session: sessionFor(userA) } },
  );
}, databaseHookTimeout);

afterAll(async () => {
  await database
    .delete(schema.learningCopyAnalyses)
    .where(eq(schema.learningCopyAnalyses.userId, userA));
  await database
    .delete(schema.gradeAttachments)
    .where(eq(schema.gradeAttachments.userId, userA));
  await database.delete(schema.files).where(eq(schema.files.userId, userA));
  await database.delete(schema.grades).where(eq(schema.grades.userId, userA));
  await database.delete(schema.jobs).where(
    inArray(schema.jobs.userId, [userA, userB]),
  );
  await database
    .delete(schema.users)
    .where(inArray(schema.users.id, [userA, userB]));
}, databaseHookTimeout);

describe("grade-copy job fencing", () => {
  test("runs OCR once when the same durable delivery overlaps", async () => {
    const jobId = `job-double-${crypto.randomUUID()}`;
    const { analysis: pending } = await createAnalysis({ label: "double" });
    const payload = payloadFor(pending);
    await createJob(jobId, userA, payload);
    const analysis = await attachJob(pending.id, jobId);
    const started = deferred();
    const release = deferred();
    let ocrCalls = 0;
    const first = runGradeCopyAnalysisJob(payload, {
      jobId,
      attempts: 1,
      maxAttempts: 3,
      readOwnedFile: async () => new Uint8Array([1, 2, 3]).buffer,
      runOcr: async () => {
        ocrCalls += 1;
        started.resolve();
        await release.promise;
        return ocrExecution;
      },
    });
    await started.promise;
    const duplicate = await runGradeCopyAnalysisJob(payload, {
      jobId,
      attempts: 1,
      maxAttempts: 3,
      readOwnedFile: async () => new Uint8Array([1]).buffer,
      runOcr: async () => {
        ocrCalls += 1;
        return ocrExecution;
      },
    });
    release.resolve();
    const completed = await first;

    expect(duplicate).toEqual({ analysisId: analysis.id, status: "stale" });
    expect(completed.status).toBe("proposed");
    expect(ocrCalls).toBe(1);
    const [stored] = await database
      .select()
      .from(schema.learningCopyAnalyses)
      .where(eq(schema.learningCopyAnalyses.id, analysis.id));
    expect(stored).toMatchObject({
      status: "proposed",
      revision: 2,
      jobId,
      provider: "mistral",
      model: "mistral-ocr-latest",
    });
  });

  test("ignores attempt A after retry B has taken ownership", async () => {
    const oldJobId = `job-old-${crypto.randomUUID()}`;
    const newJobId = `job-new-${crypto.randomUUID()}`;
    const fixture = await createAnalysis({
      label: "old-after-new",
      revision: 2,
    });
    const oldPayload = {
      ...payloadFor(fixture.analysis),
      expectedRevision: 1,
    };
    const newPayload = payloadFor(fixture.analysis);
    await createJob(oldJobId, userA, oldPayload);
    await createJob(newJobId, userA, newPayload);
    fixture.analysis = await attachJob(fixture.analysis.id, newJobId);
    let ocrCalls = 0;
    const oldResult = await runGradeCopyAnalysisJob(oldPayload, {
      jobId: oldJobId,
      attempts: 1,
      maxAttempts: 3,
      readOwnedFile: async () => new Uint8Array([1]).buffer,
      runOcr: async () => {
        ocrCalls += 1;
        return ocrExecution;
      },
    });
    const newResult = await runGradeCopyAnalysisJob(newPayload, {
      jobId: newJobId,
      attempts: 1,
      maxAttempts: 3,
      readOwnedFile: async () => new Uint8Array([1]).buffer,
      runOcr: async () => {
        ocrCalls += 1;
        return ocrExecution;
      },
    });

    expect(oldResult.status).toBe("stale");
    expect(newResult.status).toBe("proposed");
    expect(ocrCalls).toBe(1);
  });

  test("a late failure from A cannot overwrite retry B", async () => {
    const oldJobId = `job-failing-old-${crypto.randomUUID()}`;
    const newJobId = `job-failing-new-${crypto.randomUUID()}`;
    const { analysis: pending } = await createAnalysis({
      label: "failure-after-retry",
    });
    const oldPayload = payloadFor(pending);
    await createJob(oldJobId, userA, oldPayload);
    const analysis = await attachJob(pending.id, oldJobId);
    const readStarted = deferred();
    let rejectRead!: (error: Error) => void;
    const execution = runGradeCopyAnalysisJob(oldPayload, {
      jobId: oldJobId,
      attempts: 1,
      maxAttempts: 1,
      readOwnedFile: async () => {
        readStarted.resolve();
        return new Promise<ArrayBuffer>((_resolve, reject) => {
          rejectRead = reject;
        });
      },
      runOcr: async () => ocrExecution,
    });
    await readStarted.promise;

    const newPayload = {
      ...payloadFor(analysis),
      expectedRevision: 3,
    };
    await createJob(newJobId, userA, newPayload);
    await database
      .update(schema.learningCopyAnalyses)
      .set({
        status: "queued",
        revision: 3,
        jobId: newJobId,
        safeError: null,
      })
      .where(eq(schema.learningCopyAnalyses.id, analysis.id));
    rejectRead(new Error("late attempt A failure"));
    await expect(execution).rejects.toThrow("late attempt A failure");

    const [stored] = await database
      .select()
      .from(schema.learningCopyAnalyses)
      .where(eq(schema.learningCopyAnalyses.id, analysis.id));
    expect(stored).toMatchObject({
      status: "queued",
      revision: 3,
      jobId: newJobId,
      safeError: null,
    });
  });

  test("cancellation wins atomically against a late publication", async () => {
    const jobId = `job-cancel-${crypto.randomUUID()}`;
    const { analysis: pending } = await createAnalysis({ label: "cancel" });
    const payload = payloadFor(pending);
    await createJob(jobId, userA, payload);
    const analysis = await attachJob(pending.id, jobId);
    const started = deferred();
    const release = deferred();
    const execution = runGradeCopyAnalysisJob(payload, {
      jobId,
      attempts: 1,
      maxAttempts: 3,
      readOwnedFile: async () => new Uint8Array([1]).buffer,
      runOcr: async () => {
        started.resolve();
        await release.promise;
        return ocrExecution;
      },
    });
    await started.promise;
    const cancellation = await api.learning.copies.cancel({
      analysisId: analysis.id,
      expectedRevision: 1,
    });
    release.resolve();
    const executionResult = await execution;

    expect(cancellation).toMatchObject({
      cancellationRequested: true,
      analysis: { status: "cancelled", revision: 2 },
    });
    expect(executionResult.status).toBe("stale");
    const [stored] = await database
      .select()
      .from(schema.learningCopyAnalyses)
      .where(eq(schema.learningCopyAnalyses.id, analysis.id));
    expect(stored).toMatchObject({
      status: "cancelled",
      revision: 2,
      proposalJson: null,
    });
  });

  test("does not inspect or OCR a forged owner or stale source payload", async () => {
    const foreignJobId = `job-foreign-${crypto.randomUUID()}`;
    const staleJobId = `job-stale-${crypto.randomUUID()}`;
    const { analysis } = await createAnalysis({ label: "forged" });
    const exact = payloadFor(analysis);
    await createJob(foreignJobId, userB, exact);
    await createJob(staleJobId, userA, {
      ...exact,
      sourceDigest: `${analysis.sourceDigest}-forged`,
    });
    let reads = 0;
    let ocrCalls = 0;
    const dependencies = {
      readOwnedFile: async () => {
        reads += 1;
        return new Uint8Array([1]).buffer;
      },
      runOcr: async () => {
        ocrCalls += 1;
        return ocrExecution;
      },
    };
    const foreign = await runGradeCopyAnalysisJob(exact, {
      jobId: foreignJobId,
      ...dependencies,
    });
    const stale = await runGradeCopyAnalysisJob(
      { ...exact, sourceDigest: `${analysis.sourceDigest}-forged` },
      { jobId: staleJobId, ...dependencies },
    );

    expect(foreign.status).toBe("stale");
    expect(stale.status).toBe("stale");
    expect(reads).toBe(0);
    expect(ocrCalls).toBe(0);
  });

  test("concurrent request calls converge on one analysis and one job", async () => {
    const source = await createSource("request-race");
    const [left, right] = await Promise.all([
      api.learning.copies.request({
        attachmentId: source.attachmentId,
        idempotencyKey: `request-left-${crypto.randomUUID()}`,
      }),
      api.learning.copies.request({
        attachmentId: source.attachmentId,
        idempotencyKey: `request-right-${crypto.randomUUID()}`,
      }),
    ]);

    expect(left.id).toBe(right.id);
    expect(left.jobId).toBe(right.jobId);
    expect(left.jobId).not.toBeNull();
    const rows = await database
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "grade-copy.analyze"),
          eq(schema.jobs.userId, userA),
        ),
      );
    const matching = rows.filter(
      (row) =>
        (row.payload as { analysisId?: string } | null)?.analysisId === left.id,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]?.payload).toMatchObject({
      analysisId: left.id,
      expectedRevision: 1,
      sourceDigest: left.sourceDigest,
      modelRevision: left.modelRevision,
    });
  });

  test("concurrent reanalysis calls resolve the unique source/model row", async () => {
    const { analysis: previous } = await createAnalysis({
      label: "reanalyze-race",
      status: "failed",
      modelRevision: "mistral-ocr-old:proposal-v0",
    });
    const [left, right] = await Promise.all([
      api.learning.copies.reanalyze({
        analysisId: previous.id,
        idempotencyKey: `reanalyze-left-${crypto.randomUUID()}`,
      }),
      api.learning.copies.reanalyze({
        analysisId: previous.id,
        idempotencyKey: `reanalyze-right-${crypto.randomUUID()}`,
      }),
    ]);

    expect(left.id).toBe(right.id);
    expect(left.jobId).toBe(right.jobId);
    expect(left.modelRevision).toBe(modelRevision);
    const rows = await database
      .select()
      .from(schema.learningCopyAnalyses)
      .where(
        and(
          eq(schema.learningCopyAnalyses.userId, userA),
          eq(schema.learningCopyAnalyses.attachmentId, previous.attachmentId),
          eq(schema.learningCopyAnalyses.sourceDigest, previous.sourceDigest),
          eq(schema.learningCopyAnalyses.modelRevision, modelRevision),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
