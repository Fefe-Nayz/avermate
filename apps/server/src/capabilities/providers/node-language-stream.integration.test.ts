import { describe, expect, test } from "bun:test";
import {
  capabilityUsageSchema,
  languageGenerationResultV1Schema,
  type CapabilityError,
  type CapabilityOffering,
  type CapabilityUsage,
  type FrozenCapabilityRoutePlan,
  type LanguageGenerationResultV1,
  type ModelGateway,
  type ModelGatewayEvent,
  type ModelRequest,
  type NodeCapabilityEventV1,
  type NodeCapabilityTransport,
  type ProviderConnectionPublicSnapshot,
  type ProviderPluginManifest,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { NodeCapabilityExecutor } from "../../../../node/src/capabilities/executor";
import { LegacyModelCapabilityAdapter } from "../../../../node/src/capabilities/legacy-bridge";
import { createNodeCapabilityOffering } from "../../../../node/src/capabilities/manifest";
import { NodeCapabilityRegistry } from "../../../../node/src/capabilities/registry";
import { NodeCapabilitySecretCustody } from "../../../../node/src/capabilities/secret-store";
import type { NodeSecretStore } from "../../../../node/src/secret-store";
import { CoreNodeGrantIssuer } from "../../node/core-grant-issuer";
import { CapabilityExecutionError } from "../errors";
import { CapabilityExecutor } from "../executor";
import type {
  CapabilityOperationStore,
  PublicCapabilityOperation,
} from "../operation-store";
import { ProviderPluginRegistry } from "../plugin-registry";
import { CapabilityRegistryInvoker } from "../registry-invoker";
import { capabilityDigest } from "../values";
import { createCoreNodeProviderPlugin } from "./node";

const configRevision = `sha256:${"a".repeat(64)}` as const;
const nodeId = "node-language-integration";
const ownerId = "owner-language-integration";
const operationId = "operation-language-integration";
const manifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "avermate.node",
  version: "1.0.0",
  displayName: "Avermate Node",
  executionTrust: "node-reviewed",
  capabilities: ["language.generate"],
  connectionSchemaVersion: 1,
  configurationFields: [],
  secretSlots: [],
};
const modelEvents: ModelGatewayEvent[] = [
  { type: "content-delta", delta: "Bonjour depuis le Node." },
  {
    type: "usage",
    usage: {
      inputTokens: 23,
      outputTokens: 5,
      reasoningTokens: 0,
      cachedReadTokens: 2,
      cachedWriteTokens: "unknown",
    },
  },
  { type: "finish", reason: "stop" },
];
type Fault =
  | "provider-error"
  | "missing-finish"
  | "chunk-payload"
  | "sequence-gap"
  | "completion-payload";

function fixture(fault?: Fault) {
  const now = new Date();
  const connection: ProviderConnectionPublicSnapshot = {
    schemaVersion: 1,
    id: "connection-language-integration",
    ownerKind: "user",
    ownerId,
    pluginId: manifest.id,
    pluginVersion: manifest.version,
    displayName: "Owner Node",
    placement: { kind: "node", nodeId, configRevision },
    configVersion: 1,
    config: { nodeId, configRevision },
    configDigest: capabilityDigest({ nodeId, configRevision }),
    status: "ready",
    revision: 1,
    lastValidatedAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deletedAt: null,
  };
  const advertised = createNodeCapabilityOffering({
    descriptor: {
      schemaVersion: 1,
      connectionId: "node-internal-connection",
      connectionRevision: 1,
      pluginId: "fixture.node-model",
      pluginVersion: "1",
      adapterRevision: "legacy-language-v1",
      capability: "language.generate",
      capabilityProtocolVersion: 1,
      provider: "node-local-model",
      modelId: "fixture-model",
      modelRevision: "weights-r1",
      placement: { kind: "node", nodeId, configRevision },
      dataHandling: {
        egress: "owner-node",
        providerName: null,
        region: null,
        disclosureRevision: "node-local-v1",
        retentionDisclosureRevision: null,
        trainingDisclosureRevision: null,
        requiresExplicitConsent: false,
      },
      limits: {
        maxInputBytes: 1_000_000,
        maxOutputBytes: 1_000_000,
        maxBatchSize: 1,
        maxConcurrency: 1,
      },
      supportedLanguages: ["fr"],
      healthCheckKind: "node-attested",
      specification: {
        inputModalities: ["text"],
        contextWindow: 8_192,
        maximumOutputTokens: 4_096,
        tools: false,
        parallelTools: false,
        structuredOutput: false,
        streaming: true,
        reasoningSummary: false,
        opaqueReasoningContinuation: false,
        cachedUsage: true,
      },
    },
    runtime: {
      implementation: "node-model-gateway",
      runtimeRevision: "runtime-r1",
      imageDigest: null,
      modelRevision: "weights-r1",
    },
    egressPolicyDigest: `sha256:${"b".repeat(64)}`,
  });
  const gatewayRequests: ModelRequest[] = [];
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected non-stream gateway method");
  };
  const gateway: ModelGateway = {
    async listModels() {
      return [];
    },
    async *stream(request) {
      gatewayRequests.push(request);
      yield modelEvents[0]!;
      yield modelEvents[1]!;
      if (fault === "provider-error") {
        yield { type: "error", code: "PROVIDER_UNAVAILABLE", retryable: true };
        return;
      }
      if (fault !== "missing-finish") yield modelEvents[2]!;
    },
    embed: unused,
    transcribe: unused,
    estimate: unused,
  };
  const nodeRegistry = new NodeCapabilityRegistry({
    nodeId,
    configRevision: () => configRevision,
    secrets: new NodeCapabilitySecretCustody({
      read: unused,
    } as unknown as NodeSecretStore),
  });
  nodeRegistry.register(
    new LegacyModelCapabilityAdapter({
      offering: advertised,
      gateway,
      modelId: advertised.descriptor.modelId,
    }),
  );
  const issuer = new CoreNodeGrantIssuer(
    "node-language-stream-integration-secret-".repeat(2),
  );
  const nodeExecutor = new NodeCapabilityExecutor({
    nodeId,
    configRevision: () => configRevision,
    issuerPublicKeyDer: issuer.publicSigningKey,
    issuerKeyId: issuer.identity.keyId,
    registry: nodeRegistry,
  });
  const wireEvents: NodeCapabilityEventV1[] = [];
  const relayRequests: Array<
    Parameters<NodeCapabilityTransport["streamCapability"]>[0]
  > = [];
  let unaryCalls = 0;
  const transport: NodeCapabilityTransport = {
    async online() {
      return true;
    },
    async listCapabilityOfferings() {
      return nodeRegistry.listOfferings();
    },
    async invokeCapability() {
      unaryCalls += 1;
      throw new Error(
        "Language stream must use stream-relay, never unary-relay",
      );
    },
    async *streamCapability(input) {
      relayRequests.push(input);
      for await (const original of nodeExecutor.stream(input)) {
        const event = structuredClone(original);
        wireEvents.push(structuredClone(original));
        // Corrupt the relay boundary after the real Node executor validated it:
        // Core must independently reject malformed payloads and sequence gaps.
        if (fault === "chunk-payload" && event.type === "chunk")
          event.payload = { type: "content-delta", delta: { unsafe: true } };
        if (fault === "sequence-gap" && event.type === "chunk")
          event.sequence += 1;
        if (fault === "completion-payload" && event.type === "completed")
          event.payload = { finishReason: "made-up" };
        yield event;
      }
    },
  };
  const plugin = createCoreNodeProviderPlugin(manifest, {
    transport,
    signGrant: (claims) => issuer.signCapabilityInvocation(claims),
    now: () => new Date(),
  });
  const registry = new ProviderPluginRegistry();
  registry.register({
    source: "compiled",
    manifest,
    connectionConfigSchema: z.strictObject({
      nodeId: z.string(),
      configRevision: z.string(),
    }),
    instantiate: () => plugin,
  });

  // Only persistence is in-memory. Discovery, policy resolution, frozen route,
  // Core execution, signed grant verification, Node execution, and both stream
  // conversions below are the real production implementations.
  let operation: PublicCapabilityOperation | null = null;
  let policySnapshot: unknown = null;
  let stored: LanguageGenerationResultV1 | null = null;
  const persistedUsage: CapabilityUsage[] = [];
  const failures: CapabilityError[] = [];
  const offerings = new Map<string, CapabilityOffering>();
  let providerDispatches = 0;
  const operations = {
    async reserve(input: Parameters<CapabilityOperationStore["reserve"]>[0]) {
      const replayed = operation !== null;
      if (operation) {
        expect(input.inputDigest).toBe(operation.inputDigest);
        expect(input.idempotencyKey).toBe(operation.idempotencyKey);
      } else {
        policySnapshot = input.policySnapshot;
        operation = {
          id: operationId,
          capability: "language.generate",
          purpose: input.purpose,
          inputDigest: input.inputDigest,
          idempotencyKey: input.idempotencyKey,
          state: "reserved",
          routePlan: null,
          resultDigest: null,
          hasResult: false,
          safeErrorCode: null,
          retryable: false,
          ambiguous: false,
          revision: 1,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          completedAt: null,
        };
      }
      return { operation: structuredClone(operation), replayed };
    },
    async freezeRoute(input: { routePlan: FrozenCapabilityRoutePlan }) {
      operation = {
        ...operation!,
        state: "ready",
        routePlan: input.routePlan,
        revision: operation!.revision + 1,
      };
      return structuredClone(operation);
    },
    async get(requestOwner: string, id: string) {
      expect(requestOwner).toBe(ownerId);
      expect(id).toBe(operationId);
      return structuredClone(operation);
    },
    async getPolicySnapshot() {
      return structuredClone(policySnapshot);
    },
    async getResult() {
      return structuredClone(stored);
    },
    async beginAttempt() {
      operation = {
        ...operation!,
        state: "dispatching",
        revision: operation!.revision + 1,
      };
      return {
        id: "attempt-language-integration",
        ordinal: 0,
        startedAt: now.toISOString(),
      };
    },
    async markProviderDispatch() {
      providerDispatches += 1;
    },
    async acknowledgeAttempt() {
      operation = {
        ...operation!,
        state: "acknowledged",
        revision: operation!.revision + 1,
      };
    },
    async complete(input: { result: unknown; usage: CapabilityUsage }) {
      stored = languageGenerationResultV1Schema.parse(input.result);
      const usage = capabilityUsageSchema.parse(input.usage);
      expect(usage).toEqual(stored.usage);
      persistedUsage.push(usage);
      operation = {
        ...operation!,
        state: "completed",
        hasResult: true,
        resultDigest: capabilityDigest(stored),
        completedAt: new Date().toISOString(),
        revision: operation!.revision + 1,
      };
    },
    async failAttempt(input: { error: CapabilityError; terminal: boolean }) {
      expect(input.terminal).toBe(true);
      failures.push(input.error);
      operation = {
        ...operation!,
        state: input.error.ambiguous ? "inspect-required" : "failed",
        safeErrorCode: input.error.code,
        ambiguous: input.error.ambiguous,
        revision: operation!.revision + 1,
      };
    },
  };
  const dependencies = {
    operations,
    connections: {
      async list() {
        return [{ connection, credentialSlots: [] }];
      },
      async get(requestOwner: string, id: string) {
        expect(requestOwner).toBe(ownerId);
        expect(id).toBe(connection.id);
        return { connection, credentialSlots: [] };
      },
    },
    offerings: {
      async register(input: { offering: CapabilityOffering }) {
        offerings.set(input.offering.id, input.offering);
        return input.offering;
      },
      async list() {
        return [...offerings.values()];
      },
      async get(_owner: string, id: string) {
        return offerings.get(id) ?? null;
      },
    },
    consents: {
      async list() {
        return [];
      },
    },
    health: {
      async get() {
        return { state: "healthy", latencyP50Ms: 1 };
      },
      async recordSuccess() {},
      async recordFailure() {},
    },
    policies: {
      async list() {
        return [];
      },
      async assertAppliedPoliciesCurrent() {},
    },
    registry,
    metrics: { async emit() {} },
  };
  const executor = new CapabilityExecutor(
    dependencies as unknown as ConstructorParameters<
      typeof CapabilityExecutor
    >[0],
  );
  return {
    nodeRegistry,
    advertised,
    gatewayRequests,
    relayRequests,
    wireEvents,
    persistedUsage,
    failures,
    state: () => operation?.state,
    stored: () => stored,
    unaryCalls: () => unaryCalls,
    providerDispatches: () => providerDispatches,
    async collect(events: ModelGatewayEvent[] = []) {
      // Reconstruct the facade on every call: replay must use stored results,
      // not an in-process stream cache belonging to the previous facade.
      const invoker = new CapabilityRegistryInvoker({
        ...dependencies,
        executor,
      } as unknown as ConstructorParameters<
        typeof CapabilityRegistryInvoker
      >[0]);
      for await (const event of invoker.streamLanguage({
        ownerId,
        purpose: "assistant.chat",
        idempotencyKey: "node-language-round-1",
        request: {
          schemaVersion: 1,
          messages: [
            { role: "user", parts: [{ type: "text", text: "Bonjour" }] },
          ],
          tools: [],
          maximumOutputTokens: 128,
          responseFormat: "text",
        },
      }))
        events.push(event);
      return events;
    },
  };
}

describe("Node language stream through the registry", () => {
  test("normalizes wire events, persists text/usage, and replays without generating again", async () => {
    const f = fixture();
    expect(await f.collect()).toEqual(modelEvents);
    expect(
      f.wireEvents.map(({ type, sequence }) => ({ type, sequence })),
    ).toEqual([
      { type: "acknowledged", sequence: 0 },
      { type: "chunk", sequence: 1 },
      { type: "usage", sequence: 2 },
      { type: "completed", sequence: 3 },
    ]);
    expect(f.stored()).toMatchObject({
      text: "Bonjour depuis le Node.",
      finishReason: "stop",
      toolCalls: [],
    });
    expect(f.persistedUsage).toHaveLength(1);
    expect(f.persistedUsage[0]?.items).toEqual([
      { unit: "input-token", quantity: "23", source: "provider" },
      { unit: "output-token", quantity: "5", source: "provider" },
      { unit: "reasoning-token", quantity: "0", source: "provider" },
      { unit: "cached-input-token", quantity: "2", source: "provider" },
    ]);
    expect(f.state()).toBe("completed");
    expect(await f.collect()).toEqual(modelEvents);
    expect(f.gatewayRequests).toHaveLength(1);
    expect(f.relayRequests).toHaveLength(1);
    expect(f.persistedUsage).toHaveLength(1);
    expect(f.failures).toEqual([]);
    expect(f.providerDispatches()).toBe(1);
    expect(f.nodeRegistry.invocationModes()).toEqual(["stream-relay"]);
    expect(f.unaryCalls()).toBe(0);
    expect(f.relayRequests[0]?.grant.claims).toMatchObject({
      ownerId,
      nodeId,
      operationId,
      offeringId: f.advertised.descriptor.id,
      offeringDigest: f.advertised.descriptorDigest,
      requestDigest: f.relayRequests[0]?.request.requestDigest,
      configRevision,
    });
    expect(f.gatewayRequests[0]).toMatchObject({
      ownerId,
      runId: operationId,
      requestKey: operationId,
      modelId: "fixture-model",
      maximumOutputTokens: 128,
      tools: [],
    });
  });

  for (const fault of [
    "provider-error",
    "missing-finish",
    "completion-payload",
  ] as const) {
    test(`${fault} after partial output never persists a successful result or regenerates`, async () => {
      const f = fixture(fault);
      const partial: ModelGatewayEvent[] = [];
      await expect(f.collect(partial)).rejects.toBeInstanceOf(
        CapabilityExecutionError,
      );
      expect(partial).toEqual(modelEvents.slice(0, 2));
      expect(f.state()).toBe("inspect-required");
      expect(f.stored()).toBeNull();
      expect(f.persistedUsage).toEqual([]);
      expect(f.failures).toMatchObject([
        { code: "INSPECT_REQUIRED", ambiguous: true, retryable: false },
      ]);
      await expect(f.collect()).rejects.toThrow(
        "CAPABILITY_OPERATION_NOT_EXECUTABLE:inspect-required",
      );
      expect(f.gatewayRequests).toHaveLength(1);
      expect(f.relayRequests).toHaveLength(1);
      expect(f.unaryCalls()).toBe(0);
    });
  }

  for (const fault of ["chunk-payload", "sequence-gap"] as const) {
    test(`rejects ${fault} independently at Core's relay boundary`, async () => {
      const f = fixture(fault);
      const partial: ModelGatewayEvent[] = [];
      await expect(f.collect(partial)).rejects.toBeInstanceOf(
        CapabilityExecutionError,
      );
      expect(partial).toEqual([]); // Acknowledgement is transport-only, not model output.
      expect(f.state()).toBe("inspect-required");
      expect(f.stored()).toBeNull();
      expect(f.persistedUsage).toEqual([]);
      expect(f.failures[0]).toMatchObject({
        ambiguous: true,
        retryable: false,
      });
      expect(f.gatewayRequests).toHaveLength(1);
      expect(f.unaryCalls()).toBe(0);
    });
  }
});
