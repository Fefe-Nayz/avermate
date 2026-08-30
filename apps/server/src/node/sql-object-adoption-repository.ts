import type { Client, InValue, Transaction } from "@libsql/client";
import {
  objectStorageMetadataSchema,
  ownedObjectRefSchema,
  type ObjectStorageMetadata,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { canonicalFileUrl } from "../lib/storage-backend";
import { DOCUMENT_ARTIFACT_STORAGE_QUOTA_BYTES, COURSE_MEDIA_STORAGE_QUOTA_BYTES } from "../lib/storage";
import { capabilityArtifactPurpose } from "../lib/capability-artifact-policy";
import type {
  ObjectAdoptionIntent,
  ObjectAdoptionRecord,
  ObjectAdoptionRepository,
  ObjectAdoptionState,
} from "./two-phase-object-adopter";

type AdoptionSqlClient = Pick<Client, "execute" | "transaction">;
type SqlTarget = Pick<Client, "execute"> | Transaction;
type Row = Record<string, InValue>;

function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function canonicalFileId(adoptionId: string) {
  return `file_${createHash("sha256")
    .update(`node-object-adoption-v1\0${adoptionId}`)
    .digest("hex")
    .slice(0, 40)}`;
}

function metadataJson(metadata: ObjectStorageMetadata) {
  return JSON.stringify(objectStorageMetadataSchema.parse(metadata));
}

function parseMetadata(value: InValue): ObjectStorageMetadata | undefined {
  if (value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error("ADOPTION_METADATA_LEDGER_INVALID");
  }
  try {
    return objectStorageMetadataSchema.parse(JSON.parse(value));
  } catch {
    throw new Error("ADOPTION_METADATA_LEDGER_INVALID");
  }
}

function record(row: Row): ObjectAdoptionRecord {
  const ref = ownedObjectRefSchema.parse({
    ownerId: row.ownerId,
    namespace: row.namespace,
    key: row.objectKey,
  });
  const state = String(row.state) as ObjectAdoptionState;
  if (
    !["reserved", "object_committed", "adopted", "needs_operator"].includes(
      state,
    )
  ) {
    throw new Error("ADOPTION_STATE_LEDGER_INVALID");
  }
  const objectMetadata = parseMetadata(row.objectMetadataJson);
  if (objectMetadata) assertMetadataMatchesRow(objectMetadata, row);
  const canonicalRecordId =
    row.canonicalRecordId === null ? undefined : String(row.canonicalRecordId);
  const safeErrorCode =
    row.safeErrorCode === null ? undefined : String(row.safeErrorCode);
  if (state === "adopted" && !canonicalRecordId) {
    throw new Error("ADOPTION_CANONICAL_LEDGER_INCOMPLETE");
  }
  if (state !== "adopted" && canonicalRecordId) {
    throw new Error("ADOPTION_CANONICAL_LEDGER_INVALID");
  }
  if (state === "needs_operator" && !safeErrorCode) {
    throw new Error("ADOPTION_OPERATOR_LEDGER_INCOMPLETE");
  }
  return {
    adoptionId: String(row.id),
    providerId: String(row.providerId),
    ref,
    byteSize: Number(row.byteSize),
    mimeType: String(row.mimeType),
    expectedDigest: String(row.expectedDigest) as `sha256:${string}`,
    idempotencyKey: String(row.idempotencyKey),
    state,
    ...(objectMetadata ? { objectMetadata } : {}),
    ...(canonicalRecordId ? { canonicalRecordId } : {}),
    ...(safeErrorCode ? { safeErrorCode } : {}),
  };
}

function assertIntent(input: ObjectAdoptionIntent) {
  const ref = ownedObjectRefSchema.parse(input.ref);
  if (
    ref.ownerId.length > 256 ||
    !input.adoptionId ||
    input.adoptionId.length > 256
  ) {
    throw new Error("ADOPTION_ID_INVALID");
  }
  if (!input.providerId || input.providerId.length > 256) {
    throw new Error("ADOPTION_PROVIDER_INVALID");
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 256) {
    throw new Error("ADOPTION_IDEMPOTENCY_KEY_INVALID");
  }
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0) {
    throw new Error("ADOPTION_SIZE_INVALID");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.expectedDigest)) {
    throw new Error("ADOPTION_DIGEST_INVALID");
  }
  if (!input.mimeType || input.mimeType.length > 256) {
    throw new Error("ADOPTION_MIME_INVALID");
  }
  return ref;
}

function assertSameIntent(
  existing: ObjectAdoptionRecord,
  input: ObjectAdoptionIntent,
) {
  if (
    existing.adoptionId !== input.adoptionId ||
    existing.providerId !== input.providerId ||
    existing.ref.ownerId !== input.ref.ownerId ||
    existing.ref.namespace !== input.ref.namespace ||
    existing.ref.key !== input.ref.key ||
    existing.byteSize !== input.byteSize ||
    existing.mimeType !== input.mimeType ||
    existing.expectedDigest !== input.expectedDigest ||
    existing.idempotencyKey !== input.idempotencyKey
  ) {
    throw new Error("ADOPTION_IDEMPOTENCY_PAYLOAD_MISMATCH");
  }
  return existing;
}

function assertMetadataMatchesRow(metadata: ObjectStorageMetadata, row: Row) {
  const parsed = objectStorageMetadataSchema.parse(metadata);
  if (
    parsed.ref.ownerId !== String(row.ownerId) ||
    parsed.ref.namespace !== String(row.namespace) ||
    parsed.ref.key !== String(row.objectKey) ||
    parsed.byteSize !== Number(row.byteSize) ||
    parsed.mimeType !== String(row.mimeType) ||
    parsed.digest !== String(row.expectedDigest)
  ) {
    throw new Error("ADOPTION_OBJECT_METADATA_MISMATCH");
  }
  return parsed;
}

async function rowById(target: SqlTarget, adoptionId: string) {
  const result = await target.execute({
    sql: "SELECT * FROM node_object_adoptions WHERE id = ? LIMIT 1",
    args: [adoptionId],
  });
  return (result.rows[0] as Row | undefined) ?? null;
}

async function rowByIdempotency(
  target: SqlTarget,
  input: Pick<ObjectAdoptionIntent, "providerId" | "idempotencyKey"> & {
    ownerId: string;
  },
) {
  const result = await target.execute({
    sql: `SELECT * FROM node_object_adoptions
      WHERE ownerId = ? AND providerId = ? AND idempotencyKey = ? LIMIT 1`,
    args: [input.ownerId, input.providerId, input.idempotencyKey],
  });
  return (result.rows[0] as Row | undefined) ?? null;
}

/**
 * libSQL-backed adoption ledger. The canonical `files` row and the terminal
 * adoption state commit in one transaction, which closes the provider-write /
 * database-write crash window without inventing a second file authority.
 */
export class CoreObjectAdoptionRepository implements ObjectAdoptionRepository {
  constructor(
    private readonly client: AdoptionSqlClient,
    private readonly options: {
      managedProvider: string;
      quotaBytes?: number;
      clock?: () => Date;
    },
  ) {}

  async reserve(intent: ObjectAdoptionIntent): Promise<ObjectAdoptionRecord> {
    const ref = assertIntent(intent);
    try {
      return await this.write(async (transaction) => {
        const byId = await rowById(transaction, intent.adoptionId);
        if (byId) return assertSameIntent(record(byId), intent);
        const byKey = await rowByIdempotency(transaction, {
          ownerId: ref.ownerId,
          providerId: intent.providerId,
          idempotencyKey: intent.idempotencyKey,
        });
        if (byKey) return assertSameIntent(record(byKey), intent);
        const now = epochSeconds(this.clock());
        await transaction.execute({
          sql: `INSERT INTO node_object_adoptions
            (id, providerId, ownerId, namespace, objectKey, byteSize,
             mimeType, expectedDigest, idempotencyKey, state, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`,
          args: [
            intent.adoptionId,
            intent.providerId,
            ref.ownerId,
            ref.namespace,
            ref.key,
            intent.byteSize,
            intent.mimeType,
            intent.expectedDigest,
            intent.idempotencyKey,
            now,
            now,
          ],
        });
        return record((await rowById(transaction, intent.adoptionId))!);
      });
    } catch (error) {
      // A concurrent writer may have won the unique idempotency reservation.
      // Re-read and accept only the byte-for-byte same intent.
      const existing = (await this.load(intent.adoptionId)) ?? (() => null)();
      if (existing) return assertSameIntent(existing, intent);
      const byKey = await rowByIdempotency(this.client, {
        ownerId: ref.ownerId,
        providerId: intent.providerId,
        idempotencyKey: intent.idempotencyKey,
      });
      if (byKey) return assertSameIntent(record(byKey), intent);
      throw error;
    }
  }

  async load(adoptionId: string): Promise<ObjectAdoptionRecord | null> {
    if (!adoptionId || adoptionId.length > 256) {
      throw new Error("ADOPTION_ID_INVALID");
    }
    const row = await rowById(this.client, adoptionId);
    return row ? record(row) : null;
  }

  async markObjectCommitted(
    adoptionId: string,
    metadataValue: ObjectStorageMetadata,
  ): Promise<ObjectAdoptionRecord> {
    return this.write(async (transaction) => {
      const row = await rowById(transaction, adoptionId);
      if (!row) throw new Error("ADOPTION_NOT_FOUND");
      const current = record(row);
      const metadata = assertMetadataMatchesRow(metadataValue, row);
      if (current.state === "needs_operator") {
        throw new Error("ADOPTION_NEEDS_OPERATOR");
      }
      if (current.state === "adopted") return current;
      await transaction.execute({
        sql: `UPDATE node_object_adoptions
          SET state = 'object_committed', objectMetadataJson = ?,
              safeErrorCode = NULL, updatedAt = ?
          WHERE id = ? AND state IN ('reserved', 'object_committed')`,
        args: [metadataJson(metadata), epochSeconds(this.clock()), adoptionId],
      });
      return record((await rowById(transaction, adoptionId))!);
    });
  }

  async adoptCanonical(
    adoptionId: string,
    metadataValue: ObjectStorageMetadata,
  ): Promise<ObjectAdoptionRecord> {
    return this.write(async (transaction) => {
      const row = await rowById(transaction, adoptionId);
      if (!row) throw new Error("ADOPTION_NOT_FOUND");
      const current = record(row);
      const metadata = assertMetadataMatchesRow(metadataValue, row);
      const purpose = capabilityArtifactPurpose(metadata.ref.namespace);
      if (current.state === "needs_operator") {
        throw new Error("ADOPTION_NEEDS_OPERATOR");
      }
      if (current.state === "adopted") return current;
      if (current.state !== "object_committed") {
        throw new Error("ADOPTION_OBJECT_NOT_COMMITTED");
      }

      const fileId = canonicalFileId(adoptionId);
      const existingFile = (
        await transaction.execute({
          sql: `SELECT id, provider, storageKey, mimeType, byteSize, purpose,
                  status, userId
            FROM files WHERE provider = ? AND storageKey = ? LIMIT 1`,
          args: [this.options.managedProvider, metadata.ref.key],
        })
      ).rows[0] as Row | undefined;
      if (!existingFile) {
        const usage = await transaction.execute({
          sql: `SELECT COALESCE(SUM(byteSize), 0) AS total FROM files
            WHERE userId = ? AND purpose = ?
              AND status = 'stored'`,
          args: [metadata.ref.ownerId, purpose],
        });
        if (
          Number(usage.rows[0]?.total ?? 0) + metadata.byteSize >
          (this.options.quotaBytes ?? (purpose === "document-artifact" ? DOCUMENT_ARTIFACT_STORAGE_QUOTA_BYTES : purpose === "course-media" ? COURSE_MEDIA_STORAGE_QUOTA_BYTES : Number.MAX_SAFE_INTEGER))
        ) {
          throw new Error("ADOPTION_STORAGE_QUOTA_EXCEEDED");
        }
        const now = epochSeconds(this.clock());
        await transaction.execute({
          sql: `INSERT INTO files
            (id, provider, storageKey, url, mimeType, byteSize, purpose,
             status, previewStatus, userId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'stored',
                    'pending', ?, ?, ?)`,
          args: [
            fileId,
            this.options.managedProvider,
            metadata.ref.key,
            canonicalFileUrl(fileId),
            metadata.mimeType,
            metadata.byteSize,
            purpose,
            metadata.ref.ownerId,
            now,
            now,
          ],
        });
      }
      const canonical = (
        await transaction.execute({
          sql: `SELECT id, provider, storageKey, mimeType, byteSize, purpose,
                  status, userId
            FROM files WHERE provider = ? AND storageKey = ? LIMIT 1`,
          args: [this.options.managedProvider, metadata.ref.key],
        })
      ).rows[0] as Row | undefined;
      if (
        !canonical ||
        String(canonical.id) !== fileId ||
        String(canonical.userId) !== metadata.ref.ownerId ||
        String(canonical.mimeType) !== metadata.mimeType ||
        Number(canonical.byteSize) !== metadata.byteSize ||
        String(canonical.purpose) !== purpose ||
        String(canonical.status) !== "stored"
      ) {
        throw new Error("ADOPTION_CANONICAL_FILE_CONFLICT");
      }
      const updated = await transaction.execute({
        sql: `UPDATE node_object_adoptions
          SET state = 'adopted', objectMetadataJson = ?, canonicalRecordId = ?,
              safeErrorCode = NULL, updatedAt = ?
          WHERE id = ? AND state = 'object_committed'
            AND canonicalRecordId IS NULL`,
        args: [
          metadataJson(metadata),
          fileId,
          epochSeconds(this.clock()),
          adoptionId,
        ],
      });
      if (Number(updated.rowsAffected) !== 1) {
        throw new Error("ADOPTION_STATE_CONCURRENTLY_CHANGED");
      }
      return record((await rowById(transaction, adoptionId))!);
    });
  }

  async markNeedsOperator(
    adoptionId: string,
    safeErrorCodeValue: string,
  ): Promise<ObjectAdoptionRecord> {
    const safeErrorCode = safeErrorCodeValue.trim();
    if (!/^[A-Z0-9_:-]{3,128}$/u.test(safeErrorCode)) {
      throw new Error("ADOPTION_SAFE_ERROR_CODE_INVALID");
    }
    return this.write(async (transaction) => {
      const row = await rowById(transaction, adoptionId);
      if (!row) throw new Error("ADOPTION_NOT_FOUND");
      const current = record(row);
      if (current.state === "adopted") {
        throw new Error("ADOPTION_ALREADY_ADOPTED");
      }
      await transaction.execute({
        sql: `UPDATE node_object_adoptions
          SET state = 'needs_operator', safeErrorCode = ?, updatedAt = ?
          WHERE id = ? AND state <> 'adopted'`,
        args: [safeErrorCode, epochSeconds(this.clock()), adoptionId],
      });
      return record((await rowById(transaction, adoptionId))!);
    });
  }

  async *pending(limit: number): AsyncIterable<ObjectAdoptionRecord> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("ADOPTION_PENDING_LIMIT_INVALID");
    }
    const result = await this.client.execute({
      sql: `SELECT * FROM node_object_adoptions
        WHERE state IN ('reserved', 'object_committed')
        ORDER BY updatedAt, id LIMIT ?`,
      args: [limit],
    });
    for (const row of result.rows as Row[]) yield record(row);
  }

  private clock() {
    return this.options.clock?.() ?? new Date();
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
