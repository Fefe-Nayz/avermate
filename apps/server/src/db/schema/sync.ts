import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { grades, periods, subjects, years } from "./app";
import { users } from "./auth";

export type SyncProviderId = "moodle" | "ecoledirecte" | "pronote" | "skolengo";
export type SyncCapability =
  | "files"
  | "homework"
  | "timetable"
  | "grades"
  | "attachments"
  | "school-calendar";
export type SyncConnectionStatus =
  "pending" | "active" | "error" | "revoked" | "disconnected";
export type SyncSubjectMappingStatus = "mapped" | "unmatched" | "ambiguous";
export type SyncPeriodMappingStatus = SyncSubjectMappingStatus;
export type SyncGradeRecordState = "managed" | "missing" | "dismissed";
export type ContentConnectionProvider = "moodle" | "onedrive" | "googledrive";
export type ContentConnectionStatus = "connected" | "expired" | "error";

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

/** A user-authorized remote academic provider connection. */
export const syncConnections = sqliteTable(
  "sync_connections",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sconn")),
    provider: text().$type<SyncProviderId>().notNull(),
    label: text().notNull(),
    baseUrl: text().notNull(),
    /** AES-256-GCM sealed credentials; never select this into a public DTO. */
    sealedCredentials: text(),
    /** Optional trusted PEM chain. TLS verification is never disabled. */
    caCertPem: text(),
    capabilities: text({ mode: "json" }).$type<SyncCapability[]>().notNull(),
    status: text().$type<SyncConnectionStatus>().notNull().default("active"),
    lastSyncAt: integer({ mode: "timestamp" }),
    lastError: text(),
    /** Stable provider-owned pupil identity; never infer it from list order. */
    remoteStudentId: text(),
    /** Stable provider-owned academic-year identity discovered before linking. */
    remoteAcademicYearId: text(),
    /** At most one connection should publish grades into a given local year. */
    gradesAuthority: integer({ mode: "boolean" }).notNull().default(false),
    /** Credentials are destroyed on disconnect while the cached projection remains. */
    disconnectedAt: integer({ mode: "timestamp" }),
    yearId: text().references(() => years.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("sync_connections_user_idx").on(t.userId),
    index("sync_connections_year_idx").on(t.yearId),
    uniqueIndex("sync_connections_grades_authority_unique")
      .on(t.yearId)
      .where(sql`${t.gradesAuthority} = true and ${t.yearId} is not null`),
    uniqueIndex("sync_connections_remote_scope_unique")
      .on(
        t.userId,
        t.provider,
        t.baseUrl,
        t.remoteStudentId,
        t.remoteAcademicYearId,
      )
      .where(
        sql`${t.remoteStudentId} is not null and ${t.remoteAcademicYearId} is not null`,
      ),
  ],
);

/** Stable provider-to-local identity and modification state across sync runs. */
export const syncedResources = sqliteTable(
  "synced_resources",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sres")),
    connectionId: text()
      .notNull()
      .references(() => syncConnections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    capability: text().$type<SyncCapability>().notNull(),
    externalId: text().notNull(),
    externalModifiedAt: integer({ mode: "timestamp" }),
    contentHash: text(),
    localKind: text().notNull(),
    localId: text().notNull(),
    syncedAt: integer({ mode: "timestamp" }).notNull(),
    userId: owner(),
  },
  (t) => [
    uniqueIndex("synced_resources_conn_ext_unique").on(
      t.connectionId,
      t.externalId,
    ),
    index("synced_resources_local_idx").on(t.localKind, t.localId),
  ],
);

/** Durable fixed-window counters for provider authentication and sync actions. */
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("srl")),
    /** SHA-256 of the user/provider scope; raw identifiers are never retained. */
    subjectHash: text().notNull(),
    action: text().notNull(),
    windowStart: integer({ mode: "timestamp" }).notNull(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    count: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("rate_limits_scope_window_unique").on(
      t.subjectHash,
      t.action,
      t.windowStart,
    ),
    index("rate_limits_expiry_idx").on(t.expiresAt),
  ],
);

/**
 * Stable provider-subject identity. Names are only an initial matching hint;
 * once resolved, provider/local renames cannot silently rebind the mapping.
 */
export const syncSubjectMappings = sqliteTable(
  "sync_subject_mappings",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ssmap")),
    connectionId: text()
      .notNull()
      .references(() => syncConnections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    providerSubjectExternalId: text().notNull(),
    providerSubjectName: text().notNull(),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    matchStatus: text().$type<SyncSubjectMappingStatus>().notNull(),
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
    uniqueIndex("sync_subject_mappings_conn_external_unique").on(
      t.connectionId,
      t.providerSubjectExternalId,
    ),
    index("sync_subject_mappings_owner_year_idx").on(t.userId, t.yearId),
    index("sync_subject_mappings_subject_idx").on(t.subjectId),
  ],
);

/**
 * Stable provider-period identity. A provider period is mapped explicitly to
 * one local period; provider renames can therefore never silently rebind it.
 */
export const syncPeriodMappings = sqliteTable(
  "sync_period_mappings",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("spmap")),
    connectionId: text()
      .notNull()
      .references(() => syncConnections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    providerPeriodExternalId: text().notNull(),
    providerPeriodName: text().notNull(),
    periodId: text().references(() => periods.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    matchStatus: text().$type<SyncPeriodMappingStatus>().notNull(),
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
    uniqueIndex("sync_period_mappings_conn_external_unique").on(
      t.connectionId,
      t.providerPeriodExternalId,
    ),
    index("sync_period_mappings_owner_year_idx").on(t.userId, t.yearId),
    index("sync_period_mappings_period_idx").on(t.periodId),
  ],
);

/**
 * Durable provider snapshot for one grade. It preserves non-numeric results
 * and source identity even when no canonical local `grades` row can exist.
 */
export const syncGradeRecords = sqliteTable(
  "sync_grade_records",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sgrec")),
    connectionId: text()
      .notNull()
      .references(() => syncConnections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    externalId: text().notNull(),
    externalModifiedAt: integer({ mode: "timestamp" }),
    title: text().notNull(),
    providerSubjectExternalId: text().notNull(),
    providerSubjectName: text().notNull(),
    providerPeriodExternalId: text(),
    providerPeriodName: text(),
    passedAt: integer({ mode: "timestamp" }).notNull(),
    value: real(),
    outOf: real(),
    coefficient: real().notNull().default(1),
    significant: integer({ mode: "boolean" }).notNull().default(true),
    syncState: text()
      .$type<SyncGradeRecordState>()
      .notNull()
      .default("managed"),
    localGradeId: text().references(() => grades.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
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
    uniqueIndex("sync_grade_records_conn_external_unique").on(
      t.connectionId,
      t.externalId,
    ),
    uniqueIndex("sync_grade_records_local_grade_unique").on(t.localGradeId),
    index("sync_grade_records_owner_year_idx").on(t.userId, t.yearId),
    index("sync_grade_records_conn_state_idx").on(t.connectionId, t.syncState),
    index("sync_grade_records_subject_external_idx").on(
      t.connectionId,
      t.providerSubjectExternalId,
    ),
    index("sync_grade_records_period_external_idx").on(
      t.connectionId,
      t.providerPeriodExternalId,
    ),
    check(
      "sync_grade_records_state_check",
      sql`${t.syncState} in ('managed', 'missing', 'dismissed')`,
    ),
  ],
);

/** A read-only content source projected into the merged Materials tree. */
export const contentConnections = sqliteTable(
  "content_connections",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("cconn")),
    provider: text().$type<ContentConnectionProvider>().notNull(),
    accountLabel: text().notNull(),
    status: text()
      .$type<ContentConnectionStatus>()
      .notNull()
      .default("connected"),
    cursor: text(),
    subscriptionId: text(),
    /** Google Drive watch channels also require their provider resource id to stop. */
    subscriptionResourceId: text(),
    subscriptionExpiresAt: integer({ mode: "timestamp" }),
    lastSyncedAt: integer({ mode: "timestamp" }),
    lastError: text(),
    scopeJson: text({ mode: "json" }).$type<{ folderIds: string[] } | null>(),
    /** Monotonic fence preventing a completed sync from publishing stale scope. */
    syncRevision: integer().notNull().default(0),
    /** Coalescing watermark incremented for every manual/webhook request. */
    syncRequestedGeneration: integer().notNull().default(0),
    /** The one worker allowed to drain requested generations for this source. */
    syncActiveJobId: text(),
    /** AES-256-GCM envelope containing OAuth access and refresh tokens. */
    sealedCredentials: text().notNull(),
    /** SHA-256 of the provider webhook secret; plaintext never enters the DB. */
    webhookSecretHash: text(),
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
    index("content_connections_owner_year_idx").on(t.userId, t.yearId),
    index("content_connections_subscription_idx").on(t.subscriptionId),
  ],
);

/** One-use OAuth state ledger; the verifier is stored only as a digest. */
export const contentOauthStates = sqliteTable(
  "content_oauth_states",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("costate")),
    stateHash: text().notNull(),
    /** Sealed PKCE verifier, consumed atomically with the state row. */
    sealedVerifier: text(),
    provider: text().$type<ContentConnectionProvider>().notNull(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    yearId: text()
      .notNull()
      .references(() => years.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("content_oauth_states_hash_unique").on(t.stateHash),
    index("content_oauth_states_expiry_idx").on(t.expiresAt),
  ],
);

// ------------------------------------------------------------------- relations

export const syncConnectionsRelations = relations(
  syncConnections,
  ({ many, one }) => ({
    year: one(years, {
      fields: [syncConnections.yearId],
      references: [years.id],
    }),
    user: one(users, {
      fields: [syncConnections.userId],
      references: [users.id],
    }),
    resources: many(syncedResources),
    subjectMappings: many(syncSubjectMappings),
    periodMappings: many(syncPeriodMappings),
    gradeRecords: many(syncGradeRecords),
  }),
);

export const syncedResourcesRelations = relations(
  syncedResources,
  ({ one }) => ({
    connection: one(syncConnections, {
      fields: [syncedResources.connectionId],
      references: [syncConnections.id],
    }),
    user: one(users, {
      fields: [syncedResources.userId],
      references: [users.id],
    }),
  }),
);

export const syncSubjectMappingsRelations = relations(
  syncSubjectMappings,
  ({ one }) => ({
    connection: one(syncConnections, {
      fields: [syncSubjectMappings.connectionId],
      references: [syncConnections.id],
    }),
    subject: one(subjects, {
      fields: [syncSubjectMappings.subjectId],
      references: [subjects.id],
    }),
    year: one(years, {
      fields: [syncSubjectMappings.yearId],
      references: [years.id],
    }),
    user: one(users, {
      fields: [syncSubjectMappings.userId],
      references: [users.id],
    }),
  }),
);

export const syncPeriodMappingsRelations = relations(
  syncPeriodMappings,
  ({ one }) => ({
    connection: one(syncConnections, {
      fields: [syncPeriodMappings.connectionId],
      references: [syncConnections.id],
    }),
    period: one(periods, {
      fields: [syncPeriodMappings.periodId],
      references: [periods.id],
    }),
    year: one(years, {
      fields: [syncPeriodMappings.yearId],
      references: [years.id],
    }),
    user: one(users, {
      fields: [syncPeriodMappings.userId],
      references: [users.id],
    }),
  }),
);

export const syncGradeRecordsRelations = relations(
  syncGradeRecords,
  ({ one }) => ({
    connection: one(syncConnections, {
      fields: [syncGradeRecords.connectionId],
      references: [syncConnections.id],
    }),
    localGrade: one(grades, {
      fields: [syncGradeRecords.localGradeId],
      references: [grades.id],
    }),
    year: one(years, {
      fields: [syncGradeRecords.yearId],
      references: [years.id],
    }),
    user: one(users, {
      fields: [syncGradeRecords.userId],
      references: [users.id],
    }),
  }),
);

// ------------------------------------------------------------------------ rows

export type SyncConnection = typeof syncConnections.$inferSelect;
export type NewSyncConnection = typeof syncConnections.$inferInsert;
export type SyncPeriodMapping = typeof syncPeriodMappings.$inferSelect;
export type NewSyncPeriodMapping = typeof syncPeriodMappings.$inferInsert;
export type SyncGradeRecord = typeof syncGradeRecords.$inferSelect;
export type NewSyncGradeRecord = typeof syncGradeRecords.$inferInsert;
