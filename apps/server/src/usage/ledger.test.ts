import { describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { EntitlementService } from "../entitlements/service";
import { capabilityMap } from "../entitlements/capabilities";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import { UsageLedger, UsageLedgerError } from "./ledger";

const now = new Date("2026-08-22T12:00:00.000Z");

async function enabledLedger(
  client: Client,
  input: { hardLimit?: string; concurrency?: number } = {},
) {
  const entitlements = new EntitlementService(client, {
    mode: "enforce",
    clock: () => now,
    cacheTtlMs: 0,
  });
  await entitlements.publishSnapshot(
    {
      version: 1,
      id: "snapshot-a",
      accountId: "account-a",
      revision: "test/1",
      plan: "test",
      status: "active",
      period: {
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-09-01T00:00:00.000Z",
      },
      capabilities: capabilityMap((_capability, unit) => ({
        enabled: true,
        unit,
        hardLimit: input.hardLimit ?? "1000000",
        concurrency: input.concurrency ?? 1_000,
      })),
      source: "operator",
      issuedAt: now.toISOString(),
    },
    {
      actorId: "test-admin",
      justification: "fixture",
      correlationId: "test-snapshot",
    },
  );
  return {
    entitlements,
    ledger: new UsageLedger(client, entitlements, { clock: () => now }),
  };
}

function reservationInput(
  maximumQuantity: string,
  idempotencyKey: string,
) {
  return {
    accountId: "account-a",
    userId: "account-a",
    capability: "ocr.pages" as const,
    unit: "pages" as const,
    maximumQuantity,
    idempotencyKey,
    placement: { kind: "managed" as const, providerId: "mistral" },
    runId: idempotencyKey,
    provider: "mistral",
    expiresAt: new Date(now.getTime() + 60_000),
    estimatorVersion: "fixture/1",
  };
}

describe.serial("managed entitlement and immutable usage ledger", () => {
  test("records a shadow would-block decision without blocking the run", async () => {
    const client = await createManagedTestDatabase();
    try {
      const entitlement = new EntitlementService(client, {
        mode: "shadow",
        clock: () => now,
        cacheTtlMs: 0,
      });
      const ledger = new UsageLedger(client, entitlement, { clock: () => now });
      const result = await ledger.reserve(reservationInput("12", "shadow"));
      expect(result.decision).toMatchObject({
        allowed: true,
        wouldBlock: true,
        reason: "capability-disabled",
        mode: "shadow",
      });
      const decisions = await client.execute(
        "SELECT allowed, wouldBlock, reason FROM entitlement_decisions",
      );
      expect(decisions.rows).toEqual([
        expect.objectContaining({
          allowed: 1,
          wouldBlock: 1,
          reason: "capability-disabled",
        }),
      ]);
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("serializes concurrent reservations and cannot oversubscribe a hard cap", async () => {
    const client = await createManagedTestDatabase();
    try {
      const { ledger } = await enabledLedger(client, { hardLimit: "100" });
      const outcomes = await Promise.allSettled([
        ledger.reserve(reservationInput("60", "concurrent-a")),
        ledger.reserve(reservationInput("60", "concurrent-b")),
      ]);
      expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(
        1,
      );
      const rejected = outcomes.find(
        (item): item is PromiseRejectedResult => item.status === "rejected",
      );
      expect(rejected?.reason).toBeInstanceOf(UsageLedgerError);
      expect((rejected?.reason as UsageLedgerError).code).toBe(
        "capability-denied",
      );
      const rows = await client.execute(
        "SELECT COUNT(*) AS count FROM usage_reservations",
      );
      expect(Number(rows.rows[0]?.count)).toBe(1);
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("deduplicates retries and consumes actual usage while releasing the exact remainder", async () => {
    const client = await createManagedTestDatabase();
    try {
      const { ledger } = await enabledLedger(client);
      const first = await ledger.reserve(reservationInput("100", "same-run"));
      const replay = await ledger.reserve(reservationInput("100", "same-run"));
      expect(replay.replayed).toBe(true);
      expect(replay.reservation.id).toBe(first.reservation.id);

      const settled = await ledger.settle({
        accountId: "account-a",
        reservationId: first.reservation.id,
        actualQuantity: "37",
        outcome: "failed",
        authoritative: true,
        provider: "mistral",
      });
      expect(settled.reservation).toMatchObject({
        consumedQuantity: "37",
        releasedQuantity: "63",
        status: "settled",
      });
      expect(
        await ledger.settle({
          accountId: "account-a",
          reservationId: first.reservation.id,
          actualQuantity: "37",
          outcome: "failed",
          authoritative: true,
        }),
      ).toMatchObject({ replayed: true });
      const events = await client.execute(
        "SELECT direction, quantity FROM usage_events ORDER BY occurredAt, direction",
      );
      expect(events.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ direction: "reserve", quantity: "100" }),
          expect.objectContaining({ direction: "consume", quantity: "37" }),
          expect.objectContaining({ direction: "release", quantity: "63" }),
        ]),
      );
      expect(await ledger.totals("account-a", "ocr.pages")).toMatchObject({
        consumed: "37",
        reserved: "0",
      });
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("emergency disable cancels reservations and blocks even shadow mode", async () => {
    const client = await createManagedTestDatabase();
    try {
      const { ledger } = await enabledLedger(client);
      await ledger.reserve(reservationInput("5", "before-disable"));
      expect(
        await ledger.emergencyDisable({
          accountId: "account-a",
          actorId: "account-a",
          actorKind: "user",
          justification: "user kill switch",
          correlationId: "disable-test",
        }),
      ).toEqual({ cancelledReservations: 1 });
      await expect(
        ledger.reserve(reservationInput("1", "after-disable")),
      ).rejects.toMatchObject({ code: "capability-denied" });
      expect(await ledger.totals("account-a", "ocr.pages")).toMatchObject({
        emergencyDisabled: true,
        reserved: "0",
      });
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("adjustments are append-only, audited and never rewrite consumption", async () => {
    const client = await createManagedTestDatabase();
    try {
      const { ledger } = await enabledLedger(client);
      const reserved = await ledger.reserve(reservationInput("10", "adjusted"));
      await ledger.settle({
        accountId: "account-a",
        reservationId: reserved.reservation.id,
        actualQuantity: "10",
        outcome: "completed",
        authoritative: true,
      });
      const adjusted = await ledger.adjust({
        accountId: "account-a",
        userId: "account-a",
        capability: "ocr.pages",
        unit: "pages",
        signedQuantity: "-2",
        idempotencyKey: "support-credit-1",
        placement: { kind: "managed", providerId: "mistral" },
        actorId: "test-admin",
        reason: "provider correction",
        evidenceRef: "provider-case-1",
        correlationId: "adjust-test",
      });
      expect(adjusted.replayed).toBe(false);
      expect(await ledger.totals("account-a", "ocr.pages")).toMatchObject({
        consumed: "10",
        adjusted: "-2",
        netConsumed: "8",
      });
      const immutable = await client.execute(
        "SELECT direction, quantity FROM usage_events WHERE idempotencyKey = 'support-credit-1'",
      );
      expect(immutable.rows).toEqual([
        expect.objectContaining({ direction: "adjust", quantity: "-2" }),
      ]);
      const audit = await client.execute(
        "SELECT action FROM security_audit_events WHERE action = 'usage.adjusted'",
      );
      expect(audit.rows).toHaveLength(1);
    } finally {
      await closeManagedTestDatabase(client);
    }
  });
});
