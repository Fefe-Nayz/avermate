import { relations } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";
import type { WidgetDefinitionV1 } from "@avermate/core/widget-types";

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

// ------------------------------------------------------------ managed presets

/**
 * The stable, public identity of a curriculum preset. Configuration itself is
 * immutable and lives in `presetVersions`, so publishing an edit never changes
 * the meaning of a version already attached to a school year.
 */
export const presetDefinitions = sqliteTable("preset_definitions", {
  id: text().notNull().primaryKey(),
  name: text().notNull(),
  description: text().notNull().default(""),
  /** JSON string array; tags are presentation metadata, not relational data. */
  tags: text().notNull().default("[]"),
  featured: integer({ mode: "boolean" }).notNull().default(false),
  archived: integer({ mode: "boolean" }).notNull().default(false),
  currentVersion: integer().notNull().default(1),
  createdByUserId: text().references(() => users.id, {
    onDelete: "set null",
    onUpdate: "cascade",
  }),
  ...timestamps,
});

/** An immutable, validated JSON configuration published by an administrator. */
export const presetVersions = sqliteTable(
  "preset_versions",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("prev")),
    presetId: text()
      .notNull()
      .references(() => presetDefinitions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    version: integer().notNull(),
    configuration: text().notNull(),
    changeNote: text().notNull().default(""),
    createdByUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("preset_versions_number_unique").on(t.presetId, t.version),
    index("preset_versions_preset_idx").on(t.presetId),
  ],
);

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

/**
 * One request record makes the multi-table onboarding write retry-safe. The
 * same key always resolves to the same year and cannot be reused with another
 * payload.
 */
export const yearSetupRequests = sqliteTable(
  "year_setup_requests",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ysetup")),
    idempotencyKey: text().notNull(),
    inputHash: text().notNull(),
    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("year_setup_requests_user_key_unique").on(
      t.userId,
      t.idempotencyKey,
    ),
    index("year_setup_requests_year_idx").on(t.yearId),
  ],
);

/**
 * Tracks whether a year still follows a published preset version. `linked`
 * years may be safely synchronized; `customized` years never receive a preset
 * update until their owner explicitly reapplies one.
 */
export const yearPresetMemberships = sqliteTable(
  "year_preset_memberships",
  {
    yearId: text()
      .notNull()
      .primaryKey()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    presetId: text()
      .notNull()
      .references(() => presetDefinitions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    appliedVersion: integer().notNull(),
    /** "linked" | "customized" */
    mode: text().notNull().default("linked"),
    detachedReason: text(),
    detachedAt: integer({ mode: "timestamp" }),
    lastSyncedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("year_preset_memberships_preset_idx").on(t.presetId),
    index("year_preset_memberships_user_idx").on(t.userId),
  ],
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
    /** Stable preset node identity; names and positions may change by version. */
    presetNodeKey: text(),

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
    uniqueIndex("subjects_year_preset_node_unique").on(
      t.yearId,
      t.presetNodeKey,
    ),
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
    /** @deprecated Kept only for backwards-compatible stored snapshots. */
    isMain: integer({ mode: "boolean" }).notNull().default(false),
    sortOrder: integer().notNull().default(0),
    /** Stable preset average identity across published versions. */
    presetNodeKey: text(),

    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("custom_averages_year_id_idx").on(t.yearId),
    uniqueIndex("custom_averages_year_preset_node_unique").on(
      t.yearId,
      t.presetNodeKey,
    ),
  ],
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
    /** Which screen owns the card: overview, subject, grade or insights. */
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

    /** Versioned analytics definition. Null means the legacy columns are canonical. */
    definitionVersion: integer(),
    definitionJson: text({ mode: "json" }).$type<WidgetDefinitionV1>(),

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

export type DashboardCardReferenceKind =
  "subject" | "custom-average" | "goal" | "period";

/**
 * Derived references keep widget definitions relationally observable without
 * making the JSON document itself part of a delete or ownership query.
 */
export const dashboardCardReferences = sqliteTable(
  "dashboard_card_references",
  {
    cardId: text()
      .notNull()
      .references(() => dashboardCards.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: text().$type<DashboardCardReferenceKind>().notNull(),
    referenceId: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.kind, t.referenceId] }),
    index("dashboard_card_references_lookup_idx").on(t.kind, t.referenceId),
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
    /** "global" | "preset". Preset targets live in `announcementPresetTargets`. */
    audience: text().notNull().default("global"),
    active: integer({ mode: "boolean" }).notNull().default(true),
    startsAt: integer({ mode: "timestamp" }),
    endsAt: integer({ mode: "timestamp" }),
    createdByUserId: owner(),
    ...timestamps,
  },
  (t) => [
    index("announcements_active_idx").on(t.active),
    index("announcements_audience_idx").on(t.audience),
  ],
);

/**
 * Logical preset targets for an announcement. Targets intentionally follow a
 * preset across versions; users are eligible only while their year remains a
 * linked, non-detached member of that preset.
 */
export const announcementPresetTargets = sqliteTable(
  "announcement_preset_targets",
  {
    announcementId: text()
      .notNull()
      .references(() => announcements.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    presetId: text()
      .notNull()
      .references(() => presetDefinitions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (t) => [
    uniqueIndex("announcement_preset_targets_unique").on(
      t.announcementId,
      t.presetId,
    ),
    index("announcement_preset_targets_preset_idx").on(t.presetId),
  ],
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
    /** Automatic error details; never rendered outside the admin triage view. */
    stack: text(),
    errorDigest: text(),
    route: text(),
    /** Optional user-provided screenshot stored outside the database. */
    attachmentUrl: text(),
    /** JSON: browser, viewport, route — whatever helps reproduce a bug. */
    context: text().notNull().default("{}"),
    /** Automatic reports with the same server-computed fingerprint are grouped. */
    fingerprint: text(),
    /** Cross-user admin grouping key; never exposed outside admin triage. */
    duplicateGroupKey: text(),
    source: text().notNull().default("form"),
    duplicateCount: integer().notNull().default(1),
    status: text().notNull().default("open"),
    priority: text().notNull().default("normal"),
    assignedToUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    lastSeenAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer({ mode: "timestamp" }),
    /** Optimistic concurrency token for admin workflow mutations. */
    revision: integer().notNull().default(1),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("feedback_user_id_idx").on(t.userId),
    uniqueIndex("feedback_fingerprint_unique").on(t.fingerprint),
    index("feedback_duplicate_group_idx").on(t.duplicateGroupKey, t.lastSeenAt),
    index("feedback_triage_idx").on(t.status, t.priority, t.lastSeenAt),
    index("feedback_assignee_idx").on(t.assignedToUserId, t.status),
  ],
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
