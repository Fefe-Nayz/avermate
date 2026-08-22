import type { Client, InValue, Transaction } from "@libsql/client";
import {
  sandboxRuntimeCheckpointRefV1Schema,
  sandboxWorkspaceSnapshotRefSchema,
  type SandboxRuntimeCheckpointRefV1,
} from "@avermate/agent-contracts";
import { canonicalJson } from "../search/values";

export type NodeRuntimeCheckpointState =
  "captured" | "adopted" | "failed" | "deleted";

export type NodeRuntimeCheckpointRecord = {
  id: string;
  ownerId: string;
  nodeId: string;
  workspaceSnapshotId: string;
  checkpoint: SandboxRuntimeCheckpointRefV1;
  state: NodeRuntimeCheckpointState;
  safeErrorCode: string | null;
  deletedAt: string | null;
};

type RuntimeCheckpointSqlClient = Pick<Client, "execute" | "transaction">;
type SqlTarget = Pick<Client, "execute"> | Transaction;
type Row = Record<string, InValue>;

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function iso(value: InValue) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error("NODE_RUNTIME_CHECKPOINT_TIMESTAMP_INVALID");
  }
  return new Date(numeric * 1_000).toISOString();
}

function parseCheckpoint(value: InValue) {
  if (typeof value !== "string") {
    throw new Error("NODE_RUNTIME_CHECKPOINT_LEDGER_INVALID");
  }
  try {
    return sandboxRuntimeCheckpointRefV1Schema.parse(JSON.parse(value));
  } catch {
    throw new Error("NODE_RUNTIME_CHECKPOINT_LEDGER_INVALID");
  }
}

function record(row: Row): NodeRuntimeCheckpointRecord {
  const checkpoint = parseCheckpoint(row.checkpointRefJson);
  const compatibility = checkpoint.compatibility;
  const state = String(row.captureState) as NodeRuntimeCheckpointState;
  if (
    !(["captured", "adopted", "failed", "deleted"] as const).includes(state)
  ) {
    throw new Error("NODE_RUNTIME_CHECKPOINT_STATE_INVALID");
  }
  const adoptedRefs = (() => {
    if (typeof row.adoptedObjectRefsJson !== "string") {
      throw new Error("NODE_RUNTIME_CHECKPOINT_LEDGER_INVALID");
    }
    try {
      const refs = JSON.parse(row.adoptedObjectRefsJson) as unknown;
      if (
        !Array.isArray(refs) ||
        refs.some((item) => typeof item !== "string")
      ) {
        throw new Error();
      }
      return refs;
    } catch {
      throw new Error("NODE_RUNTIME_CHECKPOINT_LEDGER_INVALID");
    }
  })();
  if (
    checkpoint.checkpoint.provider !== String(row.provider) ||
    checkpoint.checkpoint.opaqueRef !== String(row.opaqueProviderRef) ||
    compatibility.region !== String(row.region) ||
    compatibility.architecture !== String(row.architecture) ||
    compatibility.runtimeKind !== String(row.runtimeKind) ||
    compatibility.runtimeVersion !== String(row.runtimeVersion) ||
    compatibility.imageDigest !== String(row.imageDigest) ||
    compatibility.profileId !== String(row.profileId) ||
    compatibility.profileVersion !== String(row.profileVersion) ||
    canonicalJson(checkpoint.sourceWorkspaceSnapshot) !==
      String(row.sourceWorkspaceSnapshotJson) ||
    checkpoint.capturedAt !== iso(row.capturedAt) ||
    checkpoint.expiresAt !== iso(row.expiresAt) ||
    canonicalJson(checkpoint.adoptedObjectRefs) !== canonicalJson(adoptedRefs)
  ) {
    throw new Error("NODE_RUNTIME_CHECKPOINT_LEDGER_MISMATCH");
  }
  if (state === "captured" && checkpoint.captureState !== "captured") {
    throw new Error("NODE_RUNTIME_CHECKPOINT_LEDGER_MISMATCH");
  }
  if (state === "adopted" && checkpoint.captureState !== "adopted") {
    throw new Error("NODE_RUNTIME_CHECKPOINT_LEDGER_MISMATCH");
  }
  if (state === "failed" && row.safeErrorCode === null) {
    throw new Error("NODE_RUNTIME_CHECKPOINT_FAILURE_INCOMPLETE");
  }
  if ((state === "deleted") !== (row.deletedAt !== null)) {
    throw new Error("NODE_RUNTIME_CHECKPOINT_DELETION_INCOMPLETE");
  }
  return {
    id: String(row.id),
    ownerId: String(row.userId),
    nodeId: String(row.nodeId),
    workspaceSnapshotId: String(row.workspaceSnapshotId),
    checkpoint,
    state,
    safeErrorCode:
      row.safeErrorCode === null ? null : String(row.safeErrorCode),
    deletedAt: row.deletedAt === null ? null : iso(row.deletedAt),
  };
}

async function rowById(target: SqlTarget, id: string) {
  const result = await target.execute({
    sql: "SELECT * FROM node_runtime_checkpoints WHERE id = ? LIMIT 1",
    args: [id],
  });
  return (result.rows[0] as Row | undefined) ?? null;
}

function assertId(id: string) {
  if (!id || id.length > 256) {
    throw new Error("NODE_RUNTIME_CHECKPOINT_ID_INVALID");
  }
}

function assertErrorCode(value: string) {
  const code = value.trim();
  if (!/^[A-Z0-9_:-]{3,128}$/u.test(code)) {
    throw new Error("NODE_RUNTIME_CHECKPOINT_ERROR_CODE_INVALID");
  }
  return code;
}

/** Durable metadata authority for provider-native Node runtime accelerators. */
export class CoreNodeRuntimeCheckpointRepository {
  constructor(
    private readonly client: RuntimeCheckpointSqlClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async recordCaptured(input: {
    id: string;
    ownerId: string;
    nodeId: string;
    workspaceSnapshotId: string;
    checkpoint: SandboxRuntimeCheckpointRefV1;
  }) {
    assertId(input.id);
    const checkpoint = sandboxRuntimeCheckpointRefV1Schema.parse(
      input.checkpoint,
    );
    if (
      checkpoint.captureState !== "captured" ||
      checkpoint.adoptedObjectRefs.length !== 0
    ) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_CAPTURE_STATE_INVALID");
    }
    return this.write(async (transaction) => {
      const existingById = await rowById(transaction, input.id);
      if (existingById) {
        return this.assertCapturedReplay(record(existingById), input);
      }
      const providerCollision = await transaction.execute({
        sql: `SELECT * FROM node_runtime_checkpoints
          WHERE provider = ? AND opaqueProviderRef = ? LIMIT 1`,
        args: [checkpoint.checkpoint.provider, checkpoint.checkpoint.opaqueRef],
      });
      if (providerCollision.rows[0]) {
        return this.assertCapturedReplay(
          record(providerCollision.rows[0] as Row),
          input,
        );
      }
      const binding = await transaction.execute({
        sql: `SELECT 1 FROM node_account_bindings binding
          JOIN avermate_nodes node ON node.id = binding.nodeId
          WHERE binding.nodeId = ? AND binding.userId = ?
            AND binding.state = 'active' AND node.state <> 'revoked' LIMIT 1`,
        args: [input.nodeId, input.ownerId],
      });
      if (!binding.rows[0]) throw new Error("NODE_BINDING_NOT_ACTIVE");
      const workspaceResult = await transaction.execute({
        sql: `SELECT workspaceSnapshotRefJson, imageDigest,
                executionProfileId, executionProfileVersion
          FROM workspace_snapshots
          WHERE id = ? AND userId = ? AND state = 'committed' LIMIT 1`,
        args: [input.workspaceSnapshotId, input.ownerId],
      });
      const workspace = workspaceResult.rows[0] as Row | undefined;
      if (
        !workspace ||
        typeof workspace.workspaceSnapshotRefJson !== "string"
      ) {
        throw new Error("NODE_RUNTIME_CHECKPOINT_WORKSPACE_NOT_COMMITTED");
      }
      let workspaceRef;
      try {
        workspaceRef = sandboxWorkspaceSnapshotRefSchema.parse(
          JSON.parse(workspace.workspaceSnapshotRefJson),
        );
      } catch {
        throw new Error("NODE_RUNTIME_CHECKPOINT_WORKSPACE_INVALID");
      }
      if (
        canonicalJson(workspaceRef) !==
          canonicalJson(checkpoint.sourceWorkspaceSnapshot) ||
        String(workspace.imageDigest) !==
          checkpoint.compatibility.imageDigest ||
        String(workspace.executionProfileId) !==
          checkpoint.compatibility.profileId ||
        String(workspace.executionProfileVersion) !==
          checkpoint.compatibility.profileVersion
      ) {
        throw new Error("NODE_RUNTIME_CHECKPOINT_WORKSPACE_MISMATCH");
      }
      const now = seconds(this.clock());
      await transaction.execute({
        sql: `INSERT INTO node_runtime_checkpoints
          (id, userId, nodeId, workspaceSnapshotId, checkpointRefJson,
           provider, opaqueProviderRef, region, architecture, runtimeKind,
           runtimeVersion, imageDigest, profileId, profileVersion,
           sourceWorkspaceSnapshotJson, captureState, adoptedObjectRefsJson,
           capturedAt, expiresAt, deletedAt, safeErrorCode, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'captured',
                  '[]', ?, ?, NULL, NULL, ?, ?)`,
        args: [
          input.id,
          input.ownerId,
          input.nodeId,
          input.workspaceSnapshotId,
          canonicalJson(checkpoint),
          checkpoint.checkpoint.provider,
          checkpoint.checkpoint.opaqueRef,
          checkpoint.compatibility.region,
          checkpoint.compatibility.architecture,
          checkpoint.compatibility.runtimeKind,
          checkpoint.compatibility.runtimeVersion,
          checkpoint.compatibility.imageDigest,
          checkpoint.compatibility.profileId,
          checkpoint.compatibility.profileVersion,
          canonicalJson(checkpoint.sourceWorkspaceSnapshot),
          seconds(new Date(checkpoint.capturedAt)),
          seconds(new Date(checkpoint.expiresAt)),
          now,
          now,
        ],
      });
      return record((await rowById(transaction, input.id))!);
    });
  }

  async loadOwned(input: { id: string; ownerId: string; nodeId?: string }) {
    assertId(input.id);
    const row = await rowById(this.client, input.id);
    if (!row) return null;
    const current = record(row);
    if (
      current.ownerId !== input.ownerId ||
      (input.nodeId && current.nodeId !== input.nodeId)
    ) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_OWNER_MISMATCH");
    }
    return current;
  }

  async loadForWorkspaceOwned(input: {
    workspaceSnapshotId: string;
    ownerId: string;
    nodeId?: string;
  }) {
    assertId(input.workspaceSnapshotId);
    const result = await this.client.execute({
      sql: `SELECT * FROM node_runtime_checkpoints
        WHERE workspaceSnapshotId = ?
        ORDER BY CASE captureState
          WHEN 'adopted' THEN 0 WHEN 'captured' THEN 1
          WHEN 'failed' THEN 2 ELSE 3 END,
          updatedAt DESC, id DESC`,
      args: [input.workspaceSnapshotId],
    });
    if (result.rows.length === 0) return null;
    const owned = result.rows
      .map((candidate) => record(candidate as Row))
      .filter(
        (candidate) =>
          candidate.ownerId === input.ownerId &&
          (!input.nodeId || candidate.nodeId === input.nodeId),
      );
    if (owned.length === 0) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_OWNER_MISMATCH");
    }
    const active = owned.filter(
      (candidate) =>
        candidate.state === "adopted" || candidate.state === "captured",
    );
    if (active.length > 1) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_WORKSPACE_AMBIGUOUS");
    }
    return active[0] ?? owned[0]!;
  }

  async markAdopted(input: {
    id: string;
    ownerId: string;
    nodeId: string;
    adoptedObjectRefs?: readonly string[];
  }) {
    return this.write(async (transaction) => {
      const current = await this.requireOwned(transaction, input);
      const refs = [...new Set(input.adoptedObjectRefs ?? [])].sort();
      const adopted = sandboxRuntimeCheckpointRefV1Schema.parse({
        ...current.checkpoint,
        captureState: "adopted",
        adoptedObjectRefs: refs,
      });
      if (current.state === "adopted") {
        if (canonicalJson(current.checkpoint) !== canonicalJson(adopted)) {
          throw new Error("NODE_RUNTIME_CHECKPOINT_ADOPTION_DIVERGED");
        }
        return current;
      }
      if (current.state !== "captured") {
        throw new Error("NODE_RUNTIME_CHECKPOINT_STATE_CONFLICT");
      }
      await transaction.execute({
        sql: `UPDATE node_runtime_checkpoints
          SET checkpointRefJson = ?, captureState = 'adopted',
              adoptedObjectRefsJson = ?, safeErrorCode = NULL, updatedAt = ?
          WHERE id = ? AND userId = ? AND nodeId = ?
            AND captureState = 'captured'`,
        args: [
          canonicalJson(adopted),
          canonicalJson(refs),
          seconds(this.clock()),
          input.id,
          input.ownerId,
          input.nodeId,
        ],
      });
      return record((await rowById(transaction, input.id))!);
    });
  }

  async markFailed(input: {
    id: string;
    ownerId: string;
    nodeId: string;
    safeErrorCode: string;
  }) {
    const safeErrorCode = assertErrorCode(input.safeErrorCode);
    return this.write(async (transaction) => {
      const current = await this.requireOwned(transaction, input);
      if (current.state === "deleted") {
        throw new Error("NODE_RUNTIME_CHECKPOINT_ALREADY_DELETED");
      }
      if (
        current.state === "failed" &&
        current.safeErrorCode === safeErrorCode
      ) {
        return current;
      }
      if (current.state !== "captured") {
        throw new Error("NODE_RUNTIME_CHECKPOINT_STATE_CONFLICT");
      }
      await transaction.execute({
        sql: `UPDATE node_runtime_checkpoints
          SET captureState = 'failed', safeErrorCode = ?, updatedAt = ?
          WHERE id = ? AND userId = ? AND nodeId = ?
            AND captureState = 'captured'`,
        args: [
          safeErrorCode,
          seconds(this.clock()),
          input.id,
          input.ownerId,
          input.nodeId,
        ],
      });
      return record((await rowById(transaction, input.id))!);
    });
  }

  async markDeleted(input: { id: string; ownerId: string; nodeId: string }) {
    return this.write(async (transaction) => {
      const current = await this.requireOwned(transaction, input);
      if (current.state === "deleted") return current;
      const now = seconds(this.clock());
      await transaction.execute({
        sql: `UPDATE node_runtime_checkpoints
          SET captureState = 'deleted', deletedAt = ?, safeErrorCode = NULL,
              updatedAt = ?
          WHERE id = ? AND userId = ? AND nodeId = ?
            AND captureState <> 'deleted'`,
        args: [now, now, input.id, input.ownerId, input.nodeId],
      });
      return record((await rowById(transaction, input.id))!);
    });
  }

  async captured(limit = 100) {
    return this.listBy("captureState = 'captured'", [], limit);
  }

  async expired(now = this.clock(), limit = 100) {
    return this.listBy(
      "captureState IN ('captured', 'adopted', 'failed') AND expiresAt <= ?",
      [seconds(now)],
      limit,
    );
  }

  private async listBy(predicate: string, args: InValue[], limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_LIMIT_INVALID");
    }
    const result = await this.client.execute({
      sql: `SELECT * FROM node_runtime_checkpoints WHERE ${predicate}
        ORDER BY updatedAt, id LIMIT ?`,
      args: [...args, limit],
    });
    return result.rows.map((row) => record(row as Row));
  }

  private async requireOwned(
    target: SqlTarget,
    input: { id: string; ownerId: string; nodeId: string },
  ) {
    const row = await rowById(target, input.id);
    if (!row) throw new Error("NODE_RUNTIME_CHECKPOINT_NOT_FOUND");
    const current = record(row);
    if (current.ownerId !== input.ownerId || current.nodeId !== input.nodeId) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_OWNER_MISMATCH");
    }
    return current;
  }

  private assertCapturedReplay(
    current: NodeRuntimeCheckpointRecord,
    input: {
      id: string;
      ownerId: string;
      nodeId: string;
      workspaceSnapshotId: string;
      checkpoint: SandboxRuntimeCheckpointRefV1;
    },
  ) {
    if (
      current.id !== input.id ||
      current.ownerId !== input.ownerId ||
      current.nodeId !== input.nodeId ||
      current.workspaceSnapshotId !== input.workspaceSnapshotId ||
      canonicalJson(current.checkpoint) !== canonicalJson(input.checkpoint)
    ) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_IDEMPOTENCY_MISMATCH");
    }
    return current;
  }

  private async write<T>(operation: (transaction: Transaction) => Promise<T>) {
    const transaction = await this.client.transaction("write");
    try {
      const result = await operation(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
