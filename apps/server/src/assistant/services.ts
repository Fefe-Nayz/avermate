import type {
  AnyAvermateToolDescriptor,
  ModelDescriptor,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { OpenAICompatibleGateway } from "../agent/model-gateways";
import { CORPUS_INDEX_SOURCE_JOB_KIND } from "../jobs/corpus";
import { resolveServiceKey } from "../lib/service-keys";
import { env } from "../lib/env";
import { enqueueJob } from "../lib/jobs";
import type { Api } from "../mcp/shared";
import { createSandboxProviderFromEnvironment } from "../sandbox/provider-factory";
import { coreCorpusIndexService } from "../search/index-service";
import { firstPartyToolDescriptors } from "../tools/first-party";
import { ToolRegistry } from "../tools/registry";
import {
  MISTRAL_ASSISTANT_MODEL,
  MISTRAL_INSTANCE_ASSISTANT_MODEL,
  MISTRAL_MANAGED_ASSISTANT_MODEL,
  MOCK_ASSISTANT_MODEL,
} from "./catalogue";
import { CoreConversationStore } from "./core-conversation-store";
import {
  MockReadOnlyModelGateway,
  ReadOnlyAssistantRunService,
  type AssistantGatewayResolver,
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

const mockGateway = new MockReadOnlyModelGateway();
const managedModelRegistry = new ManagedModelPolicyRegistry(
  db.$client,
  env.MANAGED_REGION,
);
const managedCostControls = new ManagedCostControls(db.$client);

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

class ProductionGatewayResolver implements AssistantGatewayResolver {
  async list(ownerId: string) {
    const models = [MOCK_ASSISTANT_MODEL];
    const credential = await resolveServiceKey(ownerId, "mistral");
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
    return models;
  }

  async resolve(ownerId: string, modelKey: string) {
    if (modelKey === MOCK_ASSISTANT_MODEL.modelKey) {
      return {
        capability: MOCK_ASSISTANT_MODEL,
        descriptor: mockGateway.descriptor,
        gateway: mockGateway,
      };
    }
    const managed = modelKey === MISTRAL_MANAGED_ASSISTANT_MODEL.modelKey;
    if (!managed && modelKey !== MISTRAL_ASSISTANT_MODEL.modelKey) {
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
          (capability, provider) =>
            managedCostControls.assertAllowed({
              accountId: ownerId,
              capability,
              provider,
            }),
        ),
      };
    }
    return {
      capability:
        credential.source === "user"
          ? MISTRAL_ASSISTANT_MODEL
          : MISTRAL_INSTANCE_ASSISTANT_MODEL,
      descriptor: mistralDescriptor,
      gateway: directGateway,
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

export const coreConversationStore = new CoreConversationStore(
  db.$client,
  async ({ ownerId, threadId }) => {
    await enqueueJob({
      kind: CORPUS_INDEX_SOURCE_JOB_KIND,
      payload: {
        ownerId,
        originKind: "conversation",
        originId: threadId,
      },
      userId: ownerId,
      idempotencyKey: `conversation:${threadId}`,
      newAttemptAfterTerminal: true,
      maxAttempts: 3,
    });
  },
);
export const coreConversationCheckpointStore =
  new CoreConversationCheckpointStore(
    db.$client,
    new ManagedCheckpointBlobStore(),
  );

let historicalBranchSandboxRuntime: HistoricalBranchSandboxRuntime | null =
  null;

function resolveHistoricalBranchSandboxRuntime(): HistoricalBranchSandboxRuntime {
  if (historicalBranchSandboxRuntime) return historicalBranchSandboxRuntime;
  const configured = createSandboxProviderFromEnvironment({
    allowMock: env.NODE_ENV === "test",
  });
  const configuredMaxAge = Number(process.env.SANDBOX_EVIDENCE_MAX_AGE_MS);
  historicalBranchSandboxRuntime = Object.freeze({
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
  return historicalBranchSandboxRuntime;
}

export const coreHistoricalBranchService = new HistoricalBranchService(
  new CoreHistoricalBranchRepository(db.$client),
  resolveHistoricalBranchSandboxRuntime,
);
export const assistantRunService = new ReadOnlyAssistantRunService(
  db.$client,
  coreConversationStore,
  new ProductionGatewayResolver(),
  () => createReadOnlyAssistantRegistry(),
  coreCorpusIndexService,
  coreConversationCheckpointStore,
);
