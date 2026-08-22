import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import type {
  NodeDeletionReceipt,
  OwnedObjectRef,
  RemoteDeletionState,
} from "@avermate/agent-contracts";
import {
  RemoteDeletionCoordinator,
  type RemoteDeletionRecord,
  type RemoteDeletionRepository,
} from "./remote-deletion";
import { protocolDigest, signProtocolValue } from "./protocol-crypto";

function identity(keyId: string) {
  const pair = generateKeyPairSync("ed25519");
  return {
    signing: { keyId, privateKey: pair.privateKey },
    publicKeyDer: pair.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64url"),
  };
}

function refKey(ref: OwnedObjectRef) {
  return JSON.stringify(ref);
}

class MemoryDeletionRepository implements RemoteDeletionRepository {
  readonly records = new Map<string, RemoteDeletionRecord>();
  readonly tombstones = new Set<string>();

  async createTombstone(record: RemoteDeletionRecord) {
    this.records.set(record.manifest.digest, record);
    for (const ref of record.manifest.refs)
      this.tombstones.add(refKey(ref.object));
  }
  async loadByManifestDigest(digest: string) {
    return this.records.get(digest) ?? null;
  }
  async isTombstoned(ref: OwnedObjectRef) {
    return this.tombstones.has(refKey(ref));
  }
  async markVerified(
    manifestDigest: string,
    receipt: NodeDeletionReceipt,
    acceptedReceiptDigest: `sha256:${string}`,
  ) {
    const record = this.records.get(manifestDigest);
    if (!record) throw new Error("DELETION_MANIFEST_NOT_FOUND");
    this.records.set(manifestDigest, {
      ...record,
      state: "verified_deleted",
      receipt,
      acceptedReceiptDigest,
    });
  }
  async markState(
    manifestDigest: string,
    state: Exclude<RemoteDeletionState, "verified_deleted">,
    safeOperatorInstruction?: string,
  ) {
    const record = this.records.get(manifestDigest);
    if (!record) throw new Error("DELETION_MANIFEST_NOT_FOUND");
    this.records.set(manifestDigest, {
      ...record,
      state,
      safeOperatorInstruction,
    });
  }
  async *pendingForNode(nodeId: string, limit: number) {
    let count = 0;
    for (const record of this.records.values()) {
      if (
        record.manifest.nodeId === nodeId &&
        (record.state === "pending_remote_deletion" ||
          record.state === "revoked_unreachable")
      ) {
        yield record;
        count += 1;
        if (count >= limit) return;
      }
    }
  }
}

describe("Core remote deletion coordinator", () => {
  test("tombstones before delivery and accepts only one bound node receipt", async () => {
    const core = identity("core-key");
    const node = identity("node-key");
    const repository = new MemoryDeletionRepository();
    const coordinator = new RemoteDeletionCoordinator({
      repository,
      issuer: core.signing,
    });
    const now = Date.now();
    const ref = { ownerId: "user-1", namespace: "files", key: "delete.pdf" };
    const digest = `sha256:${"a".repeat(64)}` as const;
    const manifest = await coordinator.issue({
      nodeId: "node-1",
      userId: "user-1",
      refs: [
        { object: ref, digest, byteSize: 12, mimeType: "application/pdf" },
      ],
      now,
    });
    await expect(coordinator.assertRoutable(ref)).rejects.toThrow(
      "RESOURCE_TOMBSTONED",
    );
    expect(
      (
        await Array.fromAsync(
          coordinator.pendingDeletionOnlyReconnect("node-1"),
        )
      ).length,
    ).toBe(1);

    const unsigned = {
      nodeId: "node-1",
      nonce: manifest.nonce,
      manifestDigest: manifest.digest,
      deletedCount: 1,
      verifiedAt: new Date(now + 1).toISOString(),
    };
    const receipt: NodeDeletionReceipt = {
      ...unsigned,
      keyId: node.signing.keyId,
      signature: signProtocolValue(node.signing, unsigned),
    };
    expect(
      await coordinator.acceptReceipt({
        receipt,
        expectedNodeId: "node-1",
        expectedNodeKeyId: node.signing.keyId,
        nodePublicKeyDer: node.publicKeyDer,
        now: now + 2,
      }),
    ).toEqual({
      state: "verified_deleted",
      receiptDigest: protocolDigest(receipt),
    });
    await expect(
      coordinator.acceptReceipt({
        receipt,
        expectedNodeId: "node-1",
        expectedNodeKeyId: node.signing.keyId,
        nodePublicKeyDer: node.publicKeyDer,
        now: now + 3,
      }),
    ).rejects.toThrow("DELETION_RECEIPT_REPLAYED");
  });

  test("keeps offline deletion pending and distinguishes revoked-unreachable", async () => {
    const core = identity("core-key");
    const repository = new MemoryDeletionRepository();
    const coordinator = new RemoteDeletionCoordinator({
      repository,
      issuer: core.signing,
    });
    const manifest = await coordinator.issue({
      nodeId: "offline-node",
      userId: "user-1",
      refs: [
        {
          object: { ownerId: "user-1", namespace: "files", key: "offline" },
          digest: `sha256:${"b".repeat(64)}`,
          byteSize: 1,
          mimeType: "application/octet-stream",
        },
      ],
    });
    expect(
      (await repository.loadByManifestDigest(manifest.digest))?.state,
    ).toBe("pending_remote_deletion");
    await coordinator.markRevokedUnreachable(manifest.digest);
    expect(
      (await repository.loadByManifestDigest(manifest.digest))?.state,
    ).toBe("revoked_unreachable");
    expect(
      (
        await Array.fromAsync(
          coordinator.pendingDeletionOnlyReconnect("offline-node"),
        )
      ).length,
    ).toBe(1);
    await expect(
      coordinator.assertRoutable(manifest.refs[0].object),
    ).rejects.toThrow("RESOURCE_TOMBSTONED");
  });
});
