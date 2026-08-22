import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";

const owner = () =>
  text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" });

const createdAt = () =>
  integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const agentActionSequences = sqliteTable("agent_action_sequences", {
  userId: owner().primaryKey(),
  nextSequence: integer().notNull().default(0),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const agentActionBatches = sqliteTable(
  "agent_action_batches",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("aabat")),
    userId: owner(),
    threadId: text(),
    branchId: text(),
    runId: text(),
    label: text(),
    status: text({ enum: ["open", "completed", "failed"] })
      .notNull()
      .default("open"),
    domainCursorBeforeRef: text().notNull(),
    domainCursorAfterRef: text(),
    createdAt: createdAt(),
    completedAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    index("agent_action_batches_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("agent_action_batches_branch_idx").on(table.userId, table.branchId),
    check(
      "agent_action_batches_status_check",
      sql`${table.status} in ('open', 'completed', 'failed')`,
    ),
  ],
);

export const agentActions = sqliteTable(
  "agent_actions",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("aact")),
    batchId: text().references(() => agentActionBatches.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    userId: owner(),
    actorKind: text({
      enum: ["embedded-agent", "mcp", "user-undo", "system"],
    }).notNull(),
    actorClientId: text(),
    threadId: text(),
    branchId: text(),
    runId: text(),
    toolCallId: text(),
    domainScopeKind: text(),
    domainScopeId: text(),
    toolId: text().notNull(),
    toolVersion: integer().notNull(),
    effect: text({
      enum: ["read", "create", "update", "delete", "external"],
    }).notNull(),
    risk: text({ enum: ["low", "medium", "high", "irreversible"] }).notNull(),
    argumentsHash: text().notNull(),
    idempotencyKey: text().notNull(),
    actionSequence: integer().notNull(),
    redactedInputJson: text({ mode: "json" }).$type<unknown>().notNull(),
    previewJson: text({ mode: "json" }).$type<unknown>(),
    previewHash: text().notNull(),
    status: text({
      enum: [
        "reserved",
        "awaiting-approval",
        "executing",
        "rejected",
        "expired",
        "completed",
        "failed",
        "inspect-required",
      ],
    })
      .notNull()
      .default("reserved"),
    resultSummaryJson: text({ mode: "json" }).$type<unknown>(),
    modelProjectionJson: text({ mode: "json" }).$type<unknown>(),
    uiProjectionJson: text({ mode: "json" }).$type<unknown>(),
    safeError: text(),
    compensatorId: text(),
    compensationOfActionId: text().references(
      (): ReturnType<typeof text> => agentActions.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    crashRecovery: text({ enum: ["idempotent-retry", "inspect-required"] })
      .notNull()
      .default("inspect-required"),
    startedAt: integer({ mode: "timestamp" }),
    completedAt: integer({ mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("agent_actions_idempotency_unique").on(
      table.userId,
      table.toolId,
      table.toolVersion,
      table.idempotencyKey,
    ),
    uniqueIndex("agent_actions_user_sequence_unique").on(
      table.userId,
      table.actionSequence,
    ),
    index("agent_actions_user_created_idx").on(table.userId, table.createdAt),
    index("agent_actions_thread_idx").on(table.userId, table.threadId),
    index("agent_actions_scope_idx").on(
      table.userId,
      table.domainScopeKind,
      table.domainScopeId,
    ),
    index("agent_actions_compensation_idx").on(
      table.userId,
      table.compensationOfActionId,
    ),
    check("agent_actions_sequence_check", sql`${table.actionSequence} > 0`),
    check("agent_actions_tool_version_check", sql`${table.toolVersion} > 0`),
    check(
      "agent_actions_status_check",
      sql`${table.status} in ('reserved', 'awaiting-approval', 'executing', 'rejected', 'expired', 'completed', 'failed', 'inspect-required')`,
    ),
    check(
      "agent_actions_actor_check",
      sql`${table.actorKind} in ('embedded-agent', 'mcp', 'user-undo', 'system')`,
    ),
  ],
);

export const agentActionResources = sqliteTable(
  "agent_action_resources",
  {
    actionId: text()
      .notNull()
      .references(() => agentActions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    resourceKind: text().notNull(),
    resourceId: text().notNull(),
    operation: text({
      enum: [
        "create",
        "update",
        "trash",
        "restore",
        "delete",
        "attach",
        "detach",
        "external",
      ],
    }).notNull(),
    beforeRevision: text(),
    afterRevision: text(),
    beforeSnapshotJson: text({ mode: "json" }).$type<unknown>(),
    afterSnapshotJson: text({ mode: "json" }).$type<unknown>(),
    contentRefBefore: text(),
    contentRefAfter: text(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.actionId,
        table.resourceKind,
        table.resourceId,
        table.operation,
      ],
    }),
    index("agent_action_resources_lookup_idx").on(
      table.resourceKind,
      table.resourceId,
      table.actionId,
    ),
    check(
      "agent_action_resources_operation_check",
      sql`${table.operation} in ('create', 'update', 'trash', 'restore', 'delete', 'attach', 'detach', 'external')`,
    ),
  ],
);

export const agentApprovals = sqliteTable(
  "agent_approvals",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("aappr")),
    actionId: text()
      .notNull()
      .references(() => agentActions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    state: text({ enum: ["pending", "approved", "rejected", "expired"] })
      .notNull()
      .default("pending"),
    argumentsHash: text().notNull(),
    previewHash: text().notNull(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    resolvedAt: integer({ mode: "timestamp" }),
    resolutionContextJson: text({ mode: "json" }).$type<unknown>(),
    leaseOwner: text(),
    leaseExpiresAt: integer({ mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("agent_approvals_action_unique").on(table.actionId),
    index("agent_approvals_expiry_idx").on(table.state, table.expiresAt),
    check(
      "agent_approvals_state_check",
      sql`${table.state} in ('pending', 'approved', 'rejected', 'expired')`,
    ),
  ],
);

export const agentActionDependencyFences = sqliteTable(
  "agent_action_dependency_fences",
  {
    userId: owner().primaryKey(),
    version: integer().notNull().default(0),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
);

export const agentActionDependencies = sqliteTable(
  "agent_action_dependencies",
  {
    userId: owner(),
    actionId: text()
      .notNull()
      .references(() => agentActions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    dependsOnActionId: text()
      .notNull()
      .references(() => agentActions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    scopeKind: text({ enum: ["branch", "domain"] }).notNull(),
    scopeId: text().notNull(),
    relation: text({ enum: ["resource", "explicit", "saga"] }).notNull(),
    fenceVersion: integer().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.userId,
        table.actionId,
        table.dependsOnActionId,
        table.scopeKind,
        table.scopeId,
      ],
    }),
    index("agent_action_dependencies_reverse_idx").on(
      table.userId,
      table.dependsOnActionId,
    ),
    check(
      "agent_action_dependencies_no_self_check",
      sql`${table.actionId} <> ${table.dependsOnActionId}`,
    ),
    check(
      "agent_action_dependencies_scope_check",
      sql`${table.scopeKind} in ('branch', 'domain')`,
    ),
  ],
);

export const agentActionEvents = sqliteTable(
  "agent_action_events",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("aaevt")),
    actionId: text()
      .notNull()
      .references(() => agentActions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sequence: integer().notNull(),
    eventKey: text().notNull(),
    type: text().notNull(),
    payloadJson: text({ mode: "json" }).$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("agent_action_events_sequence_unique").on(
      table.actionId,
      table.sequence,
    ),
    uniqueIndex("agent_action_events_key_unique").on(
      table.actionId,
      table.eventKey,
    ),
  ],
);
