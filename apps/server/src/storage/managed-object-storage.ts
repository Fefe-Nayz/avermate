import { createHmac } from "node:crypto";
import type { Client, InValue } from "@libsql/client";
import {
  objectSha256Schema,
  ownedObjectRefSchema,
  type MultipartAbortInput,
  type MultipartBeginInput,
  type MultipartCompleteInput,
  type MultipartHandle,
  type MultipartPartInput,
  type MultipartPartReceipt,
  type ObjectSha256,
  type ObjectStorageCapabilities,
  type ObjectStorageCommit,
  type ObjectStorageCopyInput,
  type ObjectStorageDeleteInput,
  type ObjectStorageDeleteResult,
  type ObjectStorageEntry,
  type ObjectStorageGetInput,
  type ObjectStorageMetadata,
  type ObjectStorageProvider,
  type ObjectStorageRange,
  type ObjectStorageRangeInput,
  type ObjectStorageReconcileInput,
  type ObjectStorageStatInput,
  type ObjectTransferGrant,
  type ObjectTransferGrantInput,
  type OwnedObjectRef,
} from "@avermate/agent-contracts";
import type { EntitlementSqlClient } from "../entitlements/service";
import type { UsageLedger } from "../usage/ledger";

type Row = Record<string, InValue>;

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function iso(value: InValue) {
  const numeric = Number(value);
  return new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric).toISOString();
}

export class ManagedStorageError extends Error {
  constructor(
    readonly code:
      | "not-found"
      | "forbidden"
      | "conflict"
      | "adoption-required"
      | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "ManagedStorageError";
  }
}

/**
 * Multi-tenant managed placement over the plan-032 storage contract. Logical
 * refs never become physical path authority and each tenant maps to a distinct
 * provider owner prefix.
 */
export class ManagedObjectStorageProvider implements ObjectStorageProvider {
  readonly id: string;
  readonly #client: EntitlementSqlClient;
  readonly #delegate: ObjectStorageProvider;
  readonly #usage: UsageLedger;
  readonly #key: Uint8Array;
  readonly #clock: () => Date;
  readonly #region: string;

  constructor(input: {
    id: string;
    client: EntitlementSqlClient;
    delegate: ObjectStorageProvider;
    usage: UsageLedger;
    namespaceKey: Uint8Array | string;
    region: string;
    clock?: () => Date;
  }) {
    if (input.id.length === 0) throw new Error("Managed storage id is required");
    const key =
      typeof input.namespaceKey === "string"
        ? new TextEncoder().encode(input.namespaceKey)
        : input.namespaceKey;
    if (key.byteLength < 32) {
      throw new Error("Managed storage namespace key must contain 32 bytes");
    }
    this.id = input.id;
    this.#client = input.client;
    this.#delegate = input.delegate;
    this.#usage = input.usage;
    this.#key = key;
    this.#region = input.region;
    this.#clock = input.clock ?? (() => new Date());
  }

  async capabilities(): Promise<ObjectStorageCapabilities> {
    const delegated = await this.#delegate.capabilities();
    return { ...delegated, providerId: this.id };
  }

  async stat(input: ObjectStorageStatInput) {
    const ref = ownedObjectRefSchema.parse(input.ref);
    const row = await this.#ownedRow(ref);
    if (!row || row.deletedAt !== null || String(row.category) !== "committed") {
      return null;
    }
    const physical = this.#physicalRef(ref);
    const metadata = await this.#delegate.stat({ ref: physical });
    if (!metadata) return null;
    return this.#logicalMetadata(ref, metadata);
  }

  async get(input: ObjectStorageGetInput) {
    const ref = ownedObjectRefSchema.parse(input.ref);
    await this.#requireCommitted(ref);
    return this.#delegate.get({ ...input, ref: this.#physicalRef(ref) });
  }

  async getRange(input: ObjectStorageRangeInput): Promise<ObjectStorageRange> {
    const ref = ownedObjectRefSchema.parse(input.ref);
    await this.#requireCommitted(ref);
    const result = await this.#delegate.getRange({
      ...input,
      ref: this.#physicalRef(ref),
    });
    return {
      ...result,
      metadata: this.#logicalMetadata(ref, result.metadata),
    };
  }

  async put(
    input: Parameters<ObjectStorageProvider["put"]>[0],
  ): Promise<ObjectStorageCommit> {
    const ref = ownedObjectRefSchema.parse(input.ref);
    const digest = objectSha256Schema.parse(input.expectedDigest);
    const reservation = await this.#usage.reserve({
      accountId: ref.ownerId,
      userId: ref.ownerId,
      capability: "storage.bytes",
      unit: "bytes",
      maximumQuantity: String(input.byteSize),
      idempotencyKey: `storage-put:${input.idempotencyKey}`,
      placement: { kind: "managed", providerId: this.id },
      provider: this.#delegate.id,
      expiresAt: new Date(this.#clock().getTime() + 60 * 60_000),
      estimatorVersion: "declared-upload-size/1",
    });
    await this.#upsertPending(ref, digest, input.byteSize, input.mimeType, reservation.reservation.id);
    const committed = await this.#delegate.put({
      ...input,
      ref: this.#physicalRef(ref),
      idempotencyKey: `managed:${reservation.reservation.id}`,
    });
    await this.#adopt(ref, committed, reservation.reservation.id);
    await this.#usage.settle({
      accountId: ref.ownerId,
      reservationId: reservation.reservation.id,
      actualQuantity: String(committed.byteSize),
      outcome: "completed",
      authoritative: true,
      provider: this.#delegate.id,
    });
    return this.#logicalCommit(ref, committed);
  }

  async delete(
    input: ObjectStorageDeleteInput,
  ): Promise<ObjectStorageDeleteResult> {
    const ref = ownedObjectRefSchema.parse(input.ref);
    const row = await this.#ownedRow(ref);
    if (!row || row.deletedAt !== null) {
      return { ref, deleted: false, alreadyAbsent: true };
    }
    if (
      input.expectedDigest &&
      String(row.digest) !== input.expectedDigest
    ) {
      throw new ManagedStorageError(
        "conflict",
        "Stored object digest differs from delete precondition",
      );
    }
    const physical = this.#physicalRef(ref);
    const result = await this.#delegate.delete({
      ref: physical,
      expectedDigest: input.expectedDigest,
      idempotencyKey: `managed:${input.idempotencyKey}`,
    });
    if (await this.#delegate.stat({ ref: physical })) {
      throw new ManagedStorageError(
        "adoption-required",
        "Managed object deletion could not be verified",
      );
    }
    await this.#client.execute({
      sql: `UPDATE managed_storage_objects SET deletedAt = ?, category = 'trash'
        WHERE accountId = ? AND namespace = ? AND logicalKey = ?`,
      args: [seconds(this.#clock()), ref.ownerId, ref.namespace, ref.key],
    });
    const bytes = BigInt(String(row.byteSize));
    if (bytes > 0n) {
      await this.#usage.adjust({
        accountId: ref.ownerId,
        userId: ref.ownerId,
        capability: "storage.bytes",
        unit: "bytes",
        signedQuantity: (-bytes).toString(),
        idempotencyKey: `storage-delete:${input.idempotencyKey}`,
        placement: { kind: "managed", providerId: this.id },
        actorId: "managed-storage-reconciler",
        reason: "Verified managed object deletion",
        evidenceRef: String(row.digest),
        correlationId: `storage:${input.idempotencyKey}`,
      });
    }
    return {
      ref,
      deleted: result.deleted,
      alreadyAbsent: result.alreadyAbsent,
    };
  }

  async beginMultipart(input: MultipartBeginInput): Promise<MultipartHandle> {
    const ref = ownedObjectRefSchema.parse(input.ref);
    const reservation = await this.#usage.reserve({
      accountId: ref.ownerId,
      userId: ref.ownerId,
      capability: "storage.bytes",
      unit: "bytes",
      maximumQuantity: String(input.byteSize),
      idempotencyKey: `storage-multipart:${input.idempotencyKey}`,
      placement: { kind: "managed", providerId: this.id },
      provider: this.#delegate.id,
      expiresAt: new Date(this.#clock().getTime() + 60 * 60_000),
      estimatorVersion: "declared-multipart-size/1",
    });
    await this.#upsertPending(
      ref,
      input.expectedDigest,
      input.byteSize,
      input.mimeType,
      reservation.reservation.id,
    );
    const delegated = await this.#delegate.beginMultipart({
      ...input,
      ref: this.#physicalRef(ref),
      idempotencyKey: `managed:${reservation.reservation.id}`,
    });
    await this.#client.execute({
      sql: `UPDATE usage_reservations SET jobId = ?
        WHERE id = ? AND accountId = ? AND status = 'reserved'`,
      args: [delegated.uploadId, reservation.reservation.id, ref.ownerId],
    });
    return {
      ...delegated,
      uploadId: reservation.reservation.id,
      ref,
      replayed: reservation.replayed || delegated.replayed,
    };
  }

  async uploadPart(input: MultipartPartInput): Promise<MultipartPartReceipt> {
    const mapping = await this.#multipart(input.uploadId, input.ownerId);
    const receipt = await this.#delegate.uploadPart({
      ...input,
      uploadId: mapping.delegatedUploadId,
      ownerId: this.#tenantOwner(input.ownerId),
    });
    return { ...receipt, uploadId: input.uploadId };
  }

  async completeMultipart(
    input: MultipartCompleteInput,
  ): Promise<ObjectStorageCommit> {
    const mapping = await this.#multipart(input.uploadId, input.ownerId);
    const committed = await this.#delegate.completeMultipart({
      ...input,
      uploadId: mapping.delegatedUploadId,
      ownerId: this.#tenantOwner(input.ownerId),
    });
    await this.#adopt(mapping.ref, committed, input.uploadId);
    await this.#usage.settle({
      accountId: input.ownerId,
      reservationId: input.uploadId,
      actualQuantity: String(committed.byteSize),
      outcome: "completed",
      authoritative: true,
      provider: this.#delegate.id,
    });
    return this.#logicalCommit(mapping.ref, committed);
  }

  async abortMultipart(input: MultipartAbortInput): Promise<void> {
    const mapping = await this.#multipart(input.uploadId, input.ownerId);
    await this.#delegate.abortMultipart({
      uploadId: mapping.delegatedUploadId,
      ownerId: this.#tenantOwner(input.ownerId),
    });
    await this.#usage.settle({
      accountId: input.ownerId,
      reservationId: input.uploadId,
      actualQuantity: "0",
      outcome: "cancelled",
      authoritative: false,
      provider: this.#delegate.id,
    });
    await this.#client.execute({
      sql: `UPDATE managed_storage_objects SET deletedAt = ?, category = 'trash'
        WHERE reservationId = ? AND accountId = ?`,
      args: [seconds(this.#clock()), input.uploadId, input.ownerId],
    });
  }

  async copy(input: ObjectStorageCopyInput): Promise<ObjectStorageCommit> {
    const source = ownedObjectRefSchema.parse(input.source);
    const destination = ownedObjectRefSchema.parse(input.destination);
    if (source.ownerId !== destination.ownerId) {
      throw new ManagedStorageError(
        "forbidden",
        "Cross-account managed object copy is forbidden",
      );
    }
    const sourceMetadata = await this.stat({ ref: source });
    if (!sourceMetadata) throw new ManagedStorageError("not-found", "Object not found");
    if (sourceMetadata.digest !== input.expectedSourceDigest) {
      throw new ManagedStorageError("conflict", "Source digest changed");
    }
    if (this.#delegate.copy) {
      const reservation = await this.#usage.reserve({
        accountId: destination.ownerId,
        userId: destination.ownerId,
        capability: "storage.bytes",
        unit: "bytes",
        maximumQuantity: String(sourceMetadata.byteSize),
        idempotencyKey: `storage-copy:${input.idempotencyKey}`,
        placement: { kind: "managed", providerId: this.id },
        provider: this.#delegate.id,
        expiresAt: new Date(this.#clock().getTime() + 60 * 60_000),
        estimatorVersion: "source-stat-size/1",
      });
      await this.#upsertPending(
        destination,
        sourceMetadata.digest,
        sourceMetadata.byteSize,
        sourceMetadata.mimeType,
        reservation.reservation.id,
      );
      const committed = await this.#delegate.copy({
        source: this.#physicalRef(source),
        destination: this.#physicalRef(destination),
        expectedSourceDigest: input.expectedSourceDigest,
        idempotencyKey: `managed:${reservation.reservation.id}`,
      });
      await this.#adopt(destination, committed, reservation.reservation.id);
      await this.#usage.settle({
        accountId: destination.ownerId,
        reservationId: reservation.reservation.id,
        actualQuantity: String(committed.byteSize),
        outcome: "completed",
        authoritative: true,
        provider: this.#delegate.id,
      });
      return this.#logicalCommit(destination, committed);
    }
    return this.put({
      ref: destination,
      body: await this.get({ ref: source }),
      byteSize: sourceMetadata.byteSize,
      mimeType: sourceMetadata.mimeType,
      expectedDigest: sourceMetadata.digest,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async *reconcile(
    input: ObjectStorageReconcileInput,
  ): AsyncIterable<ObjectStorageEntry> {
    const limit = Math.max(1, Math.min(input.limit ?? 250, 1_000));
    const rows = await this.#client.execute({
      sql: `SELECT * FROM managed_storage_objects
        WHERE accountId = ? AND namespace = ? AND deletedAt IS NULL
          AND logicalKey > ? ORDER BY logicalKey ASC LIMIT ?`,
      args: [input.ownerId, input.namespace, input.afterKey ?? "", limit],
    });
    for (const row of rows.rows as Row[]) {
      const ref: OwnedObjectRef = {
        ownerId: input.ownerId,
        namespace: input.namespace,
        key: String(row.logicalKey),
      };
      const physical = await this.#delegate.stat({ ref: this.#physicalRef(ref) });
      if (!physical) continue;
      if (
        String(row.category) === "pending" &&
        physical.digest === String(row.digest) &&
        String(physical.byteSize) === String(row.byteSize)
      ) {
        if (row.reservationId === null) {
          throw new ManagedStorageError(
            "adoption-required",
            "Pending managed object has no usage reservation",
          );
        }
        const reservationId = String(row.reservationId);
        await this.#adopt(ref, physical, reservationId);
        await this.#usage.settle({
          accountId: input.ownerId,
          reservationId,
          actualQuantity: String(physical.byteSize),
          outcome: "completed",
          authoritative: true,
          provider: this.#delegate.id,
          evidenceRef: physical.digest,
        });
      }
      yield this.#logicalMetadata(ref, physical);
    }
  }

  async authorizeTransfer(
    input: ObjectTransferGrantInput,
  ): Promise<ObjectTransferGrant> {
    const ref = ownedObjectRefSchema.parse(input.ref);
    if (input.operation === "download") await this.#requireCommitted(ref);
    const grant = await this.#delegate.authorizeTransfer({
      ...input,
      ref: this.#physicalRef(ref),
    });
    return { ...grant, ref };
  }

  async usageBreakdown(accountId: string) {
    const rows = await this.#client.execute({
      sql: `SELECT category, byteSize FROM managed_storage_objects
        WHERE accountId = ? AND deletedAt IS NULL`,
      args: [accountId],
    });
    const result = {
      committed: 0n,
      trash: 0n,
      pending: 0n,
      scratch: 0n,
      reserved: 0n,
    };
    for (const row of rows.rows as Row[]) {
      const category = String(row.category) as keyof typeof result;
      result[category] += BigInt(String(row.byteSize));
    }
    return Object.fromEntries(
      Object.entries(result).map(([key, value]) => [key, value.toString()]),
    ) as Record<keyof typeof result, string>;
  }

  #tenantOwner(accountId: string) {
    return `tenant-${createHmac("sha256", this.#key)
      .update(`account\0${accountId}`)
      .digest("hex")
      .slice(0, 40)}`;
  }

  #physicalRef(ref: OwnedObjectRef): OwnedObjectRef {
    return {
      ownerId: this.#tenantOwner(ref.ownerId),
      namespace: "managed-objects",
      key: createHmac("sha256", this.#key)
        .update(`object\0${this.#region}\0${ref.ownerId}\0${ref.namespace}\0${ref.key}`)
        .digest("hex"),
    };
  }

  #logicalMetadata(
    ref: OwnedObjectRef,
    metadata: ObjectStorageMetadata,
  ): ObjectStorageMetadata {
    return { ...metadata, ref };
  }

  #logicalCommit(
    ref: OwnedObjectRef,
    metadata: ObjectStorageCommit,
  ): ObjectStorageCommit {
    return { ...metadata, ref };
  }

  async #ownedRow(ref: OwnedObjectRef): Promise<Row | null> {
    const rows = await this.#client.execute({
      sql: `SELECT * FROM managed_storage_objects
        WHERE accountId = ? AND namespace = ? AND logicalKey = ? LIMIT 1`,
      args: [ref.ownerId, ref.namespace, ref.key],
    });
    return (rows.rows[0] as Row | undefined) ?? null;
  }

  async #requireCommitted(ref: OwnedObjectRef) {
    const row = await this.#ownedRow(ref);
    if (!row || row.deletedAt !== null || String(row.category) !== "committed") {
      // Identical error for missing and foreign objects avoids an existence oracle.
      throw new ManagedStorageError("not-found", "Managed object not found");
    }
    return row;
  }

  async #upsertPending(
    ref: OwnedObjectRef,
    digest: ObjectSha256,
    byteSize: number,
    mimeType: string,
    reservationId: string,
  ) {
    const physical = this.#physicalRef(ref);
    const existing = await this.#ownedRow(ref);
    if (
      existing &&
      existing.deletedAt === null &&
      (String(existing.digest) !== digest ||
        String(existing.byteSize) !== String(byteSize))
    ) {
      throw new ManagedStorageError(
        "conflict",
        "Logical object key is already bound to different content",
      );
    }
    await this.#client.execute({
      sql: `INSERT INTO managed_storage_objects
        (accountId, namespace, logicalKey, physicalKey, digest, byteSize,
         mimeType, category, placementJson, reservationId, committedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        ON CONFLICT(accountId, namespace, logicalKey) DO UPDATE SET
          reservationId = CASE
            WHEN managed_storage_objects.category = 'pending'
            THEN excluded.reservationId ELSE managed_storage_objects.reservationId END`,
      args: [
        ref.ownerId,
        ref.namespace,
        ref.key,
        `${physical.ownerId}/${physical.namespace}/${physical.key}`,
        digest,
        String(byteSize),
        mimeType,
        JSON.stringify({ kind: "managed", providerId: this.id }),
        reservationId,
        seconds(this.#clock()),
      ],
    });
  }

  async #adopt(
    ref: OwnedObjectRef,
    committed: ObjectStorageMetadata,
    reservationId: string,
  ) {
    const changed = await this.#client.execute({
      sql: `UPDATE managed_storage_objects SET
          digest = ?, byteSize = ?, mimeType = ?, category = 'committed',
          reservationId = ?, committedAt = ?, deletedAt = NULL
        WHERE accountId = ? AND namespace = ? AND logicalKey = ?
          AND (category = 'pending' OR
            (digest = ? AND byteSize = ? AND category = 'committed'))`,
      args: [
        committed.digest,
        String(committed.byteSize),
        committed.mimeType,
        reservationId,
        seconds(new Date(committed.updatedAt)),
        ref.ownerId,
        ref.namespace,
        ref.key,
        committed.digest,
        String(committed.byteSize),
      ],
    });
    if (changed.rowsAffected !== 1) {
      throw new ManagedStorageError(
        "adoption-required",
        "Managed object committed but ledger adoption requires inspection",
      );
    }
  }

  async #multipart(uploadId: string, ownerId: string) {
    const rows = await this.#client.execute({
      sql: `SELECT r.jobId, o.namespace, o.logicalKey
        FROM usage_reservations r
        JOIN managed_storage_objects o ON o.reservationId = r.id
        WHERE r.id = ? AND r.accountId = ? AND r.capability = 'storage.bytes'
          AND r.status = 'reserved' AND o.deletedAt IS NULL LIMIT 1`,
      args: [uploadId, ownerId],
    });
    const row = rows.rows[0] as Row | undefined;
    if (!row?.jobId) {
      throw new ManagedStorageError("not-found", "Multipart upload not found");
    }
    return {
      delegatedUploadId: String(row.jobId),
      ref: ownedObjectRefSchema.parse({
        ownerId,
        namespace: String(row.namespace),
        key: String(row.logicalKey),
      }),
    };
  }
}
