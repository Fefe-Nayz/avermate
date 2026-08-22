import { describe, expect, test } from "bun:test";
import { capabilityMap } from "../entitlements/capabilities";
import { EntitlementService } from "../entitlements/service";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import { UsageLedger } from "../usage/ledger";
import {
  captureManagedRecoverySnapshot,
  restoreManagedRecoverySnapshot,
} from "./restore-drill";

const now = new Date("2026-08-22T12:00:00.000Z");

describe.serial("managed backup and clean-environment restore drill", () => {
  test("reconciles metadata, immutable usage totals and object digests", async () => {
    const source = await createManagedTestDatabase();
    const target = await createManagedTestDatabase();
    try {
      const entitlements = new EntitlementService(source, {
        mode: "enforce",
        clock: () => now,
        cacheTtlMs: 0,
      });
      await entitlements.publishSnapshot(
        {
          version: 1,
          id: "restore-snapshot",
          accountId: "account-a",
          revision: "restore/1",
          plan: "test",
          status: "active",
          period: {
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-09-01T00:00:00.000Z",
          },
          capabilities: capabilityMap((_capability, unit) => ({
            enabled: true,
            unit,
            hardLimit: "1000000",
            concurrency: 100,
          })),
          source: "operator",
          issuedAt: now.toISOString(),
        },
        {
          actorId: "test-admin",
          justification: "restore fixture",
          correlationId: "restore-snapshot",
        },
      );
      const usage = new UsageLedger(source, entitlements, { clock: () => now });
      const reservation = await usage.reserve({
        accountId: "account-a",
        userId: "account-a",
        capability: "model.outputTokens",
        unit: "tokens",
        maximumQuantity: "500",
        idempotencyKey: "restore-run",
        placement: { kind: "managed", providerId: "model-gateway" },
        runId: "restore-run",
        provider: "fixture",
        expiresAt: new Date(now.getTime() + 60_000),
        estimatorVersion: "fixture/1",
      });
      await usage.settle({
        accountId: "account-a",
        reservationId: reservation.reservation.id,
        actualQuantity: "321",
        outcome: "completed",
        authoritative: true,
      });
      const objects = [
        {
          placement: "managed:eu-test",
          opaqueRef: "opaque/object/1",
          digest: `sha256:${"c".repeat(64)}` as const,
          byteSize: 123,
        },
      ];
      const backupStartedAt = performance.now();
      const snapshot = await captureManagedRecoverySnapshot({
        client: source,
        capturedAt: now,
        objects,
      });
      const restoredObjects = new Map<string, string>();
      const restoreStartedAt = performance.now();
      const restored = await restoreManagedRecoverySnapshot({
        client: target,
        snapshot,
        restoreObject: async (object) => {
          restoredObjects.set(object.opaqueRef, object.digest);
        },
        verifyObject: async (object) =>
          restoredObjects.get(object.opaqueRef) === object.digest,
      });
      const rtoMs = Math.max(0, performance.now() - restoreStartedAt);
      const rpoMs = Math.max(0, performance.now() - backupStartedAt);
      console.info(
        `[plan-034:restore] ${JSON.stringify({
          evidenceScope: "repository-fixture-not-operational",
          digest: restored.digest,
          tableCount: restored.tableCount,
          objectCount: restored.objectCount,
          rpoMs: Math.round(rpoMs),
          rtoMs: Math.round(rtoMs),
        })}`,
      );
      expect(restored).toEqual({
        digest: snapshot.digest,
        tableCount: 20,
        objectCount: 1,
      });
      const aggregate = await target.execute(
        "SELECT consumedQuantity, adjustedQuantity FROM usage_period_aggregates",
      );
      expect(aggregate.rows).toEqual([
        expect.objectContaining({
          consumedQuantity: "321",
          adjustedQuantity: "0",
        }),
      ]);
      expect(rpoMs).toBeLessThan(5 * 60_000);
      expect(rtoMs).toBeLessThan(4 * 60 * 60_000);
    } finally {
      await Promise.all([
        closeManagedTestDatabase(source),
        closeManagedTestDatabase(target),
      ]);
    }
  });

  test("rejects a tampered backup and a non-empty recovery target", async () => {
    const source = await createManagedTestDatabase();
    const target = await createManagedTestDatabase();
    try {
      const snapshot = await captureManagedRecoverySnapshot({
        client: source,
        capturedAt: now,
      });
      await expect(
        restoreManagedRecoverySnapshot({
          client: target,
          snapshot: {
            ...snapshot,
            objects: [
              {
                placement: "managed:test",
                opaqueRef: "tampered",
                digest: `sha256:${"d".repeat(64)}`,
                byteSize: 1,
              },
            ],
          },
        }),
      ).rejects.toThrow("MANAGED_BACKUP_DIGEST_MISMATCH");

      await target.execute({
        sql: `INSERT INTO billing_webhook_inbox
          (id, provider, externalEventId, eventType, payloadDigest,
           payloadJson, status, receivedAt)
          VALUES ('existing', 'fixture', 'event', 'type', 'digest', '{}', 'received', 1)`,
        args: [],
      });
      await expect(
        restoreManagedRecoverySnapshot({ client: target, snapshot }),
      ).rejects.toThrow("MANAGED_RESTORE_TARGET_NOT_EMPTY");
    } finally {
      await Promise.all([
        closeManagedTestDatabase(source),
        closeManagedTestDatabase(target),
      ]);
    }
  });
});
