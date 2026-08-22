import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { subjects, years } from "./app";
import { users } from "./auth";

export type PlannerItemKind = "task" | "event";
export type PlannerTaskStatus = "todo" | "doing" | "done";

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

/**
 * User-authored agenda items and kanban tasks.
 *
 * Recurrence and reminders are deliberately absent. Recurrence will be a
 * relational `plannerRecurrences` model rather than opaque JSON on this row.
 */
export const plannerItems = sqliteTable(
  "planner_items",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("plan")),
    kind: text().$type<PlannerItemKind>().notNull().default("task"),
    title: text().notNull(),
    notes: text(),
    /** Task due date or event start; null is an unscheduled backlog task. */
    startsAt: integer({ mode: "timestamp" }),
    /** Event end; null for tasks and all-day point events. */
    endsAt: integer({ mode: "timestamp" }),
    allDay: integer({ mode: "boolean" }).notNull().default(true),
    /** Tasks only. Events remain in `todo` and never expose a board lane. */
    status: text().$type<PlannerTaskStatus>().notNull().default("todo"),
    completedAt: integer({ mode: "timestamp" }),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    sortOrder: integer().notNull().default(0),
    yearId: text()
      .notNull()
      .references(() => years.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("planner_items_year_starts_idx").on(t.yearId, t.startsAt),
    index("planner_items_user_id_idx").on(t.userId),
  ],
);
