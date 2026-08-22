import { describe, expect, test } from "bun:test";
import { capabilityMap } from "../entitlements/capabilities";
import { EntitlementService } from "../entitlements/service";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import { UsageLedger } from "./ledger";
import { PricingService } from "./pricing";

const now = new Date("2026-08-22T12:00:00.000Z");

describe.serial("managed pricing snapshots and user-visible usage", () => {
  test("keeps historical rates immutable and never invents a user charge", async () => {
    const client = await createManagedTestDatabase();
    try {
      const pricing = new PricingService(client, () => now);
      const snapshot = await pricing.publish({
        id: "price-provider-v1",
        provider: "fixture-provider",
        model: "school-model",
        capability: "model.inputTokens",
        unit: "tokens",
        currency: "EUR",
        rateMinor: "3",
        quantityScale: "100",
        effectiveAt: now.toISOString(),
        source: "provider",
      });
      expect(snapshot.rateMinor).toBe("3");

      const entitlements = new EntitlementService(client, {
        mode: "enforce",
        clock: () => now,
        cacheTtlMs: 0,
      });
      await entitlements.publishSnapshot(
        {
          version: 1,
          id: "pricing-entitlement",
          accountId: "account-a",
          revision: "pricing/1",
          plan: "shadow",
          status: "active",
          period: {
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-09-01T00:00:00.000Z",
          },
          capabilities: capabilityMap((_capability, unit) => ({
            enabled: true,
            hardLimit: "100000",
            unit,
          })),
          source: "operator",
          issuedAt: now.toISOString(),
        },
        {
          actorId: "test-admin",
          justification: "pricing fixture",
          correlationId: "pricing-fixture",
        },
      );
      const ledger = new UsageLedger(client, entitlements, { clock: () => now });
      const reservation = await ledger.reserve({
        accountId: "account-a",
        userId: "account-a",
        capability: "model.inputTokens",
        unit: "tokens",
        maximumQuantity: "100",
        idempotencyKey: "pricing-run-reservation",
        placement: { kind: "managed", providerId: "managed-eu" },
        runId: "pricing-run",
        provider: "fixture-provider",
        model: "school-model",
        pricingSnapshotId: snapshot.id,
        expiresAt: new Date(now.getTime() + 60_000),
        estimatorVersion: "pricing-fixture/1",
      });
      await ledger.settle({
        accountId: "account-a",
        reservationId: reservation.reservation.id,
        actualQuantity: "50",
        outcome: "completed",
        authoritative: true,
        provider: "fixture-provider",
      });

      const summary = await pricing.summarizeRun("account-a", "pricing-run");
      const consumed = summary.find((item) => item.direction === "consume");
      expect(consumed).toMatchObject({
        quantity: "50",
        currency: "EUR",
        providerCostMinor: "2",
        operatorEstimateMinor: null,
        userChargeMinor: null,
        includedQuota: true,
        final: true,
      });
      await expect(pricing.publish({ ...snapshot })).rejects.toThrow();
    } finally {
      await closeManagedTestDatabase(client);
    }
  });
});
