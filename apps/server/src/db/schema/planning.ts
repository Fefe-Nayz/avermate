import type {
  IsoWeekday,
  PlanningSyncState,
  TimetableRecurrenceFrequency,
} from "@avermate/core/planning";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { subjects, years } from "./app";
import { users } from "./auth";
import { syncConnections } from "./sync";

export type PlanningTaskStatus = "todo" | "doing" | "done";
export type CalendarEventKind = "event" | "block" | "holiday" | "workday";
export type TimetableOccurrenceStatus = "scheduled" | "cancelled";

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
};

const owner = () =>
  text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" });

const year = () =>
  text()
    .notNull()
    .references(() => years.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    });

const subject = () =>
  text().references(() => subjects.id, {
    onDelete: "set null",
    onUpdate: "cascade",
  });

/**
 * Provider identity is stored beside the canonical row so sync can upsert it
 * without exposing sealed connection credentials to planning readers.
 * User-authored and detached rows use `detached` with both ids null.
 */
const managed = () => ({
  sourceConnectionId: text().references(() => syncConnections.id, {
    onDelete: "cascade",
    onUpdate: "cascade",
  }),
  externalId: text(),
  syncState: text().$type<PlanningSyncState>().notNull().default("detached"),
});

const syncStateCheck = (column: { syncState: unknown }) =>
  sql`${column.syncState} in ('managed', 'detached', 'missing', 'dismissed')`;

/** Personal tasks own their board state and never double as school events. */
export const planningTasks = sqliteTable(
  "planning_tasks",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ptask")),
    title: text().notNull(),
    notes: text(),
    /** Always local, including on a provider-managed task. */
    localNote: text(),
    /** Optional beginning of multi-day work; a null value is only a deadline. */
    startsAt: integer({ mode: "timestamp" }),
    scheduledAt: integer({ mode: "timestamp" }),
    dueAt: integer({ mode: "timestamp" }),
    status: text().$type<PlanningTaskStatus>().notNull().default("todo"),
    completedAt: integer({ mode: "timestamp" }),
    subjectId: subject(),
    sortOrder: integer().notNull().default(0),
    yearId: year(),
    userId: owner(),
    ...managed(),
    ...timestamps,
  },
  (table) => [
    index("planning_tasks_year_schedule_idx").on(
      table.yearId,
      table.scheduledAt,
      table.dueAt,
    ),
    index("planning_tasks_user_status_idx").on(table.userId, table.status),
    uniqueIndex("planning_tasks_source_external_unique").on(
      table.sourceConnectionId,
      table.externalId,
    ),
    check(
      "planning_tasks_status_check",
      sql`${table.status} in ('todo', 'doing', 'done')`,
    ),
    check("planning_tasks_sync_state_check", syncStateCheck(table)),
  ],
);

/** Provider homework/carnet-de-texte content plus user-owned completion state. */
export const academicAssignments = sqliteTable(
  "academic_assignments",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("assign")),
    title: text().notNull(),
    instructions: text(),
    assignedAt: integer({ mode: "timestamp" }),
    /** Local Gantt overlay, never overwritten by a provider refresh. */
    startsAt: integer({ mode: "timestamp" }),
    dueAt: integer({ mode: "timestamp" }),
    /** Local overlay never overwritten by a provider refresh. */
    localNote: text(),
    /** Local overlay never overwritten by a provider refresh. */
    completedAt: integer({ mode: "timestamp" }),
    subjectId: subject(),
    yearId: year(),
    userId: owner(),
    ...managed(),
    ...timestamps,
  },
  (table) => [
    index("academic_assignments_year_due_idx").on(table.yearId, table.dueAt),
    index("academic_assignments_user_idx").on(table.userId),
    uniqueIndex("academic_assignments_source_external_unique").on(
      table.sourceConnectionId,
      table.externalId,
    ),
    check("academic_assignments_sync_state_check", syncStateCheck(table)),
  ],
);

/** User or provider calendar entries, including holidays and work-day blocks. */
export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("calev")),
    eventKind: text().$type<CalendarEventKind>().notNull().default("event"),
    title: text().notNull(),
    description: text(),
    localNote: text(),
    startsAt: integer({ mode: "timestamp" }).notNull(),
    endsAt: integer({ mode: "timestamp" }),
    allDay: integer({ mode: "boolean" }).notNull().default(false),
    timezone: text().notNull().default("UTC"),
    location: text(),
    subjectId: subject(),
    yearId: year(),
    userId: owner(),
    ...managed(),
    ...timestamps,
  },
  (table) => [
    index("calendar_events_year_window_idx").on(
      table.yearId,
      table.startsAt,
      table.endsAt,
    ),
    index("calendar_events_user_idx").on(table.userId),
    uniqueIndex("calendar_events_source_external_unique").on(
      table.sourceConnectionId,
      table.externalId,
    ),
    check(
      "calendar_events_kind_check",
      sql`${table.eventKind} in ('event', 'block', 'holiday', 'workday')`,
    ),
    check(
      "calendar_events_window_check",
      sql`${table.endsAt} is null or ${table.endsAt} >= ${table.startsAt}`,
    ),
    check("calendar_events_sync_state_check", syncStateCheck(table)),
  ],
);

/** A recurring timetable definition expressed in its own IANA timezone. */
export const timetableSeries = sqliteTable(
  "timetable_series",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ttseries")),
    title: text().notNull(),
    notes: text(),
    localNote: text(),
    startsOn: text().notNull(),
    endsOn: text(),
    startMinutes: integer().notNull(),
    durationMinutes: integer().notNull(),
    timezone: text().notNull().default("UTC"),
    recurrenceFrequency: text()
      .$type<TimetableRecurrenceFrequency>()
      .notNull()
      .default("weekly"),
    recurrenceInterval: integer().notNull().default(1),
    recurrenceWeekdays: text({ mode: "json" }).$type<IsoWeekday[]>().notNull(),
    location: text(),
    subjectId: subject(),
    yearId: year(),
    userId: owner(),
    ...managed(),
    ...timestamps,
  },
  (table) => [
    index("timetable_series_year_dates_idx").on(
      table.yearId,
      table.startsOn,
      table.endsOn,
    ),
    index("timetable_series_user_idx").on(table.userId),
    uniqueIndex("timetable_series_source_external_unique").on(
      table.sourceConnectionId,
      table.externalId,
    ),
    check(
      "timetable_series_frequency_check",
      sql`${table.recurrenceFrequency} in ('daily', 'weekly')`,
    ),
    check(
      "timetable_series_interval_check",
      sql`${table.recurrenceInterval} >= 1 and ${table.recurrenceInterval} <= 52`,
    ),
    check(
      "timetable_series_minutes_check",
      sql`${table.startMinutes} >= 0 and ${table.startMinutes} < 1440 and ${table.durationMinutes} > 0 and ${table.durationMinutes} <= 1440`,
    ),
    check(
      "timetable_series_dates_check",
      sql`${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn}`,
    ),
    check("timetable_series_sync_state_check", syncStateCheck(table)),
  ],
);

/**
 * A materialized lesson, standalone lesson, exception, cancellation, or
 * dismissal tombstone. Series occurrences without an exception stay virtual.
 */
export const timetableOccurrences = sqliteTable(
  "timetable_occurrences",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ttocc")),
    seriesId: text().references(() => timetableSeries.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    occurrenceDate: text().notNull(),
    title: text().notNull(),
    notes: text(),
    localNote: text(),
    startsAt: integer({ mode: "timestamp" }).notNull(),
    endsAt: integer({ mode: "timestamp" }).notNull(),
    timezone: text().notNull().default("UTC"),
    status: text()
      .$type<TimetableOccurrenceStatus>()
      .notNull()
      .default("scheduled"),
    isException: integer({ mode: "boolean" }).notNull().default(false),
    location: text(),
    subjectId: subject(),
    yearId: year(),
    userId: owner(),
    ...managed(),
    ...timestamps,
  },
  (table) => [
    index("timetable_occurrences_year_window_idx").on(
      table.yearId,
      table.startsAt,
      table.endsAt,
    ),
    index("timetable_occurrences_user_idx").on(table.userId),
    uniqueIndex("timetable_occurrences_series_date_unique").on(
      table.seriesId,
      table.occurrenceDate,
    ),
    uniqueIndex("timetable_occurrences_source_external_unique").on(
      table.sourceConnectionId,
      table.externalId,
    ),
    check(
      "timetable_occurrences_status_check",
      sql`${table.status} in ('scheduled', 'cancelled')`,
    ),
    check(
      "timetable_occurrences_window_check",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check("timetable_occurrences_sync_state_check", syncStateCheck(table)),
  ],
);
