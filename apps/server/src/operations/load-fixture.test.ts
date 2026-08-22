import { describe, expect, test } from "bun:test";
import { EntitlementService } from "../entitlements/service";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import { UsageLedger } from "../usage/ledger";
import { runManagedShadowLoadFixture } from "./load-fixture";

const now = new Date("2026-08-22T12:00:00.000Z");

describe.serial("managed shadow-accounting load gate", () => {
  test("meets the 30-day, 100-tenant and 10,000-run numeric exit criteria", async () => {
    const result = await runManagedShadowLoadFixture();
    console.info(`[plan-034:load] ${JSON.stringify(result)}`);
    expect(result).toMatchObject({
      periodDays: 30,
      tenants: 100,
      runs: 10_000,
      peakConcurrentReservations: 1_000,
      uniqueReservations: 10_000,
      terminalReservations: 10_000,
      within24Hours: 10_000,
      authoritativeDriftPercent: 0,
      doubleCharges: 0,
      doubleGrants: 0,
      negativeBalances: 0,
    });
    expect(result.within15MinutesPercent).toBeGreaterThanOrEqual(99.9);
    expect(result.duplicateReservations).toBeGreaterThan(0);
    expect(result.duplicateCallbacks).toBe(10_000);
  });

  test("serializes 1,000 simultaneous reservations through the production SQL ledger", async () => {
    const users = Array.from(
      { length: 100 },
      (_, index) => `load-account-${String(index).padStart(3, "0")}`,
    );
    const client = await createManagedTestDatabase(users);
    try {
      const entitlements = new EntitlementService(client, {
        mode: "enforce",
        selfHost: true,
        clock: () => now,
        cacheTtlMs: 0,
      });
      const ledger = new UsageLedger(client, entitlements, { clock: () => now });
      const pending = Array.from({ length: 1_000 }, (_, index) =>
        ledger.reserve({
          accountId: users[index % users.length]!,
          userId: users[index % users.length]!,
          capability: "model.outputTokens",
          unit: "tokens",
          maximumQuantity: "10",
          idempotencyKey: `concurrent-load-${index}`,
          placement: { kind: "managed", providerId: "load-fixture" },
          runId: `concurrent-load-${index}`,
          provider: "fixture",
          expiresAt: new Date(now.getTime() + 60_000),
          estimatorVersion: "load-fixture/1",
        }),
      );
      const reserved = await Promise.all(pending);
      expect(new Set(reserved.map((item) => item.reservation.id)).size).toBe(
        1_000,
      );
      const rows = await client.execute(
        "SELECT COUNT(*) AS count FROM usage_reservations WHERE status = 'reserved'",
      );
      expect(Number(rows.rows[0]?.count)).toBe(1_000);
      await Promise.all(
        reserved.map((item, index) =>
          ledger.settle({
            accountId: users[index % users.length]!,
            reservationId: item.reservation.id,
            actualQuantity: String(index % 11),
            outcome: "completed",
            authoritative: true,
          }),
        ),
      );
      const terminal = await client.execute(
        "SELECT COUNT(*) AS count FROM usage_reservations WHERE status = 'settled'",
      );
      expect(Number(terminal.rows[0]?.count)).toBe(1_000);
    } finally {
      await closeManagedTestDatabase(client);
    }
  }, 120_000);
});
