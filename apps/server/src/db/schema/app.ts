import { relations } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";

/**
 * Application schema.
 *
 * Numbers are stored as real values on their own scale — a grade keeps the
 * `value / outOf` it was given, a coefficient is the number the user typed.
 * Normalising happens in the engine, never in the database, so a 14/20 and an
 * 87/100 stay recognisable in a row dump.
 */

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

// ----------------------------------------------------------------- preferences

export const preferences = sqliteTable("preferences", {
  userId: text()
    .notNull()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),

  /** "system" | "light" | "dark" */
  theme: text().notNull().default("system"),
  /** "system" | "en" | "fr" */
  language: text().notNull().default("system"),
  /** Named accent preset, or "custom" when `customTheme` drives the palette. */
  themePreset: text().notNull().default("default"),
  /** JSON: per-token colour overrides for the custom theme editor. */
  customTheme: text().notNull().default("{}"),
  /** JSON: `{ font, headingFont, radius }`. */
  themeShape: text().notNull().default("{}"),

  seasonalThemesEnabled: integer({ mode: "boolean" }).notNull().default(true),
  /** Manual override; "auto" follows the calendar. */
  seasonalTheme: text().notNull().default("auto"),

  hapticsEnabled: integer({ mode: "boolean" }).notNull().default(true),
  reduceMotion: integer({ mode: "boolean" }).notNull().default(false),
  /** Prefer full-page forms over sheets even on a wide screen. */
  compactMode: integer({ mode: "boolean" }).notNull().default(false),

  /** JSON: `{ autoZoom, showTrend, trendSubdivisions, showPoints }`. */
  chartSettings: text().notNull().default("{}"),

  /** Unlockable easter-egg themes the account has earned. */
  unlockedThemes: text().notNull().default("[]"),
  /** JSON: celebration keys already shown, so they fire once. */
  seenCelebrations: text().notNull().default("[]"),

  ...timestamps,
});

// ----------------------------------------------------------------------- years

export const years = sqliteTable(
  "years",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("y")),
    name: text().notNull(),
    startsAt: integer({ mode: "timestamp" }).notNull(),
    endsAt: integer({ mode: "timestamp" }).notNull(),

    /** Display scale: 20 in France, 100 elsewhere, 4 for a GPA. */
    scale: real().notNull().default(20),
    /** Pre-filled maximum when adding a grade. */
    defaultOutOf: real().notNull().default(20),
    /** Ratio at or above which a result counts as a pass. */
    passingRatio: real().notNull().default(0.5),
    /** Decimal places used when displaying averages. */
    decimals: integer().notNull().default(2),

    /** Preset this year was created from, kept for later updates. */
    presetId: text(),
    sortOrder: integer().notNull().default(0),
    archivedAt: integer({ mode: "timestamp" }),

    userId: owner(),
    ...timestamps,
  },
  (t) => [index("years_user_id_idx").on(t.userId)],
);

// --------------------------------------------------------------------- periods

export const periods = sqliteTable(
  "periods",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("per")),
    name: text().notNull(),
    startAt: integer({ mode: "timestamp" }).notNull(),
    endAt: integer({ mode: "timestamp" }).notNull(),
    /** Absorbs everything since the start of the year. */
    isCumulative: integer({ mode: "boolean" }).notNull().default(false),
    sortOrder: integer().notNull().default(0),

    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("periods_year_id_idx").on(t.yearId),
    index("periods_user_id_idx").on(t.userId),
  ],
);

// -------------------------------------------------------------------- subjects

export const subjects = sqliteTable(
  "subjects",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sub")),
    name: text().notNull(),
    shortName: text(),

    /**
     * No foreign key to itself: SQLite would need the parent to exist before
     * the child on every insert, which makes importing a preset tree a
     * dependency-ordering exercise. The engine re-roots anything orphaned.
     */
    parentId: text(),

    coefficient: real().notNull().default(1),
    /** "subject" counts once; "category" lets its children weigh in above it. */
    kind: text().notNull().default("subject"),
    isMain: integer({ mode: "boolean" }).notNull().default(false),
    sortOrder: integer().notNull().default(0),

    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("subjects_year_id_idx").on(t.yearId),
    index("subjects_user_id_idx").on(t.userId),
    index("subjects_parent_id_idx").on(t.parentId),
  ],
);

// ---------------------------------------------------------------------- grades

export const grades = sqliteTable(
  "grades",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("gra")),
    name: text().notNull(),

    value: real().notNull(),
    outOf: real().notNull(),
    coefficient: real().notNull().default(1),

    /** Set when the headline number is derived from `gradeComponents`. */
    isComposite: integer({ mode: "boolean" }).notNull().default(false),
    /** Free-form note the user attached to the result. */
    note: text(),

    passedAt: integer({ mode: "timestamp" }).notNull(),

    subjectId: text()
      .notNull()
      .references(() => subjects.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    periodId: text().references(() => periods.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("grades_subject_id_idx").on(t.subjectId),
    index("grades_year_id_idx").on(t.yearId),
    index("grades_user_id_idx").on(t.userId),
    index("grades_passed_at_idx").on(t.passedAt),
  ],
);

export const gradeComponents = sqliteTable(
  "grade_components",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("gc")),
    gradeId: text()
      .notNull()
      .references(() => grades.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text().notNull(),
    value: real().notNull(),
    outOf: real().notNull(),
    coefficient: real().notNull().default(1),
    sortOrder: integer().notNull().default(0),
    userId: owner(),
    ...timestamps,
  },
  (t) => [index("grade_components_grade_id_idx").on(t.gradeId)],
);

// ------------------------------------------------------------- custom averages

export const customAverages = sqliteTable(
  "custom_averages",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("avg")),
    name: text().notNull(),
    /** Shown in place of the general average on the dashboard. */
    isMain: integer({ mode: "boolean" }).notNull().default(false),
    sortOrder: integer().notNull().default(0),

    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [index("custom_averages_year_id_idx").on(t.yearId)],
);

/**
 * One row per subject taking part. Stored relationally rather than as a JSON
 * blob so deleting a subject cleans up after itself.
 */
export const customAverageEntries = sqliteTable(
  "custom_average_entries",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("avge")),
    averageId: text()
      .notNull()
      .references(() => customAverages.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    subjectId: text()
      .notNull()
      .references(() => subjects.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** `null` keeps the subject's own coefficient. */
    coefficient: real(),
    includeChildren: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("custom_average_entries_unique").on(t.averageId, t.subjectId),
    index("custom_average_entries_average_idx").on(t.averageId),
  ],
);

// ----------------------------------------------------------------------- goals

export const goals = sqliteTable(
  "goals",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("goal")),
    name: text().notNull(),

    /** "general" | "subject" | "custom" */
    kind: text().notNull().default("general"),
    /** Subject or custom-average id, depending on `kind`. */
    referenceId: text(),

    /** Target as a ratio in 0..1, so it survives a change of scale. */
    targetRatio: real().notNull(),
    /** Restricts the goal to one period; `null` covers the whole year. */
    periodId: text().references(() => periods.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    dueAt: integer({ mode: "timestamp" }),
    achievedAt: integer({ mode: "timestamp" }),
    /** Highlighted on the dashboard. */
    isPinned: integer({ mode: "boolean" }).notNull().default(false),
    sortOrder: integer().notNull().default(0),

    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("goals_year_id_idx").on(t.yearId),
    index("goals_user_id_idx").on(t.userId),
  ],
);

// ------------------------------------------------------------- dashboard cards

export const dashboardCards = sqliteTable(
  "dashboard_cards",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("card")),
    /** Which screen the card belongs to: "overview" | "subject" | "grade". */
    surface: text().notNull().default("overview"),

    metric: text().notNull(),
    /** "general" | "subject" | "custom" */
    targetKind: text().notNull().default("general"),
    targetId: text(),
    goalId: text().references(() => goals.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),

    display: text().notNull().default("value"),
    span: integer().notNull().default(1),
    /** `null` uses the metric's own localised name. */
    title: text(),
    accent: text(),
    sortOrder: integer().notNull().default(0),
    hidden: integer({ mode: "boolean" }).notNull().default(false),

    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("dashboard_cards_year_id_idx").on(t.yearId),
    index("dashboard_cards_user_id_idx").on(t.userId),
  ],
);

// --------------------------------------------------------------- year in review

export const yearReviewViews = sqliteTable(
  "year_review_views",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("yrv")),
    userId: owner(),
    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    /** Distinguishes the mid-year recap from the end-of-year one. */
    reviewKey: text().notNull(),
    seenAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("year_review_views_unique").on(t.userId, t.yearId, t.reviewKey),
  ],
);

// -------------------------------------------------------------- announcements

export const announcements = sqliteTable(
  "announcements",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ann")),
    title: text().notNull(),
    message: text().notNull(),
    /** "info" | "success" | "warning" | "danger" */
    tone: text().notNull().default("info"),
    active: integer({ mode: "boolean" }).notNull().default(true),
    startsAt: integer({ mode: "timestamp" }),
    endsAt: integer({ mode: "timestamp" }),
    createdByUserId: owner(),
    ...timestamps,
  },
  (t) => [index("announcements_active_idx").on(t.active)],
);

export const announcementViews = sqliteTable(
  "announcement_views",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("annv")),
    announcementId: text()
      .notNull()
      .references(() => announcements.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    seenAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("announcement_views_unique").on(t.announcementId, t.userId),
  ],
);

// -------------------------------------------------------------------- feedback

export const feedback = sqliteTable(
  "feedback",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("fb")),
    /** "bug" | "idea" | "question" | "other" */
    kind: text().notNull().default("other"),
    subject: text().notNull(),
    message: text().notNull(),
    /** JSON: browser, viewport, route — whatever helps reproduce a bug. */
    context: text().notNull().default("{}"),
    status: text().notNull().default("open"),
    userId: owner(),
    ...timestamps,
  },
  (t) => [index("feedback_user_id_idx").on(t.userId)],
);

// ------------------------------------------------------------------- relations

export const yearsRelations = relations(years, ({ many, one }) => ({
  periods: many(periods),
  subjects: many(subjects),
  grades: many(grades),
  customAverages: many(customAverages),
  goals: many(goals),
  cards: many(dashboardCards),
  user: one(users, { fields: [years.userId], references: [users.id] }),
}));

export const subjectsRelations = relations(subjects, ({ many, one }) => ({
  grades: many(grades),
  year: one(years, { fields: [subjects.yearId], references: [years.id] }),
}));

export const gradesRelations = relations(grades, ({ many, one }) => ({
  components: many(gradeComponents),
  subject: one(subjects, {
    fields: [grades.subjectId],
    references: [subjects.id],
  }),
  period: one(periods, { fields: [grades.periodId], references: [periods.id] }),
  year: one(years, { fields: [grades.yearId], references: [years.id] }),
}));

export const gradeComponentsRelations = relations(
  gradeComponents,
  ({ one }) => ({
    grade: one(grades, {
      fields: [gradeComponents.gradeId],
      references: [grades.id],
    }),
  }),
);

export const customAveragesRelations = relations(
  customAverages,
  ({ many, one }) => ({
    entries: many(customAverageEntries),
    year: one(years, {
      fields: [customAverages.yearId],
      references: [years.id],
    }),
  }),
);

export const customAverageEntriesRelations = relations(
  customAverageEntries,
  ({ one }) => ({
    average: one(customAverages, {
      fields: [customAverageEntries.averageId],
      references: [customAverages.id],
    }),
    subject: one(subjects, {
      fields: [customAverageEntries.subjectId],
      references: [subjects.id],
    }),
  }),
);

export const periodsRelations = relations(periods, ({ many, one }) => ({
  grades: many(grades),
  year: one(years, { fields: [periods.yearId], references: [years.id] }),
}));
