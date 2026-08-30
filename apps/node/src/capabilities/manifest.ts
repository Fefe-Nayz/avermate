import {
  capabilityOfferingPublicDescriptorSchema,
  nodeCapabilityInferenceFeaturesSchema,
  nodeCapabilityOfferingSchema,
  type CapabilityOfferingPublicDescriptor,
  type NodeCapabilityInferenceFeatures,
  type NodeCapabilityOffering,
  type NodeJobExecutionProfile,
} from "@avermate/agent-contracts";
import { isIP } from "node:net";
import { canonicalDigest } from "../canonical-json";
import {
  LOCAL_OCR_MODEL_PROVIDER,
  LOCAL_TRANSCRIPTION_MODEL_PROVIDER,
  localDocumentAiModelAttestation,
  type NodeConfig,
  type NodeCapabilitySidecarConfig,
} from "../config";
import type { NodeCapabilityRegistry } from "./registry";

type OfferingDescriptorWithoutId = Omit<
  CapabilityOfferingPublicDescriptor,
  "id"
>;

function normalizedProvider(value: string) {
  const provider = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return provider || "node-local";
}

function privateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  const version = isIP(host);
  if (version === 4) {
    const [first = 0, second = 0] = host.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  return version === 6 && /^(?:fc|fd|fe8|fe9|fea|feb)/u.test(host);
}

function handling(endpoint: string | null, provider: string) {
  if (endpoint === null) {
    return {
      egress: "none" as const,
      providerName: null,
      region: null,
      disclosureRevision: "node-local-v1",
      retentionDisclosureRevision: null,
      trainingDisclosureRevision: null,
      requiresExplicitConsent: false,
    };
  }
  const local = privateHost(new URL(endpoint).hostname);
  return {
    egress: local ? ("owner-node" as const) : ("external-provider" as const),
    providerName: local ? null : provider,
    region: null,
    disclosureRevision: local ? "node-local-v1" : "node-external-provider-v1",
    retentionDisclosureRevision: null,
    trainingDisclosureRevision: null,
    requiresExplicitConsent: !local,
  };
}

function connectionId(nodeId: string, source: string) {
  return `nodeconn_${canonicalDigest({ nodeId, source }).slice(7, 39)}`;
}

function offeringId(input: {
  descriptor: OfferingDescriptorWithoutId;
  runtime: NodeCapabilityOffering["runtime"];
  egressPolicyDigest: string;
}) {
  return `capoff_${canonicalDigest(input).slice(7)}`;
}

export function createNodeCapabilityOffering(input: {
  descriptor: OfferingDescriptorWithoutId;
  runtime: NodeCapabilityOffering["runtime"];
  egressPolicyDigest: string;
}) {
  const descriptor = capabilityOfferingPublicDescriptorSchema.parse({
    ...input.descriptor,
    id: offeringId(input),
  });
  return nodeCapabilityOfferingSchema.parse({
    descriptor,
    descriptorDigest: canonicalDigest(descriptor),
    runtime: input.runtime,
    network: { egressPolicyDigest: input.egressPolicyDigest },
  });
}

export function configuredNodeCapabilitySidecarOffering(input: {
  nodeId: string;
  configRevision: string;
  sidecar: NodeCapabilitySidecarConfig;
}) {
  return createNodeCapabilityOffering({
    descriptor: {
      ...input.sidecar.descriptor,
      connectionId: connectionId(input.nodeId, `sidecar:${input.sidecar.id}`),
      placement: {
        kind: "node",
        nodeId: input.nodeId,
        configRevision: input.configRevision,
      },
    } as OfferingDescriptorWithoutId,
    runtime: {
      implementation: `node-sidecar:${input.sidecar.id}`,
      runtimeRevision: input.sidecar.runtimeRevision,
      imageDigest: input.sidecar.imageDigest,
      modelRevision: input.sidecar.descriptor.modelRevision,
    },
    egressPolicyDigest: input.sidecar.egressPolicyDigest,
  });
}

function baseDescriptor(input: {
  nodeId: string;
  configRevision: string;
  connectionSource: string;
  provider: string;
  modelId: string;
  modelRevision: string;
  endpoint: string | null;
  maxInputBytes: number | null;
  maxOutputBytes: number | null;
  maxBatchSize: number | null;
  maxConcurrency: number | null;
}) {
  const provider = normalizedProvider(input.provider);
  return {
    schemaVersion: 1 as const,
    connectionId: connectionId(input.nodeId, input.connectionSource),
    connectionRevision: 1,
    pluginId: "avermate.node.legacy-bridge",
    pluginVersion: "1",
    adapterRevision: "node-capability-v1",
    capabilityProtocolVersion: 1 as const,
    provider,
    modelId: input.modelId,
    modelRevision: input.modelRevision,
    placement: {
      kind: "node" as const,
      nodeId: input.nodeId,
      configRevision: input.configRevision,
    },
    dataHandling: handling(input.endpoint, provider),
    limits: {
      maxInputBytes: input.maxInputBytes,
      maxOutputBytes: input.maxOutputBytes,
      maxBatchSize: input.maxBatchSize,
      maxConcurrency: input.maxConcurrency,
    },
    supportedLanguages: "unknown" as const,
    healthCheckKind: "node-attested" as const,
  };
}

export type LegacyNodeCapabilityBridge = {
  offering: NodeCapabilityOffering;
  source:
    | { kind: "model"; modelId: string }
    | { kind: "embedding" }
    | { kind: "rerank" }
    | { kind: "worker"; workerKind: "artifact.local-ocr" | "artifact.local-transcription" };
};

export function bridgeLegacyNodeCapabilityOfferings(input: {
  nodeId: string;
  configRevision: string;
  config: NodeConfig;
  healthyWorkerProfiles?: ReadonlyMap<string, NodeJobExecutionProfile>;
}) {
  const output: LegacyNodeCapabilityBridge[] = [];
  const maximumConcurrent = Math.max(1, input.config.jobs.maximumConcurrent);
  if (input.config.models.enabled && input.config.models.endpoint) {
    for (const model of input.config.models.catalogue) {
      const revision = input.config.models.modelRevisions[model.id];
      if (!revision || !model.modalities.includes("text")) continue;
      const base = baseDescriptor({
        nodeId: input.nodeId,
        configRevision: input.configRevision,
        connectionSource: `models:${input.config.models.gateway}`,
        provider: model.provider,
        modelId: model.id,
        modelRevision: revision,
        endpoint: input.config.models.endpoint,
        maxInputBytes: 16 * 1024 * 1024,
        maxOutputBytes: 16 * 1024 * 1024,
        maxBatchSize: 1,
        maxConcurrency: maximumConcurrent,
      });
      output.push({
        offering: createNodeCapabilityOffering({
          descriptor: {
            ...base,
            capability: "language.generate",
            specification: {
              // The legacy gateway bridge currently serializes ContextBlock
              // text only; do not over-advertise model media support.
              inputModalities: ["text"],
              contextWindow: model.contextWindow,
              maximumOutputTokens: "unknown",
              tools: false,
              parallelTools: false,
              structuredOutput: false,
              streaming: true,
              reasoningSummary: model.capabilities.reasoningSummary,
              opaqueReasoningContinuation: false,
              cachedUsage: model.capabilities.cachedUsage,
            },
          },
          runtime: {
            implementation: `legacy-model-gateway:${input.config.models.gateway}`,
            runtimeRevision: "node-model-gateway-v1",
            imageDigest: null,
            modelRevision: revision,
          },
          egressPolicyDigest: canonicalDigest({
            kind: "legacy-model-gateway",
            gateway: input.config.models.gateway,
            origin: new URL(input.config.models.endpoint).origin,
          }),
        }),
        source: { kind: "model", modelId: model.id },
      });
    }
  }

  if (
    input.config.retrieval.embeddingEndpoint &&
    input.config.retrieval.embeddingProvider &&
    input.config.retrieval.embeddingModel &&
    input.config.retrieval.embeddingRevision
  ) {
    for (const dimensions of input.config.retrieval.embeddingDimensions) {
      const provider = input.config.retrieval.embeddingProvider;
      const modelRevision = input.config.retrieval.embeddingRevision;
      const identity = {
        provider,
        model: input.config.retrieval.embeddingModel,
        modelRevision,
        dimensions,
        normalization: "none",
        preprocessingRevision: "node-retrieval-v1",
        modalities: ["text"],
      };
      const base = baseDescriptor({
        nodeId: input.nodeId,
        configRevision: input.configRevision,
        connectionSource: "retrieval:embedding",
        provider,
        modelId: input.config.retrieval.embeddingModel,
        modelRevision,
        endpoint: input.config.retrieval.embeddingEndpoint,
        maxInputBytes: 128 * 1024,
        maxOutputBytes: 128 * 1024,
        maxBatchSize: 256,
        maxConcurrency: maximumConcurrent,
      });
      output.push({
        offering: createNodeCapabilityOffering({
          descriptor: {
            ...base,
            capability: "embedding.generate",
            specification: {
              modalities: ["text"],
              dimensions,
              normalization: "none",
              maximumInputs: 256,
              maximumTokensPerInput: 2_000_000,
              preprocessingRevision: "node-retrieval-v1",
              embeddingSpaceId: `emb_${canonicalDigest(identity).slice(7)}`,
            },
          },
          runtime: {
            implementation: `legacy-retrieval:${provider}`,
            runtimeRevision: "node-provider-fetch-v1",
            imageDigest: null,
            modelRevision,
          },
          egressPolicyDigest: canonicalDigest({
            kind: "retrieval-embedding",
            origin: new URL(input.config.retrieval.embeddingEndpoint).origin,
            provider,
            modelRevision,
          }),
        }),
        source: { kind: "embedding" },
      });
    }
  }

  if (
    input.config.retrieval.rerankEndpoint &&
    input.config.retrieval.rerankProvider &&
    input.config.retrieval.rerankModel &&
    input.config.retrieval.rerankRevision &&
    input.config.retrieval.rerankImageDigest &&
    input.config.retrieval.rerankRuntimeRevision
  ) {
    const provider = input.config.retrieval.rerankProvider;
    const modelRevision = input.config.retrieval.rerankRevision;
    const base = baseDescriptor({
      nodeId: input.nodeId,
      configRevision: input.configRevision,
      connectionSource: "retrieval:rerank",
      provider,
      modelId: input.config.retrieval.rerankModel,
      modelRevision,
      endpoint: input.config.retrieval.rerankEndpoint,
      maxInputBytes: 128 * 1024,
      maxOutputBytes: 128 * 1024,
      maxBatchSize: 1_024,
      maxConcurrency: maximumConcurrent,
    });
    output.push({
      offering: createNodeCapabilityOffering({
        descriptor: {
          ...base,
          capability: "rerank.score",
          specification: {
            modalities: ["text"],
            maxCandidates: 1_024,
            maxTokensPerCandidate: 2_000_000,
            languages: "unknown",
            scoreSemantics: "provider-specific",
          },
        },
        runtime: {
          implementation: `legacy-retrieval:${provider}`,
          runtimeRevision: input.config.retrieval.rerankRuntimeRevision,
          imageDigest: input.config.retrieval.rerankImageDigest,
          modelRevision,
        },
        egressPolicyDigest: canonicalDigest({
          kind: "retrieval-rerank",
          origin: new URL(input.config.retrieval.rerankEndpoint).origin,
          provider,
          runtimeRevision: input.config.retrieval.rerankRuntimeRevision,
        }),
      }),
      source: { kind: "rerank" },
    });
  }

  for (const worker of [
    {
      kind: "artifact.local-ocr" as const,
      attestation: localDocumentAiModelAttestation(input.config.models, "ocr"),
      provider: LOCAL_OCR_MODEL_PROVIDER,
    },
    {
      kind: "artifact.local-transcription" as const,
      attestation: localDocumentAiModelAttestation(
        input.config.models,
        "transcription",
      ),
      provider: LOCAL_TRANSCRIPTION_MODEL_PROVIDER,
    },
  ]) {
    const profile = input.healthyWorkerProfiles?.get(`${worker.kind}@1`);
    if (!worker.attestation || !profile) continue;
    const base = baseDescriptor({
      nodeId: input.nodeId,
      configRevision: input.configRevision,
      connectionSource: `worker:${worker.kind}`,
      provider: worker.provider,
      modelId: worker.attestation.model.id,
      modelRevision: worker.attestation.revision,
      endpoint: null,
      maxInputBytes: 512 * 1024 * 1024,
      maxOutputBytes: 128 * 1024 * 1024,
      maxBatchSize: 1,
      maxConcurrency: maximumConcurrent,
    });
    const descriptor: OfferingDescriptorWithoutId =
      worker.kind === "artifact.local-ocr"
        ? {
            ...base,
            capability: "document.ocr",
            specification: {
              inputMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
              nativePdf: false,
              scannedPdf: true,
              images: true,
              handwriting: false,
              layout: true,
              tables: false,
              formulas: false,
              embeddedImages: false,
              boundingBoxes: "none",
              confidence: false,
              maxPages: 10_000,
              maxBytes: 512 * 1024 * 1024,
            },
          }
        : {
            ...base,
            capability: "speech.transcribe",
            specification: {
              modes: ["batch"],
              timestamps: ["none", "segment"],
              diarization: false,
              languageDetection: true,
              languageHint: true,
              vocabularyHints: false,
              inputMimeTypes: [
                "audio/mpeg",
                "audio/mp4",
                "audio/wav",
                "audio/x-wav",
                "video/mp4",
              ],
              maxBytes: 512 * 1024 * 1024,
              maxDurationSeconds: 24 * 60 * 60,
              maximumSpeakers: null,
            },
          };
    output.push({
      offering: createNodeCapabilityOffering({
        descriptor,
        runtime: {
          implementation: worker.kind,
          runtimeRevision: profile.profileVersion,
          imageDigest: profile.imageDigest,
          modelRevision: worker.attestation.revision,
        },
        egressPolicyDigest: profile.egressPolicyDigest,
      }),
      source: { kind: "worker", workerKind: worker.kind },
    });
  }
  return output.sort((left, right) =>
    left.offering.descriptor.id.localeCompare(right.offering.descriptor.id),
  );
}

export function nodeCapabilityProtocolV1Enabled(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return environment.NODE_CAPABILITY_PROTOCOL_V1?.trim().toLowerCase() === "true";
}

export function inferenceManifestFeature(input: {
  registry: NodeCapabilityRegistry;
  maxConcurrent: number;
}): NodeCapabilityInferenceFeatures | null {
  const offerings = input.registry.listOfferings();
  const invocationModes = input.registry.invocationModes();
  if (offerings.length === 0 || invocationModes.length === 0) return null;
  return nodeCapabilityInferenceFeaturesSchema.parse({
    version: 1,
    offerings,
    invocationModes,
    maxConcurrent: Math.max(1, input.maxConcurrent),
    secretCustody: "node-local",
  });
}
