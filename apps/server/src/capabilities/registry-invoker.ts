import {
  canonicalCapabilityJson,
  capabilityRequestSchemas,
  capabilityResultSchemas,
  type CapabilityKind,
  type CapabilityOffering,
  type CapabilityRequestMap,
  type CapabilityResultMap,
  type LanguageGenerationRequestV1,
  type ModelGatewayEvent,
  type NormalizedUsage,
} from "@avermate/agent-contracts";
import { newId } from "../lib/id";
import { CapabilityConnectionStore } from "./connection-store";
import { CapabilityConsentStore } from "./consent-store";
import { CapabilityExecutor } from "./executor";
import { normalizeCapabilityError } from "./errors";
import { CapabilityHealthService } from "./health-service";
import { defaultManagedCapabilityExecutionBroker } from "./managed-execution-broker";
import { CapabilityOfferingStore } from "./offering-store";
import { CapabilityOperationStore } from "./operation-store";
import { staticProviderPluginRegistry } from "./plugin-registry";
import {
  CapabilityPolicyResolver,
  type ResolvedCapabilityPolicySnapshot,
} from "./policy-resolver";
import { CapabilityPolicyStore } from "./policy-store";
import {
  CapabilityRoutePlanner,
  type CapabilityRouteRequirements,
} from "./route-planner";
import { capabilityDigest } from "./values";
import type { CapabilityRouteSelection } from "./runtime";
import {
  capabilitySystemConstraints,
  capabilitySystemPolicyEpoch,
} from "./system-policy";

type RegistryInvokerDependencies = {
  connections?: CapabilityConnectionStore;
  consents?: CapabilityConsentStore;
  executor?: CapabilityExecutor;
  health?: CapabilityHealthService;
  offerings?: CapabilityOfferingStore;
  operations?: CapabilityOperationStore;
  policies?: CapabilityPolicyStore;
  policyResolver?: CapabilityPolicyResolver;
  registry?: typeof staticProviderPluginRegistry;
  routePlanner?: CapabilityRoutePlanner;
};

export type CapabilityRouteConstraint = {
  offeringId?: string;
  provider: string;
  modelId: string;
  modelRevision: string;
  embeddingSpaceId?: string;
};

/** Server-owned workflow scope; never copied from arbitrary provider input. */
export type CapabilityWorkflowScope = {
  projectId?: string;
  workflowId?: string;
};

function matchingOfferings(
  offerings: readonly CapabilityOffering[],
  route?: CapabilityRouteConstraint,
) {
  if (!route) return offerings;
  return offerings.filter(
    (offering) =>
      (route.offeringId === undefined || offering.id === route.offeringId) &&
      offering.provider === route.provider &&
      offering.modelId === route.modelId &&
      offering.modelRevision === route.modelRevision &&
      (route.embeddingSpaceId === undefined ||
        (offering.capability === "embedding.generate" &&
          offering.specification.embeddingSpaceId === route.embeddingSpaceId)),
  );
}

function routeSelection(
  offering: CapabilityOffering,
  reason: string,
): CapabilityRouteSelection {
  return {
    offeringId: offering.id,
    routeKey: `${offering.provider}:${offering.modelId}@${offering.modelRevision}`,
    provider: offering.provider,
    modelId: offering.modelId,
    reason,
  };
}

const unknownNormalizedUsage: NormalizedUsage = {
  inputTokens: "unknown",
  outputTokens: "unknown",
  reasoningTokens: "unknown",
  cachedReadTokens: "unknown",
  cachedWriteTokens: "unknown",
};

function capabilityUsageFromNormalized(usage: NormalizedUsage) {
  const entries = [
    ["input-token", usage.inputTokens],
    ["output-token", usage.outputTokens],
    ["reasoning-token", usage.reasoningTokens],
    ["cached-input-token", usage.cachedReadTokens],
  ] as const;
  return {
    version: 1 as const,
    items: entries.flatMap(([unit, quantity]) =>
      quantity === "unknown"
        ? []
        : [{ unit, quantity: String(quantity), source: "provider" as const }],
    ),
    cost: {
      amountMinor: null,
      currency: null,
      authoritative: false,
      pricingSnapshotId: null,
    },
  };
}

function normalizedUsageFromCapability(
  result: CapabilityResultMap["language.generate"],
): NormalizedUsage {
  const quantity = (unit: string) => {
    const item = result.usage.items.find(
      (candidate) => candidate.unit === unit,
    );
    if (!item) return "unknown" as const;
    const value = Number(item.quantity);
    return Number.isSafeInteger(value) && value >= 0
      ? value
      : ("unknown" as const);
  };
  return {
    inputTokens: quantity("input-token"),
    outputTokens: quantity("output-token"),
    reasoningTokens: quantity("reasoning-token"),
    cachedReadTokens: quantity("cached-input-token"),
    cachedWriteTokens: "unknown",
  };
}

/** Policy → immutable route → executor composition used by workflow facades. */
export class CapabilityRegistryInvoker {
  readonly #connections: CapabilityConnectionStore;
  readonly #consents: CapabilityConsentStore;
  readonly #executor: CapabilityExecutor;
  readonly #health: CapabilityHealthService;
  readonly #offerings: CapabilityOfferingStore;
  readonly #operations: CapabilityOperationStore;
  readonly #policies: CapabilityPolicyStore;
  readonly #policyResolver: CapabilityPolicyResolver;
  readonly #registry: typeof staticProviderPluginRegistry;
  readonly #routePlanner: CapabilityRoutePlanner;

  constructor(dependencies: RegistryInvokerDependencies = {}) {
    this.#connections =
      dependencies.connections ?? new CapabilityConnectionStore();
    this.#consents = dependencies.consents ?? new CapabilityConsentStore();
    this.#health = dependencies.health ?? new CapabilityHealthService();
    this.#offerings = dependencies.offerings ?? new CapabilityOfferingStore();
    this.#operations =
      dependencies.operations ?? new CapabilityOperationStore();
    this.#policies = dependencies.policies ?? new CapabilityPolicyStore();
    this.#policyResolver =
      dependencies.policyResolver ?? new CapabilityPolicyResolver();
    this.#registry = dependencies.registry ?? staticProviderPluginRegistry;
    this.#routePlanner =
      dependencies.routePlanner ?? new CapabilityRoutePlanner();
    this.#executor =
      dependencies.executor ??
      new CapabilityExecutor({
        connections: this.#connections,
        consents: this.#consents,
        health: this.#health,
        offerings: this.#offerings,
        operations: this.#operations,
        policies: this.#policies,
        registry: this.#registry,
        systemPolicyEpoch: () => capabilitySystemPolicyEpoch,
        managedBroker: defaultManagedCapabilityExecutionBroker(),
      });
  }

  async resolve(
    input: CapabilityWorkflowScope & {
      ownerId: string;
      capability: CapabilityKind;
      purpose: string;
      requirements?: CapabilityRouteRequirements;
      route?: CapabilityRouteConstraint;
    },
  ): Promise<CapabilityRouteSelection> {
    return (await this.prepare(input)).selection;
  }

  /** Read-only affordance check. Stale health means a probe is needed, not unconfigured. */
  async isConfigured(
    input: CapabilityWorkflowScope & {
      ownerId: string;
      capability: CapabilityKind;
      purpose: string;
    },
  ): Promise<boolean> {
    const policy = await this.#policy(input);
    const offerings = await this.#offerings.list({
      ownerId: input.ownerId,
      capability: input.capability,
      statuses: ["ready"],
    });
    try {
      await this.#plan({
        ...input,
        operationId: newId("creadiness"),
        policy,
        offerings,
        allowUnknownHealth: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Current owner-bound selectable offerings, without discovery or provider calls. */
  async listConfiguredOfferings(
    input: CapabilityWorkflowScope & {
      ownerId: string;
      capability: CapabilityKind;
      purpose: string;
    },
  ): Promise<CapabilityOffering[]> {
    const policy = await this.#policy(input);
    const offerings = await this.#offerings.list({
      ownerId: input.ownerId,
      capability: input.capability,
      statuses: ["ready"],
    });
    const selectable: CapabilityOffering[] = [];
    for (const offering of offerings) {
      try {
        await this.#plan({
          ...input,
          operationId: newId("ccatalogue"),
          policy,
          offerings: [offering],
          allowUnknownHealth: true,
        });
        selectable.push(offering);
      } catch {
        // Disabled, missing-consent, unhealthy or otherwise incompatible routes
        // stay out of the selectable catalogue, without probing them here.
      }
    }
    return selectable;
  }

  async prepare(
    input: CapabilityWorkflowScope & {
      ownerId: string;
      capability: CapabilityKind;
      purpose: string;
      requirements?: CapabilityRouteRequirements;
      route?: CapabilityRouteConstraint;
      refreshOfferings?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<{
    selection: CapabilityRouteSelection;
    offering: CapabilityOffering;
  }> {
    if (input.refreshOfferings) {
      await this.#discover(input.ownerId, input.capability, input.signal);
    }
    const policy = await this.#policy(input);
    const offerings = matchingOfferings(
      await this.#offerings.list({
        ownerId: input.ownerId,
        capability: input.capability,
        statuses: ["ready"],
      }),
      input.route,
    );
    const plan = await this.#plan({
      ...input,
      operationId: newId("cshadow"),
      policy,
      offerings,
    });
    const offering = offerings.find(
      (candidate) => candidate.id === plan.primary.offeringId,
    );
    if (!offering) throw new Error("CAPABILITY_REGISTRY_ROUTE_UNAVAILABLE");
    return {
      selection: routeSelection(offering, "registry-policy-route"),
      offering,
    };
  }

  async invoke<K extends CapabilityKind>(
    input: CapabilityWorkflowScope & {
      ownerId: string;
      capability: K;
      purpose: string;
      request: CapabilityRequestMap[K];
      idempotencyKey: string;
      requirements?: CapabilityRouteRequirements;
      route?: CapabilityRouteConstraint;
      signal?: AbortSignal;
      deadline?: Date;
    },
  ): Promise<CapabilityResultMap[K]> {
    const request = capabilityRequestSchemas[input.capability].parse(
      input.request,
    ) as CapabilityRequestMap[K];
    await this.#discover(input.ownerId, input.capability, input.signal);
    const policy = await this.#policy(input);
    const reserved = await this.#operations.reserve({
      ownerId: input.ownerId,
      capability: input.capability,
      purpose: input.purpose,
      inputDigest: capabilityDigest(request),
      idempotencyKey: input.idempotencyKey,
      policySnapshot: policy,
    });
    let operation = reserved.operation;
    if (operation.state === "completed") {
      const stored = await this.#operations.getResult(
        input.ownerId,
        operation.id,
        input.capability,
      );
      if (!stored) throw new Error("CAPABILITY_COMPLETED_RESULT_UNAVAILABLE");
      return capabilityResultSchemas[input.capability].parse(
        stored,
      ) as CapabilityResultMap[K];
    }
    if (operation.state === "reserved") {
      const offerings = matchingOfferings(
        await this.#offerings.list({
          ownerId: input.ownerId,
          capability: input.capability,
          statuses: ["ready"],
        }),
        input.route,
      );
      const plan = await this.#plan({
        ...input,
        operationId: operation.id,
        policy,
        offerings,
      });
      operation = await this.#operations.freezeRoute({
        ownerId: input.ownerId,
        operationId: operation.id,
        expectedRevision: operation.revision,
        routePlan: plan,
      });
    }
    if (operation.state !== "ready" || !operation.routePlan) {
      throw new Error(`CAPABILITY_OPERATION_NOT_EXECUTABLE:${operation.state}`);
    }
    return this.#executor.execute<K>({
      ownerId: input.ownerId,
      operationId: operation.id,
      expectedRevision: operation.revision,
      routePlan: operation.routePlan,
      request,
      deadline: input.deadline,
      signal: input.signal,
    });
  }

  async *streamLanguage(
    input: CapabilityWorkflowScope & {
      ownerId: string;
      purpose: string;
      request: LanguageGenerationRequestV1;
      idempotencyKey: string;
      requirements?: CapabilityRouteRequirements;
      route?: CapabilityRouteConstraint;
      signal?: AbortSignal;
      deadline?: Date;
    },
  ): AsyncIterable<ModelGatewayEvent> {
    const request = capabilityRequestSchemas["language.generate"].parse(
      input.request,
    );
    await this.#discover(input.ownerId, "language.generate", input.signal);
    const policy = await this.#policy({
      ...input,
      capability: "language.generate",
    });
    const reserved = await this.#operations.reserve({
      ownerId: input.ownerId,
      capability: "language.generate",
      purpose: input.purpose,
      inputDigest: capabilityDigest(request),
      idempotencyKey: input.idempotencyKey,
      policySnapshot: policy,
    });
    let operation = reserved.operation;
    if (operation.state === "completed") {
      const stored = await this.#operations.getResult(
        input.ownerId,
        operation.id,
        "language.generate",
      );
      if (!stored) throw new Error("CAPABILITY_COMPLETED_RESULT_UNAVAILABLE");
      if (stored.finishReason === "tool-call" && !stored.toolCalls?.length) {
        throw new Error("CAPABILITY_TOOL_STREAM_REPLAY_PAYLOAD_UNAVAILABLE");
      }
      if (stored.text) yield { type: "content-delta", delta: stored.text };
      for (const call of stored.toolCalls ?? []) {
        yield {
          type: "tool-call-start",
          callId: call.callId,
          toolName: call.toolName,
        };
        if (call.argumentsJson)
          yield {
            type: "tool-arguments-delta",
            callId: call.callId,
            delta: call.argumentsJson,
          };
        yield { type: "tool-call-end", callId: call.callId };
      }
      yield { type: "usage", usage: normalizedUsageFromCapability(stored) };
      yield {
        type: "finish",
        reason:
          stored.finishReason === "tool-call"
            ? "tool-calls"
            : stored.finishReason === "error"
              ? "unknown"
              : stored.finishReason,
      };
      return;
    }
    if (operation.state === "reserved") {
      const offerings = matchingOfferings(
        await this.#offerings.list({
          ownerId: input.ownerId,
          capability: "language.generate",
          statuses: ["ready"],
        }),
        input.route,
      );
      const plan = await this.#plan({
        ...input,
        capability: "language.generate",
        operationId: operation.id,
        policy,
        offerings,
      });
      operation = await this.#operations.freezeRoute({
        ownerId: input.ownerId,
        operationId: operation.id,
        expectedRevision: operation.revision,
        routePlan: plan,
      });
    }
    if (operation.state !== "ready" || !operation.routePlan) {
      throw new Error(`CAPABILITY_OPERATION_NOT_EXECUTABLE:${operation.state}`);
    }
    let text = "";
    const toolCalls = new Map<
      string,
      {
        callId: string;
        toolName: string;
        argumentsJson: string;
        complete: boolean;
      }
    >();
    let usage: NormalizedUsage = unknownNormalizedUsage;
    let finishReason: Extract<ModelGatewayEvent, { type: "finish" }>["reason"] =
      "unknown";
    const stream = this.#executor.stream<
      "language.generate",
      ModelGatewayEvent
    >({
      ownerId: input.ownerId,
      operationId: operation.id,
      expectedRevision: operation.revision,
      routePlan: operation.routePlan,
      request,
      deadline: input.deadline,
      signal: input.signal,
      finalize: () => {
        if ([...toolCalls.values()].some((call) => !call.complete)) {
          throw new Error("CAPABILITY_PROVIDER_MALFORMED_TOOL_STREAM");
        }
        return {
          schemaVersion: 1,
          text,
          toolCalls: [...toolCalls.values()].map(
            ({ complete: _complete, ...call }) => call,
          ),
          finishReason:
            finishReason === "tool-calls" ? "tool-call" : finishReason,
          usage: capabilityUsageFromNormalized(usage),
          providerMetadata: null,
        };
      },
    });
    for await (const event of stream) {
      if (event.type === "content-delta") text += event.delta;
      else if (event.type === "tool-call-start") {
        if (
          toolCalls.has(event.callId) ||
          toolCalls.size >= 128 ||
          !request.tools.some((tool) => tool.name === event.toolName)
        ) {
          throw new Error("CAPABILITY_PROVIDER_MALFORMED_TOOL_STREAM");
        }
        toolCalls.set(event.callId, {
          callId: event.callId,
          toolName: event.toolName,
          argumentsJson: "",
          complete: false,
        });
      } else if (
        event.type === "tool-arguments-delta" ||
        event.type === "tool-call-end"
      ) {
        const call = toolCalls.get(event.callId);
        if (!call || call.complete)
          throw new Error("CAPABILITY_PROVIDER_MALFORMED_TOOL_STREAM");
        if (event.type === "tool-call-end") call.complete = true;
        else {
          call.argumentsJson += event.delta;
          if (call.argumentsJson.length > 256 * 1_024)
            throw new Error("CAPABILITY_PROVIDER_MALFORMED_TOOL_STREAM");
        }
      } else if (event.type === "usage") usage = event.usage;
      else if (event.type === "finish") finishReason = event.reason;
      yield event;
    }
  }

  async #discover(
    ownerId: string,
    capability: CapabilityKind,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (capability === "document.extract") {
      await this.#connections.ensureInternalNativeDocumentConnection({
        ownerId,
        instanceId: process.env.CORE_INSTANCE_ID?.trim() || "core-default",
      });
    }
    const connections = await this.#connections.list(ownerId);
    for (const current of connections) {
      if (current.connection.status !== "ready") continue;
      const factory = this.#registry.get(current.connection.pluginId);
      if (
        !factory?.instantiate ||
        !factory.manifest.capabilities.includes(capability)
      ) {
        continue;
      }
      const credential = async (slot: string) => {
        const publicSlot = current.credentialSlots.find(
          (candidate) => candidate.slot === slot,
        );
        if (
          !publicSlot ||
          publicSlot.status !== "active" ||
          publicSlot.keyVersion === null
        ) {
          return null;
        }
        return this.#connections.leaseSecret({
          ownerId,
          connectionId: current.connection.id,
          slot,
          expectedVersion: publicSlot.keyVersion,
        });
      };
      const plugin = factory.instantiate();
      if (
        canonicalCapabilityJson(plugin.manifest) !==
        canonicalCapabilityJson(factory.manifest)
      ) {
        throw new Error("CAPABILITY_PLUGIN_MANIFEST_MISMATCH");
      }
      const startedAt = Date.now();
      const discoverySignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000);
      const discovered = await plugin.discoverOfferings(
        {
          ownerId,
          now: new Date(),
          signal: discoverySignal,
          credential,
        },
        current.connection,
      );
      const registered: CapabilityOffering[] = [];
      for (const offering of discovered) {
        if (offering.capability !== capability) continue;
        registered.push(
          await this.#offerings.register({
            ownerId,
            offering,
            status: "ready",
          }),
        );
      }
      if (registered.length === 0) continue;
      const health = await Promise.all(
        registered.map((offering) => this.#health.get(ownerId, offering.id)),
      );
      if (!health.some((entry) => !entry || entry.state === "unknown")) {
        continue;
      }
      let validation;
      try {
        validation = await plugin.validateConnection(
          { ownerId, signal: discoverySignal, credential },
          current.connection.config,
        );
      } catch (error) {
        validation = {
          valid: false as const,
          error: normalizeCapabilityError(error),
        };
      }
      signal?.throwIfAborted();
      if (validation.valid) {
        const latencyMs = Math.max(0, Date.now() - startedAt);
        await Promise.all(
          registered.map((offering) =>
            this.#health.recordSuccess({
              ownerId,
              offeringId: offering.id,
              latencyMs,
            }),
          ),
        );
      } else {
        await Promise.all(
          registered.map((offering) =>
            this.#health.recordFailure({
              ownerId,
              offeringId: offering.id,
              error: validation.error,
            }),
          ),
        );
      }
    }
  }

  async #policy(
    input: CapabilityWorkflowScope & {
      ownerId: string;
      capability: CapabilityKind;
      purpose: string;
    },
  ) {
    return this.#policyResolver.resolve({
      context: {
        ownerId: input.ownerId,
        instanceId: process.env.CORE_INSTANCE_ID?.trim() || "core-default",
        ...(input.projectId ? { projectId: input.projectId } : {}),
        workflowId: input.workflowId ?? input.purpose,
      },
      capability: input.capability,
      purpose: input.purpose,
      policies: await this.#policies.list(input.ownerId, input.capability),
      systemConstraints: capabilitySystemConstraints,
      systemPolicyEpoch: capabilitySystemPolicyEpoch,
    });
  }

  async #plan(input: {
    ownerId: string;
    capability: CapabilityKind;
    purpose: string;
    operationId: string;
    requirements?: CapabilityRouteRequirements;
    policy: ResolvedCapabilityPolicySnapshot;
    offerings: readonly CapabilityOffering[];
    allowUnknownHealth?: boolean;
  }) {
    const [connections, consents] = await Promise.all([
      this.#connections.list(input.ownerId),
      this.#consents.list(input.ownerId),
    ]);
    const byConnection = new Map(
      connections.map((connection) => [connection.connection.id, connection]),
    );
    return this.#routePlanner.plan({
      operationId: input.operationId,
      ownerId: input.ownerId,
      policy: input.policy,
      offerings: input.offerings,
      requirements: input.requirements,
      credentialReadiness: async (offering) => {
        const connection = byConnection.get(offering.connectionId);
        if (!connection || connection.connection.status !== "ready") {
          return { ready: false, source: "none" as const, slots: [] };
        }
        const manifest = this.#registry.require(offering.pluginId).manifest;
        const slots = manifest.secretSlots.flatMap((required) => {
          const slot = connection.credentialSlots.find(
            (candidate) => candidate.slot === required.name,
          );
          return slot?.status === "active" && slot.keyVersion !== null
            ? [{ slot: slot.slot, expectedVersion: slot.keyVersion }]
            : [];
        });
        const ready = manifest.secretSlots
          .filter((slot) => slot.required)
          .every((slot) => slots.some((current) => current.slot === slot.name));
        const source =
          offering.placement.kind === "node"
            ? ("node-local" as const)
            : offering.placement.kind === "managed"
              ? ("managed" as const)
              : ("user" as const);
        return { ready, source, slots };
      },
      consentReadiness: async (offering) => {
        if (!offering.dataHandling.requiresExplicitConsent) {
          return { ready: true, grants: [] };
        }
        const grant = consents.find(
          (candidate) =>
            candidate.connectionId === offering.connectionId &&
            candidate.capability === offering.capability &&
            candidate.disclosureRevision ===
              offering.dataHandling.disclosureRevision &&
            candidate.status === "granted",
        );
        return {
          ready: Boolean(grant),
          grants: grant
            ? [{ id: grant.id, expectedRevision: grant.revision }]
            : [],
        };
      },
      health: async (offering) => {
        const current = await this.#health.get(input.ownerId, offering.id);
        if (
          input.allowUnknownHealth &&
          (!current || current.state === "unknown")
        ) {
          return { state: "healthy" as const, latencyP50Ms: null };
        }
        return current
          ? { state: current.state, latencyP50Ms: current.latencyP50Ms }
          : { state: "unknown" as const, latencyP50Ms: null };
      },
    });
  }
}

export const capabilityRegistryInvoker = new CapabilityRegistryInvoker();
