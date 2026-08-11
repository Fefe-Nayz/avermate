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

/** Asymmetric signing keys owned by Better Auth's JWT plugin. */
export const jwkss = sqliteTable("jwks", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => newId("jwk")),
  publicKey: text().notNull(),
  privateKey: text().notNull(),
  createdAt: integer({ mode: "timestamp" }).notNull(),
  expiresAt: integer({ mode: "timestamp" }),
});

/** OAuth clients are user-owned. Public MCP clients never store a secret. */
export const oauthClients = sqliteTable(
  "oauth_clients",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("oac")),
    clientId: text().notNull().unique(),
    clientSecret: text(),
    disabled: integer({ mode: "boolean" }).default(false),
    skipConsent: integer({ mode: "boolean" }),
    enableEndSession: integer({ mode: "boolean" }),
    subjectType: text(),
    scopes: text({ mode: "json" }).$type<string[]>(),
    userId: text().references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    createdAt: integer({ mode: "timestamp" }),
    updatedAt: integer({ mode: "timestamp" }),
    name: text(),
    uri: text(),
    icon: text(),
    contacts: text({ mode: "json" }).$type<string[]>(),
    tos: text(),
    policy: text(),
    softwareId: text(),
    softwareVersion: text(),
    softwareStatement: text(),
    redirectUris: text({ mode: "json" }).$type<string[]>().notNull(),
    postLogoutRedirectUris: text({ mode: "json" }).$type<string[]>(),
    tokenEndpointAuthMethod: text(),
    grantTypes: text({ mode: "json" }).$type<string[]>(),
    responseTypes: text({ mode: "json" }).$type<string[]>(),
    public: integer({ mode: "boolean" }),
    type: text(),
    requirePKCE: integer({ mode: "boolean" }),
    referenceId: text(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("oauth_clients_user_id_idx").on(t.userId)],
);

export const oauthRefreshTokens = sqliteTable(
  "oauth_refresh_tokens",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ort")),
    token: text().notNull().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text().references(() => sessions.id, { onDelete: "set null" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referenceId: text(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: integer({ mode: "timestamp" }).notNull(),
    revoked: integer({ mode: "timestamp" }),
    authTime: integer({ mode: "timestamp" }),
    scopes: text({ mode: "json" }).$type<string[]>().notNull(),
  },
  (t) => [
    index("oauth_refresh_tokens_client_id_idx").on(t.clientId),
    index("oauth_refresh_tokens_session_id_idx").on(t.sessionId),
    index("oauth_refresh_tokens_user_id_idx").on(t.userId),
  ],
);

export const oauthAccessTokens = sqliteTable(
  "oauth_access_tokens",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("oat")),
    token: text().notNull().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text().references(() => sessions.id, { onDelete: "set null" }),
    userId: text().references(() => users.id, { onDelete: "cascade" }),
    referenceId: text(),
    refreshId: text().references(() => oauthRefreshTokens.id, {
      onDelete: "cascade",
    }),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: integer({ mode: "timestamp" }).notNull(),
    scopes: text({ mode: "json" }).$type<string[]>().notNull(),
  },
  (t) => [
    index("oauth_access_tokens_client_id_idx").on(t.clientId),
    index("oauth_access_tokens_session_id_idx").on(t.sessionId),
    index("oauth_access_tokens_user_id_idx").on(t.userId),
    index("oauth_access_tokens_refresh_id_idx").on(t.refreshId),
  ],
);

export const oauthConsents = sqliteTable(
  "oauth_consents",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ocn")),
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text().references(() => users.id, { onDelete: "cascade" }),
    referenceId: text(),
    scopes: text({ mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer({ mode: "timestamp" }).notNull(),
    updatedAt: integer({ mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("oauth_consents_client_id_idx").on(t.clientId),
    index("oauth_consents_user_id_idx").on(t.userId),
  ],
);
