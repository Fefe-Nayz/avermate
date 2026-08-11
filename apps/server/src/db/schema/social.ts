import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";
import { years } from "./app";

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
};

const userRef = () =>
  text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" });

export type SocialAgeBand = "unknown" | "under15" | "15to17" | "adult";
export type SocialProfileField =
  "displayName" | "avatar" | "bio" | "educationBand";
export type SocialMetric =
  | "normalizedAverage"
  | "median"
  | "trendBand"
  | "passRateBand"
  | "gradeCountBand"
  | "genericGoalProgress";

/** Singleton runtime switch. Missing rows are deliberately treated as off. */
export const socialFeatureFlags = sqliteTable("social_feature_flags", {
  key: text().notNull().primaryKey(),
  enabled: integer({ mode: "boolean" }).notNull().default(false),
  revision: integer().notNull().default(1),
  changedByUserId: text().references(() => users.id, {
    onDelete: "set null",
    onUpdate: "cascade",
  }),
  ...timestamps,
});

/** No birth date or identity document is stored: only a coarse assurance. */
export const socialEligibility = sqliteTable("social_eligibility", {
  userId: userRef().primaryKey(),
  ageBand: text().$type<SocialAgeBand>().notNull().default("unknown"),
  assuranceLevel: text()
    .$type<
      "none" | "self_declared" | "guardian_verified" | "trusted_provider"
    >()
    .notNull()
    .default("none"),
  /** Pseudonymous reference returned by a trusted verifier, never raw proof. */
  providerRef: text(),
  verifiedAt: integer({ mode: "timestamp" }),
  expiresAt: integer({ mode: "timestamp" }),
  ...timestamps,
});

/** Append-only evidence ledger; withdrawal is another row, not an overwrite. */
export const socialFeatureConsents = sqliteTable(
  "social_feature_consents",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("scon")),
    userId: userRef(),
    policyVersion: text().notNull(),
    actorType: text().$type<"child" | "user" | "guardian">().notNull(),
    event: text().$type<"granted" | "withdrawn">().notNull(),
    /** Only set for a verified guardian; must be an opaque verifier reference. */
    guardianProviderRef: text(),
    channel: text()
      .$type<"web" | "mobile" | "admin_verified" | "mcp">()
      .notNull(),
    occurredAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("social_consents_user_version_idx").on(t.userId, t.policyVersion),
    index("social_consents_occurred_idx").on(t.occurredAt),
  ],
);

export const guardianConsentRequests = sqliteTable(
  "guardian_consent_requests",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("gcr")),
    childUserId: userRef(),
    guardianEmailHash: text().notNull(),
    tokenHash: text().notNull(),
    tokenPrefix: text().notNull(),
    policyVersion: text().notNull(),
    status: text()
      .$type<"pending" | "accepted" | "declined" | "revoked" | "expired">()
      .notNull()
      .default("pending"),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    respondedAt: integer({ mode: "timestamp" }),
    guardianUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    guardianProviderRef: text(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("guardian_consent_requests_token_unique").on(t.tokenHash),
    index("guardian_consent_requests_child_status_idx").on(
      t.childUserId,
      t.status,
    ),
    index("guardian_consent_requests_expiry_idx").on(t.expiresAt),
  ],
);

export const socialProfiles = sqliteTable(
  "social_profiles",
  {
    userId: userRef().primaryKey(),
    status: text()
      .$type<"off" | "active" | "frozen">()
      .notNull()
      .default("off"),
    discovery: text()
      .$type<"off" | "invite_only" | "exact_handle">()
      .notNull()
      .default("off"),
    handle: text(),
    displayName: text().notNull().default(""),
    bio: text().notNull().default(""),
    educationBand: text()
      .$type<
        | "unknown"
        | "middle_school"
        | "high_school"
        | "higher_education"
        | "other"
      >()
      .notNull()
      .default("unknown"),
    revision: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex("social_profiles_handle_unique").on(t.handle)],
);

export const socialProfileGrants = sqliteTable(
  "social_profile_grants",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sgrant")),
    userId: userRef(),
    fieldKey: text().$type<SocialProfileField>().notNull(),
    audience: text().$type<"friends" | "circle" | "specific_user">().notNull(),
    /** Circle or user id. Null only for the friends audience. */
    audienceId: text(),
    grantedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    withdrawnAt: integer({ mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("social_profile_grants_scope_unique").on(
      t.userId,
      t.fieldKey,
      t.audience,
      t.audienceId,
    ),
    index("social_profile_grants_user_idx").on(t.userId),
  ],
);

export const friendCircles = sqliteTable(
  "friend_circles",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("circle")),
    ownerUserId: userRef(),
    name: text().notNull(),
    revision: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [index("friend_circles_owner_idx").on(t.ownerUserId)],
);

export const friendCircleMembers = sqliteTable(
  "friend_circle_members",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("cirm")),
    circleId: text()
      .notNull()
      .references(() => friendCircles.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    friendUserId: userRef(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("friend_circle_members_unique").on(t.circleId, t.friendUserId),
    index("friend_circle_members_friend_idx").on(t.friendUserId),
  ],
);

/** One durable state machine per unordered pair; audit rows preserve history. */
export const friendRequests = sqliteTable(
  "friend_requests",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("freq")),
    userLowId: userRef(),
    userHighId: userRef(),
    senderUserId: userRef(),
    recipientUserId: userRef(),
    status: text()
      .$type<"pending" | "accepted" | "declined" | "cancelled" | "expired">()
      .notNull()
      .default("pending"),
    message: text(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    respondedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("friend_requests_pair_unique").on(t.userLowId, t.userHighId),
    index("friend_requests_recipient_status_idx").on(
      t.recipientUserId,
      t.status,
    ),
    index("friend_requests_sender_status_idx").on(t.senderUserId, t.status),
  ],
);

/** Invite-only discovery links. Only the hash is persisted; tokens are one-use. */
export const friendInvitations = sqliteTable(
  "friend_invitations",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("finv")),
    createdByUserId: userRef(),
    tokenHash: text().notNull(),
    tokenPrefix: text().notNull(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    consumedAt: integer({ mode: "timestamp" }),
    consumedByUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    revokedAt: integer({ mode: "timestamp" }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("friend_invitations_token_unique").on(t.tokenHash),
    index("friend_invitations_owner_idx").on(t.createdByUserId, t.expiresAt),
  ],
);

export const friendships = sqliteTable(
  "friendships",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("friend")),
    userLowId: userRef(),
    userHighId: userRef(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("friendships_pair_unique").on(t.userLowId, t.userHighId),
    index("friendships_low_idx").on(t.userLowId),
    index("friendships_high_idx").on(t.userHighId),
  ],
);

export const userBlocks = sqliteTable(
  "user_blocks",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("block")),
    blockerUserId: userRef(),
    blockedUserId: userRef(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("user_blocks_direction_unique").on(
      t.blockerUserId,
      t.blockedUserId,
    ),
    index("user_blocks_blocked_idx").on(t.blockedUserId),
  ],
);

export const socialGroups = sqliteTable(
  "social_groups",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sg")),
    ownerUserId: userRef(),
    type: text().$type<"friends" | "study_group" | "class">().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    state: text()
      .$type<"active" | "frozen" | "archived">()
      .notNull()
      .default("active"),
    /** Classes are community-created; this is never an institutional claim. */
    classDeclarationVersion: text(),
    classDeclaredAt: integer({ mode: "timestamp" }),
    classDeclaredByUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    currentPolicyVersion: integer().notNull().default(1),
    revision: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [index("social_groups_owner_idx").on(t.ownerUserId)],
);

export const groupMemberships = sqliteTable(
  "group_memberships",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sgm")),
    groupId: text()
      .notNull()
      .references(() => socialGroups.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: userRef(),
    role: text()
      .$type<"owner" | "moderator" | "member">()
      .notNull()
      .default("member"),
    state: text()
      .$type<"active" | "consent_required" | "left" | "removed">()
      .notNull()
      .default("consent_required"),
    alias: text().notNull(),
    /** Owner-selected source year; its raw rows are never exposed to the group. */
    sharedYearId: text().references(() => years.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    joinedAt: integer({ mode: "timestamp" }),
    leftAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("group_memberships_user_unique").on(t.groupId, t.userId),
    index("group_memberships_user_state_idx").on(t.userId, t.state),
  ],
);

/** Immutable after insert. Updates are blocked by a migration trigger. */
export const groupPolicyVersions = sqliteTable(
  "group_policy_versions",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sgpv")),
    groupId: text()
      .notNull()
      .references(() => socialGroups.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    version: integer().notNull(),
    purpose: text().notNull(),
    audienceDescription: text().notNull(),
    window: text()
      .$type<"current_academic_year" | "last_90_days" | "last_30_days">()
      .notNull(),
    digest: text().notNull(),
    rankingsEnabled: integer({ mode: "boolean" }).notNull().default(false),
    createdByUserId: userRef(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("group_policy_versions_number_unique").on(t.groupId, t.version),
    index("group_policy_versions_group_idx").on(t.groupId),
  ],
);

export const groupPolicyFields = sqliteTable(
  "group_policy_fields",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sgpf")),
    policyVersionId: text()
      .notNull()
      .references(() => groupPolicyVersions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fieldKey: text().$type<SocialMetric>().notNull(),
    required: integer({ mode: "boolean" }).notNull().default(false),
    exposure: text()
      .$type<"aggregate_only" | "member_visible" | "ranking">()
      .notNull(),
  },
  (t) => [
    uniqueIndex("group_policy_fields_unique").on(t.policyVersionId, t.fieldKey),
  ],
);

export const groupMemberConsents = sqliteTable(
  "group_member_consents",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sgc")),
    groupId: text()
      .notNull()
      .references(() => socialGroups.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: userRef(),
    policyVersion: integer().notNull(),
    status: text().$type<"accepted" | "withdrawn">().notNull(),
    policyDigest: text().notNull(),
    acceptedAt: integer({ mode: "timestamp" }),
    withdrawnAt: integer({ mode: "timestamp" }),
    channel: text().$type<"web" | "mobile" | "mcp">().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("group_member_consents_policy_unique").on(
      t.groupId,
      t.userId,
      t.policyVersion,
    ),
    index("group_member_consents_group_idx").on(t.groupId, t.policyVersion),
  ],
);

export const groupMemberConsentFields = sqliteTable(
  "group_member_consent_fields",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sgcf")),
    consentId: text()
      .notNull()
      .references(() => groupMemberConsents.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fieldKey: text().$type<SocialMetric>().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("group_member_consent_fields_unique").on(
      t.consentId,
      t.fieldKey,
    ),
  ],
);

export const groupInvitations = sqliteTable(
  "group_invitations",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sgi")),
    groupId: text()
      .notNull()
      .references(() => socialGroups.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdByUserId: userRef(),
    policyVersion: integer().notNull(),
    tokenHash: text().notNull(),
    /** Safe hint for owners; never enough to authenticate an invitation. */
    tokenPrefix: text().notNull(),
    targetEmailHash: text(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    consumedAt: integer({ mode: "timestamp" }),
    consumedByUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    revokedAt: integer({ mode: "timestamp" }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("group_invitations_token_unique").on(t.tokenHash),
    index("group_invitations_group_idx").on(t.groupId),
  ],
);

export const groupRankingOptIns = sqliteTable(
  "group_ranking_opt_ins",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sgro")),
    groupId: text()
      .notNull()
      .references(() => socialGroups.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: userRef(),
    policyVersion: integer().notNull(),
    metric: text().$type<SocialMetric>().notNull(),
    enabled: integer({ mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("group_ranking_opt_ins_unique").on(
      t.groupId,
      t.userId,
      t.policyVersion,
      t.metric,
    ),
  ],
);

export const socialNotifications = sqliteTable(
  "social_notifications",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("snot")),
    userId: userRef(),
    kind: text().notNull(),
    actorUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    entityType: text()
      .$type<"friend_request" | "group" | "report" | "system">()
      .notNull(),
    entityId: text(),
    /** Translation parameters only; no marks, subject names or school data. */
    safeParams: text().notNull().default("{}"),
    readAt: integer({ mode: "timestamp" }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("social_notifications_user_read_idx").on(t.userId, t.readAt)],
);

export const socialReports = sqliteTable(
  "social_reports",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("srep")),
    reporterUserId: userRef(),
    targetUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    groupId: text().references(() => socialGroups.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    category: text()
      .$type<
        "harassment" | "privacy" | "impersonation" | "unsafe_content" | "other"
      >()
      .notNull(),
    message: text().notNull(),
    status: text()
      .$type<"open" | "investigating" | "resolved" | "dismissed">()
      .notNull()
      .default("open"),
    priority: text()
      .$type<"low" | "normal" | "high" | "urgent">()
      .notNull()
      .default("normal"),
    assignedToUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    revision: integer().notNull().default(1),
    resolvedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (t) => [
    index("social_reports_status_idx").on(t.status, t.priority),
    index("social_reports_reporter_idx").on(t.reporterUserId),
  ],
);

/** Append-only and deliberately value-free: only changed keys are recorded. */
export const socialAuditEvents = sqliteTable(
  "social_audit_events",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("saud")),
    actorUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    subjectUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    changedKeys: text().notNull().default("[]"),
    requestId: text(),
    occurredAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("social_audit_subject_idx").on(t.subjectUserId, t.occurredAt),
    index("social_audit_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** Shared, database-backed fixed-window limits work across server replicas. */
export const socialRateLimits = sqliteTable(
  "social_rate_limits",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("srl")),
    subjectHash: text().notNull(),
    action: text().notNull(),
    windowStartedAt: integer({ mode: "timestamp" }).notNull(),
    count: integer().notNull().default(1),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("social_rate_limits_window_unique").on(
      t.subjectHash,
      t.action,
      t.windowStartedAt,
    ),
    index("social_rate_limits_expiry_idx").on(t.expiresAt),
  ],
);

/** Optional cached projections, always invalidated by group revision. */
export const socialAggregateCache = sqliteTable(
  "social_aggregate_cache",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sac")),
    groupId: text()
      .notNull()
      .references(() => socialGroups.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    groupRevision: integer().notNull(),
    policyVersion: integer().notNull(),
    metric: text().$type<SocialMetric>().notNull(),
    payload: text().notNull(),
    memberCount: integer().notNull(),
    computedAt: integer({ mode: "timestamp" }).notNull(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("social_aggregate_cache_key_unique").on(
      t.groupId,
      t.groupRevision,
      t.policyVersion,
      t.metric,
    ),
  ],
);

/** Public derived metric projection; raw academic rows never cross this type. */
export type SocialMetricProjection = {
  metric: SocialMetric;
  numeric: number | null;
  band: string | null;
};
