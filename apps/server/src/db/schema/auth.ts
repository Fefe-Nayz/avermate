import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";

/** Tables owned by better-auth. Column names follow its adapter conventions. */

export const users = sqliteTable(
  "users",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("u")),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: integer({ mode: "boolean" }).notNull().default(false),
    avatarUrl: text(),

    role: text().notNull().default("user"),
    banned: integer({ mode: "boolean" }).notNull().default(false),
    banReason: text(),
    banExpires: integer({ mode: "timestamp" }),

    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("users_email_idx").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ses", 32)),
    token: text().notNull().unique(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: integer({ mode: "timestamp" }).notNull(),
    updatedAt: integer({ mode: "timestamp" }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    impersonatedBy: text(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_token_idx").on(t.token),
  ],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("acc")),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    accessToken: text(),
    accessTokenExpiresAt: integer({ mode: "timestamp" }),
    refreshToken: text(),
    refreshTokenExpiresAt: integer({ mode: "timestamp" }),
    scope: text(),
    idToken: text(),
    password: text(),
    createdAt: integer({ mode: "timestamp" }).notNull(),
    updatedAt: integer({ mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("accounts_user_id_idx").on(t.userId),
    index("accounts_provider_idx").on(t.accountId, t.providerId),
  ],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ver")),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: integer({ mode: "timestamp" }).notNull(),
    updatedAt: integer({ mode: "timestamp" }).notNull(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);
