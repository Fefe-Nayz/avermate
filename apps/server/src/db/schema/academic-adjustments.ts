import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { periods, subjects, years } from "./app";
import { users } from "./auth";

const owner = () =>
  text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" });

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
};

/**
 * Points added to the general average for one academic period.
 *
 * A bonus is not a property of a whole school year: the same student can have
 * a different adjustment in each term. Keeping it relational also makes an
 * absent row unambiguously mean zero instead of inheriting a stale year value.
 */
export const periodGeneralAdjustments = sqliteTable(
  "period_general_adjustments",
  {
    periodId: text()
      .notNull()
      .primaryKey()
      .references(() => periods.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    points: real().notNull(),
    yearId: text()
      .notNull()
      .references(() => years.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    index("period_general_adjustments_year_idx").on(table.yearId),
    index("period_general_adjustments_user_idx").on(table.userId),
  ],
);

/** Points added to one subject's average for one academic period. */
export const subjectPeriodAdjustments = sqliteTable(
  "subject_period_adjustments",
  {
    periodId: text()
      .notNull()
      .references(() => periods.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    subjectId: text()
      .notNull()
      .references(() => subjects.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    points: real().notNull(),
    yearId: text()
      .notNull()
      .references(() => years.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.periodId, table.subjectId] }),
    index("subject_period_adjustments_year_idx").on(table.yearId),
    index("subject_period_adjustments_subject_idx").on(table.subjectId),
    index("subject_period_adjustments_user_idx").on(table.userId),
  ],
);
