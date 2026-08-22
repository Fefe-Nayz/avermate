import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type {
  MultipartAbortInput,
  MultipartBeginInput,
  MultipartCompleteInput,
  MultipartPartInput,
  ObjectSha256,
  ObjectStorageMetadata,
  ObjectStorageProvider,
  OwnedObjectRef,
} from "@avermate/agent-contracts";
import { EntitlementService } from "../entitlements/service";
import { capabilityMap } from "../entitlements/capabilities";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import { UsageLedger } from "../usage/ledger";
import {
  ManagedObjectStorageProvider,
  ManagedStorageError,
} from "./managed-object-storage";

const now = new Date("2026-08-22T12:00:00.000Z");

function key(ref: OwnedObjectRef) {
  return `${ref.ownerId}\0${ref.namespace}\0${ref.key}`;
}

function digest(bytes: Uint8Array): ObjectSha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

class MemoryObjectStorage implements ObjectStorageProvider {
  readonly id = "memory-physical";
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; metadata: ObjectStorageMetadata }
  >();
  lastPutRef?: OwnedObjectRef;
  failAfterWriteOnce = false;

  async capabilities() {
    return {
      providerId: this.id,
      maxObjectBytes: 10_000_000,
      maxPartBytes: 10_000_000,
      minPartBytes: 1,
      multipart: false,
      range: true,
      copy: false,
      reconcile: true,
      directTransfer: false,
      checksumAlgorithms: ["sha256"] as ["sha256"],
    };
  }

  async stat(input: { ref: OwnedObjectRef }) {
    return this.objects.get(key(input.ref))?.metadata ?? null;
  }

  async get(input: { ref: OwnedObjectRef; maxBytes?: number }) {
    const object = this.objects.get(key(input.ref));
    if (!object) throw new Error("NOT_FOUND");
    if (input.maxBytes && object.bytes.byteLength > input.maxBytes) {
      throw new Error("MAX_BYTES_EXCEEDED");
    }
    return stream(object.bytes);
  }

  async getRange(input: {
    ref: OwnedObjectRef;
    start: number;
    endInclusive: number;
  }) {
    const object = this.objects.get(key(input.ref));
    if (!object) throw new Error("NOT_FOUND");
    const bytes = object.bytes.slice(input.start, input.endInclusive + 1);
    return {
      metadata: object.metadata,
      start: input.start,
      endInclusive: input.start + bytes.byteLength - 1,
      totalBytes: object.bytes.byteLength,
      body: stream(bytes),
    };
  }

  async put(input: Parameters<ObjectStorageProvider["put"]>[0]) {
    const bytes = new Uint8Array(await new Response(input.body).arrayBuffer());
    if (bytes.byteLength !== input.byteSize || digest(bytes) !== input.expectedDigest) {
      throw new Error("CONTENT_MISMATCH");
    }
    this.lastPutRef = input.ref;
    const timestamp = now.toISOString();
    const metadata: ObjectStorageMetadata = {
      ref: input.ref,
      byteSize: bytes.byteLength,
      mimeType: input.mimeType,
      digest: input.expectedDigest,
      etag: input.expectedDigest,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const replayed = this.objects.has(key(input.ref));
    this.objects.set(key(input.ref), { bytes, metadata });
    if (this.failAfterWriteOnce) {
      this.failAfterWriteOnce = false;
      throw new Error("WORKER_CRASH_AFTER_OBJECT_COMMIT");
    }
    return { ...metadata, replayed };
  }

  async delete(input: Parameters<ObjectStorageProvider["delete"]>[0]) {
    const existing = this.objects.get(key(input.ref));
    if (!existing) {
      return { ref: input.ref, deleted: false, alreadyAbsent: true };
    }
    if (input.expectedDigest && input.expectedDigest !== existing.metadata.digest) {
      throw new Error("DIGEST_CONFLICT");
    }
    this.objects.delete(key(input.ref));
    return { ref: input.ref, deleted: true, alreadyAbsent: false };
  }

  beginMultipart(_input: MultipartBeginInput): Promise<never> {
    return Promise.reject(new Error("UNSUPPORTED"));
  }
  uploadPart(_input: MultipartPartInput): Promise<never> {
    return Promise.reject(new Error("UNSUPPORTED"));
  }
  completeMultipart(_input: MultipartCompleteInput): Promise<never> {
    return Promise.reject(new Error("UNSUPPORTED"));
  }
  abortMultipart(_input: MultipartAbortInput): Promise<void> {
    return Promise.reject(new Error("UNSUPPORTED"));
  }

  async *reconcile(input: {
    ownerId: string;
    namespace: string;
    afterKey?: string;
    limit?: number;
  }) {
    for (const object of this.objects.values()) {
      if (
        object.metadata.ref.ownerId === input.ownerId &&
        object.metadata.ref.namespace === input.namespace
      ) {
        yield object.metadata;
      }
    }
  }

  async authorizeTransfer(
    input: Parameters<ObjectStorageProvider["authorizeTransfer"]>[0],
  ) {
    return {
      grantId: "fixture-grant",
      ref: input.ref,
      operation: input.operation,
      mode: input.mode,
      audience: input.audience,
      byteLimit: input.byteLimit,
      expectedDigest: input.expectedDigest,
      expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1_000).toISOString(),
      token: "fixture-token-that-is-at-least-thirty-two-characters",
    };
  }
}

async function managedFixture() {
  const client = await createManagedTestDatabase();
  const entitlement = new EntitlementService(client, {
    mode: "enforce",
    clock: () => now,
    cacheTtlMs: 0,
  });
  for (const accountId of ["account-a", "account-b"]) {
    await entitlement.publishSnapshot(
      {
        version: 1,
        id: `storage-snapshot-${accountId}`,
        accountId,
        revision: "storage-test/1",
        plan: "test",
        status: "active",
        period: {
          startsAt: "2026-08-01T00:00:00.000Z",
          endsAt: "2026-09-01T00:00:00.000Z",
        },
        capabilities: capabilityMap((_capability, unit) => ({
          enabled: true,
          unit,
          hardLimit: "10000000",
          concurrency: 100,
        })),
        source: "operator",
        issuedAt: now.toISOString(),
      },
      {
        actorId: "test-admin",
        justification: "fixture",
        correlationId: `snapshot-${accountId}`,
      },
    );
  }
  const usage = new UsageLedger(client, entitlement, { clock: () => now });
  const delegate = new MemoryObjectStorage();
  const managed = new ManagedObjectStorageProvider({
    id: "managed-eu",
    client,
    delegate,
    usage,
    namespaceKey: "a".repeat(32),
    region: "eu-test-1",
    clock: () => now,
  });
  return { client, delegate, managed, usage };
}

async function read(streamValue: ReadableStream<Uint8Array>) {
  return new TextDecoder().decode(await new Response(streamValue).arrayBuffer());
}

describe.serial("managed multi-tenant object storage", () => {
  test("uses opaque physical identities and denies stat/range/download/copy across tenants", async () => {
    const fixture = await managedFixture();
    try {
      const bytes = new TextEncoder().encode("tenant-a-private-document");
      const ref = {
        ownerId: "account-a",
        namespace: "materials",
        key: "course/chapter-1.pdf",
      };
      const committed = await fixture.managed.put({
        ref,
        body: stream(bytes),
        byteSize: bytes.byteLength,
        mimeType: "application/pdf",
        expectedDigest: digest(bytes),
        idempotencyKey: "upload-1",
      });
      expect(committed.ref).toEqual(ref);
      expect(fixture.delegate.lastPutRef?.ownerId).not.toContain("account-a");
      expect(fixture.delegate.lastPutRef?.key).not.toContain("chapter-1");
      expect(await read(await fixture.managed.get({ ref }))).toBe(
        "tenant-a-private-document",
      );
      expect(
        await read(
          (
            await fixture.managed.getRange({
              ref,
              start: 0,
              endInclusive: 7,
            })
          ).body,
        ),
      ).toBe("tenant-a");

      const foreign = { ...ref, ownerId: "account-b" };
      expect(await fixture.managed.stat({ ref: foreign })).toBeNull();
      await expect(fixture.managed.get({ ref: foreign })).rejects.toMatchObject({
        code: "not-found",
      });
      await expect(
        fixture.managed.getRange({ ref: foreign, start: 0, endInclusive: 1 }),
      ).rejects.toBeInstanceOf(ManagedStorageError);
      await expect(
        fixture.managed.copy({
          source: ref,
          destination: { ...ref, ownerId: "account-b", key: "copy.pdf" },
          expectedSourceDigest: digest(bytes),
          idempotencyKey: "cross-tenant-copy",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });

      expect(await fixture.managed.usageBreakdown("account-a")).toMatchObject({
        committed: String(bytes.byteLength),
        pending: "0",
      });
      await fixture.managed.delete({
        ref,
        expectedDigest: digest(bytes),
        idempotencyKey: "delete-1",
      });
      expect(await fixture.managed.stat({ ref })).toBeNull();
      expect(await fixture.usage.totals("account-a", "storage.bytes")).toMatchObject({
        consumed: String(bytes.byteLength),
        adjusted: String(-bytes.byteLength),
        netConsumed: "0",
      });
    } finally {
      await closeManagedTestDatabase(fixture.client);
    }
  });

  test("reconciles object-commit-before-DB-adoption without listing another tenant", async () => {
    const fixture = await managedFixture();
    try {
      const bytes = new TextEncoder().encode("recoverable");
      const ref = {
        ownerId: "account-a",
        namespace: "artifacts",
        key: "crash-window.bin",
      };
      fixture.delegate.failAfterWriteOnce = true;
      await expect(
        fixture.managed.put({
          ref,
          body: stream(bytes),
          byteSize: bytes.byteLength,
          mimeType: "application/octet-stream",
          expectedDigest: digest(bytes),
          idempotencyKey: "crash-window",
        }),
      ).rejects.toThrow("WORKER_CRASH_AFTER_OBJECT_COMMIT");
      expect(await fixture.managed.stat({ ref })).toBeNull();

      const reconciled = [];
      for await (const entry of fixture.managed.reconcile({
        ownerId: "account-a",
        namespace: "artifacts",
        limit: 100,
      })) {
        reconciled.push(entry);
      }
      expect(reconciled.map((entry) => entry.ref)).toEqual([ref]);
      expect(await read(await fixture.managed.get({ ref }))).toBe("recoverable");
      expect(await fixture.usage.totals("account-a", "storage.bytes")).toMatchObject({
        consumed: String(bytes.byteLength),
        reserved: "0",
      });
      const foreign = [];
      for await (const entry of fixture.managed.reconcile({
        ownerId: "account-b",
        namespace: "artifacts",
        limit: 100,
      })) {
        foreign.push(entry);
      }
      expect(foreign).toEqual([]);
    } finally {
      await closeManagedTestDatabase(fixture.client);
    }
  });
});
