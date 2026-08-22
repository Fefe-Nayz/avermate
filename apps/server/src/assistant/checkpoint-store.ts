import type { Client, InValue, Transaction } from "@libsql/client";
import {
  conversationCheckpointRecordSchema,
  type ConversationCheckpointRecord,
} from "@avermate/agent-contracts";
import { newId } from "../lib/id";
import { isoFromSqlite, sha256 } from "../search/values";
import {
  ConversationStoreError,
  type AssistantSqlClient,
} from "./core-conversation-store";

export interface ConversationCheckpointBlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string, maxBytes: number): Promise<Uint8Array>;
  head(key: string): Promise<{ byteLength: number } | null>;
  delete(key: string): Promise<void>;
}

export type CheckpointCrashPhase =
  | "after-reserve"
  | "after-upload"
  | "after-promotion"
  | "after-adoption"
  | "after-temp-delete";

export type AppendConversationCheckpointInput = {
  ownerId: string;
  threadId: string;
  branchId: string;
  runId: string;
  inputMessageId: string;
  outputMessageId?: string | null;
  parentCheckpointId?: string | null;
  appendKey: string;
  afterEventSequence: number;
  runtimeId: string;
  runtimeVersion: string;
  graphSchemaVersion: number;
  state: Uint8Array;
};

type Row = Record<string, InValue>;

const MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024;

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}

function record(row: Row): ConversationCheckpointRecord {
  return conversationCheckpointRecordSchema.parse({
    id: String(row.id),
    threadId: String(row.threadId),
    branchId: String(row.branchId),
    runId: String(row.runId),
    inputMessageId: String(row.inputMessageId),
    outputMessageId:
      row.outputMessageId === null ? null : String(row.outputMessageId),
    parentCheckpointId:
      row.parentCheckpointId === null ? null : String(row.parentCheckpointId),
    afterEventSequence: Number(row.afterEventSequence),
    runtimeId: String(row.runtimeId),
    runtimeVersion: String(row.runtimeVersion),
    graphSchemaVersion: Number(row.graphSchemaVersion),
    stateDigest: String(row.stateDigest),
    stateByteLength: Number(row.stateByteLength),
    stateBlobRef: row.stateBlobRef === null ? null : String(row.stateBlobRef),
    status: row.status,
    failureCode: row.failureCode === null ? null : String(row.failureCode),
    committedAt:
      row.committedAt === null ? null : isoFromSqlite(row.committedAt),
    createdAt: isoFromSqlite(row.createdAt),
  });
}

async function rowById(
  target: AssistantSqlClient | Transaction,
  checkpointId: string,
) {
  return (
    await target.execute({
      sql: `SELECT * FROM assistant_conversation_checkpoints WHERE id = ?`,
      args: [checkpointId],
    })
  ).rows[0] as Row | undefined;
}

async function assertCheckpointBoundary(
  target: AssistantSqlClient | Transaction,
  input: AppendConversationCheckpointInput,
) {
  const boundary = await target.execute({
    sql: `SELECT 1
      FROM assistant_runs AS runs
      JOIN assistant_threads AS threads
        ON threads.id = runs.threadId AND threads.userId = runs.userId
      JOIN assistant_branches AS branches
        ON branches.id = runs.branchId AND branches.threadId = runs.threadId
      JOIN assistant_messages AS inputs
        ON inputs.id = runs.inputMessageId AND inputs.threadId = runs.threadId
      WHERE runs.id = ? AND runs.userId = ? AND runs.threadId = ?
        AND runs.branchId = ? AND runs.inputMessageId = ?
        AND threads.placement = 'core' AND threads.deletedAt IS NULL
      LIMIT 1`,
    args: [
      input.runId,
      input.ownerId,
      input.threadId,
      input.branchId,
      input.inputMessageId,
    ],
  });
  if (boundary.rows.length === 0) {
    throw new ConversationStoreError(
      "forbidden",
      "Checkpoint boundary does not belong to this owner, thread, branch, and run",
    );
  }
  if (input.outputMessageId) {
    const output = await target.execute({
      sql: `SELECT 1 FROM assistant_messages
        WHERE id = ? AND threadId = ? LIMIT 1`,
      args: [input.outputMessageId, input.threadId],
    });
    if (output.rows.length === 0) {
      throw new ConversationStoreError(
        "forbidden",
        "Checkpoint output message does not belong to this thread",
      );
    }
  }
  if (input.parentCheckpointId) {
    const parent = await target.execute({
      sql: `SELECT 1 FROM assistant_conversation_checkpoints
        WHERE id = ? AND userId = ? AND threadId = ? AND branchId = ?
          AND status = 'committed' AND afterEventSequence <= ? LIMIT 1`,
      args: [
        input.parentCheckpointId,
        input.ownerId,
        input.threadId,
        input.branchId,
        input.afterEventSequence,
      ],
    });
    if (parent.rows.length === 0) {
      throw new ConversationStoreError(
        "forbidden",
        "Checkpoint parent is not a committed ancestor of this branch",
      );
    }
  }
  if (input.afterEventSequence > 0) {
    const event = await target.execute({
      sql: `SELECT 1 FROM assistant_run_events
        WHERE runId = ? AND sequence = ? LIMIT 1`,
      args: [input.runId, input.afterEventSequence],
    });
    if (event.rows.length === 0) {
      throw new ConversationStoreError(
        "invalid_state",
        "Checkpoint sequence is not a persisted event boundary",
      );
    }
  }
}

export class CoreConversationCheckpointStore {
  constructor(
    private readonly client: AssistantSqlClient,
    private readonly blobs: ConversationCheckpointBlobStore,
    private readonly onPhase?: (
      phase: CheckpointCrashPhase,
      checkpointId: string,
    ) => void | Promise<void>,
  ) {}

  async append(
    input: AppendConversationCheckpointInput,
  ): Promise<ConversationCheckpointRecord> {
    if (input.state.byteLength > MAX_CHECKPOINT_BYTES) {
      throw new Error(`Checkpoint exceeds ${MAX_CHECKPOINT_BYTES} bytes`);
    }
    if (input.state.byteLength === 0) throw new Error("Checkpoint is empty");
    await assertCheckpointBoundary(this.client, input);
    const digest = sha256(input.state);
    const existing = (
      await this.client.execute({
        sql: `SELECT * FROM assistant_conversation_checkpoints
          WHERE userId = ? AND appendKey = ? LIMIT 1`,
        args: [input.ownerId, input.appendKey],
      })
    ).rows[0] as Row | undefined;
    if (existing) {
      if (
        String(existing.stateDigest) !== digest ||
        Number(existing.stateByteLength) !== input.state.byteLength ||
        String(existing.runId) !== input.runId ||
        String(existing.threadId) !== input.threadId ||
        String(existing.branchId) !== input.branchId ||
        String(existing.inputMessageId) !== input.inputMessageId ||
        (existing.outputMessageId === null
          ? input.outputMessageId != null
          : String(existing.outputMessageId) !== input.outputMessageId) ||
        (existing.parentCheckpointId === null
          ? input.parentCheckpointId != null
          : String(existing.parentCheckpointId) !== input.parentCheckpointId) ||
        Number(existing.afterEventSequence) !== input.afterEventSequence ||
        String(existing.runtimeId) !== input.runtimeId ||
        String(existing.runtimeVersion) !== input.runtimeVersion ||
        Number(existing.graphSchemaVersion) !== input.graphSchemaVersion
      ) {
        throw new ConversationStoreError(
          "divergent_replay",
          "Checkpoint append key was replayed with different state",
        );
      }
      if (existing.status === "committed") {
        await this.verifyCommitted(existing);
        return record(existing);
      }
      if (existing.status === "failed") {
        throw new ConversationStoreError(
          "invalid_state",
          `Checkpoint failed: ${String(existing.failureCode)}`,
        );
      }
      const reconciled = await this.reconcileOne(existing);
      if (reconciled) return reconciled;
      throw new ConversationStoreError(
        "invalid_state",
        "Checkpoint is still staging",
      );
    }

    const checkpointId = newId("ackp");
    const temporaryBlobRef = `private/assistant-checkpoints/${input.ownerId}/staging/${checkpointId}-${crypto.randomUUID()}.bin`;
    const stateBlobRef = `private/assistant-checkpoints/${input.ownerId}/sha256/${digest}.bin`;
    const now = nowSeconds();
    await this.client.execute({
      sql: `INSERT INTO assistant_conversation_checkpoints
        (id, userId, threadId, branchId, runId, inputMessageId, outputMessageId,
         parentCheckpointId, appendKey, afterEventSequence, runtimeId,
         runtimeVersion, graphSchemaVersion, stateDigest, stateByteLength,
         temporaryBlobRef, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staging', ?)`,
      args: [
        checkpointId,
        input.ownerId,
        input.threadId,
        input.branchId,
        input.runId,
        input.inputMessageId,
        input.outputMessageId ?? null,
        input.parentCheckpointId ?? null,
        input.appendKey,
        input.afterEventSequence,
        input.runtimeId,
        input.runtimeVersion,
        input.graphSchemaVersion,
        digest,
        input.state.byteLength,
        temporaryBlobRef,
        now,
      ],
    });
    await this.phase("after-reserve", checkpointId);

    await this.blobs.put(temporaryBlobRef, input.state);
    await this.verifyBlob(temporaryBlobRef, digest, input.state.byteLength);
    await this.phase("after-upload", checkpointId);

    const finalHead = await this.blobs.head(stateBlobRef);
    if (!finalHead) await this.blobs.put(stateBlobRef, input.state);
    await this.verifyBlob(stateBlobRef, digest, input.state.byteLength);
    await this.phase("after-promotion", checkpointId);

    const transaction = await this.client.transaction("write");
    try {
      const adoptedAt = nowSeconds();
      const adoption = await transaction.execute({
        sql: `UPDATE assistant_conversation_checkpoints
          SET status = 'committed', stateBlobRef = ?, temporaryBlobRef = NULL,
            committedAt = ?, failureCode = NULL
          WHERE id = ? AND status = 'staging' AND stateDigest = ?
            AND stateByteLength = ?`,
        args: [
          stateBlobRef,
          adoptedAt,
          checkpointId,
          digest,
          input.state.byteLength,
        ],
      });
      if (adoption.rowsAffected !== 1) {
        throw new Error("Checkpoint adoption lost its staging reservation");
      }
      await transaction.execute({
        sql: `INSERT INTO assistant_outbox
          (id, userId, runId, checkpointId, kind, state, attempt, availableAt,
           payloadDigest, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, 'checkpoint-committed', 'pending', 0, ?, ?, ?, ?)`,
        args: [
          newId("aout"),
          input.ownerId,
          input.runId,
          checkpointId,
          adoptedAt,
          digest,
          adoptedAt,
          adoptedAt,
        ],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    await this.phase("after-adoption", checkpointId);
    await this.blobs.delete(temporaryBlobRef);
    await this.phase("after-temp-delete", checkpointId);
    return this.get({ ownerId: input.ownerId, checkpointId });
  }

  async get(input: {
    ownerId: string;
    checkpointId: string;
  }): Promise<ConversationCheckpointRecord> {
    const result = await this.client.execute({
      sql: `SELECT * FROM assistant_conversation_checkpoints
        WHERE id = ? AND userId = ? AND status = 'committed' LIMIT 1`,
      args: [input.checkpointId, input.ownerId],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row) {
      throw new ConversationStoreError(
        "not_found",
        "Committed checkpoint not found",
      );
    }
    await this.verifyCommitted(row);
    return record(row);
  }

  async readState(input: {
    ownerId: string;
    checkpointId: string;
  }): Promise<Uint8Array> {
    const checkpoint = await this.get(input);
    const bytes = await this.blobs.get(
      checkpoint.stateBlobRef!,
      checkpoint.stateByteLength,
    );
    if (
      bytes.byteLength !== checkpoint.stateByteLength ||
      sha256(bytes) !== checkpoint.stateDigest
    ) {
      throw new Error("Committed checkpoint object failed digest verification");
    }
    return bytes;
  }

  async latestForRun(input: {
    ownerId: string;
    runId: string;
  }): Promise<ConversationCheckpointRecord | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM assistant_conversation_checkpoints
        WHERE userId = ? AND runId = ? AND status = 'committed'
        ORDER BY afterEventSequence DESC, createdAt DESC LIMIT 1`,
      args: [input.ownerId, input.runId],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row) return null;
    await this.verifyCommitted(row);
    return record(row);
  }

  async listForBranch(input: {
    ownerId: string;
    branchId: string;
    limit?: number;
  }): Promise<ConversationCheckpointRecord[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM assistant_conversation_checkpoints
        WHERE userId = ? AND branchId = ? AND status = 'committed'
        ORDER BY createdAt DESC LIMIT ?`,
      args: [
        input.ownerId,
        input.branchId,
        Math.min(Math.max(input.limit ?? 100, 1), 1_000),
      ],
    });
    const records: ConversationCheckpointRecord[] = [];
    for (const raw of result.rows) {
      const row = raw as Row;
      await this.verifyCommitted(row);
      records.push(record(row));
    }
    return records;
  }

  async reconcileStaging(
    input: {
      olderThanSeconds?: number;
      limit?: number;
    } = {},
  ): Promise<{ committed: string[]; failed: string[] }> {
    const cutoff = nowSeconds() - Math.max(input.olderThanSeconds ?? 60, 0);
    const result = await this.client.execute({
      sql: `SELECT * FROM assistant_conversation_checkpoints
        WHERE status = 'staging' AND createdAt <= ? ORDER BY createdAt LIMIT ?`,
      args: [cutoff, Math.min(Math.max(input.limit ?? 100, 1), 1_000)],
    });
    const committed: string[] = [];
    const failed: string[] = [];
    for (const raw of result.rows) {
      const row = raw as Row;
      try {
        const reconciled = await this.reconcileOne(row);
        if (reconciled) committed.push(reconciled.id);
        else {
          await this.failStaging(String(row.id), "checkpoint_blob_missing");
          failed.push(String(row.id));
        }
      } catch {
        await this.failStaging(String(row.id), "checkpoint_digest_mismatch");
        failed.push(String(row.id));
      }
    }
    return { committed, failed };
  }

  async markGarbage(input: {
    ownerId: string;
    olderThan: Date;
  }): Promise<string[]> {
    const cutoff = Math.floor(input.olderThan.getTime() / 1_000);
    const now = nowSeconds();
    const result = await this.client.execute({
      sql: `SELECT c.id FROM assistant_conversation_checkpoints c
        JOIN assistant_threads t ON t.id = c.threadId
        WHERE c.userId = ? AND c.status = 'committed' AND c.createdAt < ?
          AND c.gcMarkedAt IS NULL
          AND t.deletedAt IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM assistant_runs r
            WHERE r.conversationCheckpointRef = c.id
          )`,
      args: [input.ownerId, cutoff],
    });
    const ids = result.rows.map((row) => String(row.id));
    for (const id of ids) {
      await this.client.execute({
        sql: `UPDATE assistant_conversation_checkpoints SET gcMarkedAt = ?
          WHERE id = ? AND gcMarkedAt IS NULL`,
        args: [now, id],
      });
    }
    return ids;
  }

  async sweepGarbage(
    input: {
      graceSeconds?: number;
      limit?: number;
    } = {},
  ): Promise<string[]> {
    const cutoff = nowSeconds() - Math.max(input.graceSeconds ?? 86_400, 0);
    const result = await this.client.execute({
      sql: `SELECT * FROM assistant_conversation_checkpoints
        WHERE status = 'committed' AND gcMarkedAt IS NOT NULL AND gcMarkedAt <= ?
        ORDER BY gcMarkedAt LIMIT ?`,
      args: [cutoff, Math.min(Math.max(input.limit ?? 100, 1), 1_000)],
    });
    const deleted: string[] = [];
    for (const raw of result.rows) {
      const row = raw as Row;
      if (row.stateBlobRef) {
        const references = await this.client.execute({
          sql: `SELECT 1 FROM assistant_conversation_checkpoints
            WHERE id <> ? AND status = 'committed' AND stateBlobRef = ?
            LIMIT 1`,
          args: [row.id, row.stateBlobRef],
        });
        if (references.rows.length === 0) {
          await this.blobs.delete(String(row.stateBlobRef));
        }
      }
      await this.client.execute({
        sql: `DELETE FROM assistant_conversation_checkpoints
          WHERE id = ? AND gcMarkedAt IS NOT NULL`,
        args: [row.id],
      });
      deleted.push(String(row.id));
    }
    return deleted;
  }

  private async reconcileOne(
    row: Row,
  ): Promise<ConversationCheckpointRecord | null> {
    const digest = String(row.stateDigest);
    const byteLength = Number(row.stateByteLength);
    const finalRef = `private/assistant-checkpoints/${String(row.userId)}/sha256/${digest}.bin`;
    const finalHead = await this.blobs.head(finalRef);
    if (!finalHead) {
      const temporary = row.temporaryBlobRef
        ? String(row.temporaryBlobRef)
        : null;
      if (!temporary || !(await this.blobs.head(temporary))) return null;
      const bytes = await this.blobs.get(temporary, byteLength);
      if (bytes.byteLength !== byteLength || sha256(bytes) !== digest) {
        throw new Error("Staged checkpoint digest mismatch");
      }
      await this.blobs.put(finalRef, bytes);
    }
    await this.verifyBlob(finalRef, digest, byteLength);
    const transaction = await this.client.transaction("write");
    try {
      const now = nowSeconds();
      const update = await transaction.execute({
        sql: `UPDATE assistant_conversation_checkpoints
          SET status = 'committed', stateBlobRef = ?, temporaryBlobRef = NULL,
            committedAt = ?, failureCode = NULL
          WHERE id = ? AND status = 'staging'`,
        args: [finalRef, now, row.id],
      });
      if (update.rowsAffected === 1) {
        await transaction.execute({
          sql: `INSERT INTO assistant_outbox
            (id, userId, runId, checkpointId, kind, state, attempt, availableAt,
             payloadDigest, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 'checkpoint-committed', 'pending', 0, ?, ?, ?, ?)`,
          args: [
            newId("aout"),
            row.userId,
            row.runId,
            row.id,
            now,
            digest,
            now,
            now,
          ],
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    if (row.temporaryBlobRef) {
      await this.blobs.delete(String(row.temporaryBlobRef));
    }
    const adopted = await rowById(this.client, String(row.id));
    return adopted?.status === "committed" ? record(adopted) : null;
  }

  private async failStaging(id: string, code: string) {
    await this.client.execute({
      sql: `UPDATE assistant_conversation_checkpoints
        SET status = 'failed', failureCode = ?, temporaryBlobRef = NULL
        WHERE id = ? AND status = 'staging'`,
      args: [code, id],
    });
  }

  private async verifyCommitted(row: Row) {
    if (row.status !== "committed" || !row.stateBlobRef) {
      throw new ConversationStoreError(
        "not_found",
        "Only committed checkpoints are restorable",
      );
    }
    await this.verifyBlob(
      String(row.stateBlobRef),
      String(row.stateDigest),
      Number(row.stateByteLength),
    );
  }

  private async verifyBlob(key: string, digest: string, byteLength: number) {
    const head = await this.blobs.head(key);
    if (!head || head.byteLength !== byteLength) {
      throw new Error("Checkpoint object length mismatch");
    }
    const bytes = await this.blobs.get(key, byteLength);
    if (bytes.byteLength !== byteLength || sha256(bytes) !== digest) {
      throw new Error("Checkpoint object digest mismatch");
    }
  }

  private async phase(phase: CheckpointCrashPhase, id: string) {
    await this.onPhase?.(phase, id);
  }
}

export class InMemoryCheckpointBlobStore implements ConversationCheckpointBlobStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array) {
    const existing = this.objects.get(key);
    if (existing && sha256(existing) !== sha256(bytes)) {
      throw new Error("Content-addressed checkpoint key collision");
    }
    this.objects.set(key, Uint8Array.from(bytes));
  }

  async get(key: string, maxBytes: number) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error("Checkpoint object not found");
    if (bytes.byteLength > maxBytes)
      throw new Error("Checkpoint read limit exceeded");
    return Uint8Array.from(bytes);
  }

  async head(key: string) {
    const bytes = this.objects.get(key);
    return bytes ? { byteLength: bytes.byteLength } : null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}
