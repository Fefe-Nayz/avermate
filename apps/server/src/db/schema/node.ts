import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  NodeCapabilityId,
  RemoteDeletionState,
} from "@avermate/agent-contracts";
import { newId } from "../../lib/id";
import { users } from "./auth";

const timestamp = () => integer({ mode: "timestamp" });

export type CoreNodeState = "pairing" | "active" | "offline" | "revoked";
export type NodePairingState =
  | "offered"
  | "claimed"
  | "confirmed"
  | "credentials-ready"
  | "consumed"
  | "expired"
  | "revoked";

export const avermateNodes = sqliteTable(
  "avermate_nodes",
  {
    id: text().primaryKey(),
    protocolMajor: integer().notNull(),
    publicSigningKey: text().notNull(),
    keyId: text().notNull(),
    fingerprint: text().notNull(),
    state: text().$type<CoreNodeState>().notNull().default("pairing"),
    revokedAt: timestamp(),
    createdAt: timestamp().notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp().notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("avermate_nodes_key_id_unique").on(table.keyId),
    uniqueIndex("avermate_nodes_fingerprint_unique").on(table.fingerprint),
    check(
      "avermate_nodes_state_check",
      sql`${table.state} in ('pairing', 'active', 'offline', 'revoked')`,
    ),
    check("avermate_nodes_protocol_check", sql`${table.protocolMajor} = 2`),
  ],
);

export const nodePairingAttempts = sqliteTable(
  "node_pairing_attempts",
  {
    id: text().primaryKey(),
    nodeId: text()
      .notNull()
      .references(() => avermateNodes.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    codeHash: text().notNull(),
    offerJson: text().notNull(),
    registrationProofDigest: text().notNull(),
    manifestDigest: text().notNull(),
    state: text().$type<NodePairingState>().notNull().default("offered"),
    claimedUserId: text().references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    confirmedCapabilitiesJson: text(),
    expiresAt: timestamp().notNull(),
    claimedAt: timestamp(),
    confirmedAt: timestamp(),
    consumedAt: timestamp(),
    createdAt: timestamp().notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp().notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("node_pairing_code_hash_unique").on(table.codeHash),
    index("node_pairing_state_expiry_idx").on(table.state, table.expiresAt),
    index("node_pairing_claimed_user_idx").on(
      table.claimedUserId,
      table.state,
    ),
    check(
      "node_pairing_state_check",
      sql`${table.state} in ('offered', 'claimed', 'confirmed', 'credentials-ready', 'consumed', 'expired', 'revoked')`,
    ),
  ],
);

export const nodeAccountBindings = sqliteTable(
  "node_account_bindings",
  {
    id: text().primaryKey().$defaultFn(() => newId("nbind")),
    nodeId: text()
      .notNull()
      .references(() => avermateNodes.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    pairingAttemptId: text()
      .notNull()
      .references(() => nodePairingAttempts.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    state: text().$type<"active" | "revoked">().notNull().default("active"),
    createdAt: timestamp().notNull().$defaultFn(() => new Date()),
    revokedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("node_account_binding_active_node_unique")
      .on(table.nodeId)
      .where(sql`${table.state} = 'active'`),
    index("node_account_binding_user_state_idx").on(table.userId, table.state),
    check(
      "node_account_binding_state_check",
      sql`${table.state} in ('active', 'revoked')`,
    ),
  ],
);

export type NodeCredentialKind = "relay" | "capability";
export const nodeCredentialGenerations = sqliteTable(
  "node_credential_generations",
  {
    id: text().primaryKey().$defaultFn(() => newId("ncred")),
    nodeId: text()
      .notNull()
      .references(() => avermateNodes.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: text().$type<NodeCredentialKind>().notNull(),
    generation: integer().notNull(),
    credentialHash: text().notNull(),
    sealedCredential: text(),
    activeFrom: timestamp().notNull(),
    expiresAt: timestamp().notNull(),
    overlapUntil: timestamp(),
    deliveredAt: timestamp(),
    revokedAt: timestamp(),
    createdAt: timestamp().notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("node_credential_kind_generation_unique").on(
      table.nodeId,
      table.kind,
      table.generation,
    ),
    uniqueIndex("node_credential_hash_unique").on(table.credentialHash),
    index("node_credential_auth_idx").on(
      table.kind,
      table.credentialHash,
      table.revokedAt,
      table.expiresAt,
    ),
    check(
      "node_credential_kind_check",
      sql`${table.kind} in ('relay', 'capability')`,
    ),
    check("node_credential_generation_check", sql`${table.generation} >= 1`),
  ],
);

export const nodeCapabilityManifests = sqliteTable(
  "node_capability_manifests",
  {
    id: text().primaryKey().$defaultFn(() => newId("nman")),
    nodeId: text()
      .notNull()
      .references(() => avermateNodes.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    configRevision: text().notNull(),
    manifestDigest: text().notNull(),
    manifestJson: text().notNull(),
    issuedAt: timestamp().notNull(),
    expiresAt: timestamp().notNull(),
    verifiedAt: timestamp().notNull(),
    createdAt: timestamp().notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("node_manifest_digest_unique").on(
      table.nodeId,
      table.manifestDigest,
    ),
    index("node_manifest_revision_verified_idx").on(
      table.nodeId,
      table.configRevision,
      table.verifiedAt,
    ),
  ],
);

export const nodeConnectionEpochs = sqliteTable(
  "node_connection_epochs",
  {
    id: text().primaryKey().$defaultFn(() => newId("nepoch")),
    nodeId: text()
      .notNull()
      .references(() => avermateNodes.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    epoch: integer().notNull(),
    relayCredentialGeneration: integer().notNull(),
    manifestDigest: text().notNull(),
    state: text().$type<"connected" | "disconnected" | "fenced">().notNull(),
    connectedAt: timestamp().notNull(),
    lastHeartbeatAt: timestamp().notNull(),
    disconnectedAt: timestamp(),
    safeCloseCode: text(),
  },
  (table) => [
    uniqueIndex("node_connection_epoch_unique").on(table.nodeId, table.epoch),
    uniqueIndex("node_connection_primary_unique")
      .on(table.nodeId)
      .where(sql`${table.state} = 'connected'`),
    index("node_connection_heartbeat_idx").on(
      table.state,
      table.lastHeartbeatAt,
    ),
    check(
      "node_connection_state_check",
      sql`${table.state} in ('connected', 'disconnected', 'fenced')`,
    ),
    check("node_connection_epoch_check", sql`${table.epoch} >= 1`),
  ],
);

export const nodeLifecycleEvents = sqliteTable(
  "node_lifecycle_events",
  {
    id: text().primaryKey().$defaultFn(() => newId("nlife")),
    nodeId: text().notNull(),
    userId: text(),
    eventType: text().notNull(),
    safeMetadataJson: text().notNull().default("{}"),
    occurredAt: timestamp().notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("node_lifecycle_node_time_idx").on(table.nodeId, table.occurredAt),
    index("node_lifecycle_user_time_idx").on(table.userId, table.occurredAt),
  ],
);

export const nodeProofNonces = sqliteTable(
  "node_proof_nonces",
  {
    nodeId: text().notNull(),
    nonce: text().notNull(),
    action: text().notNull(),
    issuedAt: timestamp().notNull(),
    acceptedAt: timestamp().notNull(),
  },
  (table) => [
    uniqueIndex("node_proof_nonce_unique").on(table.nodeId, table.nonce),
    index("node_proof_nonce_accepted_idx").on(table.acceptedAt),
  ],
);

export const nodeCapabilityPlacementRevisions = sqliteTable(
  "node_capability_placement_revisions",
  {
    id: text().primaryKey().$defaultFn(() => newId("nplace")),
    userId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    capability: text().$type<NodeCapabilityId>().notNull(),
    revision: integer().notNull(),
    placementKind: text()
      .$type<"core" | "node" | "managed" | "byok">()
      .notNull(),
    nodeId: text().references(() => avermateNodes.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    providerId: text().notNull(),
    durableData: integer({ mode: "boolean" }).notNull(),
    consequencesJson: text().notNull(),
    migrationState: text()
      .$type<"not-required" | "planned" | "running" | "verified" | "failed">()
      .notNull(),
    createdAt: timestamp().notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("node_placement_user_cap_revision_unique").on(
      table.userId,
      table.capability,
      table.revision,
    ),
    index("node_placement_current_idx").on(
      table.userId,
      table.capability,
      table.revision,
    ),
    check(
      "node_placement_kind_check",
      sql`${table.placementKind} in ('core', 'node', 'managed', 'byok')`,
    ),
    check("node_placement_revision_check", sql`${table.revision} >= 1`),
  ],
);

export const nodeRelayOperations = sqliteTable(
  "node_relay_operations",
  {
    id: text().primaryKey(),
    nodeId: text()
      .notNull()
      .references(() => avermateNodes.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    capability: text().$type<NodeCapabilityId>().notNull(),
    configRevision: text().notNull(),
    requestDigest: text().notNull(),
    state: text()
      .$type<"offered" | "running" | "cancel-requested" | "completed" | "failed">()
      .notNull(),
    lastSequence: integer().notNull().default(0),
    acknowledgedSequence: integer().notNull().default(0),
    deadline: timestamp().notNull(),
    createdAt: timestamp().notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp().notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("node_relay_operation_node_state_idx").on(table.nodeId, table.state),
    check(
      "node_relay_operation_state_check",
      sql`${table.state} in ('offered', 'running', 'cancel-requested', 'completed', 'failed')`,
    ),
    check(
      "node_relay_operation_sequence_check",
      sql`${table.lastSequence} >= 0 and ${table.acknowledgedSequence} >= 0 and ${table.acknowledgedSequence} <= ${table.lastSequence}`,
    ),
  ],
);

export const nodeRuntimeCheckpoints = sqliteTable(
  "node_runtime_checkpoints",
  {
    id: text().primaryKey().$defaultFn(() => newId("nrchk")),
    userId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    nodeId: text()
      .notNull()
      .references(() => avermateNodes.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceSnapshotId: text().notNull(),
    // Provider-native runtime state is an optional accelerator and is never
    // keyed by, embedded in, or treated as a conversation checkpoint.
    checkpointRefJson: text().notNull(),
    provider: text().notNull(),
    opaqueProviderRef: text().notNull(),
    region: text().notNull(),
    architecture: text().notNull(),
    runtimeKind: text().notNull(),
    runtimeVersion: text().notNull(),
    imageDigest: text().notNull(),
    profileId: text().notNull(),
    profileVersion: text().notNull(),
    sourceWorkspaceSnapshotJson: text().notNull(),
    captureState: text().$type<"captured" | "adopted" | "failed" | "deleted">().notNull(),
    adoptedObjectRefsJson: text().notNull().default("[]"),
    capturedAt: timestamp().notNull(),
    expiresAt: timestamp().notNull(),
    deletedAt: timestamp(),
    safeErrorCode: text(),
    createdAt: timestamp().notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp().notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("node_runtime_checkpoint_provider_ref_unique").on(
      table.provider,
      table.opaqueProviderRef,
    ),
    index("node_runtime_checkpoint_expiry_idx").on(
      table.captureState,
      table.expiresAt,
    ),
    index("node_runtime_checkpoint_workspace_idx").on(
      table.userId,
      table.workspaceSnapshotId,
    ),
    check(
      "node_runtime_checkpoint_state_check",
      sql`${table.captureState} in ('captured', 'adopted', 'failed', 'deleted')`,
    ),
  ],
);

export const nodeObjectAdoptions = sqliteTable(
  "node_object_adoptions",
  {
    id: text().primaryKey(),
    providerId: text().notNull(),
    ownerId: text().notNull(),
    namespace: text().notNull(),
    objectKey: text().notNull(),
    byteSize: integer().notNull(),
    mimeType: text().notNull(),
    expectedDigest: text().notNull(),
    idempotencyKey: text().notNull(),
    state: text()
      .$type<"reserved" | "object_committed" | "adopted" | "needs_operator">()
      .notNull(),
    objectMetadataJson: text(),
    canonicalRecordId: text(),
    safeErrorCode: text(),
    createdAt: timestamp().notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp().notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("node_object_adoption_idempotency_unique").on(
      table.ownerId,
      table.providerId,
      table.idempotencyKey,
    ),
    index("node_object_adoption_pending_idx").on(table.state, table.updatedAt),
    check(
      "node_object_adoption_state_check",
      sql`${table.state} in ('reserved', 'object_committed', 'adopted', 'needs_operator')`,
    ),
  ],
);

export const nodeRemoteDeletions = sqliteTable(
  "node_remote_deletions",
  {
    manifestDigest: text().primaryKey(),
    nodeId: text().notNull(),
    userId: text().notNull(),
    manifestJson: text().notNull(),
    state: text().$type<RemoteDeletionState>().notNull(),
    receiptJson: text(),
    acceptedReceiptDigest: text(),
    safeOperatorInstruction: text(),
    createdAt: timestamp().notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp().notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("node_remote_deletion_pending_idx").on(table.nodeId, table.state),
    check(
      "node_remote_deletion_state_check",
      sql`${table.state} in ('pending_remote_deletion', 'verified_deleted', 'revoked_unreachable', 'user_action_required')`,
    ),
  ],
);

export const nodeRemoteDeletionRefs = sqliteTable(
  "node_remote_deletion_refs",
  {
    manifestDigest: text()
      .notNull()
      .references(() => nodeRemoteDeletions.manifestDigest, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    ownerId: text().notNull(),
    namespace: text().notNull(),
    objectKey: text().notNull(),
  },
  (table) => [
    uniqueIndex("node_remote_deletion_ref_unique").on(
      table.manifestDigest,
      table.ownerId,
      table.namespace,
      table.objectKey,
    ),
    index("node_remote_deletion_tombstone_idx").on(
      table.ownerId,
      table.namespace,
      table.objectKey,
    ),
  ],
);
