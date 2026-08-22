import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { SandboxProfileId } from "@avermate/agent-contracts";
import { newId } from "../../lib/id";
import { users } from "./auth";
import {
  assistantBranches,
  assistantConversationCheckpoints,
  assistantThreads,
} from "./assistant";

export type WorkspaceSnapshotState = "pending" | "committed" | "failed";
export type WorkspaceSnapshotOutboxKind =
  "capture" | "adopt" | "publish" | "gc";
export type WorkspaceSnapshotOutboxState =
  "pending" | "leased" | "completed" | "failed";

const timestamp = () => integer({ mode: "timestamp" });

export const workspaceSnapshots = sqliteTable(
  "workspace_snapshots",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("wsnp")),
    userId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
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
    sequence: integer().notNull(),
    requestId: text().notNull(),
    conversationCheckpointRef: text()
      .notNull()
      .references(() => assistantConversationCheckpoints.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    parentWorkspaceSnapshotRefJson: text(),
    imageTemplateRefJson: text().notNull(),
    imageDigest: text().notNull(),
    executionProfileId: text().$type<SandboxProfileId>().notNull(),
    executionProfileVersion: text().notNull(),
    state: text().$type<WorkspaceSnapshotState>().notNull().default("pending"),
    workspaceSnapshotRefJson: text(),
    sandboxRuntimeCheckpointRefJson: text(),
    trustedObjectRef: text(),
    portableManifestDigest: text(),
    byteSize: integer(),
    fileCount: integer(),
    capturedProviderRefJson: text(),
    capturedTrustedObjectRef: text(),
    capturedManifestDigest: text(),
    capturedByteSize: integer(),
    capturedFileCount: integer(),
    safeError: text(),
    createdAt: timestamp()
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp()
      .notNull()
      .$defaultFn(() => new Date()),
    committedAt: timestamp(),
    failedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("workspace_snapshots_user_request_unique").on(
      table.userId,
      table.requestId,
    ),
    uniqueIndex("workspace_snapshots_branch_sequence_unique").on(
      table.userId,
      table.branchId,
      table.sequence,
    ),
    uniqueIndex("workspace_snapshots_branch_checkpoint_committed_unique")
      .on(table.userId, table.branchId, table.conversationCheckpointRef)
      .where(sql`${table.state} = 'committed'`),
    index("workspace_snapshots_compatible_idx").on(
      table.userId,
      table.threadId,
      table.branchId,
      table.executionProfileId,
      table.executionProfileVersion,
      table.imageDigest,
      table.sequence,
    ),
    check(
      "workspace_snapshots_state_check",
      sql`${table.state} in ('pending', 'committed', 'failed')`,
    ),
    check("workspace_snapshots_sequence_check", sql`${table.sequence} >= 1`),
    check(
      "workspace_snapshots_sizes_check",
      sql`(${table.byteSize} is null or ${table.byteSize} >= 0) and (${table.fileCount} is null or ${table.fileCount} >= 0) and (${table.capturedByteSize} is null or ${table.capturedByteSize} >= 0) and (${table.capturedFileCount} is null or ${table.capturedFileCount} >= 0)`,
    ),
    check(
      "workspace_snapshots_terminal_shape_check",
      sql`(${table.state} = 'pending' and ${table.committedAt} is null and ${table.failedAt} is null) or (${table.state} = 'committed' and ${table.workspaceSnapshotRefJson} is not null and ${table.trustedObjectRef} is not null and ${table.portableManifestDigest} is not null and ${table.committedAt} is not null and ${table.failedAt} is null) or (${table.state} = 'failed' and ${table.failedAt} is not null and ${table.committedAt} is null)`,
    ),
  ],
);

export const workspaceSnapshotOutbox = sqliteTable(
  "workspace_snapshot_outbox",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("wsob")),
    workspaceSnapshotId: text()
      .notNull()
      .references(() => workspaceSnapshots.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: text().$type<WorkspaceSnapshotOutboxKind>().notNull(),
    state: text()
      .$type<WorkspaceSnapshotOutboxState>()
      .notNull()
      .default("pending"),
    attempt: integer().notNull().default(0),
    availableAt: timestamp()
      .notNull()
      .$defaultFn(() => new Date()),
    leaseOwner: text(),
    leaseExpiresAt: timestamp(),
    payloadDigest: text().notNull(),
    safeError: text(),
    createdAt: timestamp()
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp()
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: timestamp(),
  },
  (table) => [
    uniqueIndex("workspace_snapshot_outbox_record_kind_unique").on(
      table.workspaceSnapshotId,
      table.kind,
    ),
    index("workspace_snapshot_outbox_ready_idx").on(
      table.state,
      table.availableAt,
      table.leaseExpiresAt,
    ),
    check(
      "workspace_snapshot_outbox_state_check",
      sql`${table.state} in ('pending', 'leased', 'completed', 'failed')`,
    ),
    check(
      "workspace_snapshot_outbox_kind_check",
      sql`${table.kind} in ('capture', 'adopt', 'publish', 'gc')`,
    ),
    check(
      "workspace_snapshot_outbox_attempt_check",
      sql`${table.attempt} >= 0`,
    ),
  ],
);
