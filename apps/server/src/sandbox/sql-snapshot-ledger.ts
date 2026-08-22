import type { Client, InValue, Transaction } from "@libsql/client";
import {
  sandboxImageTemplateRefSchema,
  sandboxProfileIdSchema,
  sandboxProviderRuntimeCheckpointRefSchema,
  sandboxWorkspaceSnapshotRefSchema,
  type SandboxProfileId,
  type SandboxProviderRuntimeCheckpointRef,
  type SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import { newId } from "../lib/id";
import { db } from "../db";
import { canonicalJson, isoFromSqlite, sha256 } from "../search/values";
import type {
  SnapshotLedger,
  SnapshotLedgerRecord,
  SnapshotOutboxKind,
  SnapshotOutboxLease,
  SnapshotReconciliationAction,
} from "./snapshot-ledger";

type SnapshotSqlClient = Pick<Client, "execute" | "transaction">;
type SnapshotSqlExecutor =
  Pick<Client, "execute"> | Pick<Transaction, "execute">;
type Row = Record<string, InValue>;

type CaptureInput = Parameters<SnapshotLedger["requestCapture"]>[0];

function nowSeconds(now: Date) {
  return Math.floor(now.getTime() / 1_000);
}

function json<T>(value: unknown): T {
  if (typeof value !== "string")
    throw new Error("Stored snapshot JSON is invalid");
  return JSON.parse(value) as T;
}

function optionalWorkspaceRef(value: unknown) {
  return value === null
    ? null
    : sandboxWorkspaceSnapshotRefSchema.parse(
        json<SandboxWorkspaceSnapshotRef>(value),
      );
}

function record(row: Row): SnapshotLedgerRecord {
  return Object.freeze({
    id: String(row.id),
    ownerId: String(row.userId),
    threadId: String(row.threadId),
    branchId: String(row.branchId),
    sequence: Number(row.sequence),
    requestId: String(row.requestId),
    conversationCheckpointRef: String(row.conversationCheckpointRef),
    parentWorkspaceSnapshotRef: optionalWorkspaceRef(
      row.parentWorkspaceSnapshotRefJson,
    ),
    imageTemplateRef: sandboxImageTemplateRefSchema.parse(
      json(row.imageTemplateRefJson),
    ),
    executionProfileId: sandboxProfileIdSchema.parse(row.executionProfileId),
    executionProfileVersion: String(row.executionProfileVersion),
    status: row.state as SnapshotLedgerRecord["status"],
    workspaceSnapshotRef: optionalWorkspaceRef(row.workspaceSnapshotRefJson),
    sandboxRuntimeCheckpointRef:
      row.sandboxRuntimeCheckpointRefJson === null
        ? null
        : sandboxProviderRuntimeCheckpointRefSchema.parse(
            json(row.sandboxRuntimeCheckpointRefJson),
          ),
    trustedObjectRef:
      row.trustedObjectRef === null ? null : String(row.trustedObjectRef),
    portableManifestDigest:
      row.portableManifestDigest === null
        ? null
        : String(row.portableManifestDigest),
    byteSize: row.byteSize === null ? null : Number(row.byteSize),
    fileCount: row.fileCount === null ? null : Number(row.fileCount),
    failure: row.safeError === null ? null : String(row.safeError),
    createdAt: isoFromSqlite(row.createdAt),
    updatedAt: isoFromSqlite(row.updatedAt),
    committedAt:
      row.committedAt === null ? null : isoFromSqlite(row.committedAt),
    failedAt: row.failedAt === null ? null : isoFromSqlite(row.failedAt),
  });
}

function sameSnapshot(
  left: SandboxWorkspaceSnapshotRef | null,
  right: SandboxWorkspaceSnapshotRef,
) {
  return Boolean(
    left &&
    left.provider === right.provider &&
    left.digest === right.digest &&
    left.format === right.format,
  );
}

function sameOptionalSnapshot(
  left: SandboxWorkspaceSnapshotRef | null,
  right: SandboxWorkspaceSnapshotRef | null,
) {
  if (left === null || right === null) return left === right;
  return sameSnapshot(left, right);
}

function validateCapture(input: CaptureInput) {
  if (
    !input.ownerId ||
    !input.threadId ||
    !input.branchId ||
    !input.requestId ||
    !input.conversationCheckpointRef ||
    !Number.isInteger(input.sequence) ||
    input.sequence < 1
  ) {
    throw new Error(
      "Snapshot capture requires a valid owner, branch boundary, request, and sequence.",
    );
  }
  const imageTemplateRef = sandboxImageTemplateRefSchema.parse(
    input.imageTemplateRef,
  );
  const executionProfileId = sandboxProfileIdSchema.parse(
    input.executionProfileId,
  );
  const executionProfileVersion = input.executionProfileVersion.trim();
  if (
    !executionProfileVersion ||
    executionProfileVersion.length > 128 ||
    imageTemplateRef.profileVersion !== executionProfileVersion
  ) {
    throw new Error(
      "Snapshot image and execution profile versions must match.",
    );
  }
  return {
    imageTemplateRef,
    executionProfileId,
    executionProfileVersion,
    parentWorkspaceSnapshotRef: input.parentWorkspaceSnapshotRef
      ? sandboxWorkspaceSnapshotRefSchema.parse(
          input.parentWorkspaceSnapshotRef,
        )
      : null,
  };
}

async function rowById(executor: SnapshotSqlExecutor, id: string) {
  return (
    await executor.execute({
      sql: "SELECT * FROM workspace_snapshots WHERE id = ? LIMIT 1",
      args: [id],
    })
  ).rows[0] as Row | undefined;
}

async function requireRow(executor: SnapshotSqlExecutor, id: string) {
  const row = await rowById(executor, id);
  if (!row) throw new Error("Snapshot ledger record was not found.");
  return row;
}

async function assertCheckpoint(
  executor: SnapshotSqlExecutor,
  input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    conversationCheckpointRef: string;
  },
) {
  const result = await executor.execute({
    sql: `SELECT 1
      FROM assistant_conversation_checkpoints AS checkpoints
      JOIN assistant_threads AS threads
        ON threads.id = checkpoints.threadId
      JOIN assistant_branches AS branches
        ON branches.id = checkpoints.branchId
      WHERE checkpoints.id = ? AND checkpoints.userId = ?
        AND checkpoints.threadId = ? AND checkpoints.branchId = ?
        AND checkpoints.status = 'committed'
        AND threads.userId = checkpoints.userId
        AND threads.placement = 'core'
        AND branches.threadId = checkpoints.threadId
      LIMIT 1`,
    args: [
      input.conversationCheckpointRef,
      input.ownerId,
      input.threadId,
      input.branchId,
    ],
  });
  if (result.rows.length === 0) {
    throw new Error(
      "Conversation checkpoint does not belong to this owner/thread/branch.",
    );
  }
}

function outboxDigest(recordId: string, kind: SnapshotOutboxKind) {
  return sha256(
    canonicalJson(["workspace-snapshot-outbox-v1", recordId, kind]),
  );
}

async function ensureOutbox(
  executor: SnapshotSqlExecutor,
  recordId: string,
  kind: SnapshotOutboxKind,
  now: Date,
) {
  const timestamp = nowSeconds(now);
  await executor.execute({
    sql: `INSERT INTO workspace_snapshot_outbox
      (id, workspaceSnapshotId, kind, state, attempt, availableAt,
       payloadDigest, createdAt, updatedAt)
      VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)
      ON CONFLICT(workspaceSnapshotId, kind) DO NOTHING`,
    args: [
      newId("wsob"),
      recordId,
      kind,
      timestamp,
      outboxDigest(recordId, kind),
      timestamp,
      timestamp,
    ],
  });
}

async function completeKind(
  executor: SnapshotSqlExecutor,
  recordId: string,
  kind: SnapshotOutboxKind,
  now: Date,
) {
  await executor.execute({
    sql: `UPDATE workspace_snapshot_outbox
      SET state = 'completed', leaseOwner = NULL, leaseExpiresAt = NULL,
        completedAt = COALESCE(completedAt, ?), updatedAt = ?
      WHERE workspaceSnapshotId = ? AND kind = ? AND state <> 'completed'`,
    args: [nowSeconds(now), nowSeconds(now), recordId, kind],
  });
}

/**
 * Restart-safe core placement implementation. Checkpoint ownership and every
 * ledger transition share the same libSQL transaction; provider/object writes
 * remain outside it and cross the boundary only through the durable outbox.
 */
export class CoreSqlSnapshotLedger implements SnapshotLedger {
  constructor(private readonly client: SnapshotSqlClient) {}

  async requestCapture(input: CaptureInput): Promise<SnapshotLedgerRecord> {
    const validated = validateCapture(input);
    return this.write(async (transaction) => {
      await assertCheckpoint(transaction, input);
      if (validated.parentWorkspaceSnapshotRef) {
        const parent = await transaction.execute({
          sql: `SELECT 1 FROM workspace_snapshots
            WHERE userId = ? AND threadId = ? AND state = 'committed'
              AND workspaceSnapshotRefJson = ? LIMIT 1`,
          args: [
            input.ownerId,
            input.threadId,
            canonicalJson(validated.parentWorkspaceSnapshotRef),
          ],
        });
        if (parent.rows.length === 0) {
          throw new Error(
            "Parent workspace snapshot is not a committed snapshot owned by this thread.",
          );
        }
      }

      const existing = (
        await transaction.execute({
          sql: `SELECT * FROM workspace_snapshots
            WHERE userId = ? AND requestId = ? LIMIT 1`,
          args: [input.ownerId, input.requestId],
        })
      ).rows[0] as Row | undefined;
      if (existing) {
        const parsed = record(existing);
        if (
          parsed.threadId !== input.threadId ||
          parsed.branchId !== input.branchId ||
          parsed.sequence !== input.sequence ||
          parsed.conversationCheckpointRef !==
            input.conversationCheckpointRef ||
          !sameOptionalSnapshot(
            parsed.parentWorkspaceSnapshotRef,
            validated.parentWorkspaceSnapshotRef,
          ) ||
          parsed.imageTemplateRef.imageDigest !==
            validated.imageTemplateRef.imageDigest ||
          parsed.imageTemplateRef.profileVersion !==
            validated.imageTemplateRef.profileVersion ||
          parsed.executionProfileId !== validated.executionProfileId ||
          parsed.executionProfileVersion !== validated.executionProfileVersion
        ) {
          throw new Error(
            "Snapshot idempotency key was reused for a different boundary.",
          );
        }
        return parsed;
      }

      const collision = await transaction.execute({
        sql: `SELECT 1 FROM workspace_snapshots
          WHERE userId = ? AND branchId = ? AND sequence = ? LIMIT 1`,
        args: [input.ownerId, input.branchId, input.sequence],
      });
      if (collision.rows.length > 0) {
        throw new Error(
          "A different capture already owns this branch sequence.",
        );
      }

      const id = newId("wsnp");
      const now = input.now ?? new Date();
      const timestamp = nowSeconds(now);
      await transaction.execute({
        sql: `INSERT INTO workspace_snapshots
          (id, userId, threadId, branchId, sequence, requestId,
           conversationCheckpointRef, parentWorkspaceSnapshotRefJson,
           imageTemplateRefJson, imageDigest, executionProfileId,
           executionProfileVersion, state, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        args: [
          id,
          input.ownerId,
          input.threadId,
          input.branchId,
          input.sequence,
          input.requestId,
          input.conversationCheckpointRef,
          validated.parentWorkspaceSnapshotRef
            ? canonicalJson(validated.parentWorkspaceSnapshotRef)
            : null,
          canonicalJson(validated.imageTemplateRef),
          validated.imageTemplateRef.imageDigest,
          validated.executionProfileId,
          validated.executionProfileVersion,
          timestamp,
          timestamp,
        ],
      });
      await ensureOutbox(transaction, id, "capture", now);
      return record(await requireRow(transaction, id));
    });
  }

  async leaseOutbox(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
    now?: Date;
  }): Promise<readonly SnapshotOutboxLease[]> {
    if (
      !input.workerId ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new Error("A worker and limit between 1 and 100 are required.");
    }
    if (
      !Number.isInteger(input.leaseMs) ||
      input.leaseMs < 1_000 ||
      input.leaseMs > 10 * 60_000
    ) {
      throw new Error(
        "Snapshot outbox lease must be between 1 second and 10 minutes.",
      );
    }
    return this.write(async (transaction) => {
      const now = input.now ?? new Date();
      const timestamp = nowSeconds(now);
      const expiresAt = nowSeconds(new Date(now.getTime() + input.leaseMs));
      const candidates = await transaction.execute({
        sql: `SELECT id FROM workspace_snapshot_outbox
          WHERE availableAt <= ? AND
            (state = 'pending' OR
             (state = 'leased' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?))
          ORDER BY availableAt, createdAt, id LIMIT ?`,
        args: [timestamp, timestamp, input.limit],
      });
      const leases: SnapshotOutboxLease[] = [];
      for (const candidate of candidates.rows) {
        const outboxId = String(candidate.id);
        const claimed = await transaction.execute({
          sql: `UPDATE workspace_snapshot_outbox
            SET state = 'leased', attempt = attempt + 1, leaseOwner = ?,
              leaseExpiresAt = ?, updatedAt = ?
            WHERE id = ? AND
              (state = 'pending' OR
               (state = 'leased' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?))`,
          args: [input.workerId, expiresAt, timestamp, outboxId, timestamp],
        });
        if (claimed.rowsAffected !== 1) continue;
        const result = await transaction.execute({
          sql: `SELECT snapshots.*,
              outbox.id AS outboxId, outbox.kind AS outboxKind,
              outbox.attempt AS outboxAttempt,
              outbox.leaseExpiresAt AS outboxLeaseExpiresAt
            FROM workspace_snapshot_outbox AS outbox
            JOIN workspace_snapshots AS snapshots
              ON snapshots.id = outbox.workspaceSnapshotId
            WHERE outbox.id = ? LIMIT 1`,
          args: [outboxId],
        });
        const row = result.rows[0] as Row | undefined;
        if (!row) continue;
        leases.push(
          Object.freeze({
            outboxId,
            kind: row.outboxKind as SnapshotOutboxKind,
            record: record(row),
            providerCaptureRef: optionalWorkspaceRef(
              row.capturedProviderRefJson,
            ),
            attempts: Number(row.outboxAttempt),
            leasedUntil: isoFromSqlite(row.outboxLeaseExpiresAt),
          }),
        );
      }
      return Object.freeze(leases);
    });
  }

  async recordProviderCapture(input: {
    recordId: string;
    workspaceSnapshotRef: SandboxWorkspaceSnapshotRef;
    now?: Date;
  }) {
    const workspaceSnapshotRef = sandboxWorkspaceSnapshotRefSchema.parse(
      input.workspaceSnapshotRef,
    );
    return this.write(async (transaction) => {
      const row = await requireRow(transaction, input.recordId);
      const current = record(row);
      if (current.status !== "pending") {
        if (
          current.status === "committed" &&
          sameSnapshot(current.workspaceSnapshotRef, workspaceSnapshotRef)
        ) {
          return current;
        }
        throw new Error(
          "Provider capture cannot mutate a terminal snapshot record.",
        );
      }
      const captured = optionalWorkspaceRef(row.capturedProviderRefJson);
      if (captured && !sameSnapshot(captured, workspaceSnapshotRef)) {
        throw new Error("Provider capture is immutable once recorded.");
      }
      const now = input.now ?? new Date();
      await transaction.execute({
        sql: `UPDATE workspace_snapshots
          SET capturedProviderRefJson = ?, updatedAt = ?
          WHERE id = ? AND state = 'pending'`,
        args: [
          canonicalJson(workspaceSnapshotRef),
          nowSeconds(now),
          input.recordId,
        ],
      });
      await completeKind(transaction, input.recordId, "capture", now);
      await ensureOutbox(transaction, input.recordId, "adopt", now);
      return record(await requireRow(transaction, input.recordId));
    });
  }

  async recordAdoptionCandidate(input: {
    recordId: string;
    workspaceSnapshotRef: SandboxWorkspaceSnapshotRef;
    trustedObjectRef: string;
    portableManifestDigest: string;
    byteSize: number;
    fileCount: number;
    now?: Date;
  }) {
    const workspaceSnapshotRef = sandboxWorkspaceSnapshotRefSchema.parse(
      input.workspaceSnapshotRef,
    );
    const trustedObjectRef = input.trustedObjectRef.trim();
    if (!trustedObjectRef)
      throw new Error("A trusted object reference is required.");
    if (!/^sha256:[a-f0-9]{64}$/u.test(input.portableManifestDigest)) {
      throw new Error("A pinned portable manifest digest is required.");
    }
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 0 ||
      !Number.isSafeInteger(input.fileCount) ||
      input.fileCount < 0
    ) {
      throw new Error(
        "Adopted snapshot size and file count must be non-negative safe integers.",
      );
    }
    return this.write(async (transaction) => {
      const row = await requireRow(transaction, input.recordId);
      const current = record(row);
      if (current.status !== "pending") {
        if (
          current.status === "committed" &&
          sameSnapshot(current.workspaceSnapshotRef, workspaceSnapshotRef) &&
          current.trustedObjectRef === trustedObjectRef
        ) {
          return current;
        }
        throw new Error(
          "Adoption candidate cannot mutate a terminal snapshot record.",
        );
      }
      const captured = optionalWorkspaceRef(row.capturedProviderRefJson);
      if (!captured || !sameSnapshot(captured, workspaceSnapshotRef)) {
        throw new Error(
          "Adoption candidate must match the captured provider snapshot.",
        );
      }
      if (
        row.capturedTrustedObjectRef !== null &&
        (String(row.capturedTrustedObjectRef) !== trustedObjectRef ||
          String(row.capturedManifestDigest) !== input.portableManifestDigest ||
          Number(row.capturedByteSize) !== input.byteSize ||
          Number(row.capturedFileCount) !== input.fileCount)
      ) {
        throw new Error("Adoption candidate is immutable once recorded.");
      }
      const now = input.now ?? new Date();
      await transaction.execute({
        sql: `UPDATE workspace_snapshots SET
            capturedTrustedObjectRef = ?, capturedManifestDigest = ?,
            capturedByteSize = ?, capturedFileCount = ?, updatedAt = ?
          WHERE id = ? AND state = 'pending'`,
        args: [
          trustedObjectRef,
          input.portableManifestDigest,
          input.byteSize,
          input.fileCount,
          nowSeconds(now),
          input.recordId,
        ],
      });
      await completeKind(transaction, input.recordId, "adopt", now);
      return record(await requireRow(transaction, input.recordId));
    });
  }

  async commitAdoption(input: {
    recordId: string;
    workspaceSnapshotRef: SandboxWorkspaceSnapshotRef;
    trustedObjectRef: string;
    now?: Date;
  }) {
    const workspaceSnapshotRef = sandboxWorkspaceSnapshotRefSchema.parse(
      input.workspaceSnapshotRef,
    );
    const trustedObjectRef = input.trustedObjectRef.trim();
    return this.write(async (transaction) => {
      const row = await requireRow(transaction, input.recordId);
      const current = record(row);
      await assertCheckpoint(transaction, current);
      if (current.status === "committed") {
        if (
          sameSnapshot(current.workspaceSnapshotRef, workspaceSnapshotRef) &&
          current.trustedObjectRef === trustedObjectRef
        ) {
          return current;
        }
        throw new Error("Committed snapshots are immutable.");
      }
      if (current.status === "failed") {
        throw new Error("Failed snapshots cannot be committed.");
      }
      const captured = optionalWorkspaceRef(row.capturedProviderRefJson);
      if (!captured || !sameSnapshot(captured, workspaceSnapshotRef)) {
        throw new Error("Adoption must match the recorded provider capture.");
      }
      if (String(row.capturedTrustedObjectRef ?? "") !== trustedObjectRef) {
        throw new Error(
          "Commit must match the recorded trusted adoption candidate.",
        );
      }
      if (
        row.capturedManifestDigest === null ||
        row.capturedByteSize === null ||
        row.capturedFileCount === null
      ) {
        throw new Error("Commit requires complete portable manifest evidence.");
      }
      const duplicate = await transaction.execute({
        sql: `SELECT 1 FROM workspace_snapshots
          WHERE id <> ? AND userId = ? AND branchId = ?
            AND conversationCheckpointRef = ? AND state = 'committed' LIMIT 1`,
        args: [
          input.recordId,
          current.ownerId,
          current.branchId,
          current.conversationCheckpointRef,
        ],
      });
      if (duplicate.rows.length > 0) {
        throw new Error(
          "A committed snapshot already owns this branch checkpoint.",
        );
      }
      const now = input.now ?? new Date();
      const timestamp = nowSeconds(now);
      const updated = await transaction.execute({
        sql: `UPDATE workspace_snapshots SET
            state = 'committed', workspaceSnapshotRefJson = ?,
            trustedObjectRef = ?, portableManifestDigest = ?, byteSize = ?,
            fileCount = ?, safeError = NULL, committedAt = ?, updatedAt = ?
          WHERE id = ? AND state = 'pending'`,
        args: [
          canonicalJson(workspaceSnapshotRef),
          trustedObjectRef,
          String(row.capturedManifestDigest),
          Number(row.capturedByteSize),
          Number(row.capturedFileCount),
          timestamp,
          timestamp,
          input.recordId,
        ],
      });
      if (updated.rowsAffected !== 1) {
        throw new Error("Snapshot adoption lost its pending reservation.");
      }
      await completeKind(transaction, input.recordId, "capture", now);
      await completeKind(transaction, input.recordId, "adopt", now);
      await ensureOutbox(transaction, input.recordId, "publish", now);
      return record(await requireRow(transaction, input.recordId));
    });
  }

  async attachRuntimeCheckpoint(input: {
    recordId: string;
    runtimeCheckpointRef: SandboxProviderRuntimeCheckpointRef;
    imageDigest: string;
    executionProfileVersion: string;
    now?: Date;
  }) {
    const runtimeCheckpointRef =
      sandboxProviderRuntimeCheckpointRefSchema.parse(
        input.runtimeCheckpointRef,
      );
    return this.write(async (transaction) => {
      const row = await requireRow(transaction, input.recordId);
      const current = record(row);
      if (current.status !== "committed") {
        throw new Error(
          "Runtime accelerators can only attach to committed workspace snapshots.",
        );
      }
      if (
        input.imageDigest !== current.imageTemplateRef.imageDigest ||
        input.executionProfileVersion !== current.executionProfileVersion
      ) {
        throw new Error(
          "Runtime checkpoint is incompatible with the committed image/profile.",
        );
      }
      const existing = current.sandboxRuntimeCheckpointRef;
      if (
        existing &&
        (existing.provider !== runtimeCheckpointRef.provider ||
          existing.opaqueRef !== runtimeCheckpointRef.opaqueRef)
      ) {
        throw new Error(
          "Runtime checkpoint accelerator is immutable once attached.",
        );
      }
      await transaction.execute({
        sql: `UPDATE workspace_snapshots
          SET sandboxRuntimeCheckpointRefJson = ?, updatedAt = ? WHERE id = ?`,
        args: [
          canonicalJson(runtimeCheckpointRef),
          nowSeconds(input.now ?? new Date()),
          input.recordId,
        ],
      });
      return record(await requireRow(transaction, input.recordId));
    });
  }

  async failCapture(input: { recordId: string; failure: string; now?: Date }) {
    return this.write(async (transaction) => {
      const row = await requireRow(transaction, input.recordId);
      const current = record(row);
      if (current.status === "committed") {
        throw new Error("Committed snapshots cannot fail later.");
      }
      if (current.status === "failed") return current;
      const now = input.now ?? new Date();
      const timestamp = nowSeconds(now);
      await transaction.execute({
        sql: `UPDATE workspace_snapshots
          SET state = 'failed', safeError = ?, failedAt = ?, updatedAt = ?
          WHERE id = ? AND state = 'pending'`,
        args: [
          input.failure.slice(0, 4_096) || "snapshot capture failed",
          timestamp,
          timestamp,
          input.recordId,
        ],
      });
      await completeKind(transaction, input.recordId, "capture", now);
      await completeKind(transaction, input.recordId, "adopt", now);
      if (row.capturedProviderRefJson !== null) {
        await ensureOutbox(transaction, input.recordId, "gc", now);
      }
      return record(await requireRow(transaction, input.recordId));
    });
  }

  async completeOutbox(input: {
    outboxId: string;
    workerId: string;
    now?: Date;
  }) {
    return this.write(async (transaction) => {
      const result = await transaction.execute({
        sql: `SELECT * FROM workspace_snapshot_outbox WHERE id = ? LIMIT 1`,
        args: [input.outboxId],
      });
      const row = result.rows[0] as Row | undefined;
      if (!row) throw new Error("Snapshot outbox row was not found.");
      if (row.state === "completed") return;
      if (
        (row.kind !== "publish" && row.kind !== "gc") ||
        row.leaseOwner !== input.workerId ||
        row.state !== "leased"
      ) {
        throw new Error(
          "Only the active publish/GC lease owner can complete this outbox row.",
        );
      }
      const now = nowSeconds(input.now ?? new Date());
      await transaction.execute({
        sql: `UPDATE workspace_snapshot_outbox
          SET state = 'completed', leaseOwner = NULL, leaseExpiresAt = NULL,
            completedAt = ?, updatedAt = ?
          WHERE id = ? AND state = 'leased' AND leaseOwner = ?`,
        args: [now, now, input.outboxId, input.workerId],
      });
    });
  }

  async getRestorable(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    conversationCheckpointRef: string;
  }) {
    await assertCheckpoint(this.client, input);
    const result = await this.client.execute({
      sql: `SELECT * FROM workspace_snapshots
        WHERE userId = ? AND threadId = ? AND branchId = ?
          AND conversationCheckpointRef = ? AND state = 'committed' LIMIT 1`,
      args: [
        input.ownerId,
        input.threadId,
        input.branchId,
        input.conversationCheckpointRef,
      ],
    });
    const row = result.rows[0] as Row | undefined;
    return row ? record(row) : null;
  }

  async getLatestCompatible(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    executionProfileId: SandboxProfileId;
    executionProfileVersion: string;
    imageDigest: string;
    maxSequence?: number;
  }) {
    const profile = sandboxProfileIdSchema.parse(input.executionProfileId);
    const result = await this.client.execute({
      sql: `SELECT * FROM workspace_snapshots
        WHERE userId = ? AND threadId = ? AND branchId = ?
          AND executionProfileId = ? AND executionProfileVersion = ?
          AND imageDigest = ? AND sequence <= ? AND state = 'committed'
        ORDER BY sequence DESC LIMIT 1`,
      args: [
        input.ownerId,
        input.threadId,
        input.branchId,
        profile,
        input.executionProfileVersion,
        input.imageDigest,
        input.maxSequence ?? Number.MAX_SAFE_INTEGER,
      ],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row) return null;
    const parsed = record(row);
    await assertCheckpoint(this.client, parsed);
    return parsed;
  }

  async reconcile(input: {
    pendingOlderThanMs: number;
    leaseExpiredBefore?: Date;
    providerInventory?: readonly SandboxWorkspaceSnapshotRef[];
    now?: Date;
  }) {
    if (
      !Number.isFinite(input.pendingOlderThanMs) ||
      input.pendingOlderThanMs < 0
    ) {
      throw new Error("A non-negative reconciliation age is required.");
    }
    return this.write(async (transaction) => {
      const now = input.now ?? new Date();
      const timestamp = nowSeconds(now);
      const leaseCutoff = nowSeconds(input.leaseExpiredBefore ?? now);
      await transaction.execute({
        sql: `UPDATE workspace_snapshot_outbox
          SET state = 'pending', leaseOwner = NULL, leaseExpiresAt = NULL,
            updatedAt = ?
          WHERE state = 'leased' AND leaseExpiresAt IS NOT NULL
            AND leaseExpiresAt <= ?`,
        args: [timestamp, leaseCutoff],
      });
      const rows = await transaction.execute({
        sql: `SELECT * FROM workspace_snapshots ORDER BY updatedAt, id LIMIT 10000`,
        args: [],
      });
      const actions: SnapshotReconciliationAction[] = [];
      const tracked = new Set<string>();
      for (const raw of rows.rows) {
        const row = raw as Row;
        const current = record(row);
        const captured = optionalWorkspaceRef(row.capturedProviderRefJson);
        if (captured) tracked.add(canonicalJson(captured));
        if (current.status === "committed") {
          await ensureOutbox(transaction, current.id, "publish", now);
          const publish = await transaction.execute({
            sql: `SELECT state FROM workspace_snapshot_outbox
              WHERE workspaceSnapshotId = ? AND kind = 'publish' LIMIT 1`,
            args: [current.id],
          });
          if (publish.rows[0]?.state !== "completed") {
            actions.push({ recordId: current.id, action: "retry-publish" });
          }
          continue;
        }
        if (current.status === "failed" && captured) {
          await ensureOutbox(transaction, current.id, "gc", now);
          actions.push({
            recordId: current.id,
            action: "orphan-requires-cleanup",
            workspaceSnapshotRef: captured,
          });
          continue;
        }
        if (current.status !== "pending") continue;
        if (captured && row.capturedTrustedObjectRef !== null) {
          actions.push({
            recordId: current.id,
            action: "resume-commit",
            workspaceSnapshotRef: captured,
          });
          continue;
        }
        if (captured) {
          await ensureOutbox(transaction, current.id, "adopt", now);
          actions.push({
            recordId: current.id,
            action: "resume-adoption",
            workspaceSnapshotRef: captured,
          });
          continue;
        }
        const age = now.getTime() - new Date(current.updatedAt).getTime();
        if (age < input.pendingOlderThanMs) continue;
        await ensureOutbox(transaction, current.id, "capture", now);
        const capture = await transaction.execute({
          sql: `SELECT state FROM workspace_snapshot_outbox
            WHERE workspaceSnapshotId = ? AND kind = 'capture' LIMIT 1`,
          args: [current.id],
        });
        if (capture.rows[0]?.state !== "leased") {
          await transaction.execute({
            sql: `UPDATE workspace_snapshot_outbox
              SET state = 'pending', leaseOwner = NULL, leaseExpiresAt = NULL,
                availableAt = ?, updatedAt = ?
              WHERE workspaceSnapshotId = ? AND kind = 'capture'
                AND state <> 'completed'`,
            args: [timestamp, timestamp, current.id],
          });
          actions.push({ recordId: current.id, action: "retry-capture" });
        }
      }
      for (const candidate of input.providerInventory ?? []) {
        const parsed = sandboxWorkspaceSnapshotRefSchema.parse(candidate);
        if (!tracked.has(canonicalJson(parsed))) {
          actions.push({
            recordId: `untracked:${parsed.digest}`,
            action: "orphan-requires-cleanup",
            workspaceSnapshotRef: parsed,
          });
        }
      }
      return Object.freeze(
        actions.map((action) => Object.freeze(action)),
      ) as readonly SnapshotReconciliationAction[];
    });
  }

  private async write<T>(operation: (transaction: Transaction) => Promise<T>) {
    const transaction = await this.client.transaction("write");
    try {
      const value = await operation(transaction);
      await transaction.commit();
      return value;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

export const coreWorkspaceSnapshotLedger = new CoreSqlSnapshotLedger(db.$client);
