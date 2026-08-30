import type {
  CapabilityOfferingSnapshot,
  ModelCapability,
  ModelDescriptor,
  ModelGateway,
  ModelPlacement,
} from "@avermate/agent-contracts";
import { CapabilityBackedModelGateway } from "../capabilities/adapters/language-generation";
import {
  capabilityRegistryInvoker,
  type CapabilityRegistryInvoker,
} from "../capabilities/registry-invoker";
import type { AssistantGatewaySelection } from "./run-service";
import { capabilityDigest } from "../capabilities/values";

type GatewayDependencies = ConstructorParameters<
  typeof CapabilityBackedModelGateway
>[2];
type CatalogueInvoker = Pick<
  CapabilityRegistryInvoker,
  "listConfiguredOfferings" | "resolve" | "streamLanguage"
>;

/** The model key binds an exact owner connection/configuration/model revision. */
export function registryAssistantModelKey(offeringId: string) {
  return `capability:${offeringId}`;
}

function placementFor(
  offering: CapabilityOfferingSnapshot<"language.generate">,
): ModelPlacement {
  const placement = offering.placement;
  switch (placement.kind) {
    case "node":
      return {
        kind: "node",
        nodeId: placement.nodeId,
        capabilityRevision: placement.configRevision,
      };
    case "direct-byok":
      return { ...placement, credentialOwner: "user" };
    case "full-self-host":
      return { kind: "core", instanceId: placement.instanceId };
    default:
      return placement;
  }
}

export function registryAssistantSelection(
  offering: CapabilityOfferingSnapshot<"language.generate">,
  dependencies: GatewayDependencies = {},
  invoker: CatalogueInvoker = capabilityRegistryInvoker,
  runtime?: ConstructorParameters<typeof CapabilityBackedModelGateway>[3],
): AssistantGatewaySelection {
  const specification = offering.specification;
  const modalities: ModelDescriptor["modalities"] = [
    ...(specification.inputModalities.includes("text")
      ? ["text" as const]
      : []),
    ...(specification.inputModalities.includes("image")
      ? ["image" as const]
      : []),
    ...(specification.inputModalities.includes("pdf") ? ["file" as const] : []),
    ...(specification.inputModalities.includes("audio")
      ? ["audio" as const]
      : []),
  ];
  const descriptor: ModelDescriptor = {
    id: offering.modelId,
    provider: offering.provider,
    displayName: offering.modelId,
    modalities,
    capabilities: {
      tools: specification.tools,
      reasoningSummary: specification.reasoningSummary,
      cachedUsage: specification.cachedUsage,
      structuredOutput: specification.structuredOutput,
    },
    contextWindow: specification.contextWindow,
  };
  const placement = placementFor(offering);
  const capability: ModelCapability = {
    modelKey: registryAssistantModelKey(offering.id),
    providerKey: offering.provider,
    label:
      `${offering.modelId} — ${offering.dataHandling.providerName ?? offering.provider}`.slice(
        0,
        256,
      ),
    placement: placement.kind,
    modalities: modalities.filter(
      (modality): modality is "text" | "image" | "audio" | "file" =>
        modality !== "video" && modality !== "embedding",
    ),
    supportsTools: specification.tools,
    supportsReasoningSummary: specification.reasoningSummary,
    contextTokens:
      specification.contextWindow === "unknown"
        ? null
        : specification.contextWindow,
    maxOutputTokens:
      specification.maximumOutputTokens === "unknown"
        ? null
        : specification.maximumOutputTokens,
    estimatedInputPrice: null,
    estimatedOutputPrice: null,
    currency: null,
    contentLeavesPlacement:
      offering.dataHandling.egress === "external-provider",
    privacyUrl: null,
  };
  const unavailable = async (): Promise<never> => {
    throw new Error("CAPABILITY_REGISTRY_LEGACY_PATH_UNAVAILABLE");
  };
  const delegate: ModelGateway = {
    async listModels() {
      return [descriptor];
    },
    async *stream() {
      await unavailable();
    },
    embed: unavailable,
    transcribe: unavailable,
    async estimate() {
      return {
        usage: {
          inputTokens: "unknown",
          outputTokens: "unknown",
          reasoningTokens: "unknown",
          cachedReadTokens: "unknown",
          cachedWriteTokens: "unknown",
        },
        estimatedCostMinor: "unknown",
        currency: "unknown",
      };
    },
  };
  return {
    capability,
    descriptor,
    modelRevision: offering.modelRevision,
    providerRevision: capabilityDigest({
      pluginId: offering.pluginId,
      pluginVersion: offering.pluginVersion,
      adapterRevision: offering.adapterRevision,
    }),
    modelPlacement: placement,
    providerSupportsStableRequestKey: false,
    contextMediaDelivery: "server-resolved",
    gateway: new CapabilityBackedModelGateway(
      delegate,
      () => ({
        offeringId: offering.id,
        provider: offering.provider,
        modelId: offering.modelId,
        modelRevision: offering.modelRevision,
        ...(specification.maximumOutputTokens === "unknown"
          ? {}
          : { maximumOutputTokens: specification.maximumOutputTokens }),
        inputModalities: specification.inputModalities.filter(
          (modality): modality is "text" | "image" | "pdf" =>
            modality === "text" || modality === "image" || modality === "pdf",
        ),
      }),
      dependencies,
      runtime,
      invoker,
    ),
  };
}

export async function registryAssistantSelections(
  ownerId: string,
  dependencies: GatewayDependencies = {},
  invoker: CatalogueInvoker = capabilityRegistryInvoker,
) {
  const offerings = await invoker.listConfiguredOfferings({
    ownerId,
    capability: "language.generate",
    purpose: "assistant.chat",
  });
  return offerings.flatMap((offering) =>
    offering.capability === "language.generate" &&
    offering.specification.streaming &&
    offering.specification.inputModalities.includes("text")
      ? [registryAssistantSelection(offering, dependencies, invoker)]
      : [],
  );
}
