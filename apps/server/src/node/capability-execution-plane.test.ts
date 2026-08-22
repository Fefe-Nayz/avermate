import { describe, expect, test } from "bun:test";
import type {
  CapabilityRequest,
  CitationResolver,
  ConversationStore,
  CorpusStore,
  LexicalSearchBackend,
  ModelDescriptor,
  ModelGateway,
  ObjectStorageProvider,
  SandboxProvider,
} from "@avermate/agent-contracts";
import {
  CapabilityExecutionPlane,
  type CapabilityProviderSet,
} from "./capability-execution-plane";
import type { PlacementRuntimeState } from "./execution-router";

const digest = `sha256:${"c".repeat(64)}` as const;
const node = {
  kind: "node" as const,
  nodeId: "node-plane",
  providerId: "provider-bundle",
};
const core = { kind: "core" as const, providerId: "core-bundle" };
const model: ModelDescriptor = {
  id: "fixture-model",
  provider: "fixture",
  displayName: "Fixture",
  modalities: ["text"],
  capabilities: {
    tools: false,
    reasoningSummary: false,
    cachedUsage: false,
    structuredOutput: false,
  },
  contextWindow: 1_024,
};

function request(
  capability: CapabilityRequest["capability"],
  fallbackChain: CapabilityRequest["fallbackChain"] = [],
): CapabilityRequest {
  return {
    userId: "owner-plane",
    capability,
    selected: node,
    requiredCapabilityVersion: 1,
    expectedInputBytes: 0,
    allowDataTransfer: false,
    fallbackChain,
  };
}

function state(
  placement: PlacementRuntimeState["placement"] = node,
): PlacementRuntimeState {
  return {
    placement,
    online: true,
    healthy: true,
    configRevision: digest,
    features: {
      storage: {
        version: 1,
        maxObjectBytes: 1_024,
        multipart: false,
        directTransfer: false,
        encryptionModes: ["transport-tls"],
      },
      conversations: { version: 1, search: false, maxBytes: 1_024 },
      retrieval: { version: 1, lexical: true, vectorSpaces: [] },
      models: { version: 1, models: [model] },
      sandbox: {
        version: 1,
        isolation: "none",
        workspaceSnapshots: false,
        runtimeCheckpoints: false,
        browser: false,
        gpu: false,
      },
    },
    storageRemainingBytes: 1_024,
  };
}

function providers(): CapabilityProviderSet {
  const storage = {
    id: "storage-fixture",
    async capabilities() {
      return {
        providerId: "storage-fixture",
        maxObjectBytes: 1_024,
        maxPartBytes: 1_024,
        minPartBytes: 1,
        multipart: false,
        range: true,
        copy: false,
        reconcile: true,
        directTransfer: false,
        checksumAlgorithms: ["sha256"] as ["sha256"],
      };
    },
  } as ObjectStorageProvider;
  const conversations = {
    async appendEvent() {
      throw new Error("not used");
    },
    async *replayEvents() {},
    async getRun() {
      return null;
    },
  } satisfies ConversationStore;
  const lexical = {
    async capabilities() {
      return {
        available: true,
        implementation: "fixture-lexical-v1",
        modes: ["terms", "exact"] as const,
      };
    },
    async upsertVersion() {},
    async removeVersion() {},
    async search() {
      return [];
    },
    async verify() {
      return {
        consistent: true,
        indexedVersions: 0,
        missingVersionIds: [],
        orphanedVersionIds: [],
      };
    },
  } satisfies LexicalSearchBackend;
  const corpus = {} as CorpusStore;
  const citations = {} as CitationResolver;
  const models = {
    async listModels() {
      return [model];
    },
    async *stream() {},
    async embed() {
      throw new Error("not used");
    },
    async transcribe() {
      throw new Error("not used");
    },
    async estimate() {
      throw new Error("not used");
    },
  } satisfies ModelGateway;
  const sandbox = {
    id: "mock" as const,
    async capabilities() {
      return { providerId: "mock", available: true, profiles: [] };
    },
    async preflight() {
      return {
        ok: false as const,
        reason: "PROFILE_DISABLED" as const,
        message: "fixture",
      };
    },
    async create(): Promise<never> {
      throw new Error("not used");
    },
    async *execute() {},
    async putFiles() {},
    async getFiles() {
      return [];
    },
    async *readFile() {},
    async snapshotWorkspace(): Promise<never> {
      throw new Error("not used");
    },
    async forkWorkspace(): Promise<never> {
      throw new Error("not used");
    },
    async stop() {},
    async destroy() {},
  } satisfies SandboxProvider;
  return {
    storage,
    conversations,
    retrieval: { corpus, lexical, citations },
    models,
    sandbox,
  };
}

describe("CapabilityExecutionPlane", () => {
  test("dispatches all implemented data-plane capabilities through ExecutionRouter", async () => {
    const plane = new CapabilityExecutionPlane({
      clock: () => new Date("2026-08-22T12:00:00.000Z"),
    }).register({
      state: state(),
      providers: providers(),
      provenCapabilities: {
        storage: true,
        conversations: true,
        retrieval: true,
        models: true,
        sandbox: true,
      },
    });

    const storage = await plane.runStorage({
      request: request("storage"),
      operationId: "storage-op",
      invoke: async (provider) => provider.id,
    });
    expect(storage.value).toBe("storage-fixture");
    expect(storage.decision.placement).toEqual(node);

    const conversation = await plane.runConversation({
      request: request("conversations"),
      operationId: "conversation-op",
      invoke: async (provider) =>
        provider.getRun({
          ownerId: "owner-plane",
          threadId: "thread",
          branchId: "branch",
          runId: "run",
        }),
    });
    expect(conversation.value).toBeNull();

    const retrieval = await plane.runRetrieval({
      request: request("retrieval"),
      operationId: "retrieval-op",
      invoke: async (provider) =>
        (await provider.lexical.capabilities()).implementation,
    });
    expect(retrieval.value).toBe("fixture-lexical-v1");

    const models = await plane.runModel({
      request: request("models"),
      operationId: "model-op",
      invoke: (provider) =>
        provider.listModels({
          ownerId: "owner-plane",
          placement: "node",
          allowedOrigins: [],
        }),
    });
    expect(models.value).toEqual([model]);

    const sandbox = await plane.runSandbox({
      request: request("sandbox"),
      operationId: "sandbox-op",
      invoke: async (provider) => (await provider.capabilities()).available,
    });
    expect(sandbox.value).toBe(true);
  });

  test("masks unproven node capabilities and uses only an explicit fallback", async () => {
    const nodeProviders = providers();
    const coreProviders = providers();
    const plane = new CapabilityExecutionPlane()
      .register({
        state: state(node),
        providers: nodeProviders,
        // Deliberately no models proof despite the manifest claim.
        provenCapabilities: { storage: true },
      })
      .register({ state: state(core), providers: coreProviders });

    await expect(
      plane.runModel({
        request: request("models"),
        operationId: "no-fallback",
        invoke: async () => "unexpected",
      }),
    ).rejects.toThrow("CAPABILITY_NOT_ADVERTISED");

    const fallback = await plane.runModel({
      request: request("models", [core]),
      operationId: "explicit-core-fallback",
      invoke: async (_provider, decision) => decision.placement.kind,
    });
    expect(fallback.value).toBe("core");
    expect(fallback.decision).toMatchObject({
      fallbackUsed: true,
      reason: "explicit-fallback",
    });
  });

  test("invalidates conformance proof when the live manifest revision changes", async () => {
    let inspections = 0;
    let invoked = false;
    const plane = new CapabilityExecutionPlane().register({
      state: state(node),
      inspectState: async () => {
        inspections += 1;
        return inspections === 1
          ? state(node)
          : {
              ...state(node),
              configRevision: `sha256:${"d".repeat(64)}`,
            };
      },
      providers: providers(),
      provenCapabilities: { storage: true },
    });
    await expect(
      plane.runStorage({
        request: request("storage"),
        operationId: "stale-conformance-proof",
        invoke: async () => {
          invoked = true;
        },
      }),
    ).rejects.toThrow("ROUTING_DECISION_STALE");
    expect(invoked).toBe(false);
  });
});
