import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import type {
  ObjectStorageMetadata,
  ObjectStorageProvider,
  ObjectStoragePutInput,
  OwnedObjectRef,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreObjectAdoptionRepository } from "./sql-object-adoption-repository";
import { TwoPhaseObjectAdopter } from "./two-phase-object-adopter";

let client: Client;
let databaseRoot = "";
let databasePath = "";
async function removeDatabaseRoot() {
  let busy: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await rm(databaseRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      const candidate = error as NodeJS.ErrnoException;
      if (candidate.code !== "EBUSY") throw error;
      busy = candidate;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10 * 2 ** attempt, 100)),
      );
    }
  }
  // Bun's libSQL worker can keep the SQLite file handle alive until process
  // teardown on Windows even after Client.close(). We still bound and retry
  // that one recoverable condition; every other filesystem error remains a
  // hard test failure.
  if (process.platform === "win32" && busy?.code === "EBUSY") return;
  throw busy ?? new Error("TEST_DATABASE_CLEANUP_FAILED");
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function body(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

class TestProvider {
  readonly id = "core-managed-storage-v1:local";
  readonly entries = new Map<string, ObjectStorageMetadata>();

  async put(input: ObjectStoragePutInput) {
    const key = JSON.stringify(input.ref);
    const existing = this.entries.get(key);
    if (existing) return { ...existing, replayed: true };
    const bytes = new Uint8Array(await new Response(input.body).arrayBuffer());
    if (
      bytes.byteLength !== input.byteSize ||
      digest(bytes) !== input.expectedDigest
    ) {
      throw new Error("OBJECT_DIGEST_MISMATCH");
    }
    const now = new Date().toISOString();
    const metadata: ObjectStorageMetadata = {
      ref: input.ref,
      byteSize: input.byteSize,
      mimeType: input.mimeType,
      digest: input.expectedDigest,
      etag: input.expectedDigest,
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(key, metadata);
    return { ...metadata, replayed: false };
  }

  stat(input: { ref: OwnedObjectRef }) {
    return Promise.resolve(this.entries.get(JSON.stringify(input.ref)) ?? null);
  }
}

beforeEach(async () => {
  databaseRoot = await mkdtemp(join(tmpdir(), "avermate-object-adoption-"));
  databasePath = join(databaseRoot, "repository.db");
  client = createClient({ url: `file:${databasePath}` });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id text PRIMARY KEY NOT NULL);
    INSERT INTO users (id) VALUES ('owner-1'), ('owner-2');
    CREATE TABLE files (
      id text PRIMARY KEY NOT NULL, provider text NOT NULL,
      storageKey text NOT NULL, url text NOT NULL, mimeType text NOT NULL,
      byteSize integer NOT NULL, purpose text NOT NULL, status text NOT NULL,
      previewFileId text, previewStatus text NOT NULL, userId text NOT NULL,
      createdAt integer NOT NULL, updatedAt integer NOT NULL,
      UNIQUE(provider, storageKey)
    );
    CREATE TABLE node_object_adoptions (
      id text PRIMARY KEY NOT NULL, providerId text NOT NULL,
      ownerId text NOT NULL, namespace text NOT NULL, objectKey text NOT NULL,
      byteSize integer NOT NULL, mimeType text NOT NULL,
      expectedDigest text NOT NULL, idempotencyKey text NOT NULL,
      state text NOT NULL, objectMetadataJson text, canonicalRecordId text,
      safeErrorCode text, createdAt integer NOT NULL, updatedAt integer NOT NULL,
      UNIQUE(ownerId, providerId, idempotencyKey)
    );
  `);
});

afterEach(async () => {
  client.close();
  await removeDatabaseRoot();
}, 30_000);

describe("CoreObjectAdoptionRepository", () => {
  test("recovers a crash after provider commit without duplicate bytes or canonical rows", async () => {
    const bytes = new TextEncoder().encode("durable node artifact");
    const provider = new TestProvider();
    const repository = new CoreObjectAdoptionRepository(client, {
      managedProvider: "local",
    });
    const intent = {
      adoptionId: "adoption-crash",
      providerId: provider.id,
      ref: {
        ownerId: "owner-1",
        namespace: "document-artifact",
        key: "node-adoptions/v1/owner/artifact.html",
      },
      byteSize: bytes.byteLength,
      mimeType: "text/html",
      expectedDigest: digest(bytes),
      idempotencyKey: "run:stage:revision",
    } as const;
    const crashing = new TwoPhaseObjectAdopter({
      provider: provider as unknown as ObjectStorageProvider,
      repository,
      afterObjectCommit: () => Promise.reject(new Error("PROCESS_CRASH")),
    });
    await expect(
      crashing.upload({ ...intent, body: body(bytes) }),
    ).rejects.toThrow("PROCESS_CRASH");
    expect((await repository.load(intent.adoptionId))?.state).toBe(
      "object_committed",
    );

    const restarted = new TwoPhaseObjectAdopter({
      provider: provider as unknown as ObjectStorageProvider,
      repository: new CoreObjectAdoptionRepository(client, {
        managedProvider: "local",
      }),
    });
    expect(await restarted.reconcile()).toEqual([
      { adoptionId: intent.adoptionId, outcome: "adopted" },
    ]);
    const replay = await restarted.upload({ ...intent, body: body(bytes) });
    expect(replay).toMatchObject({
      replayed: true,
      record: { state: "adopted" },
    });
    const files = await client.execute("SELECT id, userId FROM files");
    expect(files.rows).toHaveLength(1);
    expect(files.rows[0]?.userId).toBe("owner-1");
    expect(provider.entries.size).toBe(1);
  });

  test("fails closed on cross-owner idempotency reuse and atomically enforces quota", async () => {
    const provider = new TestProvider();
    const repository = new CoreObjectAdoptionRepository(client, {
      managedProvider: "local",
      quotaBytes: 3,
    });
    const bytes = new TextEncoder().encode("four");
    const intent = {
      adoptionId: "adoption-quota",
      providerId: provider.id,
      ref: {
        ownerId: "owner-1",
        namespace: "document-artifact",
        key: "node-adoptions/v1/owner/quota.html",
      },
      byteSize: bytes.byteLength,
      mimeType: "text/html",
      expectedDigest: digest(bytes),
      idempotencyKey: "quota-key",
    } as const;
    const adopter = new TwoPhaseObjectAdopter({
      provider: provider as unknown as ObjectStorageProvider,
      repository,
    });
    await expect(
      adopter.upload({ ...intent, body: body(bytes) }),
    ).rejects.toThrow("ADOPTION_STORAGE_QUOTA_EXCEEDED");
    expect((await repository.load(intent.adoptionId))?.state).toBe(
      "object_committed",
    );
    expect(
      (await client.execute("SELECT COUNT(*) AS count FROM files")).rows[0]
        ?.count,
    ).toBe(0);
    await expect(
      repository.reserve({
        ...intent,
        ref: { ...intent.ref, ownerId: "owner-2" },
      }),
    ).rejects.toThrow("ADOPTION_IDEMPOTENCY_PAYLOAD_MISMATCH");
  });
});
