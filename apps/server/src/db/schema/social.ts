import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";
import { subjects, years } from "./app";

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

/**
 * The social model, second iteration.
 *
 * The first version optimised for privacy ceremony — age assurance, guardian
 * consent, per-field profile grants, versioned group policies with
 * re-consent, k-anonymous aggregates — and in doing so made the one thing
 * people actually came for impossible: showing a friend your average. This
 * version optimises for that. Identity comes from the account (name and
 * avatar), what is shared is academic and real, and every control is a lock a
 * reader can understand: share my general average, share these subjects.
 */

export type SocialShareSubjectsMode = "all" | "selected" | "none";

/**
 * One row per user: the handle friends can find them by, and the locks on
 * what friends may see. `sharedYearId` null means "my current year",
 * resolved at read time, so sharing keeps working across a school year
 * change without anyone re-doing setup.
 */
export const socialProfiles = sqliteTable(
  "social_profiles",
  {
    userId: userRef().primaryKey(),
    handle: text(),
    shareGeneralAverage: integer({ mode: "boolean" }).notNull().default(true),
    shareSubjectsMode: text()
      .$type<SocialShareSubjectsMode>()
      .notNull()
      .default("all"),
    sharedYearId: text().references(() => years.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    ...timestamps,
  },
  (t) => [uniqueIndex("social_profiles_handle_unique").on(t.handle)],
);

/** The allowlist behind `shareSubjectsMode = "selected"`. */
export const socialSharedSubjects = sqliteTable(
  "social_shared_subjects",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sshare")),
    userId: userRef(),
    subjectId: text()
      .notNull()
      .references(() => subjects.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("social_shared_subjects_unique").on(t.userId, t.subjectId),
    index("social_shared_subjects_user_idx").on(t.userId),
  ],
);

/** One durable state machine per unordered pair. */
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
      .$type<"pending" | "accepted" | "declined" | "cancelled">()
      .notNull()
      .default("pending"),
    message: text(),
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

/** Shareable links. Only the hash is persisted; a token joins one friend. */
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

/** A named room whose members compare averages. Nothing more. */
export const socialGroups = sqliteTable(
  "social_groups",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sg")),
    ownerUserId: userRef(),
    name: text().notNull(),
    description: text().notNull().default(""),
    /** `frozen` is an administrative hold after a report. */
    state: text().$type<"active" | "frozen">().notNull().default("active"),
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
    role: text().$type<"owner" | "member">().notNull().default("member"),
    /** The one lock a member has inside a group. */
    shareAverage: integer({ mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("group_memberships_user_unique").on(t.groupId, t.userId),
    index("group_memberships_user_idx").on(t.userId),
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
    tokenHash: text().notNull(),
    /** Safe hint for the list; never enough to authenticate an invitation. */
    tokenPrefix: text().notNull(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    /** Unlike friend links, a group link admits many people until revoked. */
    useCount: integer().notNull().default(0),
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
    /** Translation parameters only; no marks and no school data. */
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
    resolvedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (t) => [
    index("social_reports_status_idx").on(t.status, t.priority),
    index("social_reports_reporter_idx").on(t.reporterUserId),
  ],
);
