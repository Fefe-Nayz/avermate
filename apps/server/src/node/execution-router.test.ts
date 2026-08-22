import { describe, expect, test } from "bun:test";
import {
  DeterministicExecutionRouter,
  executionPlacementKey,
  RoutingDispatchRejectedError,
  type PlacementRuntimeState,
} from "./execution-router";
import type { CapabilityPlacement } from "@avermate/agent-contracts";

const digest = `sha256:${"a".repeat(64)}` as const;
const node = { kind: "node" as const, nodeId: "node-1", providerId: "fs" };
const core = { kind: "core" as const, providerId: "local" };

function state(placement: CapabilityPlacement = node): PlacementRuntimeState {
  return {
    placement,
    online: true,
    healthy: true,
    configRevision: digest,
    features: {
      storage: {
        version: 1,
        maxObjectBytes: 1_000,
        multipart: true,
        directTransfer: false,
        encryptionModes: ["transport-tls"],
      },
      retrieval: { version: 1, lexical: true, vectorSpaces: [] },
      sandbox: {
        version: 1,
        isolation: "gvisor",
        workspaceSnapshots: true,
        runtimeCheckpoints: false,
        browser: true,
        gpu: false,
      },
    },
    storageRemainingBytes: 1_000,
  };
}

describe("deterministic execution router", () => {
  test("never falls back unless the exact chain names it", async () => {
    const states = new Map([
      [executionPlacementKey(node), { ...state(), online: false }],
      [executionPlacementKey(core), state(core)],
    ]);
    const router = new DeterministicExecutionRouter({
      resolver: {
        inspect: async (placement) =>
          states.get(executionPlacementKey(placement)) ?? null,
      },
    });
    await expect(
      router.resolve({
        userId: "user-1",
        capability: "storage",
        selected: node,
        requiredCapabilityVersion: 1,
        expectedInputBytes: 0,
        allowDataTransfer: false,
        fallbackChain: [],
      }),
    ).rejects.toThrow("CAPABILITY_PLACEMENT_UNAVAILABLE");
    const fallback = await router.resolve({
      userId: "user-1",
      capability: "storage",
      selected: node,
      requiredCapabilityVersion: 1,
      fallbackChain: [core],
      allowDataTransfer: true,
      expectedInputBytes: 0,
    });
    expect(fallback.placement).toEqual(core);
    expect(fallback.fallbackUsed).toBe(true);
  });

  test("requires explicit consent before a fallback transfers bytes", async () => {
    const states = new Map([
      [executionPlacementKey(node), { ...state(), healthy: false }],
      [executionPlacementKey(core), state(core)],
    ]);
    const router = new DeterministicExecutionRouter({
      resolver: {
        inspect: async (placement) =>
          states.get(executionPlacementKey(placement)) ?? null,
      },
    });
    await expect(
      router.resolve({
        userId: "user-1",
        capability: "storage",
        selected: node,
        requiredCapabilityVersion: 1,
        expectedInputBytes: 100,
        fallbackChain: [core],
        allowDataTransfer: false,
      }),
    ).rejects.toThrow("DATA_TRANSFER_NOT_APPROVED");
  });

  test("keeps a durable object on its recorded placement", async () => {
    const router = new DeterministicExecutionRouter({
      resolver: { inspect: async (placement) => state(placement) },
    });
    const decision = await router.resolve({
      userId: "user-1",
      capability: "storage",
      selected: core,
      durablePlacement: node,
      requiredCapabilityVersion: 1,
      allowDataTransfer: true,
      expectedInputBytes: 0,
      fallbackChain: [],
    });
    expect(decision.placement).toEqual(node);
    expect(decision.reason).toBe("durable-placement-required");
  });

  test("checks isolation and only dispatches through the resolved adapter", async () => {
    const dispatched: string[] = [];
    const router = new DeterministicExecutionRouter({
      resolver: { inspect: async (placement) => state(placement) },
      dispatchers: new Map([
        [
          executionPlacementKey(node),
          async () => (dispatched.push("node"), "handle-1"),
        ],
      ]),
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
    });
    await expect(
      router.resolve({
        userId: "user-1",
        capability: "sandbox",
        selected: node,
        requiredCapabilityVersion: 1,
        requiredIsolation: "kata",
        expectedInputBytes: 0,
        allowDataTransfer: false,
        fallbackChain: [],
      }),
    ).rejects.toThrow("SANDBOX_ISOLATION_INSUFFICIENT");
    const result = await router.dispatch({
      operationId: "operation-1",
      request: {
        userId: "user-1",
        capability: "storage",
        selected: node,
        requiredCapabilityVersion: 1,
        expectedInputBytes: 0,
        allowDataTransfer: false,
        fallbackChain: [],
      },
      payload: {},
    });
    expect(result.placementHandle).toBe("handle-1");
    expect(dispatched).toEqual(["node"]);
  });

  test("rejects quota, renderer and resolver identity mismatches", async () => {
    const quotaRouter = new DeterministicExecutionRouter({
      resolver: {
        inspect: async (placement) => ({
          ...state(placement),
          storageRemainingBytes: 2,
        }),
      },
    });
    await expect(
      quotaRouter.resolve({
        userId: "user-1",
        capability: "storage",
        selected: node,
        requiredCapabilityVersion: 1,
        expectedInputBytes: 3,
        allowDataTransfer: false,
        fallbackChain: [],
      }),
    ).rejects.toThrow("STORAGE_QUOTA_EXCEEDED");

    const rendererRouter = new DeterministicExecutionRouter({
      resolver: {
        inspect: async (placement) => ({
          ...state(placement),
          features: {
            ...state(placement).features,
            renderers: {
              version: 1,
              kinds: ["latex"],
              imageDigests: [`sha256:${"b".repeat(64)}`],
            },
          },
        }),
      },
    });
    await expect(
      rendererRouter.resolve({
        userId: "user-1",
        capability: "renderers",
        selected: node,
        requiredCapabilityVersion: 1,
        requiredRendererDigest: digest,
        expectedInputBytes: 0,
        allowDataTransfer: false,
        fallbackChain: [],
      }),
    ).rejects.toThrow("RENDERER_DIGEST_UNAVAILABLE");

    const confusedResolver = new DeterministicExecutionRouter({
      resolver: { inspect: async () => state(core) },
    });
    await expect(
      confusedResolver.resolve({
        userId: "user-1",
        capability: "storage",
        selected: node,
        requiredCapabilityVersion: 1,
        expectedInputBytes: 0,
        allowDataTransfer: false,
        fallbackChain: [],
      }),
    ).rejects.toThrow("PLACEMENT_STATE_MISMATCH");
  });

  test("rejects a forged pre-resolved placement before invoking its dispatcher", async () => {
    const dispatched: string[] = [];
    const router = new DeterministicExecutionRouter({
      resolver: { inspect: async (placement) => state(placement) },
      dispatchers: new Map([
        [
          executionPlacementKey(core),
          async () => (dispatched.push("core"), "forged-handle"),
        ],
      ]),
    });
    await expect(
      router.dispatchResolved(
        {
          operationId: "forged-operation",
          request: {
            userId: "user-1",
            capability: "storage",
            selected: node,
            requiredCapabilityVersion: 1,
            expectedInputBytes: 0,
            allowDataTransfer: false,
            fallbackChain: [],
          },
          payload: {},
        },
        {
          placement: core,
          reason: "selected-placement-ready",
          fallbackUsed: false,
          transferRequired: false,
          inspectedAt: "2026-08-22T00:00:00.000Z",
          manifestConfigRevision: digest,
        },
      ),
    ).rejects.toBeInstanceOf(RoutingDispatchRejectedError);
    expect(dispatched).toEqual([]);
  });

  test("revalidates manifest revision and availability immediately before dispatch", async () => {
    let current = state(node);
    const dispatched: string[] = [];
    const router = new DeterministicExecutionRouter({
      resolver: { inspect: async () => current },
      dispatchers: new Map([
        [
          executionPlacementKey(node),
          async () => (dispatched.push("node"), "handle"),
        ],
      ]),
    });
    const operation = {
      operationId: "stale-operation",
      request: {
        userId: "user-1",
        capability: "storage" as const,
        selected: node,
        requiredCapabilityVersion: 1,
        expectedInputBytes: 0,
        allowDataTransfer: false,
        fallbackChain: [],
      },
      payload: {},
    };
    const decision = await router.resolve(operation.request);

    current = {
      ...current,
      configRevision: `sha256:${"b".repeat(64)}`,
    };
    await expect(router.dispatchResolved(operation, decision)).rejects.toThrow(
      "ROUTING_DECISION_STALE",
    );

    current = { ...state(node), online: false };
    const offlineDecision = {
      ...decision,
      manifestConfigRevision: current.configRevision,
    };
    await expect(
      router.dispatchResolved(operation, offlineDecision),
    ).rejects.toThrow("ROUTING_DECISION_STALE:PLACEMENT_OFFLINE");
    expect(dispatched).toEqual([]);
  });
});
