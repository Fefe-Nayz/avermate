import { describe, expect, test } from "bun:test";
import type {
  CapabilityPlacement,
  DeletionReceiptV1,
} from "@avermate/agent-contracts";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import {
  managedDeletionReceipt,
  PrivacyOperationError,
  PrivacyOperationService,
  type PrivacyPlacementHandler,
} from "./operations";

const now = new Date("2026-08-22T12:00:00.000Z");
const core = { kind: "core" as const, providerId: "core-db" };
const managed = { kind: "managed" as const, providerId: "managed-eu" };
const node = {
  kind: "node" as const,
  nodeId: "node-a",
  providerId: "node-storage",
};

function receipt(input: {
  requestId: string;
  placement: CapabilityPlacement;
  nonce: string;
  manifestDigest: `sha256:${string}`;
  objectClasses: readonly string[];
  verifierKind?: DeletionReceiptV1["verifierKind"];
}): DeletionReceiptV1 {
  if (!input.verifierKind || input.verifierKind === "managed-adapter") {
    return managedDeletionReceipt({ ...input, completedAt: now });
  }
  return {
    version: 1,
    requestId: input.requestId,
    placement: input.placement,
    verifierKind: input.verifierKind,
    nonce: input.nonce,
    manifestDigest: input.manifestDigest,
    deletedObjectClasses: [...input.objectClasses],
    completedAt: now.toISOString(),
    keyId: "node-signing-key-1",
    signature: "signed-node-receipt-that-is-long-enough-for-the-contract",
  };
}

function handler(
  placement: CapabilityPlacement,
  mode: "deleted" | "pending" | "wrong-receipt" = "deleted",
  verifierKind: DeletionReceiptV1["verifierKind"] = "managed-adapter",
): PrivacyPlacementHandler {
  return {
    placement,
    objectClasses: ["objects", "indexes"],
    async tombstone(input) {
      await input.transaction.execute({
        sql: "INSERT INTO managed_test_tombstones (requestId, placement) VALUES (?, ?)",
        args: [input.requestId, placement.kind],
      });
    },
    async export(input) {
      return {
        accountId: input.accountId,
        scope: input.scope,
        placement,
        branches: [{ id: "branch-1", parentId: null }],
      };
    },
    async trash() {},
    async delete(input) {
      if (mode === "pending") return { state: "pending_remote_deletion" };
      return {
        state: "verified_deleted",
        receipt: receipt({
          ...input,
          placement,
          nonce:
            mode === "wrong-receipt" ? `${input.nonce}-wrong` : input.nonce,
          verifierKind,
        }),
      };
    },
  };
}

async function fixture(handlers: PrivacyPlacementHandler[]) {
  const client = await createManagedTestDatabase();
  await client.execute(`CREATE TABLE managed_test_tombstones (
    requestId text NOT NULL,
    placement text NOT NULL
  )`);
  const verified: string[] = [];
  const service = new PrivacyOperationService({
    client,
    handlers,
    owns: async (accountId, scope) =>
      accountId === "account-a" && scope.id === "account-a",
    verifyExternalReceipt: async (value) => {
      if (!value.signature || !value.keyId) throw new Error("INVALID_SIGNATURE");
      verified.push(value.requestId);
    },
    clock: () => now,
  });
  return { client, service, verified };
}

describe.serial("placement-aware privacy operations", () => {
  test("exports JSON and Markdown with exact placement relationships", async () => {
    const { client, service } = await fixture([
      handler(core),
      handler(managed),
      handler(node),
    ]);
    try {
      const exported = await service.requestExport({
        accountId: "account-a",
        scope: { kind: "account", id: "account-a" },
        actorId: "account-a",
        correlationId: "export-test",
      });
      expect(exported.archive.placements).toHaveLength(3);
      expect(exported.json).toContain('"branches"');
      expect(exported.markdown).toContain("node:node-a:node-storage");
      expect(exported.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect(
        service.requestExport({
          accountId: "account-b",
          scope: { kind: "account", id: "account-a" },
          actorId: "account-b",
          correlationId: "cross-tenant-export",
        }),
      ).rejects.toMatchObject({ code: "not-found" });
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("keeps recoverable trash separate from immediate deletion", async () => {
    const { client, service } = await fixture([handler(core), handler(managed)]);
    try {
      expect(
        await service.requestTrash({
          accountId: "account-a",
          scope: { kind: "account", id: "account-a" },
          actorId: "account-a",
          correlationId: "trash-test",
        }),
      ).toMatchObject({ recoverable: true });
      const tombstones = await client.execute(
        "SELECT COUNT(*) AS count FROM managed_test_tombstones",
      );
      expect(Number(tombstones.rows[0]?.count)).toBe(0);
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("tombstones atomically, leaves an offline node pending, then verifies its signed receipt on reconnect", async () => {
    const { client, service } = await fixture([
      handler(core),
      handler(managed),
      handler(node, "pending", "user-node"),
    ]);
    try {
      const pending = await service.requestDeleteNow({
        accountId: "account-a",
        scope: { kind: "account", id: "account-a" },
        actorId: "account-a",
        correlationId: "delete-test",
      });
      expect(pending.state).toBe("running");
      expect(pending.targets.map((target) => target.state).sort()).toEqual([
        "pending_remote_deletion",
        "verified_deleted",
        "verified_deleted",
      ]);
      const tombstones = await client.execute(
        "SELECT placement FROM managed_test_tombstones ORDER BY placement",
      );
      expect(tombstones.rows.map((row) => row.placement)).toEqual([
        "core",
        "managed",
        "node",
      ]);

      const verified: string[] = [];
      const reconnected = new PrivacyOperationService({
        client,
        handlers: [handler(core), handler(managed), handler(node, "deleted", "user-node")],
        owns: async () => true,
        verifyExternalReceipt: async (value) => {
          expect(value.signature).toBeTruthy();
          verified.push(value.requestId);
        },
        clock: () => now,
      });
      const completed = await reconnected.resumeDelete({
        accountId: "account-a",
        requestId: pending.id,
      });
      expect(completed.state).toBe("completed");
      expect(completed.targets.every((target) => target.state === "verified_deleted")).toBe(
        true,
      );
      expect(verified).toEqual([pending.id]);
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("rejects a receipt not bound to its nonce and manifest", async () => {
    const { client, service } = await fixture([handler(node, "wrong-receipt", "user-node")]);
    try {
      await expect(
        service.requestDeleteNow({
          accountId: "account-a",
          scope: { kind: "account", id: "account-a" },
          actorId: "account-a",
          correlationId: "bad-receipt-test",
        }),
      ).rejects.toBeInstanceOf(PrivacyOperationError);
      const target = await client.execute(
        "SELECT state, receiptJson FROM privacy_operation_targets",
      );
      expect(target.rows[0]).toMatchObject({
        state: "pending_remote_deletion",
        receiptJson: null,
      });
    } finally {
      await closeManagedTestDatabase(client);
    }
  });
});
