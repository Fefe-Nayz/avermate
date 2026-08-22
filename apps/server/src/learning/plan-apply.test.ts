import { createClient, type Client } from "@libsql/client";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLearningPlanItemCommand } from "./plan-apply";

let sharedClient: Client | null = null;
const testDirectory = mkdtempSync(join(tmpdir(), "avermate-plan-apply-"));

afterAll(async () => {
  await Promise.resolve(sharedClient?.close());
  try {
    rmSync(testDirectory, { recursive: true, force: true });
  } catch {
    // Windows can retain a short-lived SQLite handle after close. This exact
    // directory lives under the OS temp root and is safe to reclaim later.
  }
});

async function fixture() {
  const client = (sharedClient ??= createClient({
    // A unique file keeps this schema isolated when the entire server suite
    // runs in one process; `file::memory:?cache=shared` is global across files.
    url: `file:${join(testDirectory, "learning-plan.db")}`,
  }));
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS years (id TEXT PRIMARY KEY, userId TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, yearId TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_concepts (
      id TEXT PRIMARY KEY, canonicalLabel TEXT NOT NULL, localLabel TEXT
    );
    CREATE TABLE IF NOT EXISTS learning_objectives (
      id TEXT PRIMARY KEY, conceptId TEXT NOT NULL, statement TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS planning_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      localNote TEXT,
      startsAt INTEGER,
      scheduledAt INTEGER,
      dueAt INTEGER,
      status TEXT NOT NULL,
      completedAt INTEGER,
      subjectId TEXT,
      sortOrder INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      trashedAt INTEGER,
      yearId TEXT NOT NULL,
      userId TEXT NOT NULL,
      sourceConnectionId TEXT,
      externalId TEXT,
      syncState TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_plan_items (
      id TEXT PRIMARY KEY,
      objectiveId TEXT NOT NULL,
      status TEXT NOT NULL,
      planningTaskId TEXT,
      revision INTEGER NOT NULL,
      yearId TEXT NOT NULL,
      subjectId TEXT,
      userId TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    DELETE FROM planning_tasks;
    DELETE FROM learning_plan_items;
    DELETE FROM learning_objectives;
    DELETE FROM learning_concepts;
    DELETE FROM subjects;
    DELETE FROM years;
    INSERT INTO years (id, userId) VALUES ('year-1', 'user-1');
    INSERT INTO subjects (id, userId, yearId)
      VALUES ('subject-1', 'user-1', 'year-1');
    INSERT INTO learning_concepts (id, canonicalLabel, localLabel)
      VALUES ('concept-1', 'Mathematics', 'Maths');
    INSERT INTO learning_objectives (id, conceptId, statement)
      VALUES ('objective-1', 'concept-1', 'Review quadratic equations');
    INSERT INTO learning_plan_items
      (id, objectiveId, status, planningTaskId, revision, yearId, subjectId,
       userId, updatedAt)
      VALUES ('plan-1', 'objective-1', 'proposed', NULL, 1, 'year-1',
              'subject-1', 'user-1', 0);
  `);
  return client;
}

const baseInput = {
  userId: "user-1",
  itemId: "plan-1",
  expectedRevision: 1,
  scheduledAt: new Date("2026-08-22T16:00:00.000Z"),
  dueAt: null,
};

describe("atomic learning plan application", () => {
  test("serializes concurrent exact requests into one task and one replay", async () => {
    const client = await fixture();
    const results = await Promise.all([
      applyLearningPlanItemCommand(client, baseInput),
      applyLearningPlanItemCommand(client, baseInput),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(new Set(results.map((result) => result.planningTaskId)).size).toBe(
      1,
    );
    const taskCount = await client.execute(
      "SELECT COUNT(*) AS count FROM planning_tasks",
    );
    expect(Number(taskCount.rows[0]?.count)).toBe(1);
    const item = await client.execute(
      "SELECT status, revision, planningTaskId FROM learning_plan_items WHERE id = 'plan-1'",
    );
    expect(item.rows[0]).toMatchObject({
      status: "accepted",
      revision: 2,
      planningTaskId: results[0]!.planningTaskId,
    });
  });

  test("fails closed for divergent replay and stale revision", async () => {
    const client = await fixture();
    await applyLearningPlanItemCommand(client, baseInput);
    await expect(
      applyLearningPlanItemCommand(client, {
        ...baseInput,
        scheduledAt: new Date("2026-08-23T16:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "divergent-replay" });
    await expect(
      applyLearningPlanItemCommand(client, {
        ...baseInput,
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "stale-revision" });
    const taskCount = await client.execute(
      "SELECT COUNT(*) AS count FROM planning_tasks",
    );
    expect(Number(taskCount.rows[0]?.count)).toBe(1);
  });
});
