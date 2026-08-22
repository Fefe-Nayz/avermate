import { isoDateInTimeZone } from "@avermate/core/planning";
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { db as applicationDb } from "../db";
import {
  academicAssignments,
  calendarEvents,
  grades,
  periods,
  subjects,
  syncConnections,
  syncGradeRecords,
  syncPeriodMappings,
  syncSubjectMappings,
  timetableOccurrences,
} from "../db/schema";
import { newId } from "../lib/id";
import { NonRetryableSyncError, RetryableSyncError } from "./errors";
import type { OpenConnection } from "./provider";
import {
  assertSchoolSyncWindow,
  type ProviderGrade,
  type ProviderHomework,
  type ProviderListOptions,
  type ProviderSchoolCalendarEvent,
  type ProviderSubjectRef,
  type ProviderTimetableLesson,
  type SchoolProviderAdapter,
  type SchoolSyncCapability,
  type SchoolSyncWindow,
} from "./school-provider";

export interface SchoolPlanningSnapshot {
  homework: ProviderHomework[];
  timetable: ProviderTimetableLesson[];
  schoolCalendar: ProviderSchoolCalendarEvent[];
  grades?: ProviderGrade[];
}

export interface SchoolPlanningPublishScope {
  connectionId: string;
  userId: string;
  yearId: string;
  window: SchoolSyncWindow;
  gradeWindow?: SchoolSyncWindow;
  publishGrades?: boolean;
  publicationFence: {
    expectedConnectionUpdatedAt: Date;
    connectionUpdatedAt: Date;
    connectionStatus: "active" | "error";
    lastSyncAt: Date;
    lastError: string | null;
  };
  markMissingCapabilities?: readonly Extract<
    SchoolSyncCapability,
    "homework" | "timetable" | "grades" | "school-calendar"
  >[];
}

export class SchoolPlanningPublicationConflictError extends RetryableSyncError {
  constructor() {
    super("The school synchronization connection changed before publication");
    this.name = "SchoolPlanningPublicationConflictError";
  }
}

export interface SchoolPlanningPublishResult {
  homework: number;
  timetable: number;
  schoolCalendar: number;
  grades: number;
  gradeCandidates: number;
  gradeUnmapped: number;
  markedMissing: number;
}

function normalizedSubjectName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

function normalizedPeriodName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

function providerPeriodExternalId(grade: ProviderGrade) {
  const explicit = grade.periodExternalId?.trim();
  if (explicit) {
    if (explicit.length > 1_900) {
      throw new NonRetryableSyncError(
        "The school provider returned an invalid period identity",
      );
    }
    return explicit;
  }
  const normalizedName = normalizedPeriodName(grade.periodName ?? "");
  // Some providers expose a period label but no durable identifier. Keeping a
  // namespaced fallback makes the uncertainty explicit and still allows the
  // user to review the mapping instead of silently dropping every grade.
  return normalizedName ? `name:${normalizedName}` : null;
}

function managedExternalId(
  capability: Extract<
    SchoolSyncCapability,
    "homework" | "timetable" | "grades" | "school-calendar"
  >,
  externalId: string,
) {
  const value = externalId.trim();
  if (!value || value.length > 1_900) {
    throw new NonRetryableSyncError(
      `The ${capability} provider identity is invalid`,
    );
  }
  return `${capability}:${value}`;
}

function providerSubjectExternalId(subject: ProviderSubjectRef) {
  const value = subject.externalId.trim();
  if (!value || value.length > 1_900) {
    throw new NonRetryableSyncError(
      "The school provider returned an invalid subject identity",
    );
  }
  return value;
}

function uniqueByExternalId<T extends { externalId: string }>(
  capability: Extract<
    SchoolSyncCapability,
    "homework" | "timetable" | "grades" | "school-calendar"
  >,
  values: readonly T[],
) {
  const result = new Map<string, T>();
  for (const value of values) {
    const externalId = managedExternalId(capability, value.externalId);
    if (result.has(externalId)) {
      throw new NonRetryableSyncError(
        `The ${capability} provider returned duplicate identities`,
      );
    }
    result.set(externalId, value);
  }
  return result;
}

function boundedTitle(value: string, fallback: string) {
  return value.trim().slice(0, 160) || fallback;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("The school synchronization was aborted");
}

async function activeConnection(
  transaction: Parameters<Parameters<typeof applicationDb.transaction>[0]>[0],
  scope: SchoolPlanningPublishScope,
) {
  const [connection] = await transaction
    .select({ id: syncConnections.id })
    .from(syncConnections)
    .where(
      and(
        eq(syncConnections.id, scope.connectionId),
        eq(syncConnections.userId, scope.userId),
        eq(syncConnections.yearId, scope.yearId),
        inArray(syncConnections.status, ["active", "error"]),
      ),
    )
    .limit(1);
  if (!connection) {
    throw new NonRetryableSyncError(
      "The school synchronization connection is no longer available",
    );
  }
}

function absentFromSnapshot(
  column: typeof academicAssignments.externalId,
  externalIds: readonly string[],
) {
  return externalIds.length > 0
    ? notInArray(column, [...externalIds])
    : undefined;
}

export async function publishSchoolPlanningSnapshot(
  scope: SchoolPlanningPublishScope,
  snapshot: SchoolPlanningSnapshot,
  now = new Date(),
  signal?: AbortSignal,
  database?: Pick<typeof applicationDb, "transaction">,
): Promise<SchoolPlanningPublishResult> {
  throwIfAborted(signal);
  assertSchoolSyncWindow(scope.window);
  const gradeWindow = scope.gradeWindow ?? scope.window;
  const publishGrades = scope.publishGrades ?? false;
  assertSchoolSyncWindow(gradeWindow);
  if (
    scope.publicationFence.connectionUpdatedAt <=
    scope.publicationFence.expectedConnectionUpdatedAt
  ) {
    throw new NonRetryableSyncError(
      "The school synchronization publication version is invalid",
    );
  }
  const homework = uniqueByExternalId("homework", snapshot.homework);
  const timetable = uniqueByExternalId("timetable", snapshot.timetable);
  const schoolCalendar = uniqueByExternalId(
    "school-calendar",
    snapshot.schoolCalendar,
  );
  const gradeSnapshot = uniqueByExternalId(
    "grades",
    (snapshot.grades ?? []).filter(
      (grade) =>
        grade.passedAt >= gradeWindow.from && grade.passedAt <= gradeWindow.to,
    ),
  );
  const markMissing = new Set(
    scope.markMissingCapabilities ?? [
      "homework",
      "timetable",
      "grades",
      "school-calendar",
    ],
  );

  const targetDatabase = database ?? (await import("../db")).db;
  return targetDatabase.transaction(async (transaction) => {
    throwIfAborted(signal);
    await activeConnection(transaction, scope);
    throwIfAborted(signal);
    const subjectRows = await transaction
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(
        and(
          eq(subjects.userId, scope.userId),
          eq(subjects.yearId, scope.yearId),
          eq(subjects.kind, "subject"),
        ),
      );
    const localSubjectsById = new Map(
      subjectRows.map((subject) => [subject.id, subject]),
    );
    const localSubjectsByName = new Map<string, typeof subjectRows>();
    for (const subject of subjectRows) {
      const normalizedName = normalizedSubjectName(subject.name);
      const candidates = localSubjectsByName.get(normalizedName) ?? [];
      candidates.push(subject);
      localSubjectsByName.set(normalizedName, candidates);
    }
    const existingMappings = await transaction
      .select()
      .from(syncSubjectMappings)
      .where(
        and(
          eq(syncSubjectMappings.connectionId, scope.connectionId),
          eq(syncSubjectMappings.userId, scope.userId),
          eq(syncSubjectMappings.yearId, scope.yearId),
        ),
      );
    const existingMappingByExternalId = new Map(
      existingMappings.map((mapping) => [
        mapping.providerSubjectExternalId,
        mapping,
      ]),
    );
    const providerSubjects = new Map<string, ProviderSubjectRef>();
    for (const item of [
      ...homework.values(),
      ...timetable.values(),
      ...gradeSnapshot.values(),
    ]) {
      if (!item.subject) continue;
      const externalId = providerSubjectExternalId(item.subject);
      const current = providerSubjects.get(externalId);
      if (
        current &&
        normalizedSubjectName(current.name) !==
          normalizedSubjectName(item.subject.name)
      ) {
        throw new NonRetryableSyncError(
          "The school provider returned conflicting subject identities",
        );
      }
      providerSubjects.set(externalId, item.subject);
    }
    const resolvedSubjects = new Map<string, string | null>();
    for (const [externalId, providerSubject] of providerSubjects) {
      const existing = existingMappingByExternalId.get(externalId);
      const preservedSubject = existing?.subjectId
        ? localSubjectsById.get(existing.subjectId)
        : undefined;
      const candidates =
        localSubjectsByName.get(normalizedSubjectName(providerSubject.name)) ??
        [];
      const subjectId =
        preservedSubject?.id ??
        (candidates.length === 1 ? candidates[0]!.id : null);
      const matchStatus = subjectId
        ? ("mapped" as const)
        : candidates.length > 1
          ? ("ambiguous" as const)
          : ("unmatched" as const);
      resolvedSubjects.set(externalId, subjectId);
      await transaction
        .insert(syncSubjectMappings)
        .values({
          connectionId: scope.connectionId,
          providerSubjectExternalId: externalId,
          providerSubjectName: providerSubject.name.trim().slice(0, 300),
          subjectId,
          matchStatus,
          yearId: scope.yearId,
          userId: scope.userId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            syncSubjectMappings.connectionId,
            syncSubjectMappings.providerSubjectExternalId,
          ],
          set: {
            providerSubjectName: providerSubject.name.trim().slice(0, 300),
            subjectId,
            matchStatus,
            yearId: scope.yearId,
            userId: scope.userId,
            updatedAt: now,
          },
        });
    }
    const subjectIdOf = (subject: ProviderSubjectRef | null | undefined) =>
      subject
        ? (resolvedSubjects.get(providerSubjectExternalId(subject)) ?? null)
        : null;

    const localPeriodRows = await transaction
      .select({ id: periods.id, name: periods.name })
      .from(periods)
      .where(
        and(eq(periods.userId, scope.userId), eq(periods.yearId, scope.yearId)),
      );
    const localPeriodsById = new Map(
      localPeriodRows.map((period) => [period.id, period]),
    );
    const localPeriodsByName = new Map<string, typeof localPeriodRows>();
    for (const period of localPeriodRows) {
      const normalizedName = normalizedPeriodName(period.name);
      const candidates = localPeriodsByName.get(normalizedName) ?? [];
      candidates.push(period);
      localPeriodsByName.set(normalizedName, candidates);
    }
    const existingPeriodMappings = await transaction
      .select()
      .from(syncPeriodMappings)
      .where(
        and(
          eq(syncPeriodMappings.connectionId, scope.connectionId),
          eq(syncPeriodMappings.userId, scope.userId),
          eq(syncPeriodMappings.yearId, scope.yearId),
        ),
      );
    const existingPeriodMappingByExternalId = new Map(
      existingPeriodMappings.map((mapping) => [
        mapping.providerPeriodExternalId,
        mapping,
      ]),
    );
    const providerPeriods = new Map<string, string>();
    for (const grade of gradeSnapshot.values()) {
      const externalId = providerPeriodExternalId(grade);
      if (!externalId) continue;
      const name = grade.periodName?.trim().slice(0, 160) || externalId;
      const current = providerPeriods.get(externalId);
      if (
        current &&
        normalizedPeriodName(current) !== normalizedPeriodName(name)
      ) {
        throw new NonRetryableSyncError(
          "The school provider returned conflicting period identities",
        );
      }
      providerPeriods.set(externalId, name);
    }
    const resolvedPeriods = new Map<string, string | null>();
    for (const [externalId, providerPeriodName] of providerPeriods) {
      const existing = existingPeriodMappingByExternalId.get(externalId);
      const preservedPeriod = existing?.periodId
        ? localPeriodsById.get(existing.periodId)
        : undefined;
      const candidates =
        localPeriodsByName.get(normalizedPeriodName(providerPeriodName)) ?? [];
      const periodId =
        preservedPeriod?.id ??
        (candidates.length === 1 ? candidates[0]!.id : null);
      const matchStatus = periodId
        ? ("mapped" as const)
        : candidates.length > 1
          ? ("ambiguous" as const)
          : ("unmatched" as const);
      resolvedPeriods.set(externalId, periodId);
      await transaction
        .insert(syncPeriodMappings)
        .values({
          connectionId: scope.connectionId,
          providerPeriodExternalId: externalId,
          providerPeriodName,
          periodId,
          matchStatus,
          yearId: scope.yearId,
          userId: scope.userId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            syncPeriodMappings.connectionId,
            syncPeriodMappings.providerPeriodExternalId,
          ],
          set: {
            providerPeriodName,
            periodId,
            matchStatus,
            yearId: scope.yearId,
            userId: scope.userId,
            updatedAt: now,
          },
        });
    }
    const periodIdOf = (grade: ProviderGrade) => {
      const externalId = providerPeriodExternalId(grade);
      return externalId ? (resolvedPeriods.get(externalId) ?? null) : null;
    };

    const existingGradeRecords = await transaction
      .select()
      .from(syncGradeRecords)
      .where(
        and(
          eq(syncGradeRecords.connectionId, scope.connectionId),
          eq(syncGradeRecords.userId, scope.userId),
          eq(syncGradeRecords.yearId, scope.yearId),
        ),
      );
    const existingGradeRecordByExternalId = new Map(
      existingGradeRecords.map((record) => [record.externalId, record]),
    );
    const linkedGradeIds = existingGradeRecords.flatMap((record) =>
      record.localGradeId ? [record.localGradeId] : [],
    );
    const existingLocalGrades =
      linkedGradeIds.length > 0
        ? await transaction
            .select()
            .from(grades)
            .where(
              and(
                eq(grades.userId, scope.userId),
                inArray(grades.id, linkedGradeIds),
              ),
            )
        : [];
    const localGradeById = new Map(
      existingLocalGrades.map((grade) => [grade.id, grade]),
    );
    let publishedGrades = 0;
    let unmappedGrades = 0;

    for (const [externalId, item] of gradeSnapshot) {
      throwIfAborted(signal);
      if (
        !Number.isFinite(item.passedAt.getTime()) ||
        !Number.isFinite(item.coefficient) ||
        item.coefficient < 0 ||
        (item.value !== null &&
          (!Number.isFinite(item.value) || item.value < 0)) ||
        (item.outOf !== null &&
          (!Number.isFinite(item.outOf) || item.outOf <= 0))
      ) {
        throw new NonRetryableSyncError(
          "The school provider returned an invalid grade",
        );
      }
      const subjectId = subjectIdOf(item.subject);
      const providerPeriodId = providerPeriodExternalId(item);
      const periodId = periodIdOf(item);
      const mapped =
        Boolean(subjectId) && (providerPeriodId === null || Boolean(periodId));
      const numeric =
        item.significant && item.value !== null && item.outOf !== null;
      if (!mapped) unmappedGrades += 1;

      const existingRecord = existingGradeRecordByExternalId.get(externalId);
      const dismissed = existingRecord?.syncState === "dismissed";
      let localGradeId = existingRecord?.localGradeId ?? null;
      const localGrade = localGradeId
        ? localGradeById.get(localGradeId)
        : undefined;

      if (publishGrades && mapped && numeric && !dismissed) {
        const providerValues = {
          name: boundedTitle(item.title, "School grade").slice(0, 96),
          value: item.value!,
          outOf: item.outOf!,
          coefficient: item.coefficient,
          isComposite: false,
          passedAt: item.passedAt,
          subjectId: subjectId!,
          periodId,
          yearId: scope.yearId,
          userId: scope.userId,
          syncExcludedFromAverage: false,
          updatedAt: now,
        };
        if (localGrade) {
          await transaction
            .update(grades)
            .set(providerValues)
            .where(
              and(
                eq(grades.id, localGrade.id),
                eq(grades.userId, scope.userId),
              ),
            );
        } else {
          localGradeId = newId("gra");
          await transaction.insert(grades).values({
            id: localGradeId,
            ...providerValues,
            bonus: 0,
            note: null,
            typeId: null,
            excludedFromAverage: false,
            syncExcludedFromAverage: false,
            createdAt: now,
          });
        }
        publishedGrades += 1;
      } else if (localGrade) {
        // Keep user overlays and attachments intact while ensuring a remote
        // result that is no longer numeric/mapped cannot affect calculations.
        await transaction
          .update(grades)
          .set({ syncExcludedFromAverage: true, updatedAt: now })
          .where(
            and(eq(grades.id, localGrade.id), eq(grades.userId, scope.userId)),
          );
      }

      await transaction
        .insert(syncGradeRecords)
        .values({
          connectionId: scope.connectionId,
          externalId,
          externalModifiedAt: item.modifiedAt,
          title: boundedTitle(item.title, "School grade").slice(0, 160),
          providerSubjectExternalId: providerSubjectExternalId(item.subject),
          providerSubjectName: item.subject.name.trim().slice(0, 300),
          providerPeriodExternalId: providerPeriodId,
          providerPeriodName: item.periodName?.trim().slice(0, 160) ?? null,
          passedAt: item.passedAt,
          value: item.value,
          outOf: item.outOf,
          coefficient: item.coefficient,
          significant: item.significant,
          syncState: dismissed ? "dismissed" : "managed",
          localGradeId,
          yearId: scope.yearId,
          userId: scope.userId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [syncGradeRecords.connectionId, syncGradeRecords.externalId],
          set: {
            externalModifiedAt: item.modifiedAt,
            title: boundedTitle(item.title, "School grade").slice(0, 160),
            providerSubjectExternalId: providerSubjectExternalId(item.subject),
            providerSubjectName: item.subject.name.trim().slice(0, 300),
            providerPeriodExternalId: providerPeriodId,
            providerPeriodName: item.periodName?.trim().slice(0, 160) ?? null,
            passedAt: item.passedAt,
            value: item.value,
            outOf: item.outOf,
            coefficient: item.coefficient,
            significant: item.significant,
            syncState: dismissed ? "dismissed" : "managed",
            localGradeId,
            yearId: scope.yearId,
            userId: scope.userId,
            updatedAt: now,
          },
        });
    }

    for (const [externalId, item] of homework) {
      throwIfAborted(signal);
      const values = {
        title: boundedTitle(item.title, "School assignment"),
        instructions: item.instructions?.slice(0, 10_000) ?? null,
        assignedAt: item.assignedAt,
        dueAt: item.dueAt,
        subjectId: subjectIdOf(item.subject),
        completedAt: item.completedUpstream ? now : null,
        yearId: scope.yearId,
        userId: scope.userId,
        sourceConnectionId: scope.connectionId,
        externalId,
        syncState: "managed" as const,
        updatedAt: now,
      };
      await transaction
        .insert(academicAssignments)
        .values({ ...values, createdAt: now })
        .onConflictDoUpdate({
          target: [
            academicAssignments.sourceConnectionId,
            academicAssignments.externalId,
          ],
          set: {
            title: values.title,
            instructions: values.instructions,
            assignedAt: values.assignedAt,
            dueAt: values.dueAt,
            subjectId: values.subjectId,
            syncState: sql`case when ${academicAssignments.syncState} = 'missing' then 'managed' else ${academicAssignments.syncState} end`,
            updatedAt: now,
          },
        });
    }

    for (const [externalId, item] of timetable) {
      throwIfAborted(signal);
      if (item.endsAt <= item.startsAt) {
        throw new NonRetryableSyncError(
          "The timetable provider returned an invalid lesson window",
        );
      }
      const values = {
        seriesId: null,
        occurrenceDate: isoDateInTimeZone(item.startsAt, item.timezone),
        title: boundedTitle(item.title, "School lesson"),
        notes: item.notes?.slice(0, 10_000) ?? null,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        timezone: item.timezone,
        status: item.cancelled
          ? ("cancelled" as const)
          : ("scheduled" as const),
        isException: false,
        location: item.location?.slice(0, 300) ?? null,
        subjectId: subjectIdOf(item.subject),
        yearId: scope.yearId,
        userId: scope.userId,
        sourceConnectionId: scope.connectionId,
        externalId,
        syncState: "managed" as const,
        updatedAt: now,
      };
      await transaction
        .insert(timetableOccurrences)
        .values({ ...values, createdAt: now })
        .onConflictDoUpdate({
          target: [
            timetableOccurrences.sourceConnectionId,
            timetableOccurrences.externalId,
          ],
          set: {
            occurrenceDate: values.occurrenceDate,
            title: values.title,
            notes: values.notes,
            startsAt: values.startsAt,
            endsAt: values.endsAt,
            timezone: values.timezone,
            status: values.status,
            location: values.location,
            subjectId: values.subjectId,
            syncState: sql`case when ${timetableOccurrences.syncState} = 'missing' then 'managed' else ${timetableOccurrences.syncState} end`,
            updatedAt: now,
          },
        });
    }

    for (const [externalId, item] of schoolCalendar) {
      throwIfAborted(signal);
      if (item.endsAt && item.endsAt < item.startsAt) {
        throw new NonRetryableSyncError(
          "The school calendar provider returned an invalid event window",
        );
      }
      const values = {
        eventKind: item.kind,
        title: boundedTitle(item.title, "School event"),
        description: item.description?.slice(0, 10_000) ?? null,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        allDay: item.allDay,
        timezone: item.timezone,
        location: item.location?.slice(0, 300) ?? null,
        subjectId: null,
        yearId: scope.yearId,
        userId: scope.userId,
        sourceConnectionId: scope.connectionId,
        externalId,
        syncState: "managed" as const,
        updatedAt: now,
      };
      await transaction
        .insert(calendarEvents)
        .values({ ...values, createdAt: now })
        .onConflictDoUpdate({
          target: [
            calendarEvents.sourceConnectionId,
            calendarEvents.externalId,
          ],
          set: {
            eventKind: values.eventKind,
            title: values.title,
            description: values.description,
            startsAt: values.startsAt,
            endsAt: values.endsAt,
            allDay: values.allDay,
            timezone: values.timezone,
            location: values.location,
            syncState: sql`case when ${calendarEvents.syncState} = 'missing' then 'managed' else ${calendarEvents.syncState} end`,
            updatedAt: now,
          },
        });
    }

    const homeworkIds = [...homework.keys()];
    const timetableIds = [...timetable.keys()];
    const calendarIds = [...schoolCalendar.keys()];
    const gradeIds = [...gradeSnapshot.keys()];
    throwIfAborted(signal);
    const missingGradeRecords = markMissing.has("grades")
      ? await transaction
          .update(syncGradeRecords)
          .set({ syncState: "missing", updatedAt: now })
          .where(
            and(
              eq(syncGradeRecords.userId, scope.userId),
              eq(syncGradeRecords.yearId, scope.yearId),
              eq(syncGradeRecords.connectionId, scope.connectionId),
              eq(syncGradeRecords.syncState, "managed"),
              gte(syncGradeRecords.passedAt, gradeWindow.from),
              lte(syncGradeRecords.passedAt, gradeWindow.to),
              gradeIds.length > 0
                ? notInArray(syncGradeRecords.externalId, gradeIds)
                : undefined,
            ),
          )
          .returning({
            id: syncGradeRecords.id,
            localGradeId: syncGradeRecords.localGradeId,
          })
      : [];
    const missingLocalGradeIds = missingGradeRecords.flatMap((record) =>
      record.localGradeId ? [record.localGradeId] : [],
    );
    if (missingLocalGradeIds.length > 0) {
      await transaction
        .update(grades)
        .set({ syncExcludedFromAverage: true, updatedAt: now })
        .where(
          and(
            eq(grades.userId, scope.userId),
            inArray(grades.id, missingLocalGradeIds),
          ),
        );
    }
    const missingUpdates = await Promise.all([
      markMissing.has("homework")
        ? transaction
            .update(academicAssignments)
            .set({ syncState: "missing", updatedAt: now })
            .where(
              and(
                eq(academicAssignments.userId, scope.userId),
                eq(academicAssignments.yearId, scope.yearId),
                eq(academicAssignments.sourceConnectionId, scope.connectionId),
                eq(academicAssignments.syncState, "managed"),
                gte(academicAssignments.dueAt, scope.window.from),
                lte(academicAssignments.dueAt, scope.window.to),
                absentFromSnapshot(academicAssignments.externalId, homeworkIds),
              ),
            )
            .returning({ id: academicAssignments.id })
        : [],
      markMissing.has("timetable")
        ? transaction
            .update(timetableOccurrences)
            .set({ syncState: "missing", updatedAt: now })
            .where(
              and(
                eq(timetableOccurrences.userId, scope.userId),
                eq(timetableOccurrences.yearId, scope.yearId),
                eq(timetableOccurrences.sourceConnectionId, scope.connectionId),
                eq(timetableOccurrences.syncState, "managed"),
                gte(timetableOccurrences.startsAt, scope.window.from),
                lte(timetableOccurrences.startsAt, scope.window.to),
                timetableIds.length > 0
                  ? notInArray(timetableOccurrences.externalId, timetableIds)
                  : undefined,
              ),
            )
            .returning({ id: timetableOccurrences.id })
        : [],
      markMissing.has("school-calendar")
        ? transaction
            .update(calendarEvents)
            .set({ syncState: "missing", updatedAt: now })
            .where(
              and(
                eq(calendarEvents.userId, scope.userId),
                eq(calendarEvents.yearId, scope.yearId),
                eq(calendarEvents.sourceConnectionId, scope.connectionId),
                eq(calendarEvents.syncState, "managed"),
                lte(calendarEvents.startsAt, scope.window.to),
                or(
                  gte(calendarEvents.endsAt, scope.window.from),
                  and(
                    isNull(calendarEvents.endsAt),
                    gte(calendarEvents.startsAt, scope.window.from),
                  ),
                ),
                calendarIds.length > 0
                  ? notInArray(calendarEvents.externalId, calendarIds)
                  : undefined,
              ),
            )
            .returning({ id: calendarEvents.id })
        : [],
      missingGradeRecords,
    ]);

    throwIfAborted(signal);
    const [publishedConnection] = await transaction
      .update(syncConnections)
      .set({
        status: scope.publicationFence.connectionStatus,
        lastSyncAt: scope.publicationFence.lastSyncAt,
        lastError: scope.publicationFence.lastError?.slice(0, 1_000) ?? null,
        updatedAt: scope.publicationFence.connectionUpdatedAt,
      })
      .where(
        and(
          eq(syncConnections.id, scope.connectionId),
          eq(syncConnections.userId, scope.userId),
          eq(syncConnections.yearId, scope.yearId),
          inArray(syncConnections.status, ["active", "error"]),
          isNotNull(syncConnections.sealedCredentials),
          eq(syncConnections.gradesAuthority, publishGrades),
          eq(
            syncConnections.updatedAt,
            scope.publicationFence.expectedConnectionUpdatedAt,
          ),
        ),
      )
      .returning({ id: syncConnections.id });
    if (!publishedConnection) {
      throw new SchoolPlanningPublicationConflictError();
    }
    throwIfAborted(signal);
    return {
      homework: homework.size,
      timetable: timetable.size,
      schoolCalendar: schoolCalendar.size,
      grades: publishedGrades,
      gradeCandidates: gradeSnapshot.size,
      gradeUnmapped: unmappedGrades,
      markedMissing: missingUpdates.reduce(
        (total, rows) => total + rows.length,
        0,
      ),
    };
  });
}

export async function synchronizeSchoolPlanning(
  adapter: SchoolProviderAdapter,
  connection: OpenConnection,
  options: ProviderListOptions,
  publicationFence: SchoolPlanningPublishScope["publicationFence"],
  now = new Date(),
  gradesOptions?: {
    window: SchoolSyncWindow;
    publish: boolean;
  },
) {
  assertSchoolSyncWindow(options.window);
  const gradeWindow = gradesOptions?.window ?? options.window;
  assertSchoolSyncWindow(gradeWindow);
  const {
    homework,
    timetable,
    schoolCalendar,
    grades: gradeSnapshot,
  } = await collectSchoolPlanningSnapshot(adapter, connection, options, {
    ...options,
    window: gradeWindow,
  });
  return publishSchoolPlanningSnapshot(
    {
      connectionId: connection.id,
      userId: connection.userId,
      yearId: connection.yearId,
      window: options.window,
      gradeWindow,
      publishGrades: gradesOptions?.publish ?? false,
      publicationFence,
      markMissingCapabilities: adapter.completeWindowFacets ?? [],
    },
    { homework, timetable, schoolCalendar, grades: gradeSnapshot },
    now,
    options.signal,
  );
}

/**
 * Discover every planning facet as one abortable unit. Promise.all rejects as
 * soon as one child fails while its siblings keep running; a job retry could
 * then overlap those stale requests (and their rotating credentials). We abort
 * siblings on the first failure and wait for every child to settle before
 * returning the failure to the runner.
 */
export async function collectSchoolPlanningSnapshot(
  adapter: SchoolProviderAdapter,
  connection: OpenConnection,
  options: ProviderListOptions,
  gradeOptions: ProviderListOptions = options,
): Promise<SchoolPlanningSnapshot> {
  assertSchoolSyncWindow(options.window);
  assertSchoolSyncWindow(gradeOptions.window);
  const controller = new AbortController();
  const onParentAbort = () =>
    controller.abort(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error("The school synchronization was aborted"),
    );
  if (options.signal?.aborted) onParentAbort();
  else options.signal?.addEventListener("abort", onParentAbort, { once: true });

  const childOptions = { ...options, signal: controller.signal };
  const tasks = [
    adapter.facets.homework?.list(connection, childOptions) ??
      Promise.resolve([] as ProviderHomework[]),
    adapter.facets.timetable?.list(connection, childOptions) ??
      Promise.resolve([] as ProviderTimetableLesson[]),
    adapter.facets["school-calendar"]?.list(connection, childOptions) ??
      Promise.resolve([] as ProviderSchoolCalendarEvent[]),
    adapter.facets.grades?.list(connection, {
      ...gradeOptions,
      signal: controller.signal,
    }) ?? Promise.resolve([] as ProviderGrade[]),
  ] as const;
  let hasFailure = false;
  let firstFailure: unknown;
  for (const task of tasks) {
    void task.catch((error) => {
      if (!hasFailure) {
        hasFailure = true;
        firstFailure = error;
      }
      if (!controller.signal.aborted) controller.abort(error);
    });
  }

  try {
    const settled = await Promise.allSettled(tasks);
    throwIfAborted(options.signal);
    if (hasFailure) throw firstFailure;
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
    return {
      homework: (settled[0] as PromiseFulfilledResult<ProviderHomework[]>)
        .value,
      timetable: (
        settled[1] as PromiseFulfilledResult<ProviderTimetableLesson[]>
      ).value,
      schoolCalendar: (
        settled[2] as PromiseFulfilledResult<ProviderSchoolCalendarEvent[]>
      ).value,
      grades: (settled[3] as PromiseFulfilledResult<ProviderGrade[]>).value,
    };
  } finally {
    options.signal?.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) {
      controller.abort(new Error("The school synchronization discovery ended"));
    }
  }
}

export function defaultSchoolSyncWindow(
  now = new Date(),
  timezone = "Europe/Paris",
) {
  return {
    from: new Date(now.getTime() - 30 * 86_400_000),
    to: new Date(now.getTime() + 120 * 86_400_000),
    timezone,
  } satisfies SchoolSyncWindow;
}
