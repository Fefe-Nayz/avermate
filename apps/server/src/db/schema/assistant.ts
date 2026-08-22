import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type {
  AgentTerminalReason,
  AssistantAttachmentKind,
  AssistantAuthorship,
  AssistantMessageStatus,
  AssistantPartV1,
  AssistantRole,
  AssistantRunStatus,
  AssistantRunModelPolicy,
  ModelPlacement,
  ProviderDispatchClaimState,
} from "@avermate/agent-contracts";
import { newId } from "../../lib/id";
import { users } from "./auth";
import {
  contentChunks,
  contentVersionReferences,
  contentVersions,
  studyProjects,
} from "./corpus";
import { files } from "./files";

export type AssistantThreadPlacement = "core" | "node";
export type AssistantCheckpointStatus = "staging" | "committed" | "failed";
export type AssistantOutboxState =
  "pending" | "leased" | "published" | "failed";
export type AssistantOutboxKind =
  "event" | "terminal" | "checkpoint-committed" | "checkpoint-gc";
export type AssistantRunLeaseState =
  | "active"
  | "released"
  | "expired"
  | "fenced";

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

/** Canonical conversation directory for core placement. */
export const assistantThreads = sqliteTable(
  "assistant_threads",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("athr")),
    userId: owner(),
    title: text().notNull(),
    revision: integer().notNull().default(1),
    activeBranchId: text(),
    projectId: text().references(() => studyProjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    placement: text()
      .$type<AssistantThreadPlacement>()
      .notNull()
      .default("core"),
    placementRef: text(),
    starredAt: integer({ mode: "timestamp" }),
    archivedAt: integer({ mode: "timestamp" }),
    deletedAt: integer({ mode: "timestamp" }),
    purgeAfter: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    index("assistant_threads_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
    index("assistant_threads_user_deleted_idx").on(
      table.userId,
      table.deletedAt,
    ),
    check(
      "assistant_threads_placement_check",
      sql`${table.placement} in ('core', 'node')`,
    ),
    check(
      "assistant_threads_placement_ref_check",
      sql`(${table.placement} = 'core' and ${table.placementRef} is null) or (${table.placement} = 'node' and ${table.placementRef} is not null)`,
    ),
    check("assistant_threads_revision_check", sql`${table.revision} >= 1`),
  ],
);

/** User-owned routing policy. It never contains credentials or provider URLs. */
export const assistantModelPreferences = sqliteTable(
  "assistant_model_preferences",
  {
    userId: owner().primaryKey(),
    defaultModelKey: text(),
    route: text().notNull().default("selected-only"),
    fallback: text().notNull().default("none"),
    maximumInputTokens: integer(),
    maximumOutputTokens: integer(),
    maximumEstimatedCostMinor: integer(),
    currency: text(),
    revision: integer().notNull().default(1),
    ...timestamps,
  },
  (table) => [
    check(
      "assistant_model_preferences_route_check",
      sql`${table.route} in ('selected-only', 'prefer-node', 'prefer-core', 'managed-only')`,
    ),
    check(
      "assistant_model_preferences_fallback_check",
      sql`${table.fallback} in ('none', 'same-provider', 'configured-routes')`,
    ),
    check(
      "assistant_model_preferences_budget_check",
      sql`(${table.maximumInputTokens} is null or ${table.maximumInputTokens} > 0)
        and (${table.maximumOutputTokens} is null or ${table.maximumOutputTokens} > 0)
        and (${table.maximumEstimatedCostMinor} is null or ${table.maximumEstimatedCostMinor} >= 0)`,
    ),
    check(
      "assistant_model_preferences_currency_check",
      sql`${table.currency} is null or length(${table.currency}) = 3`,
    ),
    check(
      "assistant_model_preferences_revision_check",
      sql`${table.revision} > 0`,
    ),
  ],
);

export const assistantBranches = sqliteTable(
  "assistant_branches",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("abrn")),
    threadId: text()
      .notNull()
      .references(() => assistantThreads.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text(),
    forkedFromMessageId: text(),
    headMessageId: text(),
    ...timestamps,
  },
  (table) => [
    index("assistant_branches_thread_idx").on(table.threadId, table.updatedAt),
    uniqueIndex("assistant_branches_thread_id_unique").on(
      table.threadId,
      table.id,
    ),
  ],
);

export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("amsg")),
    threadId: text()
      .notNull()
      .references(() => assistantThreads.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    parentMessageId: text().references(
      (): AnySQLiteColumn => assistantMessages.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    role: text().$type<AssistantRole>().notNull(),
    authorship: text().$type<AssistantAuthorship>().notNull(),
    status: text().$type<AssistantMessageStatus>().notNull(),
    partsVersion: integer().notNull().default(1),
    partsJson: text({ mode: "json" }).$type<AssistantPartV1[]>().notNull(),
    createdByRunId: text(),
    replacesMessageId: text().references(
      (): AnySQLiteColumn => assistantMessages.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("assistant_messages_thread_parent_idx").on(
      table.threadId,
      table.parentMessageId,
      table.createdAt,
    ),
    uniqueIndex("assistant_messages_thread_id_unique").on(
      table.threadId,
      table.id,
    ),
    check(
      "assistant_messages_role_check",
      sql`${table.role} in ('user', 'assistant', 'system', 'tool')`,
    ),
    check(
      "assistant_messages_authorship_check",
      sql`${table.authorship} in ('user', 'model', 'user-edited-model', 'application')`,
    ),
    check(
      "assistant_messages_status_check",
      sql`${table.status} in ('pending', 'streaming', 'complete', 'failed', 'cancelled')`,
    ),
    check(
      "assistant_messages_parts_version_check",
      sql`${table.partsVersion} > 0`,
    ),
  ],
);

export const assistantRuns = sqliteTable(
  "assistant_runs",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("arun")),
    userId: owner(),
    threadId: text()
      .notNull()
      .references(() => assistantThreads.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    branchId: text()
      .notNull()
      .references(() => assistantBranches.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    inputMessageId: text()
      .notNull()
      .references(() => assistantMessages.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    outputMessageId: text().references(() => assistantMessages.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    reservedOutputMessageId: text().notNull(),
    parentRunId: text().references((): AnySQLiteColumn => assistantRuns.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    clientRequestId: text().notNull(),
    runtimeId: text().notNull(),
    runtimeVersion: text().notNull(),
    runtimeProtocolVersion: integer().notNull().default(1),
    graphSchemaVersion: integer().notNull(),
    modelKey: text().notNull(),
    modelRevision: text().notNull().default("legacy/1"),
    providerKey: text().notNull(),
    providerRevision: text().notNull().default("legacy/1"),
    modelPlacementJson: text({ mode: "json" })
      .$type<ModelPlacement>()
      .notNull()
      .default({ kind: "core", instanceId: "legacy" }),
    policyRevision: text().notNull().default("assistant-policy/1"),
    modelPolicyJson: text({ mode: "json" })
      .$type<AssistantRunModelPolicy>(),
    toolCatalogRevision: text().notNull().default("legacy/1"),
    contextManifestDigest: text(),
    branchIdentityDigest: text(),
    modelResolvedId: text(),
    status: text().$type<AssistantRunStatus>().notNull().default("reserved"),
    approvalMode: text().notNull().default("read-only"),
    providerRequestKey: text(),
    providerDispatchState: text().notNull().default("pending"),
    contextManifestId: text(),
    conversationCheckpointRef: text(),
    workspaceSnapshotRef: text(),
    sandboxRuntimeCheckpointRef: text(),
    domainCursorRef: text(),
    startedAt: integer({ mode: "timestamp" }),
    completedAt: integer({ mode: "timestamp" }),
    cancellationRequestedAt: integer({ mode: "timestamp" }),
    cancellationReason: text(),
    terminalReason: text().$type<AgentTerminalReason>(),
    errorCode: text(),
    safeError: text(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("assistant_runs_thread_client_request_unique").on(
      table.threadId,
      table.clientRequestId,
    ),
    uniqueIndex("assistant_runs_output_message_unique").on(
      table.outputMessageId,
    ),
    uniqueIndex("assistant_runs_reserved_output_unique").on(
      table.reservedOutputMessageId,
    ),
    uniqueIndex("assistant_runs_branch_active_unique")
      .on(table.branchId)
      .where(
        sql`${table.status} in ('reserved', 'running', 'waiting-for-user', 'waiting-approval', 'cancelling')`,
      ),
    index("assistant_runs_thread_created_idx").on(
      table.threadId,
      table.createdAt,
    ),
    uniqueIndex("assistant_runs_thread_id_unique").on(table.threadId, table.id),
    check(
      "assistant_runs_status_check",
      sql`${table.status} in ('reserved', 'running', 'waiting-for-user', 'waiting-approval', 'cancelling', 'complete', 'failed', 'cancelled')`,
    ),
    check(
      "assistant_runs_approval_mode_check",
      sql`${table.approvalMode} in ('read-only', 'confirm-writes', 'auto-reversible')`,
    ),
    check(
      "assistant_runs_dispatch_state_check",
      sql`${table.providerDispatchState} in ('pending', 'dispatching', 'acknowledged', 'completed', 'failed', 'cancelled', 'inspect-required')`,
    ),
    check(
      "assistant_runs_runtime_protocol_check",
      sql`${table.runtimeProtocolVersion} = 1`,
    ),
  ],
);

/**
 * Durable worker ownership for a run. Fencing tokens increase monotonically per
 * run; a stale worker cannot renew or release a newer lease.
 */
export const assistantRunLeases = sqliteTable(
  "assistant_run_leases",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("arle")),
    userId: owner(),
    runId: text()
      .notNull()
      .references(() => assistantRuns.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workerId: text().notNull(),
    fencingToken: integer().notNull(),
    state: text().$type<AssistantRunLeaseState>().notNull().default("active"),
    acquiredAt: integer({ mode: "timestamp" }).notNull(),
    heartbeatAt: integer({ mode: "timestamp" }).notNull(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    releasedAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("assistant_run_leases_run_token_unique").on(
      table.runId,
      table.fencingToken,
    ),
    uniqueIndex("assistant_run_leases_run_active_unique")
      .on(table.runId)
      .where(sql`${table.state} = 'active'`),
    index("assistant_run_leases_expiry_idx").on(table.state, table.expiresAt),
    check(
      "assistant_run_leases_state_check",
      sql`${table.state} in ('active', 'released', 'expired', 'fenced')`,
    ),
    check(
      "assistant_run_leases_fencing_token_check",
      sql`${table.fencingToken} > 0`,
    ),
  ],
);

/**
 * One immutable provider request claim per model attempt. A round can therefore
 * retain distinct, auditable claims for a bounded fallback without storing any
 * prompt, credential, response body, or hidden reasoning.
 */
export const assistantProviderDispatchClaims = sqliteTable(
  "assistant_provider_dispatch_claims",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("apdc")),
    userId: owner(),
    runId: text()
      .notNull()
      .references(() => assistantRuns.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    dispatchKey: text().notNull(),
    requestDigest: text().notNull(),
    providerKey: text().notNull(),
    providerRevision: text().notNull(),
    modelKey: text().notNull(),
    modelRevision: text().notNull(),
    placementJson: text({ mode: "json" }).$type<ModelPlacement>().notNull(),
    providerSupportsStableRequestKey: integer({ mode: "boolean" })
      .notNull()
      .default(false),
    stableRequestKey: text(),
    state: text()
      .$type<ProviderDispatchClaimState>()
      .notNull()
      .default("claimed"),
    inspectReason: text(),
    claimedAt: integer({ mode: "timestamp" }).notNull(),
    dispatchStartedAt: integer({ mode: "timestamp" }),
    acknowledgedAt: integer({ mode: "timestamp" }),
    completedAt: integer({ mode: "timestamp" }),
    updatedAt: integer({ mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("assistant_provider_claims_run_dispatch_unique").on(
      table.userId,
      table.runId,
      table.dispatchKey,
    ),
    index("assistant_provider_claims_reconcile_idx").on(
      table.state,
      table.updatedAt,
    ),
    check(
      "assistant_provider_claims_state_check",
      sql`${table.state} in ('claimed', 'dispatching', 'acknowledged', 'completed', 'failed', 'cancelled', 'inspect-required')`,
    ),
    check(
      "assistant_provider_claims_request_digest_check",
      sql`length(${table.requestDigest}) = 64 and ${table.requestDigest} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "assistant_provider_claims_stable_key_check",
      sql`(${table.providerSupportsStableRequestKey} = 0 and ${table.stableRequestKey} is null) or (${table.providerSupportsStableRequestKey} = 1 and ${table.stableRequestKey} is not null)`,
    ),
  ],
);

export const assistantRunEvents = sqliteTable(
  "assistant_run_events",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("aevt")),
    runId: text()
      .notNull()
      .references(() => assistantRuns.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sequence: integer().notNull(),
    eventId: text().notNull(),
    type: text().notNull(),
    payloadJson: text({ mode: "json" }).$type<unknown>().notNull(),
    terminal: integer({ mode: "boolean" }).notNull().default(false),
    emittedAt: integer({ mode: "timestamp" }).notNull(),
    persistedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("assistant_run_events_sequence_unique").on(
      table.runId,
      table.sequence,
    ),
    uniqueIndex("assistant_run_events_event_unique").on(
      table.runId,
      table.eventId,
    ),
    index("assistant_run_events_replay_idx").on(table.runId, table.sequence),
    check("assistant_run_events_sequence_check", sql`${table.sequence} > 0`),
  ],
);

export const assistantContextManifests = sqliteTable(
  "assistant_context_manifests",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("acmf")),
    runId: text()
      .notNull()
      .references(() => assistantRuns.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    version: integer().notNull().default(1),
    revision: integer().notNull(),
    budgetJson: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    itemsJson: text({ mode: "json" }).$type<unknown[]>().notNull(),
    digest: text().notNull(),
    committedAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("assistant_context_manifests_revision_unique").on(
      table.runId,
      table.revision,
    ),
    uniqueIndex("assistant_context_manifests_run_id_unique").on(
      table.runId,
      table.id,
    ),
    check(
      "assistant_context_manifests_version_check",
      sql`${table.version} > 0`,
    ),
    check(
      "assistant_context_manifests_revision_check",
      sql`${table.revision} > 0`,
    ),
  ],
);

export const assistantContextProofHandles = sqliteTable(
  "assistant_context_proof_handles",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("aprf")),
    contextManifestId: text()
      .notNull()
      .references(() => assistantContextManifests.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    runId: text()
      .notNull()
      .references(() => assistantRuns.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    ordinal: integer().notNull(),
    contentVersionReferenceId: text()
      .notNull()
      .references(() => contentVersionReferences.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    sourceVersionId: text()
      .notNull()
      .references(() => contentVersions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    chunkId: text().references(() => contentChunks.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    locatorSchemaVersion: integer().notNull().default(1),
    locatorJson: text({ mode: "json" }).$type<unknown>().notNull(),
    evidenceDigest: text().notNull(),
    quotedContentHash: text(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("assistant_proof_handles_run_id_unique").on(
      table.runId,
      table.id,
    ),
    uniqueIndex("assistant_proof_handles_manifest_ordinal_unique").on(
      table.contextManifestId,
      table.ordinal,
    ),
    uniqueIndex("assistant_proof_handles_run_proof_unique").on(
      table.runId,
      table.id,
    ),
    index("assistant_proof_handles_reference_idx").on(
      table.contentVersionReferenceId,
    ),
    check("assistant_proof_handles_ordinal_check", sql`${table.ordinal} >= 0`),
  ],
);

export const assistantCitations = sqliteTable(
  "assistant_citations",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("acit")),
    messageId: text()
      .notNull()
      .references(() => assistantMessages.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    runId: text()
      .notNull()
      .references(() => assistantRuns.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    ordinal: integer().notNull(),
    proofHandleId: text()
      .notNull()
      .references(() => assistantContextProofHandles.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    claimPartId: text(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("assistant_citations_message_ordinal_unique").on(
      table.messageId,
      table.ordinal,
    ),
    index("assistant_citations_proof_idx").on(table.proofHandleId),
    check("assistant_citations_ordinal_check", sql`${table.ordinal} >= 0`),
  ],
);

export const assistantUsage = sqliteTable(
  "assistant_usage",
  {
    runId: text()
      .notNull()
      .primaryKey()
      .references(() => assistantRuns.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    providerKey: text().notNull(),
    providerRevision: text().notNull().default("legacy/1"),
    modelKey: text().notNull(),
    modelRevision: text().notNull().default("legacy/1"),
    usageVersion: integer().notNull().default(1),
    source: text().notNull().default("unknown"),
    pricingSnapshotId: text(),
    inputTokens: integer(),
    outputTokens: integer(),
    reasoningTokens: integer(),
    cachedReadTokens: integer(),
    cachedWriteTokens: integer(),
    estimatedCost: text(),
    currency: text(),
    final: integer({ mode: "boolean" }).notNull().default(false),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check("assistant_usage_version_check", sql`${table.usageVersion} = 1`),
    check(
      "assistant_usage_source_check",
      sql`${table.source} in ('provider', 'estimated', 'unknown')`,
    ),
    check(
      "assistant_usage_nonnegative_check",
      sql`coalesce(${table.inputTokens}, 0) >= 0 and coalesce(${table.outputTokens}, 0) >= 0 and coalesce(${table.reasoningTokens}, 0) >= 0 and coalesce(${table.cachedReadTokens}, 0) >= 0 and coalesce(${table.cachedWriteTokens}, 0) >= 0`,
    ),
  ],
);

export const assistantAttachments = sqliteTable(
  "assistant_attachments",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("aatt")),
    messageId: text()
      .notNull()
      .references(() => assistantMessages.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: text().$type<AssistantAttachmentKind>().notNull(),
    referenceId: text().notNull(),
    snapshotVersion: text(),
    label: text().notNull(),
    fileId: text().references(() => files.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("assistant_attachments_message_reference_unique").on(
      table.messageId,
      table.kind,
      table.referenceId,
    ),
    index("assistant_attachments_file_idx").on(table.fileId),
  ],
);

export const assistantConversationCheckpoints = sqliteTable(
  "assistant_conversation_checkpoints",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ackp")),
    userId: owner(),
    threadId: text()
      .notNull()
      .references(() => assistantThreads.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    branchId: text()
      .notNull()
      .references(() => assistantBranches.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    runId: text()
      .notNull()
      .references(() => assistantRuns.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    inputMessageId: text()
      .notNull()
      .references(() => assistantMessages.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    outputMessageId: text().references(() => assistantMessages.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    parentCheckpointId: text().references(
      (): AnySQLiteColumn => assistantConversationCheckpoints.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    appendKey: text().notNull(),
    afterEventSequence: integer().notNull(),
    runtimeId: text().notNull(),
    runtimeVersion: text().notNull(),
    graphSchemaVersion: integer().notNull(),
    stateDigest: text().notNull(),
    stateByteLength: integer().notNull(),
    temporaryBlobRef: text(),
    stateBlobRef: text(),
    status: text()
      .$type<AssistantCheckpointStatus>()
      .notNull()
      .default("staging"),
    failureCode: text(),
    committedAt: integer({ mode: "timestamp" }),
    gcMarkedAt: integer({ mode: "timestamp" }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("assistant_checkpoints_user_append_unique").on(
      table.userId,
      table.appendKey,
    ),
    uniqueIndex("assistant_checkpoints_run_event_unique")
      .on(table.runId, table.afterEventSequence)
      .where(sql`${table.status} = 'committed'`),
    index("assistant_checkpoints_branch_created_idx").on(
      table.branchId,
      table.createdAt,
    ),
    check(
      "assistant_checkpoints_status_check",
      sql`${table.status} in ('staging', 'committed', 'failed')`,
    ),
    check(
      "assistant_checkpoints_sequence_check",
      sql`${table.afterEventSequence} >= 0`,
    ),
    check(
      "assistant_checkpoints_length_check",
      sql`${table.stateByteLength} >= 0`,
    ),
  ],
);

export const assistantOutbox = sqliteTable(
  "assistant_outbox",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("aout")),
    userId: owner(),
    runId: text().references(() => assistantRuns.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    checkpointId: text().references(() => assistantConversationCheckpoints.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    eventId: text(),
    kind: text().$type<AssistantOutboxKind>().notNull(),
    state: text().$type<AssistantOutboxState>().notNull().default("pending"),
    attempt: integer().notNull().default(0),
    availableAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    leaseOwner: text(),
    leaseExpiresAt: integer({ mode: "timestamp" }),
    payloadDigest: text().notNull(),
    safeError: text(),
    publishedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("assistant_outbox_event_unique")
      .on(table.eventId)
      .where(sql`${table.eventId} is not null`),
    index("assistant_outbox_ready_idx").on(
      table.state,
      table.availableAt,
      table.leaseExpiresAt,
    ),
    check(
      "assistant_outbox_state_check",
      sql`${table.state} in ('pending', 'leased', 'published', 'failed')`,
    ),
  ],
);
