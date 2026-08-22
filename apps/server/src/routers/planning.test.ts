import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

// Shared cache keeps libsql transactions on the same in-memory database.
process.env.DATABASE_URL = "file::memory:?cache=shared";
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

const planningTables = `
CREATE TABLE IF NOT EXISTS planning_tasks (
  id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, notes TEXT, localNote TEXT,
  scheduledAt INTEGER, dueAt INTEGER, status TEXT NOT NULL DEFAULT 'todo',
  completedAt INTEGER, subjectId TEXT, sortOrder INTEGER NOT NULL DEFAULT 0,
  yearId TEXT NOT NULL, userId TEXT NOT NULL, sourceConnectionId TEXT,
  externalId TEXT, syncState TEXT NOT NULL DEFAULT 'detached',
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS planning_tasks_source_external_unique
  ON planning_tasks(sourceConnectionId, externalId);
CREATE TABLE IF NOT EXISTS academic_assignments (
  id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, instructions TEXT,
  assignedAt INTEGER, dueAt INTEGER, localNote TEXT, completedAt INTEGER,
  subjectId TEXT, yearId TEXT NOT NULL, userId TEXT NOT NULL,
  sourceConnectionId TEXT, externalId TEXT,
  syncState TEXT NOT NULL DEFAULT 'detached', createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS academic_assignments_source_external_unique
  ON academic_assignments(sourceConnectionId, externalId);
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY NOT NULL, eventKind TEXT NOT NULL DEFAULT 'event',
  title TEXT NOT NULL, description TEXT, localNote TEXT, startsAt INTEGER NOT NULL,
  endsAt INTEGER, allDay INTEGER NOT NULL DEFAULT 0, timezone TEXT NOT NULL DEFAULT 'UTC',
  location TEXT, subjectId TEXT, yearId TEXT NOT NULL, userId TEXT NOT NULL,
  sourceConnectionId TEXT, externalId TEXT,
  syncState TEXT NOT NULL DEFAULT 'detached', createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_source_external_unique
  ON calendar_events(sourceConnectionId, externalId);
CREATE TABLE IF NOT EXISTS timetable_series (
  id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, notes TEXT, localNote TEXT,
  startsOn TEXT NOT NULL, endsOn TEXT, startMinutes INTEGER NOT NULL,
  durationMinutes INTEGER NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrenceFrequency TEXT NOT NULL DEFAULT 'weekly',
  recurrenceInterval INTEGER NOT NULL DEFAULT 1, recurrenceWeekdays TEXT NOT NULL,
  location TEXT, subjectId TEXT, yearId TEXT NOT NULL, userId TEXT NOT NULL,
  sourceConnectionId TEXT, externalId TEXT,
  syncState TEXT NOT NULL DEFAULT 'detached', createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS timetable_series_source_external_unique
  ON timetable_series(sourceConnectionId, externalId);
CREATE TABLE IF NOT EXISTS timetable_occurrences (
  id TEXT PRIMARY KEY NOT NULL, seriesId TEXT, occurrenceDate TEXT NOT NULL,
  title TEXT NOT NULL, notes TEXT, localNote TEXT, startsAt INTEGER NOT NULL,
  endsAt INTEGER NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'scheduled', isException INTEGER NOT NULL DEFAULT 0,
  location TEXT, subjectId TEXT, yearId TEXT NOT NULL, userId TEXT NOT NULL,
  sourceConnectionId TEXT, externalId TEXT,
  syncState TEXT NOT NULL DEFAULT 'detached', createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS timetable_occurrences_series_date_unique
  ON timetable_occurrences(seriesId, occurrenceDate);
CREATE UNIQUE INDEX IF NOT EXISTS timetable_occurrences_source_external_unique
  ON timetable_occurrences(sourceConnectionId, externalId);
`;

type AppRouter = {
  planning: typeof import("./planning").planningRouter;
  planner: typeof import("./planner").plannerRouter;
};
type Api = ReturnType<
  typeof createRouterClient<AppRouter, Record<never, never>>
>;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let apiA: Api;
let apiB: Api;

const userA = "planning-user-a";
const userB = "planning-user-b";
const yearA = "planning-year-a";
const yearB = "planning-year-b";
const subjectA = "planning-subject-a";
const connectionA = "planning-connection-a";

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

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  registerSharedTestDatabaseLifecycle(database.$client);
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  await database.$client.executeMultiple(planningTables);
  const now = new Date("2026-08-01T00:00:00.000Z");
  await database
    .insert(schema.users)
    .values([
      {
        id: userA,
        name: "Planning A",
        email: "planning-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: "Planning B",
        email: "planning-b@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();
  await database.insert(schema.years).values([
    {
      id: yearA,
      name: "2026–2027",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2027-07-01T00:00:00.000Z"),
      userId: userA,
    },
    {
      id: yearB,
      name: "Other",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2027-07-01T00:00:00.000Z"),
      userId: userB,
    },
  ]);
  await database.insert(schema.subjects).values({
    id: subjectA,
    name: "Mathematics",
    yearId: yearA,
    userId: userA,
  });
  await database.insert(schema.syncConnections).values({
    id: connectionA,
    provider: "moodle",
    label: "Managed school",
    baseUrl: "https://school.invalid",
    sealedCredentials: "sealed",
    capabilities: ["files"],
    yearId: yearA,
    userId: userA,
  });

  const [{ planningRouter }, { plannerRouter }] = await Promise.all([
    import("./planning"),
    import("./planner"),
  ]);
  const appRouter = { planning: planningRouter, planner: plannerRouter };
  apiA = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userA) },
  });
  apiB = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userB) },
  });
}, 30_000);

afterAll(async () => {
  await database
    .delete(schema.users)
    .where(inArray(schema.users.id, [userA, userB]));
}, 30_000);

describe("planning v2", () => {
  test("keeps personal tasks separate and projects them into calendar and day", async () => {
    const task = await apiA.planning.tasks.create({
      yearId: yearA,
      title: "Prepare the oral",
      startsAt: new Date("2027-03-24T08:00:00.000Z"),
      scheduledAt: new Date("2027-03-29T06:30:00.000Z"),
      dueAt: new Date("2027-03-29T08:00:00.000Z"),
      subjectId: subjectA,
    });
    expect(task.management).toMatchObject({
      mode: "user",
      lockedFields: [],
    });
    expect(task.startsAt).toEqual(new Date("2027-03-24T08:00:00.000Z"));
    await expect(
      apiA.planning.tasks.update({
        taskId: task.id,
        startsAt: new Date("2027-03-30T08:00:00.000Z"),
      }),
    ).rejects.toThrow("start after its due date");
    const day = await apiA.planning.day({
      yearId: yearA,
      date: "2027-03-29",
      timezone: "Europe/Paris",
    });
    expect(day.tasks.map((item) => item.id)).toContain(task.id);
    const done = await apiA.planning.tasks.setStatus({
      taskId: task.id,
      status: "done",
    });
    expect(done.completedAt).toBeInstanceOf(Date);
  });

  test("creates, edits, completes, and deletes a local academic assignment", async () => {
    const created = await apiA.planning.assignments.create({
      yearId: yearA,
      title: "Read chapter 4",
      instructions: "Take notes on the examples",
      assignedAt: new Date("2027-03-28T08:00:00.000Z"),
      startsAt: new Date("2027-03-29T08:00:00.000Z"),
      dueAt: new Date("2027-03-30T16:00:00.000Z"),
      subjectId: subjectA,
    });
    expect(created.management).toMatchObject({
      mode: "user",
      lockedFields: [],
    });
    expect(created.startsAt).toEqual(new Date("2027-03-29T08:00:00.000Z"));
    const updated = await apiA.planning.assignments.update({
      assignmentId: created.id,
      title: "Read and summarize chapter 4",
      localNote: "Review before class",
      completed: true,
    });
    expect(updated).toMatchObject({
      title: "Read and summarize chapter 4",
      localNote: "Review before class",
      completed: true,
    });
    expect(updated.completedAt).toBeInstanceOf(Date);
    await expect(
      apiB.planning.assignments.update({
        assignmentId: created.id,
        title: "Cross-user edit",
      }),
    ).rejects.toThrow("not found");
    await expect(
      apiA.planning.assignments.create({
        yearId: yearA,
        title: "Invalid subject",
        subjectId: "foreign-subject",
      }),
    ).rejects.toThrow();
    await expect(
      apiA.planning.assignments.update({
        assignmentId: created.id,
        startsAt: new Date("2027-03-31T08:00:00.000Z"),
      }),
    ).rejects.toThrow("start after its due date");
    expect(
      await apiA.planning.assignments.delete({ assignmentId: created.id }),
    ).toEqual({ ok: true });
    expect(
      (
        await apiA.planning.assignments.list({
          yearId: yearA,
          includeMissing: true,
        })
      ).some((assignment) => assignment.id === created.id),
    ).toBe(false);
  });

  test("keeps provider homework immutable while allowing local completion and notes", async () => {
    const assignmentId = `assignment-${crypto.randomUUID()}`;
    const now = new Date();
    await database.insert(schema.academicAssignments).values({
      id: assignmentId,
      title: "Provider homework",
      instructions: "Exercises 1–4",
      dueAt: new Date("2027-04-03T16:00:00.000Z"),
      subjectId: subjectA,
      yearId: yearA,
      userId: userA,
      sourceConnectionId: connectionA,
      externalId: `homework-${crypto.randomUUID()}`,
      syncState: "managed",
      createdAt: now,
      updatedAt: now,
    });
    const noted = await apiA.planning.assignments.updateLocal({
      assignmentId,
      localNote: "Ask about exercise 3",
    });
    expect(noted.localNote).toBe("Ask about exercise 3");
    expect(noted.management.lockedFields).toContain("title");
    expect(noted.management.editableFields).toContain("startsAt");
    const planned = await apiA.planning.assignments.update({
      assignmentId,
      startsAt: new Date("2027-04-01T08:00:00.000Z"),
    });
    expect(planned.startsAt).toEqual(new Date("2027-04-01T08:00:00.000Z"));
    expect(
      (
        await apiA.planning.assignments.setCompleted({
          assignmentId,
          completed: true,
        })
      ).completed,
    ).toBe(true);
    const [listed] = await apiA.planning.assignments.list({ yearId: yearA });
    expect(listed?.management).toMatchObject({
      provider: "moodle",
      providerLabel: "Managed school",
    });
    await expect(
      apiA.planning.assignments.update({
        assignmentId,
        title: "Forged provider homework",
      }),
    ).rejects.toThrow("locked");
    await expect(
      apiA.planning.assignments.delete({ assignmentId }),
    ).rejects.toThrow("Dismiss or detach");
  });

  test("rejects provider field edits, then detach creates an editable copy and tombstone", async () => {
    const eventId = `managed-event-${crypto.randomUUID()}`;
    const now = new Date();
    await database.insert(schema.calendarEvents).values({
      id: eventId,
      eventKind: "holiday",
      title: "Provider holiday",
      startsAt: new Date("2027-04-10T00:00:00.000Z"),
      allDay: true,
      timezone: "Europe/Paris",
      yearId: yearA,
      userId: userA,
      sourceConnectionId: connectionA,
      externalId: `holiday-${crypto.randomUUID()}`,
      syncState: "managed",
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      apiA.planning.events.update({ eventId, title: "Forged" }),
    ).rejects.toThrow("locked");
    const detached = await apiA.planning.events.detach({ eventId });
    expect(detached.management.mode).toBe("user");
    expect(
      (
        await apiA.planning.events.update({
          eventId: detached.id,
          title: "My holiday",
        })
      ).title,
    ).toBe("My holiday");
    const [source] = await database
      .select({ syncState: schema.calendarEvents.syncState })
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, eventId));
    expect(source?.syncState).toBe("dismissed");
  });

  test("expands timetable series and materializes a local cancellation exception", async () => {
    const series = await apiA.planning.timetable.createSeries({
      yearId: yearA,
      title: "Mathematics",
      startsOn: "2027-04-05",
      endsOn: "2027-04-30",
      startMinutes: 8 * 60 + 30,
      durationMinutes: 90,
      timezone: "Europe/Paris",
      recurrence: { frequency: "weekly", interval: 1, weekdays: [1] },
      subjectId: subjectA,
    });
    let calendar = await apiA.planning.calendar({
      yearId: yearA,
      from: new Date("2027-04-04T00:00:00.000Z"),
      to: new Date("2027-04-13T00:00:00.000Z"),
      timezone: "Europe/Paris",
    });
    const lessons = calendar.items.filter((item) => item.kind === "lesson");
    expect(lessons).toHaveLength(2);
    expect(lessons.every((item) => item.virtual)).toBe(true);
    await apiA.planning.timetable.cancelOccurrence({
      seriesId: series.id,
      occurrenceDate: "2027-04-12",
    });
    calendar = await apiA.planning.calendar({
      yearId: yearA,
      from: new Date("2027-04-04T00:00:00.000Z"),
      to: new Date("2027-04-13T00:00:00.000Z"),
      timezone: "Europe/Paris",
    });
    const cancelled = calendar.items.find(
      (item) => item.kind === "lesson" && item.occurrenceDate === "2027-04-12",
    );
    expect(cancelled).toMatchObject({ status: "cancelled", virtual: false });
  });

  test("projects only explicit recording links and keeps recordings after Planning deletion", async () => {
    const event = await apiA.planning.events.create({
      yearId: yearA,
      title: "Oral exam",
      startsAt: new Date("2027-04-20T08:00:00.000Z"),
      endsAt: new Date("2027-04-20T09:00:00.000Z"),
      subjectId: subjectA,
    });
    const occurrence = await apiA.planning.timetable.createOccurrence({
      yearId: yearA,
      seriesId: null,
      occurrenceDate: "2027-04-20",
      title: "Mathematics class",
      startsAt: new Date("2027-04-20T10:00:00.000Z"),
      endsAt: new Date("2027-04-20T11:00:00.000Z"),
      subjectId: subjectA,
    });
    const eventRecordingId = `event-recording-${crypto.randomUUID()}`;
    const occurrenceRecordingId = `occurrence-recording-${crypto.randomUUID()}`;
    const unlinkedRecordingId = `unlinked-recording-${crypto.randomUUID()}`;
    await database.insert(schema.lectureRecordings).values([
      {
        id: eventRecordingId,
        title: "Explicit event recording",
        status: "uploaded",
        recordedAt: new Date("2027-04-20T08:15:00.000Z"),
        calendarEventId: event.id,
        subjectId: subjectA,
        yearId: yearA,
        userId: userA,
      },
      {
        id: occurrenceRecordingId,
        title: "Explicit class recording",
        status: "uploaded",
        recordedAt: new Date("2027-03-20T10:15:00.000Z"),
        timetableOccurrenceId: occurrence.id,
        subjectId: subjectA,
        yearId: yearA,
        userId: userA,
      },
      {
        id: unlinkedRecordingId,
        title: "Coincidental recording",
        status: "uploaded",
        recordedAt: new Date("2027-04-20T10:30:00.000Z"),
        subjectId: subjectA,
        yearId: yearA,
        userId: userA,
      },
    ]);

    const calendar = await apiA.planning.calendar({
      yearId: yearA,
      from: new Date("2027-04-20T00:00:00.000Z"),
      to: new Date("2027-04-20T23:59:59.999Z"),
      timezone: "UTC",
    });
    const eventItem = calendar.items.find(
      (item) => item.kind === "event" && item.id === event.id,
    );
    const lessonItem = calendar.items.find(
      (item) => item.kind === "lesson" && item.id === occurrence.id,
    );
    expect(
      eventItem && "recordings" in eventItem ? eventItem.recordings : null,
    ).toEqual([{ id: eventRecordingId, title: "Explicit event recording" }]);
    expect(
      lessonItem && "recordings" in lessonItem ? lessonItem.recordings : null,
    ).toEqual([
      { id: occurrenceRecordingId, title: "Explicit class recording" },
    ]);
    expect(
      calendar.items
        .filter((item) => item.kind === "lesson" || item.kind === "event")
        .flatMap((item) => ("recordings" in item ? item.recordings : []))
        .some((recording) => recording.id === unlinkedRecordingId),
    ).toBe(false);

    await apiA.planning.events.delete({ eventId: event.id });
    await apiA.planning.timetable.deleteOccurrence({
      occurrenceId: occurrence.id,
    });
    const persisted = await database
      .select({
        id: schema.lectureRecordings.id,
        calendarEventId: schema.lectureRecordings.calendarEventId,
        timetableOccurrenceId: schema.lectureRecordings.timetableOccurrenceId,
      })
      .from(schema.lectureRecordings)
      .where(
        inArray(schema.lectureRecordings.id, [
          eventRecordingId,
          occurrenceRecordingId,
        ]),
      );
    expect(persisted).toHaveLength(2);
    expect(
      persisted.every(
        (recording) =>
          recording.calendarEventId === null &&
          recording.timetableOccurrenceId === null,
      ),
    ).toBe(true);
  });

  test("uses dismiss and detach instead of mutating provider lesson occurrences", async () => {
    const seriesId = `managed-series-${crypto.randomUUID()}`;
    const now = new Date();
    await database.insert(schema.timetableSeries).values({
      id: seriesId,
      title: "Managed lesson",
      startsOn: "2027-05-03",
      endsOn: "2027-05-31",
      startMinutes: 9 * 60,
      durationMinutes: 60,
      timezone: "Europe/Paris",
      recurrenceFrequency: "weekly",
      recurrenceInterval: 1,
      recurrenceWeekdays: [1],
      subjectId: subjectA,
      yearId: yearA,
      userId: userA,
      sourceConnectionId: connectionA,
      externalId: `lesson-${crypto.randomUUID()}`,
      syncState: "managed",
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      apiA.planning.timetable.cancelOccurrence({
        seriesId,
        occurrenceDate: "2027-05-03",
      }),
    ).rejects.toThrow("locked");
    expect(
      await database
        .select()
        .from(schema.timetableOccurrences)
        .where(eq(schema.timetableOccurrences.seriesId, seriesId)),
    ).toHaveLength(0);

    const tombstone = await apiA.planning.timetable.dismissOccurrence({
      seriesId,
      occurrenceDate: "2027-05-03",
    });
    expect(tombstone.syncState).toBe("dismissed");
    const detached = await apiA.planning.timetable.detachOccurrence({
      seriesId,
      occurrenceDate: "2027-05-10",
    });
    expect(detached).toMatchObject({
      seriesId: null,
      syncState: "detached",
      management: { mode: "user" },
    });
  });

  test("locates a linked calendar item without exposing another account", async () => {
    const event = await apiA.planning.events.create({
      yearId: yearA,
      title: "Linked oral exam",
      startsAt: new Date("2027-07-14T08:00:00.000Z"),
      endsAt: new Date("2027-07-14T09:00:00.000Z"),
      timezone: "Europe/Paris",
      subjectId: subjectA,
    });
    const createdOccurrence = await apiA.planning.timetable.createOccurrence({
      yearId: yearA,
      seriesId: null,
      occurrenceDate: "2027-07-15",
      title: "Linked class",
      startsAt: new Date("2027-07-15T08:00:00.000Z"),
      endsAt: new Date("2027-07-15T09:00:00.000Z"),
      timezone: "Europe/Paris",
      subjectId: subjectA,
    });
    // An exception keeps its recurrence identity even after moving to a
    // different visual day. locate must follow startsAt, not that identity.
    const occurrence = await apiA.planning.timetable.updateOccurrence({
      occurrenceId: createdOccurrence.id,
      startsAt: new Date("2027-07-16T08:00:00.000Z"),
      endsAt: new Date("2027-07-16T09:00:00.000Z"),
    });

    expect(
      await apiA.planning.locate({
        kind: "calendarEvent",
        eventId: event.id,
      }),
    ).toMatchObject({
      kind: "calendarEvent",
      id: event.id,
      yearId: yearA,
      date: "2027-07-14",
      timezone: "Europe/Paris",
      available: true,
    });
    expect(
      await apiA.planning.locate({
        kind: "timetableOccurrence",
        occurrenceId: occurrence.id,
      }),
    ).toMatchObject({
      kind: "timetableOccurrence",
      id: occurrence.id,
      yearId: yearA,
      date: "2027-07-16",
      timezone: "Europe/Paris",
      available: true,
    });
    await database
      .update(schema.timetableOccurrences)
      .set({ status: "cancelled" })
      .where(eq(schema.timetableOccurrences.id, occurrence.id));
    expect(
      await apiA.planning.locate({
        kind: "timetableOccurrence",
        occurrenceId: occurrence.id,
      }),
    ).toMatchObject({ id: occurrence.id, available: false });
    await database
      .update(schema.calendarEvents)
      .set({ syncState: "dismissed" })
      .where(eq(schema.calendarEvents.id, event.id));
    expect(
      await apiA.planning.locate({ kind: "calendarEvent", eventId: event.id }),
    ).toMatchObject({ id: event.id, available: false });
    await expect(
      apiB.planning.locate({ kind: "calendarEvent", eventId: event.id }),
    ).rejects.toThrow();
  });

  test("does not reveal another account's planning rows", async () => {
    const task = await apiA.planning.tasks.create({
      yearId: yearA,
      title: "Private",
    });
    await expect(
      apiB.planning.tasks.update({ taskId: task.id, title: "Forged" }),
    ).rejects.toThrow("Planning task not found");
  });

  test("keeps legacy planner rows visible until the idempotent backfill runs", async () => {
    const legacy = await apiA.planner.create({
      yearId: yearA,
      title: "Legacy event",
      kind: "event",
      startsAt: new Date("2027-04-20T09:00:00.000Z"),
      allDay: false,
    });
    const calendar = await apiA.planning.calendar({
      yearId: yearA,
      from: new Date("2027-04-20T00:00:00.000Z"),
      to: new Date("2027-04-20T23:59:59.999Z"),
    });
    expect(calendar.items).toContainEqual(
      expect.objectContaining({
        id: legacy.id,
        kind: "legacy",
        legacyKind: "event",
      }),
    );
  });
});
