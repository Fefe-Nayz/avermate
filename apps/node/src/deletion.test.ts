import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  bytesStream,
  digestBytes,
  FilesystemObjectStorageProvider,
} from "./filesystem-storage";
import { loadOrCreateNodeIdentity } from "./identity";
import {
  executeDeletionManifest,
  signDeletionManifest,
  verifyDeletionReceipt,
} from "./deletion";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("signed remote deletion", () => {
  test("deletes exact bytes and returns a node-bound absence receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-delete-"));
    roots.push(root);
    const core = await loadOrCreateNodeIdentity(join(root, "core.json"));
    const node = await loadOrCreateNodeIdentity(join(root, "node.json"));
    const storage = new FilesystemObjectStorageProvider({
      root: join(root, "storage"),
      maxObjectBytes: 1024,
      quotaBytes: 4096,
    });
    await storage.initialize();
    const bytes = new TextEncoder().encode("delete me");
    const ref = { ownerId: "user-1", namespace: "files", key: "delete.txt" };
    const digest = digestBytes(bytes);
    await storage.put({
      ref,
      body: bytesStream(bytes),
      byteSize: bytes.byteLength,
      mimeType: "text/plain",
      expectedDigest: digest,
      idempotencyKey: "put",
    });
    const now = Date.now();
    const manifest = signDeletionManifest(core, {
      version: 1,
      nodeId: node.nodeId,
      userId: "user-1",
      nonce: "nonce-1",
      refs: [
        {
          object: ref,
          digest,
          byteSize: bytes.byteLength,
          mimeType: "text/plain",
        },
      ],
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    const receipt = await executeDeletionManifest({
      manifest,
      issuerPublicKeyDer: core.publicKeyDer,
      expectedIssuerKeyId: core.keyId,
      identity: node,
      storage,
      now: now + 1,
    });
    expect(await storage.stat({ ref })).toBeNull();
    expect(
      verifyDeletionReceipt({
        receipt,
        nodePublicKeyDer: node.publicKeyDer,
        expectedNodeId: node.nodeId,
        expectedNodeKeyId: node.keyId,
        manifest,
        now: now + 2,
      }).deletedCount,
    ).toBe(1);
  });

  test("rejects wrong-node manifests and forged receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-delete-forged-"));
    roots.push(root);
    const core = await loadOrCreateNodeIdentity(join(root, "core.json"));
    const node = await loadOrCreateNodeIdentity(join(root, "node.json"));
    const other = await loadOrCreateNodeIdentity(join(root, "other.json"));
    const now = Date.now();
    const manifest = signDeletionManifest(core, {
      version: 1,
      nodeId: other.nodeId,
      userId: "user-1",
      nonce: "nonce-2",
      refs: [
        {
          object: { ownerId: "user-1", namespace: "files", key: "gone" },
          digest: digestBytes(new Uint8Array()),
          byteSize: 0,
          mimeType: "application/octet-stream",
        },
      ],
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    const storage = new FilesystemObjectStorageProvider({
      root: join(root, "storage"),
      maxObjectBytes: 1024,
      quotaBytes: 4096,
    });
    await expect(
      executeDeletionManifest({
        manifest,
        issuerPublicKeyDer: core.publicKeyDer,
        identity: node,
        storage,
        now,
      }),
    ).rejects.toThrow("DELETION_MANIFEST_WRONG_NODE");

    const receipt = {
      nodeId: other.nodeId,
      nonce: manifest.nonce,
      manifestDigest: manifest.digest,
      deletedCount: 1,
      verifiedAt: new Date(now).toISOString(),
      keyId: other.keyId,
      signature: "A".repeat(64),
    };
    expect(() =>
      verifyDeletionReceipt({
        receipt,
        nodePublicKeyDer: node.publicKeyDer,
        expectedNodeId: node.nodeId,
        manifest,
        now,
      }),
    ).toThrow("DELETION_RECEIPT_WRONG_NODE");
  });
});
