import type {
  AnyAvermateToolDescriptor,
  ModelDescriptor,
  ModelCapability,
  ModelReadiness,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { OpenAICompatibleGateway } from "../agent/model-gateways";
import {
  ContextAssetHandleService,
  OwnedFileContextAssetResolver,
} from "../agent/multimodal-context";
import { createProductionAgentRuntime } from "../agent/production-runtime";
import { CORPUS_INDEX_SOURCE_JOB_KIND } from "../jobs/corpus";
import {
  resolveProviderServiceKey,
  resolveServiceKey,
  type ResolvedServiceKey,
} from "../lib/service-keys";
import { env } from "../lib/env";
import { enqueueJob } from "../lib/jobs";
import type { Api } from "../mcp/shared";
import { createSandboxProviderFromEnvironment } from "../sandbox/provider-factory";
import { enableSandboxProfile } from "../sandbox/profiles";
import { coreCorpusIndexService } from "../search/index-service";
import { routedCorpusStore } from "../search/routed-corpus-store";
import { firstPartyToolDescriptors } from "../tools/first-party";
import { ToolRegistry } from "../tools/registry";
import {
  MISTRAL_ASSISTANT_MODEL,
  MISTRAL_INSTANCE_ASSISTANT_MODEL,
  MISTRAL_MANAGED_ASSISTANT_MODEL,
  MOCK_ASSISTANT_MODEL,
  OPENAI_ASSISTANT_MODEL,
  OPENAI_INSTANCE_ASSISTANT_MODEL,
  OPENROUTER_ASSISTANT_MODEL,
  OPENROUTER_INSTANCE_ASSISTANT_MODEL,
} from "./catalogue";
import { CoreConversationStore } from "./core-conversation-store";
import { RoutedConversationStore } from "./routed-conversation-store";
import {
  MockReadOnlyModelGateway,
  type AssistantGatewayResolver,
  type AssistantGatewaySelection,
} from "./run-service";
import { CoreConversationCheckpointStore } from "./checkpoint-store";
import { ManagedCheckpointBlobStore } from "./managed-checkpoint-blob-store";
import {
  CoreHistoricalBranchRepository,
  HistoricalBranchService,
  type HistoricalBranchSandboxRuntime,
} from "./historical-branch-service";
import {
  ManagedModelPolicyRegistry,
  MeteredModelGateway,
} from "../usage/metered-model-gateway";
import { managedUsage } from "../managed/services";
import { usesManagedOperatorSpend } from "../usage/managed-provider-accounting";
import { ManagedCostControls } from "../operations/cost-controls";
import { AssistantModelPreferenceService } from "./model-preferences";
import {
  decideAssistantModelPolicy,
  loadAssistantRunModelPolicy,
  PolicyConstrainedModelGateway,
} from "./model-policy";
import {
  relayNodeProviderTransport,
  coreNodeRegistry,
  coreNodeRelay,
  coreNodeRuntimeCheckpoints,
  pairedNodeRuntimeCheckpointId,
  pairedNodeRuntimeCheckpointLifecycle,
  registerNodeConversationReconciler,
  selectedPairedNodeSandboxProvider,
} from "../node/services";
import { NodeModelGateway } from "../node/node-provider-adapters";
import { createHash } from "node:crypto";
import { nodePlacementMigrationReady } from "../node/readiness";
import { registerPlacementMigrationAdapter } from "../node/placement-migration-adapters";
import type { OwnedStoredFile } from "../lib/owned-file-storage";

const mockGateway = new MockReadOnlyModelGateway();
const managedModelRegistry = new ManagedModelPolicyRegistry(
  db.$client,
  env.MANAGED_REGION,
);
const managedCostControls = new ManagedCostControls(db.$client);
const contextAssetHandles = new ContextAssetHandleService(
  env.NODE_CREDENTIAL_MASTER_SECRET ?? env.BETTER_AUTH_SECRET,
);
const contextAssetResolver = new OwnedFileContextAssetResolver({
  handles: contextAssetHandles,
  async loadOwnedFile(ownerId, derivativeId) {
    const result = await db.$client.execute({
      sql: `SELECT files.id, files.userId, files.provider, files.storageKey,
          files.mimeType, files.byteSize, files.status
        FROM content_derivatives AS derivatives
        JOIN content_versions AS versions ON versions.id = derivatives.versionId
        JOIN content_chunks AS chunks ON chunks.id = derivatives.chunkId
          AND chunks.versionId = derivatives.versionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        JOIN files ON files.id = derivatives.fileId
          AND files.userId = sources.userId
        WHERE derivatives.id = ? AND sources.userId = ?
          AND derivatives.status = 'ready' AND files.status = 'stored'
        LIMIT 1`,
      args: [derivativeId, ownerId],
    });
    const row = result.rows[0];
    return row
      ? {
          id: String(row.id),
          userId: String(row.userId),
          provider: String(row.provider),
          storageKey: String(row.storageKey),
          mimeType: String(row.mimeType),
          byteSize: Number(row.byteSize),
          status: String(row.status) as OwnedStoredFile["status"],
        }
      : null;
  },
});

function nodeModelKey(nodeId: string, modelId: string) {
  const node = createHash("sha256").update(nodeId).digest("hex").slice(0, 16);
  const model = createHash("sha256").update(modelId).digest("hex").slice(0, 32);
  return `node:${node}:${model}`;
}

type PairedNodeSelection = {
  capability: ModelCapability;
  descriptor: ModelDescriptor;
  gateway: NodeModelGateway;
  modelRevision: string;
  providerRevision: string;
  modelPlacement: {
    kind: "node";
    nodeId: string;
    capabilityRevision: string;
  };
  providerSupportsStableRequestKey: false;
};

async function pairedNodeModelSelections(
  ownerId: string,
): Promise<PairedNodeSelection[]> {
  const nodes = await coreNodeRegistry.listNodes(ownerId);
  const selections: PairedNodeSelection[] = [];
  for (const node of nodes) {
    if (!node.online || !node.capabilities.includes("models")) continue;
    const state = coreNodeRelay.inspect(node.nodeId);
    const models = state?.features.models;
    if (
      !state ||
      state.userId !== ownerId ||
      !models ||
      !models.revisions ||
      !state.health.some(
        (health) =>
          health.capability === "models" && health.state === "healthy",
      )
    ) {
      continue;
    }
    const gateway = new NodeModelGateway(
      state.nodeId,
      ownerId,
      models.models,
      relayNodeProviderTransport,
    );
    let tested: ModelDescriptor[];
    try {
      tested = await gateway.listModels({
        ownerId,
        placement: "node",
        allowedOrigins: [],
      });
    } catch {
      continue;
    }
    for (const descriptor of tested) {
      if (!descriptor.modalities.includes("text")) continue;
      const modelRevision = models.revisions[descriptor.id];
      if (!modelRevision) continue;
      const modalities = descriptor.modalities.filter(
        (modality): modality is "text" | "image" | "audio" =>
          modality === "text" || modality === "image" || modality === "audio",
      );
      selections.push({
        capability: {
          modelKey: nodeModelKey(state.nodeId, descriptor.id),
          providerKey: `node-${createHash("sha256")
            .update(state.nodeId)
            .digest("hex")
            .slice(0, 16)}`,
          label: `${descriptor.displayName} — Node`,
          placement: "node",
          modalities,
          supportsTools: descriptor.capabilities.tools,
          supportsReasoningSummary: descriptor.capabilities.reasoningSummary,
          contextTokens:
            descriptor.contextWindow === "unknown"
              ? null
              : descriptor.contextWindow,
          maxOutputTokens: null,
          estimatedInputPrice: null,
          estimatedOutputPrice: null,
          currency: null,
          contentLeavesPlacement: false,
          privacyUrl: null,
        },
        descriptor,
        gateway,
        modelRevision,
        providerRevision: `node-relay/2:${state.configRevision}`,
        modelPlacement: {
          kind: "node",
          nodeId: state.nodeId,
          capabilityRevision: state.configRevision,
        },
        providerSupportsStableRequestKey: false,
      });
    }
  }
  return selections;
}

const mistralDescriptor: ModelDescriptor = {
  id: "mistral-small-latest",
  provider: "mistral",
  displayName: "Mistral Small",
  modalities: ["text", "image"],
  capabilities: {
    tools: true,
    reasoningSummary: false,
    cachedUsage: false,
    structuredOutput: true,
  },
  contextWindow: 128_000,
};

const openAiDescriptor: ModelDescriptor = {
  id: "gpt-4.1-mini",
  provider: "openai",
  displayName: "GPT-4.1 mini",
  modalities: ["text", "image"],
  capabilities: {
    tools: true,
    reasoningSummary: false,
    cachedUsage: true,
    structuredOutput: true,
  },
  contextWindow: 1_000_000,
};

const openRouterDescriptor: ModelDescriptor = {
  ...openAiDescriptor,
  id: "openai/gpt-4.1-mini",
  provider: "openrouter",
  displayName: "GPT-4.1 mini via OpenRouter",
};

function compatibleSelection(input: {
  credential: ResolvedServiceKey;
  origin: string;
  baseUrl: string;
  provider: "openai" | "openrouter";
  descriptor: ModelDescriptor;
  userCapability:
    typeof OPENAI_ASSISTANT_MODEL | typeof OPENROUTER_ASSISTANT_MODEL;
  instanceCapability:
    | typeof OPENAI_INSTANCE_ASSISTANT_MODEL
    | typeof OPENROUTER_INSTANCE_ASSISTANT_MODEL;
}) {
  return {
    capability:
      input.credential.source === "user"
        ? input.userCapability
        : input.instanceCapability,
    descriptor: input.descriptor,
    gateway: new OpenAICompatibleGateway({
      baseUrl: input.baseUrl,
      providerName:
        input.credential.source === "user"
          ? `${input.provider}-byok`
          : `${input.provider}-instance`,
      credential: {
        origin: input.origin,
        headerName: "Authorization",
        value: `Bearer ${input.credential.key}`,
      },
      endpointPolicy: {
        placement: "hosted-core",
        allowedOrigins: [input.origin],
      },
      models: [input.descriptor],
      contextAssetResolver,
    }),
    contextMediaDelivery: "server-resolved" as const,
    modelRevision: `${input.descriptor.id}/2026-08-22`,
    providerRevision: `${input.provider}-openai-compatible/1`,
    modelPlacement:
      input.credential.source === "user"
        ? {
            kind: "direct-byok" as const,
            origin: input.origin,
            credentialOwner: "user" as const,
          }
        : {
            kind: "core" as const,
            instanceId: process.env.CORE_INSTANCE_ID?.trim() || "core-default",
          },
    providerSupportsStableRequestKey: false,
  };
}

class ProductionGatewayResolver implements AssistantGatewayResolver {
  async list(ownerId: string) {
    // The deterministic gateway is a local-development/test fixture. Never
    // advertise synthetic answers as a production model.
    const models: ModelCapability[] =
      env.NODE_ENV === "production" ? [] : [MOCK_ASSISTANT_MODEL];
    const [
      credential,
      openAiCredential,
      openRouterCredential,
      nodeModels,
      preference,
    ] = await Promise.all([
      resolveServiceKey(ownerId, "mistral"),
      resolveProviderServiceKey(ownerId, "inference", "openai"),
      resolveProviderServiceKey(ownerId, "inference", "openrouter"),
      pairedNodeModelSelections(ownerId),
      assistantModelPreferenceService.get(ownerId),
    ]);
    if (credential?.source === "user") {
      models.push(MISTRAL_ASSISTANT_MODEL);
    } else if (credential && usesManagedOperatorSpend(credential)) {
      const allowed = await managedModelRegistry.list(ownerId);
      if (allowed.some((policy) => policy.model === mistralDescriptor.id)) {
        models.push(MISTRAL_MANAGED_ASSISTANT_MODEL);
      }
    } else if (credential) {
      models.push(MISTRAL_INSTANCE_ASSISTANT_MODEL);
    }
    if (openAiCredential) {
      models.push(
        openAiCredential.source === "user"
          ? OPENAI_ASSISTANT_MODEL
          : OPENAI_INSTANCE_ASSISTANT_MODEL,
      );
    }
    if (openRouterCredential) {
      models.push(
        openRouterCredential.source === "user"
          ? OPENROUTER_ASSISTANT_MODEL
          : OPENROUTER_INSTANCE_ASSISTANT_MODEL,
      );
    }
    models.push(...nodeModels.map((selection) => selection.capability));
    const filtered =
      preference.route === "managed-only"
        ? models.filter((model) => model.placement === "managed")
        : models;
    if (preference.route === "prefer-node") {
      return filtered.toSorted(
        (left, right) =>
          Number(right.placement === "node") -
          Number(left.placement === "node"),
      );
    }
    if (preference.route === "prefer-core") {
      return filtered.toSorted(
        (left, right) =>
          Number(right.placement === "core") -
          Number(left.placement === "core"),
      );
    }
    return filtered;
  }

  async readiness(ownerId: string) {
    const available = await this.list(ownerId);
    const preference = await assistantModelPreferenceService.get(ownerId);
    const ready: ModelReadiness[] = await Promise.all(
      available.map(async (capability) => {
        const selection = await this.resolve(ownerId, capability.modelKey);
        return {
          capability,
          available: true as const,
          unavailableReason: null,
          modelRevision:
            selection.modelRevision ?? `${selection.descriptor.id}/adapter-1`,
          providerRevision:
            selection.providerRevision ?? `${capability.providerKey}/adapter-1`,
          placement: selection.modelPlacement!,
          routeKey: `${capability.providerKey}:${capability.modelKey}`,
          fallbackEligible: preference.fallback !== "none",
        };
      }),
    );
    const modelKeys = new Set(available.map((model) => model.modelKey));
    if (!modelKeys.has(MISTRAL_ASSISTANT_MODEL.modelKey)) {
      ready.push({
        capability: MISTRAL_ASSISTANT_MODEL,
        available: false,
        unavailableReason: "missing-key",
        modelRevision: "mistral-small-latest/2026-08-22",
        providerRevision: "mistral-openai-compatible/1",
        placement: {
          kind: "direct-byok",
          origin: "https://api.mistral.ai",
          credentialOwner: "user",
        },
        routeKey: `mistral-byok:${MISTRAL_ASSISTANT_MODEL.modelKey}`,
        fallbackEligible: false,
      });
    }
    if (!modelKeys.has(OPENAI_ASSISTANT_MODEL.modelKey)) {
      ready.push({
        capability: OPENAI_ASSISTANT_MODEL,
        available: false,
        unavailableReason: "missing-key",
        modelRevision: "gpt-4.1-mini/2026-08-22",
        providerRevision: "openai-openai-compatible/1",
        placement: {
          kind: "direct-byok",
          origin: "https://api.openai.com",
          credentialOwner: "user",
        },
        routeKey: `openai-byok:${OPENAI_ASSISTANT_MODEL.modelKey}`,
        fallbackEligible: false,
      });
    }
    if (!modelKeys.has(OPENROUTER_ASSISTANT_MODEL.modelKey)) {
      ready.push({
        capability: OPENROUTER_ASSISTANT_MODEL,
        available: false,
        unavailableReason: "missing-key",
        modelRevision: "openai/gpt-4.1-mini/2026-08-22",
        providerRevision: "openrouter-openai-compatible/1",
        placement: {
          kind: "direct-byok",
          origin: "https://openrouter.ai",
          credentialOwner: "user",
        },
        routeKey: `openrouter-byok:${OPENROUTER_ASSISTANT_MODEL.modelKey}`,
        fallbackEligible: false,
      });
    }
    if (!modelKeys.has(MISTRAL_MANAGED_ASSISTANT_MODEL.modelKey)) {
      ready.push({
        capability: MISTRAL_MANAGED_ASSISTANT_MODEL,
        available: false,
        unavailableReason: "managed-disabled",
        modelRevision: "mistral-small-latest/2026-08-22",
        providerRevision: "mistral-openai-compatible/1",
        placement: {
          kind: "managed",
          pool: "managed-mistral",
          region: env.MANAGED_REGION,
        },
        routeKey: `mistral-managed:${MISTRAL_MANAGED_ASSISTANT_MODEL.modelKey}`,
        fallbackEligible: false,
      });
    }
    return ready;
  }

  async resolveForNewRun(ownerId: string, requestedModelKey?: string) {
    const [preference, available] = await Promise.all([
      assistantModelPreferenceService.get(ownerId),
      this.list(ownerId),
    ]);
    const decision = decideAssistantModelPolicy({
      preference,
      ...(requestedModelKey ? { requestedModelKey } : {}),
      available,
    });
    const selection = await this.#resolveExact(
      ownerId,
      decision.selectedModelKey,
    );
    return { ...selection, runPolicy: decision.policy };
  }

  async resolve(ownerId: string, modelKey: string, runId?: string) {
    const policy = runId
      ? await loadAssistantRunModelPolicy(db.$client, { ownerId, runId })
      : null;
    if (policy && policy.selectedModelKey !== modelKey) {
      throw new Error("MODEL_POLICY_SELECTION_CHANGED");
    }
    const selection = await this.#resolveExact(ownerId, modelKey, !policy);
    const constrained = (candidate: AssistantGatewaySelection) => ({
      ...candidate,
      fallbackSelections: undefined,
      gateway: new PolicyConstrainedModelGateway(
        candidate.gateway,
        db.$client,
        candidate.capability.modelKey,
      ),
    });
    const primary = constrained(selection);
    if (!policy) return primary;

    const fallbackSelections: AssistantGatewaySelection[] = [];
    for (const fallbackModelKey of policy.orderedFallbackModelKeys) {
      let fallback: AssistantGatewaySelection;
      try {
        fallback = await this.#resolveExact(ownerId, fallbackModelKey, false);
      } catch {
        // Availability is evaluated at dispatch time. A missing frozen route is
        // skipped, but no route outside the immutable list is ever substituted.
        continue;
      }
      if (
        primary.capability.placement !== "managed" &&
        fallback.capability.placement === "managed"
      ) {
        // Defensive compatibility for policies frozen before managed isolation
        // was enforced: never turn an outage into implicit operator spend.
        continue;
      }
      fallbackSelections.push(constrained(fallback));
    }
    return {
      ...primary,
      fallbackSelections,
    };
  }

  async #resolveExact(
    ownerId: string,
    modelKey: string,
    enforceCurrentPreference = true,
  ): Promise<AssistantGatewaySelection> {
    const preference = enforceCurrentPreference
      ? await assistantModelPreferenceService.get(ownerId)
      : null;
    if (
      preference?.route === "managed-only" &&
      modelKey !== MISTRAL_MANAGED_ASSISTANT_MODEL.modelKey
    ) {
      throw new Error("The configured model policy requires managed placement");
    }
    const nodeSelection = (await pairedNodeModelSelections(ownerId)).find(
      (selection) => selection.capability.modelKey === modelKey,
    );
    if (nodeSelection) return nodeSelection;
    if (modelKey.startsWith("node:")) {
      throw new Error("The paired Node model is offline, stale, or removed");
    }
    if (modelKey === MOCK_ASSISTANT_MODEL.modelKey) {
      if (env.NODE_ENV === "production") {
        throw new Error(
          "The development fixture model is disabled in production",
        );
      }
      return {
        capability: MOCK_ASSISTANT_MODEL,
        descriptor: mockGateway.descriptor,
        gateway: mockGateway,
        modelRevision: "mock-readonly/1",
        providerRevision: "mock/1",
        modelPlacement: {
          kind: "core" as const,
          instanceId: process.env.CORE_INSTANCE_ID?.trim() || "core-default",
        },
        providerSupportsStableRequestKey: false,
      };
    }
    if (
      modelKey === OPENAI_ASSISTANT_MODEL.modelKey ||
      modelKey === OPENAI_INSTANCE_ASSISTANT_MODEL.modelKey
    ) {
      const credential = await resolveProviderServiceKey(
        ownerId,
        "inference",
        "openai",
      );
      if (!credential) {
        throw new Error("Add an OpenAI key before using this model");
      }
      return compatibleSelection({
        credential,
        origin: "https://api.openai.com",
        baseUrl: "https://api.openai.com/v1",
        provider: "openai",
        descriptor: openAiDescriptor,
        userCapability: OPENAI_ASSISTANT_MODEL,
        instanceCapability: OPENAI_INSTANCE_ASSISTANT_MODEL,
      });
    }
    if (
      modelKey === OPENROUTER_ASSISTANT_MODEL.modelKey ||
      modelKey === OPENROUTER_INSTANCE_ASSISTANT_MODEL.modelKey
    ) {
      const credential = await resolveProviderServiceKey(
        ownerId,
        "inference",
        "openrouter",
      );
      if (!credential) {
        throw new Error("Add an OpenRouter key before using this model");
      }
      return compatibleSelection({
        credential,
        origin: "https://openrouter.ai",
        baseUrl: "https://openrouter.ai/api/v1",
        provider: "openrouter",
        descriptor: openRouterDescriptor,
        userCapability: OPENROUTER_ASSISTANT_MODEL,
        instanceCapability: OPENROUTER_INSTANCE_ASSISTANT_MODEL,
      });
    }
    const managed = modelKey === MISTRAL_MANAGED_ASSISTANT_MODEL.modelKey;
    if (
      !managed &&
      modelKey !== MISTRAL_ASSISTANT_MODEL.modelKey &&
      modelKey !== MISTRAL_INSTANCE_ASSISTANT_MODEL.modelKey
    ) {
      throw new Error("The requested model is not configured for this account");
    }
    const credential = await resolveServiceKey(ownerId, "mistral");
    if (!credential) {
      throw new Error("Add a Mistral key in Settings before using this model");
    }
    const origin = "https://api.mistral.ai";
    const directGateway = new OpenAICompatibleGateway({
      baseUrl: `${origin}/v1`,
      providerName:
        credential.source === "user" ? "mistral-byok" : "mistral-instance",
      credential: {
        origin,
        headerName: "Authorization",
        value: `Bearer ${credential.key}`,
      },
      endpointPolicy: {
        placement: "hosted-core",
        allowedOrigins: [origin],
      },
      models: [mistralDescriptor],
      contextAssetResolver,
    });
    if (managed) {
      if (!usesManagedOperatorSpend(credential)) {
        throw new Error("Managed model placement is unavailable");
      }
      await managedModelRegistry.require(ownerId, mistralDescriptor.id);
      return {
        capability: MISTRAL_MANAGED_ASSISTANT_MODEL,
        descriptor: mistralDescriptor,
        gateway: new MeteredModelGateway(
          directGateway,
          managedModelRegistry,
          managedUsage(),
          `managed-model-${env.MANAGED_REGION}`,
          () => new Date(),
          (capability, provider, maximumQuantity, unit) =>
            managedCostControls.assertAllowed({
              accountId: ownerId,
              capability,
              provider,
              maximumQuantity,
              unit,
            }),
        ),
        contextMediaDelivery: "server-resolved" as const,
        modelRevision: "mistral-small-latest/2026-08-22",
        providerRevision: "mistral-openai-compatible/1",
        modelPlacement: {
          kind: "managed" as const,
          pool: "managed-mistral",
          region: env.MANAGED_REGION,
        },
        providerSupportsStableRequestKey: false,
      };
    }
    return {
      capability:
        credential.source === "user"
          ? MISTRAL_ASSISTANT_MODEL
          : MISTRAL_INSTANCE_ASSISTANT_MODEL,
      descriptor: mistralDescriptor,
      gateway: directGateway,
      contextMediaDelivery: "server-resolved" as const,
      modelRevision: "mistral-small-latest/2026-08-22",
      providerRevision: "mistral-openai-compatible/1",
      modelPlacement:
        credential.source === "user"
          ? {
              kind: "direct-byok" as const,
              origin,
              credentialOwner: "user" as const,
            }
          : {
              kind: "core" as const,
              instanceId:
                process.env.CORE_INSTANCE_ID?.trim() || "core-default",
            },
      providerSupportsStableRequestKey: false,
    };
  }
}

function uncallableApi(): Api {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(
          "Tool execution requires the authenticated broker adapter; catalogue access does not execute tools",
        );
      },
    },
  ) as Api;
}

export function createReadOnlyAssistantRegistry() {
  const registry = new ToolRegistry();
  for (const descriptor of firstPartyToolDescriptors(uncallableApi())) {
    if (descriptor.effect !== "read") continue;
    registry.register(descriptor as unknown as AnyAvermateToolDescriptor);
  }
  return registry;
}

export const coreConversationStore = new RoutedConversationStore(
  db.$client,
  {
    async selectedNode(ownerId) {
      const placement = (
        await coreNodeRegistry.currentPlacements(ownerId)
      ).find((candidate) => candidate.capability === "conversations");
      return placement?.placementKind === "node" &&
        placement.nodeId &&
        nodePlacementMigrationReady("conversations", placement.migrationState)
        ? placement.nodeId
        : null;
    },
    async assertOnline(ownerId, nodeId) {
      const state = coreNodeRelay.inspect(nodeId);
      if (!state || state.userId !== ownerId || !state.features.conversations) {
        throw new Error("NODE_CONVERSATION_CAPABILITY_OFFLINE");
      }
    },
    import: (input) => relayNodeProviderTransport.importConversationDag(input),
    list: (input) => relayNodeProviderTransport.listConversationDags(input),
    get: (input) => relayNodeProviderTransport.getConversationDag(input),
    delete: (input) => relayNodeProviderTransport.deleteConversationDag(input),
  },
  env.NODE_CREDENTIAL_MASTER_SECRET ?? env.BETTER_AUTH_SECRET,
  async ({ ownerId, threadId, selector, projectItemId }) => {
    await enqueueJob({
      kind: CORPUS_INDEX_SOURCE_JOB_KIND,
      payload: {
        ownerId,
        originKind: "conversation",
        originId: threadId,
        ...(selector ? { selector } : {}),
        ...(projectItemId ? { projectItemId } : {}),
      },
      userId: ownerId,
      idempotencyKey: `conversation:${threadId}:${selector?.conversationHeadMessageId ?? "head"}:${projectItemId ?? "current"}`,
      newAttemptAfterTerminal: true,
      maxAttempts: 3,
    });
  },
);
registerNodeConversationReconciler((nodeId) =>
  coreConversationStore.reconcileNode(nodeId),
);
registerPlacementMigrationAdapter("conversations", (input) =>
  coreConversationStore.migratePlacement(input),
);
export const coreConversationCheckpointStore =
  new CoreConversationCheckpointStore(
    db.$client,
    new ManagedCheckpointBlobStore(),
  );
export const assistantModelPreferenceService =
  new AssistantModelPreferenceService(db.$client);

let localHistoricalBranchSandboxRuntime: HistoricalBranchSandboxRuntime | null =
  null;

function localHistoricalBranchRuntime(): HistoricalBranchSandboxRuntime {
  if (localHistoricalBranchSandboxRuntime) {
    return localHistoricalBranchSandboxRuntime;
  }
  const configured = createSandboxProviderFromEnvironment({
    allowMock: env.NODE_ENV === "test",
  });
  const configuredMaxAge = Number(process.env.SANDBOX_EVIDENCE_MAX_AGE_MS);
  localHistoricalBranchSandboxRuntime = Object.freeze({
    provider: configured.provider,
    profiles: configured.profiles,
    hostPolicyDigest: configured.hostPolicyDigest,
    maxEvidenceAgeMs:
      Number.isInteger(configuredMaxAge) &&
      configuredMaxAge > 0 &&
      configuredMaxAge <= 60 * 60_000
        ? configuredMaxAge
        : 5 * 60_000,
  });
  return localHistoricalBranchSandboxRuntime;
}

async function resolveHistoricalBranchSandboxRuntime(
  snapshot: Parameters<
    NonNullable<HistoricalBranchSandboxRuntime["restoreWorkspace"]>
  >[0]["snapshot"],
): Promise<HistoricalBranchSandboxRuntime> {
  const source = snapshot.workspaceSnapshotRef;
  if (!source) return localHistoricalBranchRuntime();
  const provider = await selectedPairedNodeSandboxProvider({
    ownerId: snapshot.ownerId,
    providerId: source.provider,
  });
  if (!provider) return localHistoricalBranchRuntime();

  const advertised = await provider.capabilities();
  const advertisedProfile = advertised.profiles.find(
    (candidate) =>
      candidate.id === snapshot.executionProfileId &&
      candidate.version === snapshot.executionProfileVersion &&
      candidate.evidence.imageDigest === snapshot.imageTemplateRef.imageDigest,
  );
  const local = localHistoricalBranchRuntime().profiles.find(
    (candidate) =>
      candidate.enabled &&
      candidate.id === snapshot.executionProfileId &&
      candidate.version === snapshot.executionProfileVersion &&
      candidate.image.imageDigest === snapshot.imageTemplateRef.imageDigest,
  );
  const profile =
    local ??
    enableSandboxProfile(snapshot.executionProfileId, {
      version: snapshot.executionProfileVersion,
      imageDigest: snapshot.imageTemplateRef.imageDigest,
    });
  if (!advertised.available || !advertisedProfile) {
    return {
      provider,
      profiles: [],
      hostPolicyDigest: null,
      maxEvidenceAgeMs: 5 * 60_000,
    };
  }

  const stored = await coreNodeRuntimeCheckpoints.loadForWorkspaceOwned({
    workspaceSnapshotId: snapshot.id,
    ownerId: snapshot.ownerId,
    nodeId: provider.nodeId,
  });
  const runtimeCapabilities = await provider.runtimeCheckpointCapabilities();
  const expectedCompatibility =
    stored?.checkpoint.compatibility ??
    (runtimeCapabilities.available
      ? {
          provider: runtimeCapabilities.provider,
          region: runtimeCapabilities.regions[0]!,
          architecture: runtimeCapabilities.architectures[0]!,
          runtimeKind: runtimeCapabilities.runtimeKind,
          runtimeVersion: runtimeCapabilities.runtimeVersion,
          imageDigest: snapshot.imageTemplateRef.imageDigest,
          profileId: snapshot.executionProfileId,
          profileVersion: snapshot.executionProfileVersion,
        }
      : null);

  return {
    provider,
    profiles: [profile],
    hostPolicyDigest: advertisedProfile.evidence.hostPolicyDigest,
    maxEvidenceAgeMs: 5 * 60_000,
    ...(expectedCompatibility
      ? {
          restoreWorkspace: async ({ create }) => {
            const now = new Date();
            const maximumTtlSeconds = runtimeCapabilities.available
              ? runtimeCapabilities.maximumTtlSeconds
              : 24 * 60 * 60;
            const restored =
              await pairedNodeRuntimeCheckpointLifecycle.restoreOrFallback({
                ownerId: snapshot.ownerId,
                workspaceSnapshotId: snapshot.id,
                provider,
                create,
                logicalWorkspaceSnapshot: source,
                expectedCompatibility,
                capture: {
                  checkpointId: pairedNodeRuntimeCheckpointId({
                    ownerId: snapshot.ownerId,
                    nodeId: provider.nodeId,
                    workspaceSnapshotId: snapshot.id,
                  }),
                  expiresAt: new Date(
                    now.getTime() +
                      Math.min(maximumTtlSeconds, 7 * 24 * 60 * 60) * 1_000,
                  ),
                },
              });
            return {
              handle: restored.handle,
              path: restored.path,
              ...(restored.path === "logical-workspace"
                ? { reason: restored.reason }
                : {}),
            };
          },
        }
      : {}),
  };
}

export const coreHistoricalBranchService = new HistoricalBranchService(
  new CoreHistoricalBranchRepository(db.$client),
  resolveHistoricalBranchSandboxRuntime,
);
export const assistantRunService = createProductionAgentRuntime({
  client: db.$client,
  conversations: coreConversationStore,
  gateways: new ProductionGatewayResolver(),
  registryFactory: () => createReadOnlyAssistantRegistry(),
  sourceIndexer: coreCorpusIndexService,
  checkpoints: coreConversationCheckpointStore,
  lexical: routedCorpusStore,
  contextAssetHandles,
});
