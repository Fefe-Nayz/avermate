import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  files,
  gradeAttachments,
  grades,
  learningConceptSets,
  learningConcepts,
  learningCopyAnalyses,
  learningMasteryCurrent,
  learningMasteryProjections,
  learningObjectives,
  learningPlanItems,
} from "../db/schema";

const directory = mkdtempSync(
  join(tmpdir(), "avermate-learning-progress-test-"),
);
process.env.DATABASE_URL = `file:${join(directory, "learning-progress.db")}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";
process.env.CORPUS_EMBEDDING_ENABLED = "false";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");
const databaseHookTimeout = 120_000;

type AppRouter = typeof import("./index").appRouter;
type Api = ReturnType<
  typeof createRouterClient<AppRouter, Record<never, never>>
>;

let database: typeof import("../db").db;
let api: Api;

const userId = "learning-progress-user";
const yearId = "learning-progress-year";
const mathsId = "learning-progress-maths";
const historyId = "learning-progress-history";
const mathsMeasuredId = "objective-maths-measured";
const mathsUnmeasuredId = "objective-maths-unmeasured";
const historyObjectiveId = "objective-history";

function sessionFor(id: string) {
  const now = new Date("2026-08-20T00:00:00.000Z");
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.test`,
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
      expiresAt: new Date("2027-08-20T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}

function explanation(asOf: Date) {
  return {
    version: 1 as const,
    prior: { alpha: 1, beta: 1 },
    asOf: asOf.toISOString(),
    contributions: [],
  };
}

beforeAll(async () => {
  ({ db: database } = await import("../db"));
  const { registerSharedTestDatabaseLifecycle } =
    await import("../testing/database-lifecycle");
  registerSharedTestDatabaseLifecycle(database.$client, {
    directories: [directory],
  });
  await database.$client.executeMultiple(migration);
  const now = Math.floor(
    new Date("2026-08-20T00:00:00.000Z").getTime() / 1_000,
  );
  await database.$client.batch(
    [
      {
        sql: `INSERT INTO users (id, name, email, emailVerified, role, banned, createdAt, updatedAt) VALUES (?, 'Learner', 'learner@example.test', 1, 'user', 0, ?, ?)`,
        args: [userId, now, now],
      },
      {
        sql: `INSERT INTO years (id, name, startsAt, endsAt, userId, createdAt, updatedAt) VALUES (?, '2026', ?, ?, ?, ?, ?)`,
        args: [yearId, now, now + 31_536_000, userId, now, now],
      },
      {
        sql: `INSERT INTO subjects (id, name, coefficient, kind, isMain, bonus, sortOrder, yearId, userId, createdAt, updatedAt) VALUES (?, 'Mathématiques', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
        args: [mathsId, yearId, userId, now, now],
      },
      {
        sql: `INSERT INTO subjects (id, name, coefficient, kind, isMain, bonus, sortOrder, yearId, userId, createdAt, updatedAt) VALUES (?, 'Histoire', 1, 'subject', 1, 0, 1, ?, ?, ?, ?)`,
        args: [historyId, yearId, userId, now, now],
      },
    ],
    "write",
  );

  await database.insert(learningConceptSets).values([
    {
      id: "set-maths",
      title: "Mathématiques",
      namespace: "local",
      yearId,
      subjectId: mathsId,
      userId,
    },
    {
      id: "set-history",
      title: "Histoire",
      namespace: "local",
      yearId,
      subjectId: historyId,
      userId,
    },
  ]);
  await database.insert(learningConcepts).values([
    {
      id: "concept-maths",
      setId: "set-maths",
      stableKey: "algebra",
      canonicalLabel: "Algèbre",
      yearId,
      subjectId: mathsId,
      userId,
    },
    {
      id: "concept-history",
      setId: "set-history",
      stableKey: "revolution",
      canonicalLabel: "Révolution française",
      yearId,
      subjectId: historyId,
      userId,
    },
  ]);
  await database.insert(learningObjectives).values([
    {
      id: mathsMeasuredId,
      conceptId: "concept-maths",
      statement: "Résoudre une équation",
      yearId,
      subjectId: mathsId,
      userId,
    },
    {
      id: mathsUnmeasuredId,
      conceptId: "concept-maths",
      statement: "Factoriser une expression",
      yearId,
      subjectId: mathsId,
      userId,
    },
    {
      id: historyObjectiveId,
      conceptId: "concept-history",
      statement: "Expliquer la Terreur",
      yearId,
      subjectId: historyId,
      userId,
    },
  ]);

  const firstAsOf = new Date("2026-08-10T00:00:00.000Z");
  const secondAsOf = new Date("2026-08-20T00:00:00.000Z");
  await database.insert(learningMasteryProjections).values([
    {
      id: "projection-maths-1",
      objectiveId: mathsMeasuredId,
      generation: 1,
      algorithmRevision: "test-v1",
      evidenceCursor: "maths-1",
      asOf: firstAsOf,
      estimate: 0.4,
      low: 0.2,
      high: 0.6,
      alpha: 2,
      beta: 3,
      evidenceCount: 1,
      freshnessDays: 10,
      explanationJson: explanation(firstAsOf),
      digest: "digest-maths-1",
      userId,
    },
    {
      id: "projection-maths-2",
      objectiveId: mathsMeasuredId,
      generation: 2,
      algorithmRevision: "test-v1",
      evidenceCursor: "maths-2",
      asOf: secondAsOf,
      estimate: 0.7,
      low: 0.55,
      high: 0.85,
      alpha: 4,
      beta: 2,
      evidenceCount: 2,
      freshnessDays: 2,
      explanationJson: explanation(secondAsOf),
      digest: "digest-maths-2",
      userId,
    },
    {
      id: "projection-maths-prior",
      objectiveId: mathsUnmeasuredId,
      generation: 1,
      algorithmRevision: "test-v1",
      evidenceCursor: "maths-prior",
      asOf: secondAsOf,
      estimate: 0.5,
      low: 0,
      high: 1,
      alpha: 1,
      beta: 1,
      evidenceCount: 0,
      freshnessDays: null,
      explanationJson: explanation(secondAsOf),
      digest: "digest-maths-prior",
      userId,
    },
    {
      id: "projection-history",
      objectiveId: historyObjectiveId,
      generation: 1,
      algorithmRevision: "test-v1",
      evidenceCursor: "history-1",
      asOf: secondAsOf,
      estimate: 0.9,
      low: 0.8,
      high: 1,
      alpha: 5,
      beta: 1,
      evidenceCount: 3,
      freshnessDays: 1,
      explanationJson: explanation(secondAsOf),
      digest: "digest-history",
      userId,
    },
  ]);
  await database.insert(learningMasteryCurrent).values([
    {
      objectiveId: mathsMeasuredId,
      projectionId: "projection-maths-2",
      generation: 2,
      evidenceCursor: "maths-2",
      userId,
    },
    {
      objectiveId: mathsUnmeasuredId,
      projectionId: "projection-maths-prior",
      generation: 1,
      evidenceCursor: "maths-prior",
      userId,
    },
    {
      objectiveId: historyObjectiveId,
      projectionId: "projection-history",
      generation: 1,
      evidenceCursor: "history-1",
      userId,
    },
  ]);

  await database.insert(grades).values([
    {
      id: "grade-maths",
      name: "DS algèbre",
      value: 14,
      outOf: 20,
      passedAt: secondAsOf,
      subjectId: mathsId,
      yearId,
      userId,
    },
    {
      id: "grade-history",
      name: "Composition",
      value: 18,
      outOf: 20,
      passedAt: secondAsOf,
      subjectId: historyId,
      yearId,
      userId,
    },
  ]);
  await database.insert(files).values([
    {
      id: "file-maths-copy",
      storageKey: "tests/maths-copy.pdf",
      url: "local://tests/maths-copy.pdf",
      mimeType: "application/pdf",
      byteSize: 10,
      purpose: "grade-copy",
      userId,
    },
    {
      id: "file-history-copy",
      storageKey: "tests/history-copy.pdf",
      url: "local://tests/history-copy.pdf",
      mimeType: "application/pdf",
      byteSize: 10,
      purpose: "grade-copy",
      userId,
    },
  ]);
  await database.insert(gradeAttachments).values([
    {
      id: "attachment-maths",
      gradeId: "grade-maths",
      fileId: "file-maths-copy",
      userId,
    },
    {
      id: "attachment-history",
      gradeId: "grade-history",
      fileId: "file-history-copy",
      userId,
    },
  ]);
  await database.insert(learningCopyAnalyses).values([
    {
      id: "copy-maths",
      attachmentId: "attachment-maths",
      gradeId: "grade-maths",
      sourceFileId: "file-maths-copy",
      sourceDigest: "copy-maths-digest",
      provider: "test",
      model: "test",
      modelRevision: "v1",
      status: "confirmed",
      yearId,
      subjectId: mathsId,
      userId,
    },
    {
      id: "copy-history",
      attachmentId: "attachment-history",
      gradeId: "grade-history",
      sourceFileId: "file-history-copy",
      sourceDigest: "copy-history-digest",
      provider: "test",
      model: "test",
      modelRevision: "v1",
      status: "confirmed",
      yearId,
      subjectId: historyId,
      userId,
    },
  ]);
  await database.insert(learningPlanItems).values([
    {
      id: "plan-maths",
      objectiveId: mathsMeasuredId,
      rationaleJson: { reason: "test" },
      evidenceCursor: "maths-2",
      activityKind: "exercise",
      estimatedMinutes: 20,
      status: "proposed",
      yearId,
      subjectId: mathsId,
      userId,
    },
    {
      id: "plan-history",
      objectiveId: historyObjectiveId,
      rationaleJson: { reason: "test" },
      evidenceCursor: "history-1",
      activityKind: "course-review",
      estimatedMinutes: 20,
      status: "proposed",
      yearId,
      subjectId: historyId,
      userId,
    },
  ]);

  const { appRouter } = await import("./index");
  api = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userId) },
  });
}, databaseHookTimeout);

afterAll(() => database.$client.close(), databaseHookTimeout);

describe("learning progress scope", () => {
  test("applies the same year and subject filter to mastery, copies, plan and progress", async () => {
    const [mastery, copies, plan, progress] = await Promise.all([
      api.learning.mastery.list({ yearId, subjectId: mathsId }),
      api.learning.copies.list({ yearId, subjectId: mathsId }),
      api.learning.plan.list({ yearId, subjectId: mathsId }),
      api.learning.progress({ yearId, subjectId: mathsId }),
    ]);

    expect(mastery.map((row) => row.objective.id)).toEqual([
      mathsUnmeasuredId,
      mathsMeasuredId,
    ]);
    expect(
      mastery.find((row) => row.objective.id === mathsUnmeasuredId),
    ).toMatchObject({
      measured: false,
      measurementState: "unmeasured",
      measurement: null,
      projection: { evidenceCount: 0, estimate: 0.5 },
    });
    expect(copies.map((row) => row.analysis.id)).toEqual(["copy-maths"]);
    expect(plan.map((row) => row.item.id)).toEqual(["plan-maths"]);
    expect(progress.summary).toMatchObject({
      objectiveCount: 2,
      measuredObjectiveCount: 1,
      unmeasuredObjectiveCount: 1,
      coverage: 0.5,
      estimate: 0.7,
      comparableObjectiveCount: 1,
      delta: 0.3,
      trend: "uncertain",
      variation: {
        comparableObjectiveCount: 1,
        uncertainObjectiveCount: 1,
      },
      precision: { score: 0.7, averageIntervalWidth: 0.3 },
      evidence: { itemCount: 2 },
    });
    expect(progress.objectives.map((row) => row.subjectId)).toEqual([
      mathsId,
      mathsId,
    ]);
    expect(progress.schoolGrades.map((row) => row.id)).toEqual(["grade-maths"]);
    expect(progress.summary.nextAction?.id).toBe("plan-maths");
  });
});
