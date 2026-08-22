import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planningManagement } from "@avermate/core/planning";
import * as schema from "../db/schema";
import {
  publishSchoolPlanningSnapshot,
  type SchoolPlanningSnapshot,
} from "./school-planning";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

const testDirectory = mkdtempSync(join(tmpdir(), "avermate-school-planning-"));
const testDatabasePath = join(testDirectory, "planning.db").replaceAll(
  "\\",
  "/",
);
const client = createClient({ url: `file:${testDatabasePath}` });
const database = drizzle(client, { schema });

const userId = "school-sync-user";
const yearId = "school-sync-year";
const subjectId = "school-sync-subject";
const connectionId = "school-sync-connection";
const now = new Date("2026-09-10T10:00:00.000Z");
const window = {
  from: new Date("2026-09-01T00:00:00.000Z"),
  to: new Date("2026-09-30T23:59:59.999Z"),
  timezone: "Europe/Paris",
};
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

function publishScope(
  expectedConnectionUpdatedAt: Date,
  connectionUpdatedAt: Date,
) {
  return {
    connectionId,
    userId,
    yearId,
    window,
    publicationFence: {
      expectedConnectionUpdatedAt,
      connectionUpdatedAt,
      connectionStatus: "active" as const,
      lastSyncAt: connectionUpdatedAt,
      lastError: null,
    },
  };
}

beforeAll(async () => {
  await client.executeMultiple(migration);
  await database.insert(schema.users).values({
    id: userId,
    name: "School Sync",
    email: "school-sync@example.com",
    emailVerified: true,
    role: "user",
    banned: false,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(schema.years).values({
    id: yearId,
    name: "2026–2027",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2027-07-01T00:00:00.000Z"),
    userId,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(schema.subjects).values({
    id: subjectId,
    name: "Mathematiques",
    kind: "subject",
    yearId,
    userId,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(schema.syncConnections).values({
    id: connectionId,
    provider: "ecoledirecte",
    label: "ÉcoleDirecte Ada",
    baseUrl: "https://api.ecoledirecte.com",
    sealedCredentials: "sealed-test-value",
    capabilities: [
      "homework",
      "timetable",
      "grades",
      "attachments",
      "school-calendar",
    ],
    status: "active",
    yearId,
    userId,
    createdAt: now,
    updatedAt: now,
  });
}, databaseHookTimeout);

afterAll(async () => {
  client.close();
  Bun.gc(true);
  await Bun.sleep(50);
  rmSync(testDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 20,
  });
}, databaseHookTimeout);

function firstSnapshot(): SchoolPlanningSnapshot {
  return {
    homework: [
      {
        externalId: "homework-1",
        title: "Exercices 1–4",
        instructions: "Pages 20–21",
        assignedAt: new Date("2026-09-08T10:00:00.000Z"),
        dueAt: new Date("2026-09-15T21:59:59.999Z"),
        subject: { externalId: "MATHS", name: "Mathématiques" },
        completedUpstream: false,
        attachments: [],
        modifiedAt: now,
      },
    ],
    timetable: [
      {
        externalId: "lesson-1",
        title: "Mathématiques",
        notes: null,
        startsAt: new Date("2026-09-12T06:00:00.000Z"),
        endsAt: new Date("2026-09-12T07:00:00.000Z"),
        timezone: "Europe/Paris",
        location: "B12",
        subject: { externalId: "MATHS", name: "Mathématiques" },
        cancelled: false,
        modifiedAt: now,
      },
    ],
    schoolCalendar: [
      {
        externalId: "event-1",
        kind: "holiday",
        title: "Jour sans cours",
        description: null,
        startsAt: new Date("2026-09-20T00:00:00.000Z"),
        endsAt: null,
        allDay: true,
        timezone: "Europe/Paris",
        location: null,
        modifiedAt: now,
      },
    ],
  };
}

describe("school planning publication", () => {
  test("publishes managed rows and preserves local overlays and dismissals", async () => {
    const firstWriteAt = new Date(now.getTime() + 1_000);
    const first = await publishSchoolPlanningSnapshot(
      publishScope(now, firstWriteAt),
      firstSnapshot(),
      now,
      undefined,
      database,
    );
    expect(first).toEqual({
      homework: 1,
      timetable: 1,
      schoolCalendar: 1,
      grades: 0,
      gradeCandidates: 0,
      gradeUnmapped: 0,
      markedMissing: 0,
    });

    const [assignment] = await database
      .select()
      .from(schema.academicAssignments)
      .where(eq(schema.academicAssignments.externalId, "homework:homework-1"));
    expect(assignment).toMatchObject({
      subjectId,
      sourceConnectionId: connectionId,
      syncState: "managed",
      completedAt: null,
    });
    const [initialMapping] = await database
      .select()
      .from(schema.syncSubjectMappings)
      .where(eq(schema.syncSubjectMappings.providerSubjectExternalId, "MATHS"));
    expect(initialMapping).toMatchObject({
      connectionId,
      subjectId,
      matchStatus: "mapped",
    });
    const management = planningManagement("assignment", assignment!);
    expect(management.mode).toBe("provider");
    expect(management.lockedFields).toContain("title");
    expect(management.editableFields).toEqual([
      "localNote",
      "startsAt",
      "completed",
    ]);

    const completedAt = new Date("2026-09-11T12:00:00.000Z");
    await database
      .update(schema.academicAssignments)
      .set({ localNote: "À revoir", completedAt })
      .where(eq(schema.academicAssignments.id, assignment!.id));
    await database
      .update(schema.calendarEvents)
      .set({ syncState: "dismissed" })
      .where(eq(schema.calendarEvents.externalId, "school-calendar:event-1"));

    const changed = firstSnapshot();
    changed.homework[0] = {
      ...changed.homework[0]!,
      title: "Exercices 1–6",
      instructions: "Pages 20–23",
      subject: { externalId: "MATHS", name: "Maths renommées" },
    };
    await database
      .update(schema.subjects)
      .set({ name: "Analyse" })
      .where(eq(schema.subjects.id, subjectId));
    changed.timetable = [];
    changed.schoolCalendar = [];
    const secondWriteAt = new Date(now.getTime() + 60_000);
    const second = await publishSchoolPlanningSnapshot(
      publishScope(firstWriteAt, secondWriteAt),
      changed,
      secondWriteAt,
      undefined,
      database,
    );
    expect(second.markedMissing).toBe(1);

    const [updatedAssignment] = await database
      .select()
      .from(schema.academicAssignments)
      .where(eq(schema.academicAssignments.id, assignment!.id));
    expect(updatedAssignment).toMatchObject({
      title: "Exercices 1–6",
      instructions: "Pages 20–23",
      localNote: "À revoir",
      completedAt,
      subjectId,
      syncState: "managed",
    });
    const [lesson] = await database
      .select()
      .from(schema.timetableOccurrences)
      .where(eq(schema.timetableOccurrences.externalId, "timetable:lesson-1"));
    expect(lesson?.syncState).toBe("missing");
    const [event] = await database
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.externalId, "school-calendar:event-1"));
    expect(event?.syncState).toBe("dismissed");

    await database
      .update(schema.academicAssignments)
      .set({ syncState: "missing" })
      .where(eq(schema.academicAssignments.id, assignment!.id));
    const thirdWriteAt = new Date(now.getTime() + 120_000);
    await publishSchoolPlanningSnapshot(
      publishScope(secondWriteAt, thirdWriteAt),
      changed,
      thirdWriteAt,
      undefined,
      database,
    );
    const [restored] = await database
      .select({ syncState: schema.academicAssignments.syncState })
      .from(schema.academicAssignments)
      .where(eq(schema.academicAssignments.id, assignment!.id));
    expect(restored?.syncState).toBe("managed");

    const freshWriteAt = new Date(now.getTime() + 180_000);
    const fresh = firstSnapshot();
    fresh.homework[0] = {
      ...fresh.homework[0]!,
      title: "Version la plus récente",
    };
    await publishSchoolPlanningSnapshot(
      publishScope(thirdWriteAt, freshWriteAt),
      fresh,
      freshWriteAt,
      undefined,
      database,
    );

    const stale = firstSnapshot();
    stale.homework[0] = {
      ...stale.homework[0]!,
      title: "Version obsolète",
    };
    await expect(
      publishSchoolPlanningSnapshot(
        publishScope(thirdWriteAt, new Date(now.getTime() + 150_000)),
        stale,
        new Date(now.getTime() + 150_000),
        undefined,
        database,
      ),
    ).rejects.toThrow("changed before publication");
    const [afterStaleAttempt] = await database
      .select({ title: schema.academicAssignments.title })
      .from(schema.academicAssignments)
      .where(eq(schema.academicAssignments.id, assignment!.id));
    expect(afterStaleAttempt?.title).toBe("Version la plus récente");

    let signalStaleStarted!: () => void;
    let releaseStaleDiscovery!: () => void;
    const staleStarted = new Promise<void>((resolve) => {
      signalStaleStarted = resolve;
    });
    const staleDiscoveryGate = new Promise<void>((resolve) => {
      releaseStaleDiscovery = resolve;
    });
    const snapshotWithTitle = (title: string) => {
      const snapshot = firstSnapshot();
      snapshot.homework[0] = { ...snapshot.homework[0]!, title };
      return snapshot;
    };
    const staleWriteAt = new Date(now.getTime() + 240_000);
    const freshRaceWriteAt = new Date(now.getTime() + 300_000);
    const stalePublication = (async () => {
      signalStaleStarted();
      await staleDiscoveryGate;
      return publishSchoolPlanningSnapshot(
        publishScope(freshWriteAt, staleWriteAt),
        snapshotWithTitle("Découverte obsolète"),
        staleWriteAt,
        undefined,
        database,
      );
    })();
    await staleStarted;
    await publishSchoolPlanningSnapshot(
      publishScope(freshWriteAt, freshRaceWriteAt),
      snapshotWithTitle("Découverte la plus récente"),
      freshRaceWriteAt,
      undefined,
      database,
    );
    releaseStaleDiscovery();
    await expect(stalePublication).rejects.toThrow(
      "changed before publication",
    );
    const [afterOrderedRace] = await database
      .select({ title: schema.academicAssignments.title })
      .from(schema.academicAssignments)
      .where(eq(schema.academicAssignments.id, assignment!.id));
    expect(afterOrderedRace?.title).toBe("Découverte la plus récente");

    const physicsA = "school-sync-physics-a";
    const physicsB = "school-sync-physics-b";
    await database.insert(schema.subjects).values([
      {
        id: physicsA,
        name: "Physique",
        kind: "subject",
        yearId,
        userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: physicsB,
        name: "Physique",
        kind: "subject",
        yearId,
        userId,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const ambiguousAt = new Date(now.getTime() + 360_000);
    const ambiguousSnapshot = firstSnapshot();
    ambiguousSnapshot.schoolCalendar.push({
      externalId: "overlapping-holiday",
      kind: "holiday",
      title: "Vacances commencées avant la fenêtre",
      description: null,
      startsAt: new Date("2026-08-30T00:00:00.000Z"),
      endsAt: new Date("2026-09-02T00:00:00.000Z"),
      allDay: true,
      timezone: "Europe/Paris",
      location: null,
      modifiedAt: now,
    });
    ambiguousSnapshot.homework.push({
      externalId: "physics",
      title: "Compte-rendu de TP",
      instructions: null,
      assignedAt: now,
      dueAt: new Date("2026-09-18T18:00:00.000Z"),
      subject: { externalId: "PHYS", name: "Physique" },
      completedUpstream: true,
      attachments: [],
      modifiedAt: now,
    });
    await publishSchoolPlanningSnapshot(
      publishScope(freshRaceWriteAt, ambiguousAt),
      ambiguousSnapshot,
      ambiguousAt,
      undefined,
      database,
    );
    const [ambiguousMapping] = await database
      .select()
      .from(schema.syncSubjectMappings)
      .where(eq(schema.syncSubjectMappings.providerSubjectExternalId, "PHYS"));
    expect(ambiguousMapping).toMatchObject({
      subjectId: null,
      matchStatus: "ambiguous",
    });
    const [ambiguousAssignment] = await database
      .select()
      .from(schema.academicAssignments)
      .where(eq(schema.academicAssignments.externalId, "homework:physics"));
    expect(ambiguousAssignment).toMatchObject({
      subjectId: null,
      completedAt: ambiguousAt,
    });

    await database
      .update(schema.syncSubjectMappings)
      .set({ subjectId: physicsA, matchStatus: "mapped" })
      .where(eq(schema.syncSubjectMappings.id, ambiguousMapping!.id));
    const resolvedAt = new Date(now.getTime() + 420_000);
    ambiguousSnapshot.homework[1] = {
      ...ambiguousSnapshot.homework[1]!,
      subject: { externalId: "PHYS", name: "Sciences physiques" },
      completedUpstream: false,
    };
    ambiguousSnapshot.schoolCalendar = ambiguousSnapshot.schoolCalendar.filter(
      (event) => event.externalId !== "overlapping-holiday",
    );
    await publishSchoolPlanningSnapshot(
      publishScope(ambiguousAt, resolvedAt),
      ambiguousSnapshot,
      resolvedAt,
      undefined,
      database,
    );
    const [resolvedAssignment] = await database
      .select()
      .from(schema.academicAssignments)
      .where(eq(schema.academicAssignments.id, ambiguousAssignment!.id));
    expect(resolvedAssignment).toMatchObject({
      subjectId: physicsA,
      completedAt: ambiguousAt,
    });
    const [removedOverlap] = await database
      .select()
      .from(schema.calendarEvents)
      .where(
        eq(
          schema.calendarEvents.externalId,
          "school-calendar:overlapping-holiday",
        ),
      );
    expect(removedOverlap?.syncState).toBe("missing");
  });

  test("publishes mapped numeric grades idempotently and retains non-numeric and missing snapshots", async () => {
    const gradeUserId = "school-grade-sync-user";
    const gradeYearId = "school-grade-sync-year";
    const gradeSubjectId = "school-grade-sync-subject";
    const gradePeriodId = "school-grade-sync-period";
    const gradeConnectionId = "school-grade-sync-connection";
    const initialConnectionAt = new Date("2026-09-01T08:00:00.000Z");
    const gradeWindow = {
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2027-06-30T23:59:59.999Z"),
      timezone: "Europe/Paris",
    };

    await database.insert(schema.users).values({
      id: gradeUserId,
      name: "School Grade Sync",
      email: "school-grade-sync@example.com",
      emailVerified: true,
      role: "user",
      banned: false,
      createdAt: initialConnectionAt,
      updatedAt: initialConnectionAt,
    });
    await database.insert(schema.years).values({
      id: gradeYearId,
      name: "2026–2027 grades",
      startsAt: gradeWindow.from,
      endsAt: gradeWindow.to,
      userId: gradeUserId,
      createdAt: initialConnectionAt,
      updatedAt: initialConnectionAt,
    });
    await database.insert(schema.subjects).values({
      id: gradeSubjectId,
      name: "Mathématiques",
      kind: "subject",
      yearId: gradeYearId,
      userId: gradeUserId,
      createdAt: initialConnectionAt,
      updatedAt: initialConnectionAt,
    });
    await database.insert(schema.periods).values({
      id: gradePeriodId,
      name: "Trimestre 1",
      startAt: gradeWindow.from,
      endAt: new Date("2026-12-31T23:59:59.999Z"),
      yearId: gradeYearId,
      userId: gradeUserId,
      createdAt: initialConnectionAt,
      updatedAt: initialConnectionAt,
    });
    await database.insert(schema.syncConnections).values({
      id: gradeConnectionId,
      provider: "pronote",
      label: "PRONOTE grades",
      baseUrl: "https://pronote.example",
      sealedCredentials: "sealed-grade-test-value",
      capabilities: ["grades"],
      status: "active",
      gradesAuthority: true,
      yearId: gradeYearId,
      userId: gradeUserId,
      createdAt: initialConnectionAt,
      updatedAt: initialConnectionAt,
    });

    const gradeScope = (expectedAt: Date, writeAt: Date) => ({
      connectionId: gradeConnectionId,
      userId: gradeUserId,
      yearId: gradeYearId,
      window: gradeWindow,
      gradeWindow,
      publishGrades: true,
      markMissingCapabilities: ["grades" as const],
      publicationFence: {
        expectedConnectionUpdatedAt: expectedAt,
        connectionUpdatedAt: writeAt,
        connectionStatus: "active" as const,
        lastSyncAt: writeAt,
        lastError: null,
      },
    });
    const numericGrade = {
      externalId: "math-1",
      title: "Contrôle de fonctions",
      subject: { externalId: "MATHS", name: "Mathematiques" },
      periodExternalId: "T1",
      periodName: "Trimestre 1",
      passedAt: new Date("2026-10-10T09:00:00.000Z"),
      value: 15,
      outOf: 20,
      coefficient: 2,
      significant: true,
      modifiedAt: initialConnectionAt,
    };
    const nonNumericGrade = {
      externalId: "math-absence",
      title: "Évaluation non notée",
      subject: { externalId: "MATHS", name: "Mathématiques" },
      periodExternalId: "T1",
      periodName: "Trimestre 1",
      passedAt: new Date("2026-10-17T09:00:00.000Z"),
      value: null,
      outOf: null,
      coefficient: 1,
      significant: false,
      modifiedAt: initialConnectionAt,
    };
    const snapshot = (grades: SchoolPlanningSnapshot["grades"]) => ({
      homework: [],
      timetable: [],
      schoolCalendar: [],
      grades,
    });

    const firstWriteAt = new Date("2026-09-01T08:01:00.000Z");
    const first = await publishSchoolPlanningSnapshot(
      gradeScope(initialConnectionAt, firstWriteAt),
      snapshot([numericGrade, nonNumericGrade]),
      firstWriteAt,
      undefined,
      database,
    );
    expect(first).toEqual({
      homework: 0,
      timetable: 0,
      schoolCalendar: 0,
      grades: 1,
      gradeCandidates: 2,
      gradeUnmapped: 0,
      markedMissing: 0,
    });

    const recordsAfterFirst = await database
      .select()
      .from(schema.syncGradeRecords)
      .where(eq(schema.syncGradeRecords.connectionId, gradeConnectionId));
    expect(recordsAfterFirst).toHaveLength(2);
    const numericRecord = recordsAfterFirst.find(
      (record) => record.externalId === "grades:math-1",
    );
    const nonNumericRecord = recordsAfterFirst.find(
      (record) => record.externalId === "grades:math-absence",
    );
    expect(numericRecord).toMatchObject({
      providerSubjectExternalId: "MATHS",
      providerPeriodExternalId: "T1",
      value: 15,
      outOf: 20,
      significant: true,
      syncState: "managed",
    });
    expect(numericRecord?.localGradeId).toBeTruthy();
    expect(nonNumericRecord).toMatchObject({
      value: null,
      outOf: null,
      significant: false,
      syncState: "managed",
      localGradeId: null,
    });

    const [subjectMapping] = await database
      .select()
      .from(schema.syncSubjectMappings)
      .where(eq(schema.syncSubjectMappings.connectionId, gradeConnectionId));
    const [periodMapping] = await database
      .select()
      .from(schema.syncPeriodMappings)
      .where(eq(schema.syncPeriodMappings.connectionId, gradeConnectionId));
    expect(subjectMapping).toMatchObject({
      providerSubjectExternalId: "MATHS",
      subjectId: gradeSubjectId,
      matchStatus: "mapped",
    });
    expect(periodMapping).toMatchObject({
      providerPeriodExternalId: "T1",
      periodId: gradePeriodId,
      matchStatus: "mapped",
    });

    const [createdGrade] = await database
      .select()
      .from(schema.grades)
      .where(eq(schema.grades.id, numericRecord!.localGradeId!));
    expect(createdGrade).toMatchObject({
      name: "Contrôle de fonctions",
      value: 15,
      outOf: 20,
      coefficient: 2,
      subjectId: gradeSubjectId,
      periodId: gradePeriodId,
      excludedFromAverage: false,
      syncExcludedFromAverage: false,
    });

    await database
      .update(schema.grades)
      .set({
        bonus: 1.5,
        note: "Correction locale",
        excludedFromAverage: true,
      })
      .where(eq(schema.grades.id, createdGrade!.id));
    const secondWriteAt = new Date("2026-09-01T08:02:00.000Z");
    const second = await publishSchoolPlanningSnapshot(
      gradeScope(firstWriteAt, secondWriteAt),
      snapshot([
        {
          ...numericGrade,
          title: "Contrôle de fonctions corrigé",
          value: 16,
          modifiedAt: secondWriteAt,
        },
        nonNumericGrade,
      ]),
      secondWriteAt,
      undefined,
      database,
    );
    expect(second.grades).toBe(1);
    expect(
      await database
        .select()
        .from(schema.grades)
        .where(eq(schema.grades.yearId, gradeYearId)),
    ).toHaveLength(1);
    const [updatedGrade] = await database
      .select()
      .from(schema.grades)
      .where(eq(schema.grades.id, createdGrade!.id));
    expect(updatedGrade).toMatchObject({
      name: "Contrôle de fonctions corrigé",
      value: 16,
      bonus: 1.5,
      note: "Correction locale",
      excludedFromAverage: true,
      syncExcludedFromAverage: false,
    });

    const missingWriteAt = new Date("2026-09-01T08:03:00.000Z");
    const missing = await publishSchoolPlanningSnapshot(
      gradeScope(secondWriteAt, missingWriteAt),
      snapshot([nonNumericGrade]),
      missingWriteAt,
      undefined,
      database,
    );
    expect(missing.markedMissing).toBe(1);
    const [missingRecord] = await database
      .select()
      .from(schema.syncGradeRecords)
      .where(eq(schema.syncGradeRecords.id, numericRecord!.id));
    const [excludedGrade] = await database
      .select()
      .from(schema.grades)
      .where(eq(schema.grades.id, createdGrade!.id));
    expect(missingRecord?.syncState).toBe("missing");
    expect(excludedGrade).toMatchObject({
      id: createdGrade!.id,
      excludedFromAverage: true,
      syncExcludedFromAverage: true,
      bonus: 1.5,
      note: "Correction locale",
    });

    // `updatedAt` is deliberately left unchanged to reproduce the same-second
    // authority race. The explicit authority fence must still roll the whole
    // attempted publication back.
    await database
      .update(schema.syncConnections)
      .set({ gradesAuthority: false })
      .where(eq(schema.syncConnections.id, gradeConnectionId));
    const staleAuthorityWriteAt = new Date("2026-09-01T08:04:00.000Z");
    await expect(
      publishSchoolPlanningSnapshot(
        gradeScope(missingWriteAt, staleAuthorityWriteAt),
        snapshot([numericGrade, nonNumericGrade]),
        staleAuthorityWriteAt,
        undefined,
        database,
      ),
    ).rejects.toThrow("changed before publication");
    expect(
      (
        await database
          .select()
          .from(schema.syncGradeRecords)
          .where(eq(schema.syncGradeRecords.id, numericRecord!.id))
      )[0]?.syncState,
    ).toBe("missing");
  });
});
