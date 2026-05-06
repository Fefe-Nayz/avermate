import { generateId } from "@/lib/nanoid";
import { relations } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// TODO: Add index on userId and yearId

export const years = sqliteTable("years", {
  id: text().notNull().primaryKey().$defaultFn(() => generateId("y")),
  name: text().notNull(),
  startDate: integer({ mode: "timestamp" }).notNull(),
  endDate: integer({ mode: "timestamp" }).notNull(),
  defaultOutOf: integer().notNull(),
  createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  userId: text().notNull().references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
}, (t) => ({
  userIdIdx: index("years_user_id_idx").on(t.userId),
}));

export const subjects = sqliteTable(
  "subjects",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => generateId("sub")),

    name: text().notNull(),

    parentId: text(),

    coefficient: integer().notNull(),

    depth: integer().notNull().default(0),

    isMainSubject: integer({ mode: "boolean" }).default(false).notNull(),

    isDisplaySubject: integer({ mode: "boolean" }).default(false).notNull(),

    createdAt: integer({ mode: "timestamp" }).notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
    yearId: text()
      .notNull()
      .references(() => years.id, { onUpdate: "cascade", onDelete: "cascade" })
  },
  (t) => ({
    parentReference: foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "subjects_parent_id_fk",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    userIdIdx: index("subjects_user_id_idx").on(t.userId),
    yearIdIdx: index("subjects_year_id_idx").on(t.yearId),
  }),
);

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  parent: one(subjects, {
    fields: [subjects.parentId],
    references: [subjects.id],
    relationName: "parent_relation",
  }),
  childrens: many(subjects, { relationName: "parent_relation" }),
  grades: many(grades),
  user: one(users, {
    fields: [subjects.userId],
    references: [users.id],
  }),
  year: one(years, {
    fields: [subjects.yearId],
    references: [years.id],
  }),
}));

export const periods = sqliteTable("periods", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("per")),

  name: text().notNull(),

  startAt: integer({ mode: "timestamp" }).notNull(),
  endAt: integer({ mode: "timestamp" }).notNull(),

  isCumulative: integer({ mode: "boolean" }).notNull().default(false),

  createdAt: integer({ mode: "timestamp" }).notNull(),
  userId: text()
    .notNull()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
  yearId: text()
    .notNull()
    .references(() => years.id, { onUpdate: "cascade", onDelete: "cascade" })
}, (t) => ({
  userIdIdx: index("periods_user_id_idx").on(t.userId),
  yearIdIdx: index("periods_year_id_idx").on(t.yearId),
}));


export const grades = sqliteTable("grades", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("gra")),

  name: text().notNull(),

  value: integer().notNull(),
  outOf: integer().notNull(),
  coefficient: integer().notNull(),

  isComposite: integer({ mode: "boolean" }).notNull().default(false),

  passedAt: integer({ mode: "timestamp" }).notNull(),
  createdAt: integer({ mode: "timestamp" }).notNull(),

  periodId: text()
    .references(() => periods.id, { onUpdate: "cascade", onDelete: "cascade" }),

  subjectId: text()
    .notNull()
    .references(() => subjects.id, {
      onUpdate: "cascade",
      onDelete: "cascade",
    }),
  userId: text()
    .notNull()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
  yearId: text()
    .notNull()
    .references(() => years.id, { onUpdate: "cascade", onDelete: "cascade" })
}, (t) => ({
  userIdIdx: index("grades_user_id_idx").on(t.userId),
  subjectIdIdx: index("grades_subject_id_idx").on(t.subjectId),
  yearIdIdx: index("grades_year_id_idx").on(t.yearId),
}));

export const gradeComponents = sqliteTable("grade_components", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("gc")),
  gradeId: text()
    .notNull()
    .references(() => grades.id, { onUpdate: "cascade", onDelete: "cascade" }),
  name: text().notNull(),
  value: integer().notNull(),
  outOf: integer().notNull(),
  coefficient: integer().notNull(),
  createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  userId: text()
    .notNull()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
  yearId: text()
    .notNull()
    .references(() => years.id, { onUpdate: "cascade", onDelete: "cascade" }),
}, (t) => ({
  gradeIdIdx: index("grade_components_grade_id_idx").on(t.gradeId),
  userIdIdx: index("grade_components_user_id_idx").on(t.userId),
  yearIdIdx: index("grade_components_year_id_idx").on(t.yearId),
}));

export const gradeComponentsRelations = relations(gradeComponents, ({ one }) => ({
  grade: one(grades, {
    fields: [gradeComponents.gradeId],
    references: [grades.id],
  }),
  user: one(users, {
    fields: [gradeComponents.userId],
    references: [users.id],
  }),
  year: one(years, {
    fields: [gradeComponents.yearId],
    references: [years.id],
  }),
}));

export const gradesRelations = relations(grades, ({ one, many }) => ({
  subject: one(subjects, {
    fields: [grades.subjectId],
    references: [subjects.id],
  }),
  period: one(periods, {
    fields: [grades.periodId],
    references: [periods.id],
  }),
  user: one(users, {
    fields: [grades.userId],
    references: [users.id],
  }),
  year: one(years, {
    fields: [grades.yearId],
    references: [years.id],
  }),
  components: many(gradeComponents),
}));

export const users = sqliteTable("users", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("u")),

  name: text().notNull(),

  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).notNull(),

  avatarUrl: text(),

  role: text().default("user"),
  banned: integer({ mode: "boolean" }).default(false),
  banReason: text(),
  banExpires: integer({ mode: "timestamp" }),

  updatedAt: integer({ mode: "timestamp" }).notNull(),
  createdAt: integer({ mode: "timestamp" }).notNull(),
}, (t) => ({
  emailIdx: index("users_email_idx").on(t.email),
}));

export const userSettings = sqliteTable("user_settings", {
  userId: text()
    .notNull()
    .primaryKey()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
  theme: text().notNull().default("system"),
  language: text().notNull().default("system"),
  chartSettings: text()
    .notNull()
    .default('{"autoZoomYAxis":true,"showTrendLine":false,"trendLineSubdivisions":1}'),
  seasonalThemesEnabled: integer({ mode: "boolean" }).notNull().default(true),
  seasonalTheme: text().notNull().default("none"),
  mokattamThemeAvailable: integer({ mode: "boolean" }).notNull().default(false),
  mokattamThemeEnabled: integer({ mode: "boolean" }).notNull().default(false),
  mokattamThemeCelebrationSeenAt: integer({ mode: "timestamp" }),
  hapticsEnabled: integer({ mode: "boolean" }).notNull().default(true),
  customTheme: text().notNull().default("{}"),
  createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const yearReviewViews = sqliteTable("year_review_views", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("yrv")),
  userId: text()
    .notNull()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
  yearId: text()
    .notNull()
    .references(() => years.id, { onUpdate: "cascade", onDelete: "cascade" }),
  reviewKey: text().notNull(),
  clickedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  userYearReviewKeyIdx: uniqueIndex("year_review_views_user_year_key_idx").on(
    t.userId,
    t.yearId,
    t.reviewKey
  ),
  userIdIdx: index("year_review_views_user_id_idx").on(t.userId),
  yearIdIdx: index("year_review_views_year_id_idx").on(t.yearId),
}));

export const announcements = sqliteTable("announcements", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("ann")),
  title: text().notNull(),
  message: text().notNull(),
  tone: text().notNull().default("info"),
  active: integer({ mode: "boolean" }).notNull().default(true),
  startsAt: integer({ mode: "timestamp" }),
  endsAt: integer({ mode: "timestamp" }),
  createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  createdByUserId: text()
    .notNull()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
}, (t) => ({
  activeIdx: index("announcements_active_idx").on(t.active),
  createdByUserIdIdx: index("announcements_created_by_user_id_idx").on(t.createdByUserId),
}));

export const announcementViews = sqliteTable("announcement_views", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("annv")),
  announcementId: text()
    .notNull()
    .references(() => announcements.id, { onUpdate: "cascade", onDelete: "cascade" }),
  userId: text()
    .notNull()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
  viewedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  announcementUserIdx: uniqueIndex("announcement_views_announcement_user_idx").on(
    t.announcementId,
    t.userId
  ),
  userIdIdx: index("announcement_views_user_id_idx").on(t.userId),
  announcementIdIdx: index("announcement_views_announcement_id_idx").on(t.announcementId),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  subjects: many(subjects),
  grades: many(grades),
  sessions: many(sessions),
  accounts: many(accounts),
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

export const sessions = sqliteTable("sessions", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("ses", 32)),

  token: text().unique().notNull(),

  expiresAt: integer({ mode: "timestamp" }).notNull(),
  createdAt: integer({ mode: "timestamp" }).notNull(),
  updatedAt: integer({ mode: "timestamp" }).notNull(),

  ipAddress: text(),
  userAgent: text(),
  impersonatedBy: text(),

  userId: text()
    .notNull()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
}, (t) => ({
  userIdIdx: index("sessions_user_id_idx").on(t.userId),
  tokenIdx: index("sessions_token_idx").on(t.token),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const accounts = sqliteTable("accounts", {
  id: text()
    .primaryKey()
    .notNull()
    .$defaultFn(() => generateId("acc")),

  accountId: text().notNull(),

  providerId: text().notNull(),

  userId: text()
    .notNull()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),

  accessToken: text(),
  accessTokenExpiresAt: integer({ mode: "timestamp" }),
  refreshToken: text(),
  refreshTokenExpiresAt: integer({ mode: "timestamp" }),
  scope: text(),
  idToken: text(),

  createdAt: integer({ mode: "timestamp" }).notNull(),
  updatedAt: integer({ mode: "timestamp" }).notNull(),

  password: text(),
}, (t) => ({
  userIdIdx: index("accounts_user_id_idx").on(t.userId),
  accountIdProviderIdIdx: index("accounts_account_id_provider_id_idx").on(
    t.accountId,
    t.providerId,
  ),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const verifications = sqliteTable("verifications", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("ver")),

  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: integer({ mode: "timestamp" }).notNull(),
  createdAt: integer({ mode: "timestamp" }).notNull(),
  updatedAt: integer({ mode: "timestamp" }).notNull(),
});

export const customAverages = sqliteTable("custom_averages", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("ca")),

  name: text().notNull(),

  subjects: text().notNull(),

  userId: text()
    .notNull()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),

  isMainAverage: integer({ mode: "boolean" }).default(false).notNull(),

  createdAt: integer({ mode: "timestamp" }).notNull(),

  yearId: text()
    .notNull()
    .references(() => years.id, { onUpdate: "cascade", onDelete: "cascade" })
}, (t) => ({
  yearIdIdx: index("custom_averages_year_id_idx").on(t.yearId),
}));

export const cardLayouts = sqliteTable("card_layouts", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => generateId("cl")),
  userId: text()
    .notNull()
    .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
  page: text().notNull(),
  cards: text().notNull(),
  createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  userPageIdx: uniqueIndex("card_layouts_user_page_idx").on(t.userId, t.page),
  userIdIdx: index("card_layouts_user_id_idx").on(t.userId),
}));

export const cardLayoutsRelations = relations(cardLayouts, ({ one }) => ({
  user: one(users, {
    fields: [cardLayouts.userId],
    references: [users.id],
  }),
}));
