import type { Client, InValue, Transaction } from "@libsql/client";
import {
  nodeDeletionManifestSchema,
  nodeDeletionReceiptSchema,
  objectSha256Schema,
  ownedObjectRefSchema,
  remoteDeletionStateSchema,
  type NodeDeletionManifest,
  type NodeDeletionReceipt,
  type OwnedObjectRef,
  type RemoteDeletionState,
} from "@avermate/agent-contracts";
import { canonicalProtocolJson, protocolDigest } from "./protocol-crypto";
import type {
  RemoteDeletionRecord,
  RemoteDeletionRepository,
} from "./remote-deletion";

type RemoteDeletionSqlClient = Pick<Client, "execute" | "transaction">;
type SqlTarget = Pick<Client, "execute"> | Transaction;
type Row = Record<string, InValue>;

const pendingStates = new Set<RemoteDeletionState>([
  "pending_remote_deletion",
  "revoked_unreachable",
]);

function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function one(
  target: SqlTarget,
  sql: string,
  args: InValue[] = [],
): Promise<Row | null> {
  return target.execute({ sql, args }).then((result) => {
    return (result.rows[0] as Row | undefined) ?? null;
  });
}

function parseJson(value: InValue, code: string): unknown {
  if (typeof value !== "string") throw new Error(code);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(code);
  }
}

function unsignedManifest(manifest: NodeDeletionManifest) {
  const {
    digest: _digest,
    keyId: _keyId,
    signature: _signature,
    ...unsigned
  } = manifest;
  return unsigned;
}

function validateManifest(manifestValue: unknown): NodeDeletionManifest {
  const manifest = nodeDeletionManifestSchema.parse(manifestValue);
  if (protocolDigest(unsignedManifest(manifest)) !== manifest.digest) {
    throw new Error("DELETION_MANIFEST_DIGEST_INVALID");
  }
  const refs = new Set<string>();
  for (const artifact of manifest.refs) {
    if (artifact.object.ownerId !== manifest.userId) {
      throw new Error("DELETION_MANIFEST_OWNER_MISMATCH");
    }
    const key = canonicalProtocolJson(artifact.object);
    if (refs.has(key)) throw new Error("DELETION_MANIFEST_DUPLICATE_REF");
    refs.add(key);
  }
  return manifest;
}

function recordFromRow(row: Row): RemoteDeletionRecord {
  const manifest = validateManifest(
    parseJson(row.manifestJson, "DELETION_MANIFEST_STORED_INVALID"),
  );
  if (
    String(row.manifestDigest) !== manifest.digest ||
    String(row.nodeId) !== manifest.nodeId ||
    String(row.userId) !== manifest.userId
  ) {
    throw new Error("DELETION_MANIFEST_LEDGER_MISMATCH");
  }
  const state = remoteDeletionStateSchema.parse(row.state);
  const receipt =
    row.receiptJson === null
      ? undefined
      : nodeDeletionReceiptSchema.parse(
          parseJson(row.receiptJson, "DELETION_RECEIPT_STORED_INVALID"),
        );
  const acceptedReceiptDigest =
    row.acceptedReceiptDigest === null
      ? undefined
      : (objectSha256Schema.parse(
          row.acceptedReceiptDigest,
        ) as `sha256:${string}`);
  if (state === "verified_deleted") {
    if (!receipt || !acceptedReceiptDigest) {
      throw new Error("DELETION_RECEIPT_LEDGER_INCOMPLETE");
    }
    if (
      receipt.manifestDigest !== manifest.digest ||
      receipt.nodeId !== manifest.nodeId ||
      receipt.nonce !== manifest.nonce ||
      receipt.deletedCount !== manifest.refs.length ||
      protocolDigest(receipt) !== acceptedReceiptDigest
    ) {
      throw new Error("DELETION_RECEIPT_LEDGER_MISMATCH");
    }
  } else if (receipt || acceptedReceiptDigest) {
    throw new Error("DELETION_RECEIPT_STATE_MISMATCH");
  }
  return {
    manifest,
    state,
    ...(receipt ? { receipt } : {}),
    ...(acceptedReceiptDigest ? { acceptedReceiptDigest } : {}),
    ...(row.safeOperatorInstruction === null
      ? {}
      : { safeOperatorInstruction: String(row.safeOperatorInstruction) }),
  };
}

function assertCreationRecord(record: RemoteDeletionRecord) {
  const manifest = validateManifest(record.manifest);
  if (
    record.state !== "pending_remote_deletion" ||
    record.receipt !== undefined ||
    record.acceptedReceiptDigest !== undefined ||
    record.safeOperatorInstruction !== undefined
  ) {
    throw new Error("DELETION_TOMBSTONE_INITIAL_STATE_INVALID");
  }
  return manifest;
}

function assertReceiptBinding(input: {
  manifest: NodeDeletionManifest;
  receipt: NodeDeletionReceipt;
  receiptDigest: `sha256:${string}`;
}) {
  const receipt = nodeDeletionReceiptSchema.parse(input.receipt);
  const receiptDigest = objectSha256Schema.parse(input.receiptDigest);
  if (protocolDigest(receipt) !== receiptDigest) {
    throw new Error("DELETION_RECEIPT_DIGEST_INVALID");
  }
  if (
    receipt.manifestDigest !== input.manifest.digest ||
    receipt.nodeId !== input.manifest.nodeId ||
    receipt.nonce !== input.manifest.nonce ||
    receipt.deletedCount !== input.manifest.refs.length
  ) {
    throw new Error("DELETION_RECEIPT_MANIFEST_MISMATCH");
  }
  return { receipt, receiptDigest };
}

/**
 * Durable Core ledger for remote deletion.
 *
 * The deletion row and every owned tombstone ref are committed together. A
 * manifest is consequently safe to deliver only after createTombstone returns.
 */
export class CoreRemoteDeletionRepository implements RemoteDeletionRepository {
  constructor(
    private readonly client: RemoteDeletionSqlClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async createTombstone(record: RemoteDeletionRecord): Promise<void> {
    const manifest = assertCreationRecord(record);
    await this.write(async (transaction) => {
      const existing = await this.rowByDigest(transaction, manifest.digest);
      if (existing) {
        const stored = recordFromRow(existing);
        await this.assertRefLedger(transaction, stored.manifest);
        if (
          canonicalProtocolJson(stored.manifest) !==
          canonicalProtocolJson(manifest)
        ) {
          throw new Error("DELETION_MANIFEST_DIVERGENT_REPLAY");
        }
        return;
      }

      const now = epochSeconds(this.clock());
      await transaction.execute({
        sql: `INSERT INTO node_remote_deletions
          (manifestDigest, nodeId, userId, manifestJson, state, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, 'pending_remote_deletion', ?, ?)`,
        args: [
          manifest.digest,
          manifest.nodeId,
          manifest.userId,
          canonicalProtocolJson(manifest),
          now,
          now,
        ],
      });
      for (const artifact of manifest.refs) {
        await transaction.execute({
          sql: `INSERT INTO node_remote_deletion_refs
            (manifestDigest, ownerId, namespace, objectKey)
            VALUES (?, ?, ?, ?)`,
          args: [
            manifest.digest,
            artifact.object.ownerId,
            artifact.object.namespace,
            artifact.object.key,
          ],
        });
      }
    });
  }

  async loadByManifestDigest(
    digest: string,
  ): Promise<RemoteDeletionRecord | null> {
    objectSha256Schema.parse(digest);
    const row = await this.rowByDigest(this.client, digest);
    if (!row) return null;
    const record = recordFromRow(row);
    await this.assertRefLedger(this.client, record.manifest);
    return record;
  }

  async isTombstoned(ref: OwnedObjectRef): Promise<boolean> {
    const ownedRef = ownedObjectRefSchema.parse(ref);
    const row = await one(
      this.client,
      `SELECT 1 AS tombstoned FROM node_remote_deletion_refs
       WHERE ownerId = ? AND namespace = ? AND objectKey = ? LIMIT 1`,
      [ownedRef.ownerId, ownedRef.namespace, ownedRef.key],
    );
    return row !== null;
  }

  /** Exact ref lookup used to make lifecycle retry issue idempotent. */
  async loadByRef(ref: OwnedObjectRef): Promise<RemoteDeletionRecord | null> {
    const ownedRef =
      nodeDeletionManifestSchema.shape.refs.element.shape.object.parse(ref);
    const result = await this.client.execute({
      sql: `SELECT deletion.* FROM node_remote_deletion_refs ref
        JOIN node_remote_deletions deletion
          ON deletion.manifestDigest = ref.manifestDigest
        WHERE ref.ownerId = ? AND ref.namespace = ? AND ref.objectKey = ?
        ORDER BY CASE deletion.state
          WHEN 'verified_deleted' THEN 0
          WHEN 'pending_remote_deletion' THEN 1
          WHEN 'revoked_unreachable' THEN 2
          ELSE 3
        END, deletion.createdAt DESC, deletion.updatedAt DESC,
          deletion.manifestDigest DESC LIMIT 1`,
      args: [ownedRef.ownerId, ownedRef.namespace, ownedRef.key],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row) return null;
    const loaded = recordFromRow(row);
    await this.assertRefLedger(this.client, loaded.manifest);
    return loaded;
  }

  async markVerified(
    manifestDigest: string,
    receiptValue: NodeDeletionReceipt,
    receiptDigestValue: `sha256:${string}`,
  ): Promise<void> {
    objectSha256Schema.parse(manifestDigest);
    await this.write(async (transaction) => {
      const row = await this.rowByDigest(transaction, manifestDigest);
      if (!row) throw new Error("DELETION_MANIFEST_NOT_FOUND");
      const current = recordFromRow(row);
      await this.assertRefLedger(transaction, current.manifest);
      const { receipt, receiptDigest } = assertReceiptBinding({
        manifest: current.manifest,
        receipt: receiptValue,
        receiptDigest: receiptDigestValue,
      });
      if (current.state === "verified_deleted") {
        if (
          current.acceptedReceiptDigest === receiptDigest &&
          current.receipt &&
          canonicalProtocolJson(current.receipt) ===
            canonicalProtocolJson(receipt)
        ) {
          return;
        }
        throw new Error("DELETION_RECEIPT_REPLAYED");
      }
      const result = await transaction.execute({
        sql: `UPDATE node_remote_deletions
          SET state = 'verified_deleted', receiptJson = ?,
              acceptedReceiptDigest = ?, safeOperatorInstruction = NULL,
              updatedAt = ?
          WHERE manifestDigest = ? AND state <> 'verified_deleted'
            AND receiptJson IS NULL AND acceptedReceiptDigest IS NULL`,
        args: [
          canonicalProtocolJson(receipt),
          receiptDigest,
          epochSeconds(this.clock()),
          manifestDigest,
        ],
      });
      if (Number(result.rowsAffected) !== 1) {
        throw new Error("DELETION_STATE_CONCURRENTLY_CHANGED");
      }
    });
  }

  async markState(
    manifestDigest: string,
    stateValue: Exclude<RemoteDeletionState, "verified_deleted">,
    safeOperatorInstruction?: string,
  ): Promise<void> {
    objectSha256Schema.parse(manifestDigest);
    const state = remoteDeletionStateSchema
      .exclude(["verified_deleted"])
      .parse(stateValue);
    const instruction = safeOperatorInstruction?.trim();
    if (instruction && instruction.length > 1_024) {
      throw new Error("DELETION_OPERATOR_INSTRUCTION_INVALID");
    }
    if (state === "user_action_required" && !instruction) {
      throw new Error("DELETION_OPERATOR_INSTRUCTION_REQUIRED");
    }
    if (state === "pending_remote_deletion" && instruction) {
      throw new Error("DELETION_OPERATOR_INSTRUCTION_INVALID");
    }

    await this.write(async (transaction) => {
      const row = await this.rowByDigest(transaction, manifestDigest);
      if (!row) throw new Error("DELETION_MANIFEST_NOT_FOUND");
      const current = recordFromRow(row);
      await this.assertRefLedger(transaction, current.manifest);
      if (current.state === "verified_deleted") {
        throw new Error("DELETION_ALREADY_VERIFIED");
      }
      if (
        current.state === state &&
        (current.safeOperatorInstruction ?? undefined) === instruction
      ) {
        return;
      }
      const result = await transaction.execute({
        sql: `UPDATE node_remote_deletions
          SET state = ?, safeOperatorInstruction = ?, updatedAt = ?
          WHERE manifestDigest = ? AND state <> 'verified_deleted'
            AND receiptJson IS NULL AND acceptedReceiptDigest IS NULL`,
        args: [
          state,
          instruction ?? null,
          epochSeconds(this.clock()),
          manifestDigest,
        ],
      });
      if (Number(result.rowsAffected) !== 1) {
        throw new Error("DELETION_STATE_CONCURRENTLY_CHANGED");
      }
    });
  }

  async *pendingForNode(
    nodeId: string,
    limit: number,
  ): AsyncIterable<RemoteDeletionRecord> {
    if (!nodeId || nodeId.length > 256) throw new Error("NODE_ID_INVALID");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("DELETION_PENDING_LIMIT_INVALID");
    }
    const result = await this.client.execute({
      sql: `SELECT * FROM node_remote_deletions
        WHERE nodeId = ?
          AND state IN ('pending_remote_deletion', 'revoked_unreachable')
        ORDER BY createdAt ASC, manifestDigest ASC LIMIT ?`,
      args: [nodeId, limit],
    });
    for (const row of result.rows as Row[]) {
      const record = recordFromRow(row);
      if (
        !pendingStates.has(record.state) ||
        record.manifest.nodeId !== nodeId
      ) {
        throw new Error("DELETION_PENDING_LEDGER_MISMATCH");
      }
      await this.assertRefLedger(this.client, record.manifest);
      yield record;
    }
  }

  /**
   * Owner-scoped operator view. The repository still validates every stored
   * manifest/ref ledger before returning it; callers should expose only the
   * safe summary fields required by their UI.
   */
  async listForOwner(input: {
    ownerId: string;
    nodeId?: string;
    state?: RemoteDeletionState;
    limit?: number;
  }): Promise<
    Array<{
      record: RemoteDeletionRecord;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    if (!input.ownerId || input.ownerId.length > 256) {
      throw new Error("DELETION_OWNER_ID_INVALID");
    }
    if (input.nodeId !== undefined && (!input.nodeId || input.nodeId.length > 256)) {
      throw new Error("NODE_ID_INVALID");
    }
    const state = input.state
      ? remoteDeletionStateSchema.parse(input.state)
      : undefined;
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
      throw new Error("DELETION_LIST_LIMIT_INVALID");
    }
    const result = await this.client.execute({
      sql: `SELECT manifestDigest, nodeId, userId, manifestJson, state,
          receiptJson, acceptedReceiptDigest, safeOperatorInstruction,
          createdAt, updatedAt
        FROM node_remote_deletions
        WHERE userId = ? AND (? IS NULL OR nodeId = ?)
          AND (? IS NULL OR state = ?)
        ORDER BY updatedAt DESC, manifestDigest DESC LIMIT ?`,
      args: [
        input.ownerId,
        input.nodeId ?? null,
        input.nodeId ?? null,
        state ?? null,
        state ?? null,
        limit,
      ],
    });
    const records = [];
    for (const row of result.rows as Row[]) {
      const record = recordFromRow(row);
      if (record.manifest.userId !== input.ownerId) {
        throw new Error("DELETION_OWNER_LEDGER_MISMATCH");
      }
      await this.assertRefLedger(this.client, record.manifest);
      records.push({
        record,
        createdAt: new Date(Number(row.createdAt) * 1_000),
        updatedAt: new Date(Number(row.updatedAt) * 1_000),
      });
    }
    return records;
  }

  private rowByDigest(target: SqlTarget, digest: string): Promise<Row | null> {
    return one(
      target,
      `SELECT manifestDigest, nodeId, userId, manifestJson, state, receiptJson,
              acceptedReceiptDigest, safeOperatorInstruction, createdAt, updatedAt
       FROM node_remote_deletions WHERE manifestDigest = ? LIMIT 1`,
      [digest],
    );
  }

  private async assertRefLedger(
    target: SqlTarget,
    manifest: NodeDeletionManifest,
  ): Promise<void> {
    const result = await target.execute({
      sql: `SELECT ownerId, namespace, objectKey
        FROM node_remote_deletion_refs
        WHERE manifestDigest = ? ORDER BY ownerId, namespace, objectKey`,
      args: [manifest.digest],
    });
    const stored = (result.rows as Row[]).map((row) =>
      canonicalProtocolJson({
        ownerId: String(row.ownerId),
        namespace: String(row.namespace),
        key: String(row.objectKey),
      }),
    );
    const expected = manifest.refs
      .map((artifact) => canonicalProtocolJson(artifact.object))
      .sort((left, right) => left.localeCompare(right));
    if (
      stored.length !== expected.length ||
      stored.some((ref, index) => ref !== expected[index])
    ) {
      throw new Error("DELETION_TOMBSTONE_LEDGER_MISMATCH");
    }
  }

  private async write<T>(
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
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
