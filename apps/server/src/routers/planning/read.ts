import {
  expandTimetableRecurrence,
  isoDateInTimeZone,
  planningManagement,
  zonedDateTimeToDate,
  zonedDayRange,
} from "@avermate/core/planning";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  academicAssignments,
  calendarEvents,
  lectureRecordings,
  plannerItems,
  planningTasks,
  timetableOccurrences,
  timetableSeries,
} from "../../db/schema";
import { badRequest, protectedProcedure } from "../../lib/orpc";
import {
  dateOnlySchema,
  idSchema,
  loadPlanningConnectionInfo,
  managementOf,
  requireCalendarEvent,
  requireTimetableOccurrence,
  timezoneSchema,
  validatePlanningScope,
} from "./shared";

const activeStates = ["managed", "detached"] as const;

function assertCalendarWindow(from: Date, to: Date) {
  const duration = to.getTime() - from.getTime();
  if (duration < 0) badRequest("The planning window is inverted");
  if (duration > 366 * 86_400_000) {
    badRequest("The planning window cannot exceed 366 days");
  }
}

const windowInput = z
  .object({
    yearId: idSchema,
    from: z.coerce.date(),
    to: z.coerce.date(),
    timezone: timezoneSchema.default("UTC"),
  })
  .refine((input) => input.from <= input.to, {
    message: "The planning window is inverted",
  });

type PlanningWindowInput = z.infer<typeof windowInput> & { userId: string };

interface PlanningLessonItem {
  id: string;
  kind: "lesson";
  title: string;
  notes: string | null;
  localNote: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: false;
  timezone: string;
  location: string | null;
  subjectId: string | null;
  status: "scheduled" | "cancelled";
  seriesId: string | null;
  occurrenceDate: string;
  virtual: boolean;
  management: ReturnType<typeof managementOf>;
  recordings: Array<{ id: string; title: string }>;
}

function localManagement(kind: "task" | "assignment" | "event" | "lesson") {
  return planningManagement(kind, {
    sourceConnectionId: null,
    externalId: null,
    syncState: "detached",
  });
}

export async function readPlanningWindow(input: PlanningWindowInput) {
  assertCalendarWindow(input.from, input.to);
  await validatePlanningScope({
    userId: input.userId,
    yearId: input.yearId,
    subjectId: null,
  });
  const [
    taskRows,
    assignmentRows,
    eventRows,
    seriesRows,
    occurrenceRows,
    legacyRows,
    connections,
  ] = await Promise.all([
    db
      .select()
      .from(planningTasks)
      .where(
        and(
          eq(planningTasks.userId, input.userId),
          eq(planningTasks.yearId, input.yearId),
          isNull(planningTasks.trashedAt),
          inArray(planningTasks.syncState, activeStates),
          or(
            and(
              isNotNull(planningTasks.scheduledAt),
              gte(planningTasks.scheduledAt, input.from),
              lte(planningTasks.scheduledAt, input.to),
            ),
            and(
              isNull(planningTasks.scheduledAt),
              isNotNull(planningTasks.dueAt),
              gte(planningTasks.dueAt, input.from),
              lte(planningTasks.dueAt, input.to),
            ),
          ),
        ),
      ),
    db
      .select()
      .from(academicAssignments)
      .where(
        and(
          eq(academicAssignments.userId, input.userId),
          eq(academicAssignments.yearId, input.yearId),
          inArray(academicAssignments.syncState, activeStates),
          or(
            and(
              isNotNull(academicAssignments.dueAt),
              gte(academicAssignments.dueAt, input.from),
              lte(academicAssignments.dueAt, input.to),
            ),
            and(
              isNull(academicAssignments.dueAt),
              isNotNull(academicAssignments.assignedAt),
              gte(academicAssignments.assignedAt, input.from),
              lte(academicAssignments.assignedAt, input.to),
            ),
          ),
        ),
      ),
    db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, input.userId),
          eq(calendarEvents.yearId, input.yearId),
          inArray(calendarEvents.syncState, activeStates),
          lte(calendarEvents.startsAt, input.to),
          or(
            gte(calendarEvents.endsAt, input.from),
            and(
              isNull(calendarEvents.endsAt),
              gte(calendarEvents.startsAt, input.from),
            ),
          ),
        ),
      ),
    db
      .select()
      .from(timetableSeries)
      .where(
        and(
          eq(timetableSeries.userId, input.userId),
          eq(timetableSeries.yearId, input.yearId),
          inArray(timetableSeries.syncState, activeStates),
        ),
      ),
    db
      .select()
      .from(timetableOccurrences)
      .where(
        and(
          eq(timetableOccurrences.userId, input.userId),
          eq(timetableOccurrences.yearId, input.yearId),
        ),
      ),
    db
      .select()
      .from(plannerItems)
      .where(
        and(
          eq(plannerItems.userId, input.userId),
          eq(plannerItems.yearId, input.yearId),
          isNotNull(plannerItems.startsAt),
          lte(plannerItems.startsAt, input.to),
          or(
            gte(plannerItems.endsAt, input.from),
            and(
              isNull(plannerItems.endsAt),
              gte(plannerItems.startsAt, input.from),
            ),
          ),
        ),
      ),
    loadPlanningConnectionInfo(input.userId),
  ]);

  const occurrenceBySeriesDate = new Map(
    occurrenceRows
      .filter((row) => row.seriesId)
      .map((row) => [`${row.seriesId}:${row.occurrenceDate}`, row] as const),
  );
  const handledOccurrences = new Set<string>();
  const lessonItems: PlanningLessonItem[] = [];

  for (const series of seriesRows) {
    const fromDate = isoDateInTimeZone(input.from, series.timezone);
    const toDate = isoDateInTimeZone(input.to, series.timezone);
    const dates = expandTimetableRecurrence(
      {
        frequency: series.recurrenceFrequency,
        interval: series.recurrenceInterval,
        weekdays: series.recurrenceWeekdays,
        startsOn: series.startsOn,
        endsOn: series.endsOn,
      },
      fromDate,
      toDate,
    );
    for (const date of dates) {
      const exception = occurrenceBySeriesDate.get(`${series.id}:${date}`);
      if (exception) {
        handledOccurrences.add(exception.id);
        if (
          exception.syncState === "dismissed" ||
          exception.syncState === "missing"
        ) {
          continue;
        }
        if (exception.startsAt > input.to || exception.endsAt < input.from) {
          continue;
        }
        lessonItems.push({
          id: exception.id,
          kind: "lesson",
          title: exception.title,
          notes: exception.notes,
          localNote: exception.localNote,
          startsAt: exception.startsAt,
          endsAt: exception.endsAt,
          allDay: false,
          timezone: exception.timezone,
          location: exception.location,
          subjectId: exception.subjectId,
          status: exception.status,
          seriesId: exception.seriesId,
          occurrenceDate: exception.occurrenceDate,
          virtual: false,
          management: managementOf("lesson", exception, connections),
          recordings: [],
        });
        continue;
      }
      const startsAt = zonedDateTimeToDate(
        date,
        series.startMinutes,
        series.timezone,
      );
      const endsAt = new Date(
        startsAt.getTime() + series.durationMinutes * 60_000,
      );
      if (startsAt > input.to || endsAt < input.from) continue;
      lessonItems.push({
        id: `virtual:${series.id}:${date}`,
        kind: "lesson",
        title: series.title,
        notes: series.notes,
        localNote: series.localNote,
        startsAt,
        endsAt,
        allDay: false,
        timezone: series.timezone,
        location: series.location,
        subjectId: series.subjectId,
        status: "scheduled",
        seriesId: series.id,
        occurrenceDate: date,
        virtual: true,
        management: managementOf("lesson", series, connections),
        recordings: [],
      });
    }
  }

  for (const occurrence of occurrenceRows) {
    if (handledOccurrences.has(occurrence.id)) continue;
    if (
      !activeStates.includes(
        occurrence.syncState as (typeof activeStates)[number],
      )
    ) {
      continue;
    }
    if (occurrence.startsAt > input.to || occurrence.endsAt < input.from) {
      continue;
    }
    lessonItems.push({
      id: occurrence.id,
      kind: "lesson",
      title: occurrence.title,
      notes: occurrence.notes,
      localNote: occurrence.localNote,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      allDay: false,
      timezone: occurrence.timezone,
      location: occurrence.location,
      subjectId: occurrence.subjectId,
      status: occurrence.status,
      seriesId: occurrence.seriesId,
      occurrenceDate: occurrence.occurrenceDate,
      virtual: false,
      management: managementOf("lesson", occurrence, connections),
      recordings: [],
    });
  }

  const concreteOccurrenceIds = lessonItems
    .filter((lesson) => !lesson.virtual)
    .map((lesson) => lesson.id);
  const recordingRows = await db
    .select({
      id: lectureRecordings.id,
      title: lectureRecordings.title,
      status: lectureRecordings.status,
      recordedAt: lectureRecordings.recordedAt,
      durationMs: lectureRecordings.durationMs,
      subjectId: lectureRecordings.subjectId,
      yearId: lectureRecordings.yearId,
      calendarEventId: lectureRecordings.calendarEventId,
      timetableOccurrenceId: lectureRecordings.timetableOccurrenceId,
    })
    .from(lectureRecordings)
    .where(
      and(
        eq(lectureRecordings.userId, input.userId),
        eq(lectureRecordings.yearId, input.yearId),
        or(
          and(
            gte(lectureRecordings.recordedAt, input.from),
            lte(lectureRecordings.recordedAt, input.to),
          ),
          eventRows.length > 0
            ? inArray(
                lectureRecordings.calendarEventId,
                eventRows.map((event) => event.id),
              )
            : undefined,
          concreteOccurrenceIds.length > 0
            ? inArray(
                lectureRecordings.timetableOccurrenceId,
                concreteOccurrenceIds,
              )
            : undefined,
        ),
      ),
    );

  for (const lesson of lessonItems) {
    lesson.recordings = recordingRows
      .filter((recording) => recording.timetableOccurrenceId === lesson.id)
      .map(({ id, title }) => ({ id, title }));
  }

  const newIds = new Set([
    ...taskRows.map((row) => row.id),
    ...eventRows.map((row) => row.id),
  ]);
  const items = [
    ...taskRows.map((row) => {
      const startsAt = row.scheduledAt ?? row.dueAt!;
      return {
        id: row.id,
        kind: "task" as const,
        title: row.title,
        notes: row.notes,
        localNote: row.localNote,
        startsAt,
        endsAt: null,
        dueAt: row.dueAt,
        allDay: row.scheduledAt === null,
        subjectId: row.subjectId,
        status: row.status,
        completed: row.completedAt !== null,
        management: managementOf("task", row, connections),
      };
    }),
    ...assignmentRows.map((row) => ({
      id: row.id,
      kind: "assignment" as const,
      title: row.title,
      instructions: row.instructions,
      localNote: row.localNote,
      startsAt: row.dueAt ?? row.assignedAt!,
      endsAt: null,
      assignedAt: row.assignedAt,
      dueAt: row.dueAt,
      allDay: true,
      subjectId: row.subjectId,
      completed: row.completedAt !== null,
      management: managementOf("assignment", row, connections),
    })),
    ...eventRows.map((row) => ({
      id: row.id,
      kind: "event" as const,
      eventKind: row.eventKind,
      title: row.title,
      description: row.description,
      localNote: row.localNote,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay,
      timezone: row.timezone,
      location: row.location,
      subjectId: row.subjectId,
      recordings: recordingRows
        .filter((recording) => recording.calendarEventId === row.id)
        .map(({ id, title }) => ({ id, title })),
      management: managementOf("event", row, connections),
    })),
    ...lessonItems,
    ...recordingRows
      .filter(
        (row) => row.recordedAt >= input.from && row.recordedAt <= input.to,
      )
      .map((row) => ({
        id: row.id,
        kind: "recording" as const,
        title: row.title,
        startsAt: row.recordedAt,
        endsAt: new Date(row.recordedAt.getTime() + row.durationMs),
        allDay: false,
        subjectId: row.subjectId,
        status: row.status,
        durationMs: row.durationMs,
        management: {
          ...localManagement("lesson"),
          editableFields: [],
        },
      })),
    ...legacyRows
      .filter((row) => !newIds.has(row.id))
      .map((row) => ({
        id: row.id,
        kind: "legacy" as const,
        legacyKind: row.kind,
        title: row.title,
        notes: row.notes,
        startsAt: row.startsAt!,
        endsAt: row.endsAt,
        allDay: row.allDay,
        subjectId: row.subjectId,
        status: row.status,
        completed: row.completedAt !== null,
        management: localManagement(row.kind),
      })),
  ].sort(
    (left, right) =>
      left.startsAt.getTime() - right.startsAt.getTime() ||
      String(left.title).localeCompare(String(right.title)),
  );

  return {
    yearId: input.yearId,
    from: input.from,
    to: input.to,
    timezone: input.timezone,
    items,
  };
}

export const planningReadRouter = {
  locate: protectedProcedure
    .input(
      z.discriminatedUnion("kind", [
        z
          .object({ kind: z.literal("calendarEvent"), eventId: idSchema })
          .strict(),
        z
          .object({
            kind: z.literal("timetableOccurrence"),
            occurrenceId: idSchema,
          })
          .strict(),
      ]),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (input.kind === "calendarEvent") {
        const event = await requireCalendarEvent(userId, input.eventId);
        const available = activeStates.includes(
          event.syncState as (typeof activeStates)[number],
        );
        return {
          kind: input.kind,
          id: event.id,
          yearId: event.yearId,
          startsAt: event.startsAt,
          timezone: event.timezone,
          date: isoDateInTimeZone(event.startsAt, event.timezone),
          available,
        };
      }
      const occurrence = await requireTimetableOccurrence(
        userId,
        input.occurrenceId,
      );
      const available =
        occurrence.status === "scheduled" &&
        activeStates.includes(
          occurrence.syncState as (typeof activeStates)[number],
        );
      return {
        kind: input.kind,
        id: occurrence.id,
        yearId: occurrence.yearId,
        startsAt: occurrence.startsAt,
        timezone: occurrence.timezone,
        date: isoDateInTimeZone(occurrence.startsAt, occurrence.timezone),
        available,
      };
    }),

  calendar: protectedProcedure
    .input(windowInput)
    .handler(({ context, input }) =>
      readPlanningWindow({ ...input, userId: context.session.user.id }),
    ),

  day: protectedProcedure
    .input(
      z.object({
        yearId: idSchema,
        date: dateOnlySchema,
        timezone: timezoneSchema.default("UTC"),
      }),
    )
    .handler(async ({ context, input }) => {
      const range = zonedDayRange(input.date, input.timezone);
      const result = await readPlanningWindow({
        ...range,
        yearId: input.yearId,
        timezone: input.timezone,
        userId: context.session.user.id,
      });
      return {
        ...result,
        date: input.date,
        tasks: result.items.filter((item) => item.kind === "task"),
        assignments: result.items.filter((item) => item.kind === "assignment"),
        events: result.items.filter((item) => item.kind === "event"),
        lessons: result.items.filter((item) => item.kind === "lesson"),
        recordings: result.items.filter((item) => item.kind === "recording"),
        legacy: result.items.filter((item) => item.kind === "legacy"),
      };
    }),
};
