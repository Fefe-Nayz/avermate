import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
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

type AppRouter = typeof import("./index").appRouter;
type Api = ReturnType<
  typeof createRouterClient<AppRouter, Record<never, never>>
>;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let apiA: Api;
let apiB: Api;

const userA = "planner-user-a";
const userB = "planner-user-b";
const yearA = "planner-year-a";
const yearB = "planner-year-b";
const boardYear = "planner-year-board";
const subjectA = "planner-subject-a";
const subjectB = "planner-subject-b";

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
      expiresAt: new Date("2027-12-01T00:00:00.000Z"),
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
  const now = new Date("2026-08-01T00:00:00.000Z");
  await database
    .insert(schema.users)
    .values([
      {
        id: userA,
        name: "Planner A",
        email: "planner-user-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: "Planner B",
        email: "planner-user-b@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();
  await database
    .insert(schema.years)
    .values([
      {
        id: yearA,
        name: "2026–2027",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: userA,
      },
      {
        id: yearB,
        name: "Other year",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: userB,
      },
      {
        id: boardYear,
        name: "Board isolation year",
        startsAt: new Date("2027-09-01T00:00:00.000Z"),
        endsAt: new Date("2028-07-01T00:00:00.000Z"),
        userId: userA,
      },
    ])
    .onConflictDoNothing();
  await database
    .insert(schema.subjects)
    .values([
      { id: subjectA, name: "Mathematics", yearId: yearA, userId: userA },
      { id: subjectB, name: "Physics", yearId: yearB, userId: userB },
    ])
    .onConflictDoNothing();
  const { appRouter } = await import("./index");
  apiA = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userA) },
  });
  apiB = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userB) },
  });
});

afterAll(async () => {
  await database.delete(schema.users).where(inArray(schema.users.id, [userA, userB]));
});

describe("planner domain", () => {
  test("creates, lists, updates and deletes a task", async () => {
    const created = await apiA.planner.create({
      yearId: yearA,
      title: "Read chapter 4",
      subjectId: subjectA,
    });
    expect(created.kind).toBe("task");
    expect(created.status).toBe("todo");
    expect((await apiA.planner.list({ yearId: yearA })).map((item) => item.id)).toContain(
      created.id,
    );
    const updated = await apiA.planner.update({
      itemId: created.id,
      title: "Read chapter 5",
      notes: "Pages 90–104",
    });
    expect(updated?.title).toBe("Read chapter 5");
    await apiA.planner.delete({ itemId: created.id });
    expect((await apiA.planner.list({ yearId: yearA })).some((item) => item.id === created.id)).toBe(
      false,
    );
  });

  test("does not reveal or mutate another account's item", async () => {
    const item = await apiA.planner.create({ yearId: yearA, title: "Private task" });
    await expect(
      apiB.planner.update({ itemId: item.id, title: "Forged" }),
    ).rejects.toThrow("Planner item not found");
    await expect(apiB.planner.delete({ itemId: item.id })).rejects.toThrow(
      "Planner item not found",
    );
  });

  test("rejects a subject outside the planner item's year", async () => {
    await expect(
      apiA.planner.create({
        yearId: yearA,
        title: "Cross-year subject",
        subjectId: subjectB,
      }),
    ).rejects.toThrow();
  });

  test("enforces task and event date invariants", async () => {
    await expect(
      apiA.planner.create({
        yearId: yearA,
        title: "Invalid task",
        kind: "task",
        endsAt: new Date("2027-02-02T10:00:00.000Z"),
      }),
    ).rejects.toThrow("A task cannot have an end date");
    await expect(
      apiA.planner.create({
        yearId: yearA,
        title: "Invalid event",
        kind: "event",
        startsAt: new Date("2027-02-02T12:00:00.000Z"),
        endsAt: new Date("2027-02-02T10:00:00.000Z"),
      }),
    ).rejects.toThrow("An event cannot end before it starts");
    await expect(
      apiA.planner.create({
        yearId: yearA,
        title: "Unscheduled event",
        kind: "event",
      }),
    ).rejects.toThrow("An event requires a start date");
  });

  test("events cannot enter a task status lane", async () => {
    const event = await apiA.planner.create({
      yearId: yearA,
      title: "Oral exam",
      kind: "event",
      startsAt: new Date("2027-02-04T09:00:00.000Z"),
    });
    await expect(
      apiA.planner.setStatus({ itemId: event.id, status: "done" }),
    ).rejects.toThrow("An event cannot move through task statuses");
  });

  test("completion timestamps enter and leave the done state exactly", async () => {
    const task = await apiA.planner.create({
      yearId: yearA,
      title: "Submit essay",
    });
    const done = await apiA.planner.setStatus({ itemId: task.id, status: "done" });
    expect(done?.completedAt).toBeInstanceOf(Date);
    const doing = await apiA.planner.setStatus({
      itemId: task.id,
      status: "doing",
    });
    expect(doing?.completedAt).toBeNull();
  });

  test("moves tasks within a lane and compacts both lanes across a move", async () => {
    const suffix = crypto.randomUUID();
    const first = await apiA.planner.create({ yearId: boardYear, title: `Board A ${suffix}` });
    const second = await apiA.planner.create({ yearId: boardYear, title: `Board B ${suffix}` });
    const third = await apiA.planner.create({ yearId: boardYear, title: `Board C ${suffix}` });

    await apiA.planner.moveInBoard({
      itemId: third.id,
      status: "todo",
      beforeId: first.id,
    });
    let rows = (await apiA.planner.list({ yearId: boardYear, includeCompleted: true })).filter(
      (item) => [first.id, second.id, third.id].includes(item.id),
    );
    expect(rows.filter((item) => item.status === "todo").map((item) => item.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);

    await apiA.planner.moveInBoard({ itemId: first.id, status: "doing" });
    await apiA.planner.moveInBoard({
      itemId: second.id,
      status: "doing",
      beforeId: first.id,
    });
    rows = (await apiA.planner.list({ yearId: boardYear, includeCompleted: true })).filter(
      (item) => [first.id, second.id, third.id].includes(item.id),
    );
    expect(rows.filter((item) => item.status === "todo").map((item) => [item.id, item.sortOrder])).toEqual([
      [third.id, 0],
    ]);
    expect(rows.filter((item) => item.status === "doing").map((item) => [item.id, item.sortOrder])).toEqual([
      [second.id, 0],
      [first.id, 1],
    ]);
  });

  test("merges planner, goal, grade and period events in chronological order", async () => {
    const periodId = `planner-period-${crypto.randomUUID()}`;
    const goalId = `planner-goal-${crypto.randomUUID()}`;
    const gradeId = `planner-grade-${crypto.randomUUID()}`;
    await database.insert(schema.periods).values({
      id: periodId,
      name: "Spring term",
      startAt: new Date("2027-02-01T00:00:00.000Z"),
      endAt: new Date("2027-02-28T23:59:00.000Z"),
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.goals).values({
      id: goalId,
      name: "Reach 80%",
      targetRatio: 0.8,
      dueAt: new Date("2027-02-10T00:00:00.000Z"),
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.grades).values({
      id: gradeId,
      name: "Midterm",
      value: 16,
      outOf: 20,
      passedAt: new Date("2027-02-12T00:00:00.000Z"),
      subjectId: subjectA,
      yearId: yearA,
      userId: userA,
    });
    const event = await apiA.planner.create({
      yearId: yearA,
      title: "Study group",
      kind: "event",
      startsAt: new Date("2027-02-08T18:00:00.000Z"),
      allDay: false,
    });

    const agenda = await apiA.planner.agenda({
      yearId: yearA,
      from: new Date("2027-02-01T00:00:00.000Z"),
      to: new Date("2027-02-28T23:59:59.000Z"),
    });
    const selected = agenda.filter((item) =>
      [periodId, goalId, gradeId, event.id].includes(item.id),
    );
    expect(selected.map((item) => item.source)).toEqual([
      "period",
      "planner",
      "goal",
      "grade",
    ]);
    expect(
      selected.every(
        (item, index) =>
          index === 0 || selected[index - 1]!.startsAt <= item.startsAt,
      ),
    ).toBe(true);
  });

  test("caps the unified agenda window at 62 days", async () => {
    await expect(
      apiA.planner.agenda({
        yearId: yearA,
        from: new Date("2027-01-01T00:00:00.000Z"),
        to: new Date("2027-04-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("The agenda window cannot exceed 62 days");
  });

  test("windowed lists exclude backlog and hide done tasks by default", async () => {
    const backlog = await apiA.planner.create({ yearId: yearA, title: "Backlog only" });
    const scheduled = await apiA.planner.create({
      yearId: yearA,
      title: "Scheduled and done",
      startsAt: new Date("2027-03-10T00:00:00.000Z"),
    });
    await apiA.planner.setStatus({ itemId: scheduled.id, status: "done" });
    const hidden = await apiA.planner.list({
      yearId: yearA,
      from: new Date("2027-03-01T00:00:00.000Z"),
      to: new Date("2027-03-31T23:59:59.000Z"),
    });
    expect(hidden.some((item) => [backlog.id, scheduled.id].includes(item.id))).toBe(false);
    const included = await apiA.planner.list({
      yearId: yearA,
      from: new Date("2027-03-01T00:00:00.000Z"),
      to: new Date("2027-03-31T23:59:59.000Z"),
      includeCompleted: true,
    });
    expect(included.some((item) => item.id === scheduled.id)).toBe(true);
    expect(included.some((item) => item.id === backlog.id)).toBe(false);
  });
});
