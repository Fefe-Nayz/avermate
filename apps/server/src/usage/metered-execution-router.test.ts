import { describe, expect, test } from "bun:test";
import type {
  CapabilityRoutingDecision,
  RoutedOperation,
} from "@avermate/agent-contracts";
import { capabilityMap } from "../entitlements/capabilities";
import { EntitlementService } from "../entitlements/service";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import { RoutingDispatchRejectedError } from "../node/execution-router";
import { UsageLedger } from "./ledger";
import {
  MeteredExecutionRouter,
  type ResolvedExecutionRouter,
} from "./metered-execution-router";

const now = new Date("2026-08-22T12:00:00.000Z");
const managedDecision: CapabilityRoutingDecision = {
  placement: { kind: "managed", providerId: "managed-worker" },
  reason: "selected-placement-ready",
  fallbackUsed: false,
  transferRequired: false,
  inspectedAt: now.toISOString(),
};
const operation: RoutedOperation = {
  operationId: "operation-1",
  request: {
    userId: "account-a",
    capability: "models",
    selected: managedDecision.placement,
    fallbackChain: [],
    allowDataTransfer: false,
    expectedInputBytes: 0,
    requiredCapabilityVersion: 1,
  },
  payload: { promptRef: "opaque-prompt-ref" },
};

function router(
  delegate: ResolvedExecutionRouter,
  ledger: UsageLedger,
) {
  return new MeteredExecutionRouter(
    delegate,
    ledger,
    async () => ({
      capability: "model.outputTokens",
      unit: "tokens",
      maximumQuantity: "100",
      estimatorVersion: "test-estimator/1",
      provider: "fixture-provider",
      model: "fixture-model",
      expiresAt: new Date(now.getTime() + 60_000),
    }),
    (routed, grant) => ({
      ...routed,
      payload: { ...(routed.payload as object), accountingGrant: grant },
    }),
  );
}

describe.serial("metered placement dispatch", () => {
  test("cannot invoke a managed adapter without an enabled entitlement and reservation", async () => {
    const client = await createManagedTestDatabase();
    try {
      const entitlements = new EntitlementService(client, {
        mode: "enforce",
        clock: () => now,
        cacheTtlMs: 0,
      });
      const ledger = new UsageLedger(client, entitlements, { clock: () => now });
      let dispatches = 0;
      const delegate: ResolvedExecutionRouter = {
        resolve: async () => managedDecision,
        dispatch: async () => {
          throw new Error("unexpected direct dispatch");
        },
        dispatchResolved: async () => {
          dispatches += 1;
          throw new Error("unexpected managed dispatch");
        },
      };
      await expect(router(delegate, ledger).dispatch(operation)).rejects.toMatchObject({
        code: "capability-denied",
      });
      expect(dispatches).toBe(0);
      const reservations = await client.execute(
        "SELECT COUNT(*) AS count FROM usage_reservations",
      );
      expect(Number(reservations.rows[0]?.count)).toBe(0);
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("persists and attaches the reservation before the first placement effect", async () => {
    const client = await createManagedTestDatabase();
    try {
      const entitlements = new EntitlementService(client, {
        mode: "enforce",
        clock: () => now,
        cacheTtlMs: 0,
      });
      await entitlements.publishSnapshot(
        {
          version: 1,
          id: "dispatch-snapshot",
          accountId: "account-a",
          revision: "dispatch/1",
          plan: "test",
          status: "active",
          period: {
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-09-01T00:00:00.000Z",
          },
          capabilities: capabilityMap((_capability, unit) => ({
            enabled: true,
            unit,
            hardLimit: "1000",
            concurrency: 10,
          })),
          source: "operator",
          issuedAt: now.toISOString(),
        },
        {
          actorId: "test-admin",
          justification: "fixture",
          correlationId: "dispatch-snapshot",
        },
      );
      const ledger = new UsageLedger(client, entitlements, { clock: () => now });
      const delegate: ResolvedExecutionRouter = {
        resolve: async () => managedDecision,
        dispatch: async () => {
          throw new Error("unexpected direct dispatch");
        },
        dispatchResolved: async (routed, decision) => {
          const rows = await client.execute(
            "SELECT id, status FROM usage_reservations",
          );
          expect(rows.rows).toHaveLength(1);
          expect(rows.rows[0]?.status).toBe("reserved");
          expect(routed.payload).toMatchObject({
            accountingGrant: {
              reservationId: rows.rows[0]?.id,
              entitlementDecisionId: expect.any(String),
            },
          });
          return {
            operationId: routed.operationId,
            decision,
            placementHandle: "managed-handle-1",
          };
        },
      };
      const result = await router(delegate, ledger).dispatch(operation);
      expect(result).toMatchObject({
        placementHandle: "managed-handle-1",
        reservationId: expect.any(String),
        entitlementDecisionId: expect.any(String),
      });
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("releases quota only for a typed rejection proven to occur pre-dispatch", async () => {
    const client = await createManagedTestDatabase();
    try {
      const entitlements = new EntitlementService(client, {
        mode: "shadow",
        clock: () => now,
        cacheTtlMs: 0,
      });
      const ledger = new UsageLedger(client, entitlements, { clock: () => now });
      const delegate: ResolvedExecutionRouter = {
        resolve: async () => managedDecision,
        dispatch: async () => {
          throw new Error("unexpected direct dispatch");
        },
        dispatchResolved: async () => {
          throw new RoutingDispatchRejectedError("ROUTING_DECISION_STALE");
        },
      };
      await expect(router(delegate, ledger).dispatch(operation)).rejects.toThrow(
        "ROUTING_DECISION_STALE",
      );
      const rows = await client.execute(
        "SELECT consumedQuantity, releasedQuantity, status FROM usage_reservations",
      );
      expect(rows.rows).toEqual([
        expect.objectContaining({
          consumedQuantity: "0",
          releasedQuantity: "100",
          status: "settled",
        }),
      ]);
    } finally {
      await closeManagedTestDatabase(client);
    }
  });
});
