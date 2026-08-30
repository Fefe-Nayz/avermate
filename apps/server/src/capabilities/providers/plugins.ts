import type {
  CapabilityAdapter,
  CapabilityKind,
  CapabilityOffering,
  CapabilityOfferingSnapshot,
  ProviderConnectionPublicSnapshot,
  ProviderConnectionValidationResult,
  ProviderPlugin,
  ProviderPluginManifest,
} from "@avermate/agent-contracts";
import { SpeechSynthesisCapabilityAdapter } from "../adapters/speech";
import { TranscriptionCapabilityAdapter } from "../adapters/transcription";
import { OcrCapabilityAdapter } from "../adapters/ocr";
import {
  COHERE_RERANK_CAPABILITY_ADAPTER_REVISION,
  CohereRerankCapabilityAdapter,
} from "../adapters/rerank";
import {
  GEMINI_EMBEDDING_CAPABILITY_ADAPTER_REVISION,
  OPENAI_COMPATIBLE_EMBEDDING_CAPABILITY_ADAPTER_REVISION,
  GeminiEmbeddingCapabilityAdapter,
  OpenAICompatibleEmbeddingCapabilityAdapter,
} from "../adapters/embedding";
import { DocumentExtractionCapabilityAdapter } from "../adapters/document-extraction";
import {
  OPENAI_COMPATIBLE_LANGUAGE_CAPABILITY_ADAPTER_REVISION,
  OpenAICompatibleLanguageCapabilityAdapter,
} from "../adapters/language-generation";
import {
  coreCapabilityArtifactIo,
  type CapabilityArtifactIo,
} from "../artifact-io";
import { capabilityOfferingIdentity } from "../offering-store";
import {
  AiSdkElevenLabsSpeechSynthesisAdapter,
  DEFAULT_MISTRAL_SPEECH_MODEL,
  MistralSpeechSynthesisAdapter,
  type SpeechProviderFetcher,
} from "./speech-synthesis";
import {
  AiSdkDeepgramTranscriptionAdapter,
  MISTRAL_TRANSCRIPTION_MODEL,
  MistralTranscriptionAdapter,
  type TranscriptionProviderFetcher,
} from "./transcription";
import { MISTRAL_OCR_MODEL, MistralOcrAdapter } from "./ocr";
import type { ProviderFetcher } from "../../search/provider-transport";
import {
  GEMINI_EMBEDDING_DISCLOSURE_REVISION,
  GEMINI_EMBEDDING_MODEL,
  geminiEmbeddingSpaceDescriptor,
} from "../../search/gemini-embedding";
import { canonicalJson, sha256 } from "../../search/values";
import { NativePdfDocumentExtractionAdapter } from "./document-extraction";
import { safeModelFetchResponse } from "../../agent/model-endpoint-policy";
import { createPinnedOpenRouterTransport } from "./openrouter-transport";

const apiKeySlot = {
  name: "apiKey",
  required: true,
  kind: "api-key" as const,
  validation: "remote-minimal-call" as const,
};

const regionField = {
  key: "region",
  label: "Region",
  kind: "text" as const,
  required: false,
  options: [],
  placeholder: null,
  help: "Optional provider region used for discovery and data-boundary display.",
};

export const mistralWorkflowPluginManifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "avermate.mistral",
  version: "1.0.0",
  displayName: "Mistral AI",
  executionTrust: "core-reviewed",
  capabilities: [
    "language.generate",
    "embedding.generate",
    "speech.transcribe",
    "speech.synthesize",
    "document.ocr",
  ],
  connectionSchemaVersion: 1,
  configurationFields: [regionField],
  secretSlots: [apiKeySlot],
};

export const elevenLabsWorkflowPluginManifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "ai-sdk.elevenlabs",
  version: "1.0.0",
  displayName: "ElevenLabs",
  executionTrust: "core-reviewed",
  capabilities: ["speech.synthesize"],
  connectionSchemaVersion: 1,
  configurationFields: [regionField],
  secretSlots: [apiKeySlot],
};

export const deepgramWorkflowPluginManifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "ai-sdk.deepgram",
  version: "1.0.0",
  displayName: "Deepgram",
  executionTrust: "core-reviewed",
  capabilities: ["speech.transcribe"],
  connectionSchemaVersion: 1,
  configurationFields: [regionField],
  secretSlots: [apiKeySlot],
};

export const cohereWorkflowPluginManifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "avermate.cohere",
  version: "1.0.0",
  displayName: "Cohere",
  executionTrust: "core-reviewed",
  capabilities: ["rerank.score"],
  connectionSchemaVersion: 1,
  configurationFields: [regionField],
  secretSlots: [apiKeySlot],
};

const googleConfigurationFields: ProviderPluginManifest["configurationFields"] = [
  regionField,
  {
    key: "projectId",
    label: "Project ID",
    kind: "text",
    required: false,
    options: [],
    placeholder: null,
    help: "Optional Google Cloud project identifier.",
  },
];

export const googleWorkflowPluginManifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "ai-sdk.google",
  version: "1.0.0",
  displayName: "Google Gemini",
  executionTrust: "core-reviewed",
  capabilities: ["embedding.generate"],
  connectionSchemaVersion: 1,
  configurationFields: googleConfigurationFields,
  secretSlots: [apiKeySlot],
};

const compatibleConfigurationFields: ProviderPluginManifest["configurationFields"] = [
  {
    key: "origin",
    label: "API origin",
    kind: "url",
    required: true,
    options: [],
    placeholder: "https://api.example.com",
    help: "HTTPS origin only; paths, credentials and private hosted addresses are rejected.",
  },
  {
    key: "apiVersion",
    label: "API version",
    kind: "text",
    required: false,
    options: [],
    placeholder: null,
    help: "Optional reviewed protocol version selector.",
  },
  {
    key: "organization",
    label: "Organization",
    kind: "text",
    required: false,
    options: [],
    placeholder: null,
    help: "Optional non-secret provider organization identifier.",
  },
  {
    key: "modelId",
    label: "Model ID",
    kind: "text",
    required: true,
    options: [],
    placeholder: "model-name",
    help: "Exact immutable provider model identifier.",
  },
  {
    key: "dimensions",
    label: "Embedding dimensions",
    kind: "number",
    required: false,
    options: [],
    placeholder: null,
    help: "Required when this connection advertises an embedding offering.",
  },
  {
    key: "modelRevision",
    label: "Model revision",
    kind: "text",
    required: false,
    options: [],
    placeholder: null,
    help: "Pinned provider model revision; defaults to the exact model ID.",
  },
  {
    key: "preprocessingRevision",
    label: "Preprocessing revision",
    kind: "text",
    required: false,
    options: [],
    placeholder: null,
    help: "Immutable embedding preprocessing revision.",
  },
];

export const openAICompatibleWorkflowPluginManifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "avermate.openai-compatible",
  version: "1.0.0",
  displayName: "OpenAI-compatible endpoint",
  executionTrust: "core-reviewed",
  capabilities: ["language.generate", "embedding.generate"],
  connectionSchemaVersion: 1,
  configurationFields: compatibleConfigurationFields,
  secretSlots: [apiKeySlot],
};

export const nativeDocumentWorkflowPluginManifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "avermate.native-document",
  version: "1.0.0",
  displayName: "Avermate native document extraction",
  executionTrust: "core-reviewed",
  capabilities: ["document.extract"],
  connectionSchemaVersion: 1,
  configurationFields: [],
  secretSlots: [],
};

export const openAIWorkflowPluginManifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "ai-sdk.openai",
  version: "1.0.0",
  displayName: "OpenAI",
  executionTrust: "core-reviewed",
  capabilities: ["language.generate"],
  connectionSchemaVersion: 1,
  configurationFields: [regionField],
  secretSlots: [apiKeySlot],
};

export const openRouterWorkflowPluginManifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "avermate.openrouter",
  version: "1.0.0",
  displayName: "OpenRouter",
  executionTrust: "core-reviewed",
  capabilities: ["language.generate"],
  connectionSchemaVersion: 1,
  configurationFields: [regionField],
  secretSlots: [apiKeySlot],
};

function invalidConfiguration(message: string) {
  return {
    valid: false as const,
    error: {
      version: 1 as const,
      code: "UNSUPPORTED_INPUT" as const,
      message,
      retryable: false,
      ambiguous: false,
      providerRequestId: null,
      safeDiagnostic: null,
    },
  };
}

function validateFixedConfiguration(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return invalidConfiguration("Provider configuration must be an object");
  }
  const value = config as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "region")) {
    return invalidConfiguration("Provider configuration contains unknown fields");
  }
  if (
    value.region !== undefined &&
    (typeof value.region !== "string" ||
      !value.region.trim() ||
      value.region.length > 128)
  ) {
    return invalidConfiguration("Provider region is invalid");
  }
  return {
    valid: true as const,
    safeMetadata: value.region ? { region: value.region as string } : null,
  };
}

function validateGoogleConfiguration(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return invalidConfiguration("Provider configuration must be an object");
  }
  const value = config as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["region", "projectId"].includes(key))) {
    return invalidConfiguration("Provider configuration contains unknown fields");
  }
  for (const key of ["region", "projectId"] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "string" ||
        !value[key].trim() ||
        value[key].length > (key === "region" ? 128 : 256))
    ) {
      return invalidConfiguration(`Provider ${key} is invalid`);
    }
  }
  return {
    valid: true as const,
    safeMetadata: value.region
      ? { region: value.region as string }
      : null,
  };
}

type OpenAICompatibleConfiguration = {
  origin: string;
  apiVersion?: string;
  organization?: string;
  modelId: string;
  dimensions?: number;
  modelRevision?: string;
  preprocessingRevision?: string;
};

function openAICompatibleConfiguration(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const value = config as Record<string, unknown>;
  const allowed = new Set([
    "origin",
    "apiVersion",
    "organization",
    "modelId",
    "dimensions",
    "modelRevision",
    "preprocessingRevision",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (typeof value.origin !== "string" || typeof value.modelId !== "string") {
    return null;
  }
  let origin: string;
  try {
    const parsed = new URL(value.origin);
    if (parsed.username || parsed.password || parsed.pathname !== "/") return null;
    origin = parsed.origin;
  } catch {
    return null;
  }
  if (!value.modelId.trim() || value.modelId.length > 256) return null;
  for (const key of [
    "apiVersion",
    "organization",
    "modelRevision",
    "preprocessingRevision",
  ] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "string" ||
        !value[key].trim() ||
        value[key].length > 256)
    ) {
      return null;
    }
  }
  if (
    value.dimensions !== undefined &&
    (!Number.isSafeInteger(value.dimensions) ||
      Number(value.dimensions) < 1 ||
      Number(value.dimensions) > 65_536)
  ) {
    return null;
  }
  return {
    origin,
    modelId: value.modelId.trim(),
    ...(value.apiVersion ? { apiVersion: value.apiVersion as string } : {}),
    ...(value.organization
      ? { organization: value.organization as string }
      : {}),
    ...(value.dimensions ? { dimensions: Number(value.dimensions) } : {}),
    ...(value.modelRevision
      ? { modelRevision: value.modelRevision as string }
      : {}),
    ...(value.preprocessingRevision
      ? { preprocessingRevision: value.preprocessingRevision as string }
      : {}),
  } satisfies OpenAICompatibleConfiguration;
}

function validateOpenAICompatibleConfiguration(config: unknown) {
  const parsed = openAICompatibleConfiguration(config);
  return parsed
    ? {
        valid: true as const,
        safeMetadata: {
          origin: parsed.origin,
          modelId: parsed.modelId,
          dimensions: parsed.dimensions ?? null,
        },
      }
    : invalidConfiguration("OpenAI-compatible configuration is invalid");
}

type CredentialProbe = {
  url: string;
  headerName: string;
  headerValue(secret: string): string;
  fetch?: ProviderFetcher;
};

export async function validateRemoteApiKey(
  context: Parameters<ProviderPlugin["validateConnection"]>[0],
  configuration: ProviderConnectionValidationResult,
  probe: CredentialProbe,
) {
  if (!configuration.valid) return configuration;
  const credential = await context.credential("apiKey");
  if (!credential?.secret.trim()) {
    return {
      valid: false as const,
      error: {
        version: 1 as const,
        code: "AUTHENTICATION_REQUIRED" as const,
        message: "A provider API key is required",
        retryable: false,
        ambiguous: false,
        providerRequestId: null,
        safeDiagnostic: null,
      },
    };
  }
  try {
    const origin = new URL(probe.url).origin;
    const response = probe.fetch
      ? await probe.fetch(probe.url, {
          method: "GET",
          headers: {
            accept: "application/json",
            [probe.headerName]: probe.headerValue(credential.secret),
          },
          redirect: "manual",
          signal: AbortSignal.any([
            context.signal,
            AbortSignal.timeout(10_000),
          ]),
        })
      : await safeModelFetchResponse(probe.url, {
          policy: {
            placement: "hosted-core",
            allowedOrigins: [origin],
          },
          credential: {
            origin,
            headerName: probe.headerName,
            value: probe.headerValue(credential.secret),
          },
          method: "GET",
          headers: { accept: "application/json" },
          signal: context.signal,
          maxRedirects: 0,
          // Model catalogues can exceed 16 KiB even though validation reads no body.
          maxResponseBytes: 256 * 1_024,
          connectTimeoutMs: 5_000,
          readTimeoutMs: 5_000,
          totalTimeoutMs: 10_000,
        });
    const status = response.status;
    void response.body?.cancel().catch(() => undefined);
    if (response.ok) {
      return {
        valid: true as const,
        safeMetadata: {
          endpoint: origin,
          credentialVersion: credential.version,
        },
      };
    }
    const authentication = status === 401 || status === 403;
    return {
      valid: false as const,
      error: {
        version: 1 as const,
        code: authentication
          ? ("CREDENTIAL_INVALID" as const)
          : ("PROVIDER_UNAVAILABLE" as const),
        message: authentication
          ? "The provider rejected the API key"
          : "The provider validation endpoint is unavailable",
        retryable: !authentication && (response.status === 429 || response.status >= 500),
        ambiguous: false,
        providerRequestId: response.headers.get("x-request-id"),
        safeDiagnostic: { httpStatus: response.status },
      },
    };
  } catch {
    return {
      valid: false as const,
      error: {
        version: 1 as const,
        code: "PROVIDER_UNAVAILABLE" as const,
        message: "The provider validation endpoint could not be reached",
        retryable: true,
        ambiguous: false,
        providerRequestId: null,
        safeDiagnostic: null,
      },
    };
  }
}

function externalDataHandling(
  providerName: string,
  connection: ProviderConnectionPublicSnapshot,
) {
  return {
    egress: "external-provider" as const,
    providerName,
    region:
      typeof connection.config.region === "string"
        ? connection.config.region
        : null,
    disclosureRevision: `${providerName}-data-handling/1`,
    retentionDisclosureRevision: `${providerName}-retention/1`,
    trainingDisclosureRevision: `${providerName}-training/1`,
    requiresExplicitConsent: true,
  };
}

function embeddingPlacement(
  placement: ProviderConnectionPublicSnapshot["placement"],
) {
  if (placement.kind === "node") return "node" as const;
  if (placement.kind === "managed") return "managed" as const;
  return "core" as const;
}

function embeddingSpaceIdentity(input: {
  provider: string;
  model: string;
  modelRevision: string;
  dimensions: number;
  modalities: readonly ("text" | "image" | "pdf-page" | "audio" | "video")[];
  normalization: "provider-unit" | "client-unit";
  preprocessingRevision: string;
  placement: "core" | "node" | "managed";
  origin?: string;
}) {
  return `emb_${sha256(canonicalJson(input))}`;
}

function speechOffering(input: {
  connection: ProviderConnectionPublicSnapshot;
  manifest: ProviderPluginManifest;
  provider: string;
  providerName: string;
  modelId: string;
  modelRevision: string;
  adapterRevision: string;
}): CapabilityOfferingSnapshot<"speech.synthesize"> {
  const identity: Omit<
    CapabilityOfferingSnapshot<"speech.synthesize">,
    "id"
  > = {
    schemaVersion: 1,
    connectionId: input.connection.id,
    connectionRevision: input.connection.revision,
    pluginId: input.manifest.id,
    pluginVersion: input.manifest.version,
    adapterRevision: input.adapterRevision,
    capabilityProtocolVersion: 1,
    capability: "speech.synthesize",
    provider: input.provider,
    modelId: input.modelId,
    modelRevision: input.modelRevision,
    placement: input.connection.placement,
    dataHandling: externalDataHandling(input.providerName, input.connection),
    limits: {
      maxInputBytes: 448_000,
      maxOutputBytes: 100 * 1024 * 1024,
      maxBatchSize: 1,
      maxConcurrency: 4,
    },
    supportedLanguages: "unknown",
    healthCheckKind: "active-probe",
    specification: {
      streaming: false,
      inputLanguages: "unknown",
      outputFormats: [
        { container: "mp3", codec: "mp3", sampleRates: [44_100] },
      ],
      speedControl: false,
      pitchControl: false,
      styleControl: false,
      alignment: ["none"],
      voiceCatalogue: "manual",
      voiceCloning: false,
    },
  };
  return { id: capabilityOfferingIdentity(identity), ...identity };
}

function transcriptionOffering(input: {
  connection: ProviderConnectionPublicSnapshot;
  manifest: ProviderPluginManifest;
  provider: string;
  providerName: string;
  modelId: string;
  modelRevision: string;
  adapterRevision: string;
}): CapabilityOfferingSnapshot<"speech.transcribe"> {
  const identity: Omit<
    CapabilityOfferingSnapshot<"speech.transcribe">,
    "id"
  > = {
    schemaVersion: 1,
    connectionId: input.connection.id,
    connectionRevision: input.connection.revision,
    pluginId: input.manifest.id,
    pluginVersion: input.manifest.version,
    adapterRevision: input.adapterRevision,
    capabilityProtocolVersion: 1,
    capability: "speech.transcribe",
    provider: input.provider,
    modelId: input.modelId,
    modelRevision: input.modelRevision,
    placement: input.connection.placement,
    dataHandling: externalDataHandling(input.providerName, input.connection),
    limits: {
      maxInputBytes: 32 * 1024 * 1024,
      maxOutputBytes: 8 * 1024 * 1024,
      maxBatchSize: 1,
      maxConcurrency: 4,
    },
    supportedLanguages: "unknown",
    healthCheckKind: "active-probe",
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
        "audio/ogg",
        "audio/wav",
        "audio/webm",
        "video/mp4",
        "video/webm",
      ],
      maxBytes: 32 * 1024 * 1024,
      maxDurationSeconds: 14_400,
      maximumSpeakers: null,
    },
  };
  return { id: capabilityOfferingIdentity(identity), ...identity };
}

function ocrOffering(input: {
  connection: ProviderConnectionPublicSnapshot;
  manifest: ProviderPluginManifest;
  provider: string;
  providerName: string;
  modelId: string;
  modelRevision: string;
  adapterRevision: string;
}): CapabilityOfferingSnapshot<"document.ocr"> {
  const identity: Omit<CapabilityOfferingSnapshot<"document.ocr">, "id"> = {
    schemaVersion: 1,
    connectionId: input.connection.id,
    connectionRevision: input.connection.revision,
    pluginId: input.manifest.id,
    pluginVersion: input.manifest.version,
    adapterRevision: input.adapterRevision,
    capabilityProtocolVersion: 1,
    capability: "document.ocr",
    provider: input.provider,
    modelId: input.modelId,
    modelRevision: input.modelRevision,
    placement: input.connection.placement,
    dataHandling: externalDataHandling(input.providerName, input.connection),
    limits: {
      maxInputBytes: 25 * 1024 * 1024,
      maxOutputBytes: 64 * 1024 * 1024,
      maxBatchSize: 1,
      maxConcurrency: 2,
    },
    supportedLanguages: "unknown",
    healthCheckKind: "active-probe",
    specification: {
      inputMimeTypes: [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
      ],
      nativePdf: true,
      scannedPdf: true,
      images: true,
      handwriting: true,
      layout: true,
      tables: true,
      formulas: true,
      embeddedImages: false,
      boundingBoxes: "none",
      confidence: false,
      maxPages: 500,
      maxBytes: 25 * 1024 * 1024,
    },
  };
  return { id: capabilityOfferingIdentity(identity), ...identity };
}

function rerankOffering(input: {
  connection: ProviderConnectionPublicSnapshot;
  manifest: ProviderPluginManifest;
  modelId: "rerank-v4.0-pro" | "rerank-v4.0-fast";
}): CapabilityOfferingSnapshot<"rerank.score"> {
  const identity: Omit<CapabilityOfferingSnapshot<"rerank.score">, "id"> = {
    schemaVersion: 1,
    connectionId: input.connection.id,
    connectionRevision: input.connection.revision,
    pluginId: input.manifest.id,
    pluginVersion: input.manifest.version,
    adapterRevision: COHERE_RERANK_CAPABILITY_ADAPTER_REVISION,
    capabilityProtocolVersion: 1,
    capability: "rerank.score",
    provider: "cohere",
    modelId: input.modelId,
    modelRevision: input.modelId,
    placement: input.connection.placement,
    dataHandling: externalDataHandling("Cohere", input.connection),
    limits: {
      maxInputBytes: 1024 * 1024,
      maxOutputBytes: 2 * 1024 * 1024,
      maxBatchSize: 1_000,
      maxConcurrency: 8,
    },
    supportedLanguages: "unknown",
    healthCheckKind: "active-probe",
    specification: {
      modalities: ["text"],
      maxCandidates: 1_000,
      maxTokensPerCandidate: 4_096,
      languages: "multilingual",
      scoreSemantics: "probability-like",
    },
  };
  return { id: capabilityOfferingIdentity(identity), ...identity };
}

function embeddingOffering(input: {
  connection: ProviderConnectionPublicSnapshot;
  manifest: ProviderPluginManifest;
  adapterRevision: string;
  provider: string;
  providerName: string;
  modelId: string;
  modelRevision: string;
  dimensions: number;
  modalities: ("text" | "image" | "pdf-page" | "audio" | "video")[];
  preprocessingRevision: string;
  embeddingSpaceId: string;
  disclosureRevision?: string;
  maximumInputs?: number;
}): CapabilityOfferingSnapshot<"embedding.generate"> {
  const handling = externalDataHandling(input.providerName, input.connection);
  const identity: Omit<
    CapabilityOfferingSnapshot<"embedding.generate">,
    "id"
  > = {
    schemaVersion: 1,
    connectionId: input.connection.id,
    connectionRevision: input.connection.revision,
    pluginId: input.manifest.id,
    pluginVersion: input.manifest.version,
    adapterRevision: input.adapterRevision,
    capabilityProtocolVersion: 1,
    capability: "embedding.generate",
    provider: input.provider,
    modelId: input.modelId,
    modelRevision: input.modelRevision,
    placement: input.connection.placement,
    dataHandling: input.disclosureRevision
      ? { ...handling, disclosureRevision: input.disclosureRevision }
      : handling,
    limits: {
      maxInputBytes: 100 * 1024 * 1024,
      maxOutputBytes: 64 * 1024 * 1024,
      maxBatchSize: input.maximumInputs ?? 100,
      maxConcurrency: 8,
    },
    supportedLanguages: "unknown",
    healthCheckKind: "active-probe",
    specification: {
      modalities: input.modalities,
      dimensions: input.dimensions,
      normalization: "provider-unit",
      maximumInputs: input.maximumInputs ?? 100,
      maximumTokensPerInput: 8_192,
      preprocessingRevision: input.preprocessingRevision,
      embeddingSpaceId: input.embeddingSpaceId,
    },
  };
  return { id: capabilityOfferingIdentity(identity), ...identity };
}

function nativeDocumentOffering(
  connection: ProviderConnectionPublicSnapshot,
): CapabilityOfferingSnapshot<"document.extract"> {
  const adapter = new NativePdfDocumentExtractionAdapter();
  const identity: Omit<CapabilityOfferingSnapshot<"document.extract">, "id"> = {
    schemaVersion: 1,
    connectionId: connection.id,
    connectionRevision: connection.revision,
    pluginId: nativeDocumentWorkflowPluginManifest.id,
    pluginVersion: nativeDocumentWorkflowPluginManifest.version,
    adapterRevision: adapter.adapterRevision,
    capabilityProtocolVersion: 1,
    capability: "document.extract",
    provider: adapter.providerId,
    modelId: "unpdf-text-layer",
    modelRevision: adapter.adapterRevision,
    placement: connection.placement,
    dataHandling: {
      egress: "none",
      providerName: "Avermate native PDF",
      region: null,
      disclosureRevision: "native-pdf-local/1",
      retentionDisclosureRevision: "native-pdf-retention/1",
      trainingDisclosureRevision: "native-pdf-training/1",
      requiresExplicitConsent: false,
    },
    limits: {
      maxInputBytes: 64 * 1024 * 1024,
      maxOutputBytes: 64 * 1024 * 1024,
      maxBatchSize: 1,
      maxConcurrency: 4,
    },
    supportedLanguages: "unknown",
    healthCheckKind: "passive",
    specification: {
      inputMimeTypes: ["application/pdf"],
      deterministic: true,
      preservesSourceLocators: true,
      supportsAssets: false,
      maxBytes: 64 * 1024 * 1024,
    },
  };
  return { id: capabilityOfferingIdentity(identity), ...identity };
}

export function languageOffering(input: {
  connection: ProviderConnectionPublicSnapshot;
  manifest: ProviderPluginManifest;
  provider: string;
  providerName: string;
  modelId: string;
  modelRevision: string;
  contextWindow: number | "unknown";
  maximumOutputTokens: number | "unknown";
  tools: boolean;
  inputModalities: readonly ("text" | "image" | "pdf")[];
}): CapabilityOfferingSnapshot<"language.generate"> {
  const identity: Omit<
    CapabilityOfferingSnapshot<"language.generate">,
    "id"
  > = {
    schemaVersion: 1,
    connectionId: input.connection.id,
    connectionRevision: input.connection.revision,
    pluginId: input.manifest.id,
    pluginVersion: input.manifest.version,
    adapterRevision: OPENAI_COMPATIBLE_LANGUAGE_CAPABILITY_ADAPTER_REVISION,
    capabilityProtocolVersion: 1,
    capability: "language.generate",
    provider: input.provider,
    modelId: input.modelId,
    modelRevision: input.modelRevision,
    placement: input.connection.placement,
    dataHandling: externalDataHandling(input.providerName, input.connection),
    limits: {
      maxInputBytes: 8 * 1024 * 1024,
      maxOutputBytes: 16 * 1024 * 1024,
      maxBatchSize: 1,
      maxConcurrency: 8,
    },
    supportedLanguages: "unknown",
    healthCheckKind: "active-probe",
    specification: {
      inputModalities: [...input.inputModalities],
      contextWindow: input.contextWindow,
      maximumOutputTokens: input.maximumOutputTokens,
      tools: input.tools,
      parallelTools: false,
      structuredOutput: false,
      streaming: true,
      reasoningSummary: false,
      opaqueReasoningContinuation: false,
      cachedUsage: true,
    },
  };
  return { id: capabilityOfferingIdentity(identity), ...identity };
}

function assertOfferingConnection(
  connection: ProviderConnectionPublicSnapshot,
  offering: CapabilityOffering,
  manifest: ProviderPluginManifest,
) {
  const { id: _id, ...identity } = offering;
  if (
    offering.id !== capabilityOfferingIdentity(identity) ||
    offering.connectionId !== connection.id ||
    offering.connectionRevision !== connection.revision ||
    offering.pluginId !== manifest.id ||
    offering.pluginVersion !== manifest.version
  ) {
    throw new Error("CAPABILITY_PLUGIN_OFFERING_SNAPSHOT_MISMATCH");
  }
}

type ProviderModelRoute = {
  provider: string;
  providerName: string;
  id: string;
  revision: string;
};

class MediaWorkflowProviderPlugin implements ProviderPlugin {
  constructor(
    readonly manifest: ProviderPluginManifest,
    private readonly artifacts: CapabilityArtifactIo,
    private readonly adapters: {
      validation?: CredentialProbe;
      speech?: {
        adapter:
          | MistralSpeechSynthesisAdapter
          | AiSdkElevenLabsSpeechSynthesisAdapter;
        model: ProviderModelRoute;
      };
      transcription?: {
        adapter:
          | MistralTranscriptionAdapter
          | AiSdkDeepgramTranscriptionAdapter;
        model: ProviderModelRoute;
      };
      ocr?: {
        adapter: MistralOcrAdapter;
        model: ProviderModelRoute;
      };
      embedding?: {
        fetch?: ProviderFetcher;
        model: ProviderModelRoute & {
          dimensions: number;
          preprocessingRevision: string;
        };
      };
      language?: {
        fetch?: ProviderFetcher;
        apiVersion?: string;
        model: ProviderModelRoute & {
          contextWindow: number | "unknown";
          maximumOutputTokens: number | "unknown";
          tools: boolean;
          inputModalities: readonly ("text" | "image" | "pdf")[];
        };
        origin: string;
      };
    },
  ) {}

  async validateConnection(
    context: Parameters<ProviderPlugin["validateConnection"]>[0],
    config: unknown,
  ) {
    const configuration = validateFixedConfiguration(config);
    return this.adapters.validation
      ? validateRemoteApiKey(context, configuration, this.adapters.validation)
      : configuration;
  }

  async discoverOfferings(
    context: Parameters<ProviderPlugin["discoverOfferings"]>[0],
    connection: ProviderConnectionPublicSnapshot,
  ) {
    context.signal.throwIfAborted();
    if (
      connection.pluginId !== this.manifest.id ||
      connection.pluginVersion !== this.manifest.version
    ) {
      throw new Error("CAPABILITY_PLUGIN_CONNECTION_MISMATCH");
    }
    const offerings: CapabilityOffering[] = [];
    if (this.adapters.speech) {
      const { adapter, model } = this.adapters.speech;
      offerings.push(
        speechOffering({
          connection,
          manifest: this.manifest,
          provider: model.provider,
          providerName: model.providerName,
          modelId: model.id,
          modelRevision: model.revision,
          adapterRevision: adapter.adapterRevision,
        }),
      );
    }
    if (this.adapters.transcription) {
      const { adapter, model } = this.adapters.transcription;
      offerings.push(
        transcriptionOffering({
          connection,
          manifest: this.manifest,
          provider: model.provider,
          providerName: model.providerName,
          modelId: model.id,
          modelRevision: model.revision,
          adapterRevision: adapter.adapterRevision,
        }),
      );
    }
    if (this.adapters.ocr) {
      const { adapter, model } = this.adapters.ocr;
      offerings.push(
        ocrOffering({
          connection,
          manifest: this.manifest,
          provider: model.provider,
          providerName: model.providerName,
          modelId: model.id,
          modelRevision: model.revision,
          adapterRevision: adapter.adapterRevision,
        }),
      );
    }
    if (this.adapters.embedding) {
      const { model } = this.adapters.embedding;
      const placement = embeddingPlacement(connection.placement);
      offerings.push(
        embeddingOffering({
          connection,
          manifest: this.manifest,
          adapterRevision:
            OPENAI_COMPATIBLE_EMBEDDING_CAPABILITY_ADAPTER_REVISION,
          provider: model.provider,
          providerName: model.providerName,
          modelId: model.id,
          modelRevision: model.revision,
          dimensions: model.dimensions,
          modalities: ["text"],
          preprocessingRevision: model.preprocessingRevision,
          embeddingSpaceId: embeddingSpaceIdentity({
            provider: model.provider,
            model: model.id,
            modelRevision: model.revision,
            dimensions: model.dimensions,
            modalities: ["text"],
            normalization: "provider-unit",
            preprocessingRevision: model.preprocessingRevision,
            placement,
          }),
          maximumInputs: 256,
        }),
      );
    }
    if (this.adapters.language) {
      const { model } = this.adapters.language;
      offerings.push(
        languageOffering({
          connection,
          manifest: this.manifest,
          provider: model.provider,
          providerName: model.providerName,
          modelId: model.id,
          modelRevision: model.revision,
          contextWindow: model.contextWindow,
          maximumOutputTokens: model.maximumOutputTokens,
          tools: model.tools,
          inputModalities: model.inputModalities,
        }),
      );
    }
    return offerings;
  }

  async createAdapter<K extends CapabilityKind>(
    context: Parameters<ProviderPlugin["createAdapter"]>[0],
    offering: CapabilityOfferingSnapshot<K>,
  ): Promise<CapabilityAdapter<K>> {
    context.signal.throwIfAborted();
    assertOfferingConnection(context.connection, offering, this.manifest);
    if (offering.capability === "speech.synthesize" && this.adapters.speech) {
      return new SpeechSynthesisCapabilityAdapter(
        offering as CapabilityOfferingSnapshot<"speech.synthesize">,
        this.adapters.speech.adapter,
        this.artifacts,
      ) as unknown as CapabilityAdapter<K>;
    }
    if (
      offering.capability === "speech.transcribe" &&
      this.adapters.transcription
    ) {
      return new TranscriptionCapabilityAdapter(
        offering as CapabilityOfferingSnapshot<"speech.transcribe">,
        this.adapters.transcription.adapter,
        this.artifacts,
      ) as unknown as CapabilityAdapter<K>;
    }
    if (offering.capability === "document.ocr" && this.adapters.ocr) {
      return new OcrCapabilityAdapter(
        offering as CapabilityOfferingSnapshot<"document.ocr">,
        this.adapters.ocr.adapter,
        this.artifacts,
      ) as unknown as CapabilityAdapter<K>;
    }
    if (
      offering.capability === "embedding.generate" &&
      this.adapters.embedding
    ) {
      return new OpenAICompatibleEmbeddingCapabilityAdapter(
        offering as CapabilityOfferingSnapshot<"embedding.generate">,
        { origin: "https://api.mistral.ai", apiVersion: "v1" },
        this.adapters.embedding.fetch,
      ) as unknown as CapabilityAdapter<K>;
    }
    if (offering.capability === "language.generate" && this.adapters.language) {
      return new OpenAICompatibleLanguageCapabilityAdapter(
        offering as CapabilityOfferingSnapshot<"language.generate">,
        {
          origin: this.adapters.language.origin,
          ...(this.adapters.language.apiVersion
            ? { apiVersion: this.adapters.language.apiVersion }
            : {}),
        },
        this.adapters.language.fetch,
        this.artifacts,
      ) as unknown as CapabilityAdapter<K>;
    }
    throw new Error(`CAPABILITY_PLUGIN_ADAPTER_UNAVAILABLE:${offering.capability}`);
  }
}

class CohereWorkflowProviderPlugin implements ProviderPlugin {
  readonly manifest = cohereWorkflowPluginManifest;

  constructor(
    private readonly providerFetch?: ProviderFetcher,
    private readonly validationFetch?: ProviderFetcher,
  ) {}

  async validateConnection(
    context: Parameters<ProviderPlugin["validateConnection"]>[0],
    config: unknown,
  ) {
    return validateRemoteApiKey(context, validateFixedConfiguration(config), {
      url: "https://api.cohere.com/v1/models?page_size=1",
      headerName: "authorization",
      headerValue: (secret) => `Bearer ${secret}`,
      fetch: this.validationFetch,
    });
  }

  async discoverOfferings(
    context: Parameters<ProviderPlugin["discoverOfferings"]>[0],
    connection: ProviderConnectionPublicSnapshot,
  ) {
    context.signal.throwIfAborted();
    if (
      connection.pluginId !== this.manifest.id ||
      connection.pluginVersion !== this.manifest.version
    ) {
      throw new Error("CAPABILITY_PLUGIN_CONNECTION_MISMATCH");
    }
    return (["rerank-v4.0-pro", "rerank-v4.0-fast"] as const).map(
      (modelId) => rerankOffering({ connection, manifest: this.manifest, modelId }),
    );
  }

  async createAdapter<K extends CapabilityKind>(
    context: Parameters<ProviderPlugin["createAdapter"]>[0],
    offering: CapabilityOfferingSnapshot<K>,
  ): Promise<CapabilityAdapter<K>> {
    context.signal.throwIfAborted();
    assertOfferingConnection(context.connection, offering, this.manifest);
    if (offering.capability !== "rerank.score") {
      throw new Error(
        `CAPABILITY_PLUGIN_ADAPTER_UNAVAILABLE:${offering.capability}`,
      );
    }
    return new CohereRerankCapabilityAdapter(
      offering as CapabilityOfferingSnapshot<"rerank.score">,
      this.providerFetch,
    ) as unknown as CapabilityAdapter<K>;
  }
}

class GoogleEmbeddingWorkflowProviderPlugin implements ProviderPlugin {
  readonly manifest = googleWorkflowPluginManifest;

  constructor(
    private readonly artifacts: CapabilityArtifactIo,
    private readonly providerFetch?: ProviderFetcher,
    private readonly validationFetch?: ProviderFetcher,
  ) {}

  async validateConnection(
    context: Parameters<ProviderPlugin["validateConnection"]>[0],
    config: unknown,
  ) {
    return validateRemoteApiKey(context, validateGoogleConfiguration(config), {
      url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      headerName: "x-goog-api-key",
      headerValue: (secret) => secret,
      fetch: this.validationFetch,
    });
  }

  async discoverOfferings(
    context: Parameters<ProviderPlugin["discoverOfferings"]>[0],
    connection: ProviderConnectionPublicSnapshot,
  ) {
    context.signal.throwIfAborted();
    if (
      connection.pluginId !== this.manifest.id ||
      connection.pluginVersion !== this.manifest.version
    ) {
      throw new Error("CAPABILITY_PLUGIN_CONNECTION_MISMATCH");
    }
    return ([768, 1536, 3072] as const).map((dimensions) => {
      const descriptor = geminiEmbeddingSpaceDescriptor(dimensions);
      return embeddingOffering({
        connection,
        manifest: this.manifest,
        adapterRevision: GEMINI_EMBEDDING_CAPABILITY_ADAPTER_REVISION,
        provider: "gemini",
        providerName: "Google Gemini",
        modelId: GEMINI_EMBEDDING_MODEL,
        modelRevision: descriptor.modelRevision,
        dimensions,
        modalities: ["text", "image", "pdf-page", "audio", "video"],
        preprocessingRevision: descriptor.preprocessingRevision,
        embeddingSpaceId: descriptor.id,
        disclosureRevision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
        maximumInputs: 100,
      });
    });
  }

  async createAdapter<K extends CapabilityKind>(
    context: Parameters<ProviderPlugin["createAdapter"]>[0],
    offering: CapabilityOfferingSnapshot<K>,
  ): Promise<CapabilityAdapter<K>> {
    context.signal.throwIfAborted();
    assertOfferingConnection(context.connection, offering, this.manifest);
    if (offering.capability !== "embedding.generate") {
      throw new Error(
        `CAPABILITY_PLUGIN_ADAPTER_UNAVAILABLE:${offering.capability}`,
      );
    }
    return new GeminiEmbeddingCapabilityAdapter(
      offering as CapabilityOfferingSnapshot<"embedding.generate">,
      this.artifacts,
      this.providerFetch,
    ) as unknown as CapabilityAdapter<K>;
  }
}

class OpenAICompatibleWorkflowProviderPlugin implements ProviderPlugin {
  readonly manifest = openAICompatibleWorkflowPluginManifest;

  constructor(
    private readonly providerFetch?: ProviderFetcher,
    private readonly validationFetch?: ProviderFetcher,
  ) {}

  async validateConnection(
    context: Parameters<ProviderPlugin["validateConnection"]>[0],
    config: unknown,
  ) {
    const configuration = validateOpenAICompatibleConfiguration(config);
    const parsed = openAICompatibleConfiguration(config);
    if (!configuration.valid || !parsed) return configuration;
    return validateRemoteApiKey(context, configuration, {
      url: `${parsed.origin}/${parsed.apiVersion ?? "v1"}/models`,
      headerName: "authorization",
      headerValue: (secret) => `Bearer ${secret}`,
      fetch: this.validationFetch,
    });
  }

  async discoverOfferings(
    context: Parameters<ProviderPlugin["discoverOfferings"]>[0],
    connection: ProviderConnectionPublicSnapshot,
  ) {
    context.signal.throwIfAborted();
    if (
      connection.pluginId !== this.manifest.id ||
      connection.pluginVersion !== this.manifest.version
    ) {
      throw new Error("CAPABILITY_PLUGIN_CONNECTION_MISMATCH");
    }
    const config = openAICompatibleConfiguration(connection.config);
    if (!config) throw new Error("CAPABILITY_PLUGIN_CONFIGURATION_INVALID");
    const offerings: CapabilityOffering[] = [
      languageOffering({
        connection,
        manifest: this.manifest,
        provider: "openai-compatible",
        providerName: `OpenAI-compatible ${new URL(config.origin).hostname}`,
        modelId: config.modelId,
        modelRevision: config.modelRevision ?? config.modelId,
        contextWindow: "unknown",
        maximumOutputTokens: "unknown",
        tools: false,
        inputModalities: ["text"],
      }),
    ];
    if (!config.dimensions) return offerings;
    const modelRevision = config.modelRevision ?? config.modelId;
    const preprocessingRevision =
      config.preprocessingRevision ?? "avermate-corpus-text-v1";
    const placement = embeddingPlacement(connection.placement);
    offerings.push(
      embeddingOffering({
        connection,
        manifest: this.manifest,
        adapterRevision:
          OPENAI_COMPATIBLE_EMBEDDING_CAPABILITY_ADAPTER_REVISION,
        provider: "openai-compatible",
        providerName: `OpenAI-compatible ${new URL(config.origin).hostname}`,
        modelId: config.modelId,
        modelRevision,
        dimensions: config.dimensions,
        modalities: ["text"],
        preprocessingRevision,
        embeddingSpaceId: embeddingSpaceIdentity({
          provider: "openai-compatible",
          model: config.modelId,
          modelRevision,
          dimensions: config.dimensions,
          modalities: ["text"],
          normalization: "provider-unit",
          preprocessingRevision,
          placement,
          origin: config.origin,
        }),
        maximumInputs: 256,
      }),
    );
    return offerings;
  }

  async createAdapter<K extends CapabilityKind>(
    context: Parameters<ProviderPlugin["createAdapter"]>[0],
    offering: CapabilityOfferingSnapshot<K>,
  ): Promise<CapabilityAdapter<K>> {
    context.signal.throwIfAborted();
    assertOfferingConnection(context.connection, offering, this.manifest);
    if (
      offering.capability !== "embedding.generate" &&
      offering.capability !== "language.generate"
    ) {
      throw new Error(
        `CAPABILITY_PLUGIN_ADAPTER_UNAVAILABLE:${offering.capability}`,
      );
    }
    const config = openAICompatibleConfiguration(context.connection.config);
    if (!config) throw new Error("CAPABILITY_PLUGIN_CONFIGURATION_INVALID");
    if (offering.capability === "language.generate") {
      return new OpenAICompatibleLanguageCapabilityAdapter(
        offering as CapabilityOfferingSnapshot<"language.generate">,
        {
          origin: config.origin,
          ...(config.apiVersion ? { apiVersion: config.apiVersion } : {}),
        },
        this.providerFetch,
      ) as unknown as CapabilityAdapter<K>;
    }
    return new OpenAICompatibleEmbeddingCapabilityAdapter(
      offering as CapabilityOfferingSnapshot<"embedding.generate">,
      {
        origin: config.origin,
        ...(config.apiVersion ? { apiVersion: config.apiVersion } : {}),
      },
      this.providerFetch,
    ) as unknown as CapabilityAdapter<K>;
  }
}

class NativeDocumentWorkflowProviderPlugin implements ProviderPlugin {
  readonly manifest = nativeDocumentWorkflowPluginManifest;
  readonly #adapter = new NativePdfDocumentExtractionAdapter();

  constructor(private readonly artifacts: CapabilityArtifactIo) {}

  async validateConnection(
    _context: Parameters<ProviderPlugin["validateConnection"]>[0],
    config: unknown,
  ) {
    return config &&
      typeof config === "object" &&
      !Array.isArray(config) &&
      Object.keys(config).length === 0
      ? { valid: true as const, safeMetadata: { networkAccess: false } }
      : invalidConfiguration("Native document configuration must be empty");
  }

  async discoverOfferings(
    context: Parameters<ProviderPlugin["discoverOfferings"]>[0],
    connection: ProviderConnectionPublicSnapshot,
  ) {
    context.signal.throwIfAborted();
    if (
      connection.pluginId !== this.manifest.id ||
      connection.pluginVersion !== this.manifest.version
    ) {
      throw new Error("CAPABILITY_PLUGIN_CONNECTION_MISMATCH");
    }
    return [nativeDocumentOffering(connection)];
  }

  async createAdapter<K extends CapabilityKind>(
    context: Parameters<ProviderPlugin["createAdapter"]>[0],
    offering: CapabilityOfferingSnapshot<K>,
  ): Promise<CapabilityAdapter<K>> {
    context.signal.throwIfAborted();
    assertOfferingConnection(context.connection, offering, this.manifest);
    if (offering.capability !== "document.extract") {
      throw new Error(
        `CAPABILITY_PLUGIN_ADAPTER_UNAVAILABLE:${offering.capability}`,
      );
    }
    return new DocumentExtractionCapabilityAdapter(
      offering as CapabilityOfferingSnapshot<"document.extract">,
      this.#adapter,
      this.artifacts,
    ) as unknown as CapabilityAdapter<K>;
  }
}

export type WorkflowProviderPluginDependencies = {
  artifacts?: CapabilityArtifactIo;
  mistralFetch?: SpeechProviderFetcher;
  elevenLabsFetch?: SpeechProviderFetcher;
  deepgramFetch?: TranscriptionProviderFetcher;
  cohereFetch?: ProviderFetcher;
  mistralEmbeddingFetch?: ProviderFetcher;
  googleEmbeddingFetch?: ProviderFetcher;
  openAICompatibleEmbeddingFetch?: ProviderFetcher;
  mistralLanguageFetch?: ProviderFetcher;
  openAILanguageFetch?: ProviderFetcher;
  openRouterLanguageFetch?: ProviderFetcher;
  mistralValidationFetch?: ProviderFetcher;
  elevenLabsValidationFetch?: ProviderFetcher;
  deepgramValidationFetch?: ProviderFetcher;
  cohereValidationFetch?: ProviderFetcher;
  googleValidationFetch?: ProviderFetcher;
  openAICompatibleValidationFetch?: ProviderFetcher;
  openAIValidationFetch?: ProviderFetcher;
  openRouterValidationFetch?: ProviderFetcher;
};

export function createWorkflowProviderPluginFactories(
  dependencies: WorkflowProviderPluginDependencies = {},
): Partial<Record<string, () => ProviderPlugin>> {
  const artifacts = dependencies.artifacts ?? coreCapabilityArtifactIo;
  return {
    "avermate.mistral": () =>
      new MediaWorkflowProviderPlugin(
        mistralWorkflowPluginManifest,
        artifacts,
        {
          validation: {
            url: "https://api.mistral.ai/v1/models",
            headerName: "authorization",
            headerValue: (secret) => `Bearer ${secret}`,
            fetch: dependencies.mistralValidationFetch,
          },
          speech: {
            adapter: new MistralSpeechSynthesisAdapter(
              dependencies.mistralFetch ?? fetch,
            ),
            model: {
              provider: "mistral",
              providerName: "Mistral AI",
              id: DEFAULT_MISTRAL_SPEECH_MODEL,
              revision: "voxtral-mini-tts-2603",
            },
          },
          transcription: {
            adapter: new MistralTranscriptionAdapter(
              dependencies.mistralFetch ?? fetch,
            ),
            model: {
              provider: "mistral",
              providerName: "Mistral AI",
              id: MISTRAL_TRANSCRIPTION_MODEL,
              revision: "voxtral-mini-latest/2026-08-28",
            },
          },
          ocr: {
            adapter: new MistralOcrAdapter(dependencies.mistralFetch ?? fetch),
            model: {
              provider: "mistral",
              providerName: "Mistral AI",
              id: MISTRAL_OCR_MODEL,
              revision: "mistral-ocr-latest/2026-08-28",
            },
          },
          embedding: {
            ...(dependencies.mistralEmbeddingFetch
              ? { fetch: dependencies.mistralEmbeddingFetch }
              : {}),
            model: {
              provider: "mistral",
              providerName: "Mistral AI",
              id: "mistral-embed",
              revision: "mistral-embed",
              dimensions: 1_024,
              preprocessingRevision: "avermate-corpus-text-v1",
            },
          },
          language: {
            ...(dependencies.mistralLanguageFetch
              ? { fetch: dependencies.mistralLanguageFetch }
              : {}),
            origin: "https://api.mistral.ai",
            apiVersion: "v1",
            model: {
              provider: "mistral",
              providerName: "Mistral AI",
              id: "mistral-small-latest",
              revision: "mistral-small-latest/2026-08-22",
              contextWindow: 128_000,
              maximumOutputTokens: 32_000,
              tools: true,
              inputModalities: ["text", "image", "pdf"],
            },
          },
        },
      ),
    "ai-sdk.elevenlabs": () =>
      new MediaWorkflowProviderPlugin(
        elevenLabsWorkflowPluginManifest,
        artifacts,
        {
          validation: {
            url: "https://api.elevenlabs.io/v1/user",
            headerName: "xi-api-key",
            headerValue: (secret) => secret,
            fetch: dependencies.elevenLabsValidationFetch,
          },
          speech: {
            adapter: new AiSdkElevenLabsSpeechSynthesisAdapter({
              fetch: dependencies.elevenLabsFetch ?? fetch,
            }),
            model: {
              provider: "elevenlabs",
              providerName: "ElevenLabs",
              id: "eleven_flash_v2_5",
              revision: "eleven_flash_v2_5",
            },
          },
        },
      ),
    "ai-sdk.deepgram": () =>
      new MediaWorkflowProviderPlugin(
        deepgramWorkflowPluginManifest,
        artifacts,
        {
          validation: {
            url: "https://api.deepgram.com/v1/projects",
            headerName: "authorization",
            headerValue: (secret) => `Token ${secret}`,
            fetch: dependencies.deepgramValidationFetch,
          },
          transcription: {
            adapter: new AiSdkDeepgramTranscriptionAdapter({
              fetch: dependencies.deepgramFetch ?? fetch,
            }),
            model: {
              provider: "deepgram",
              providerName: "Deepgram",
              id: "nova-3",
              revision: "nova-3/2026-08-28",
            },
          },
        },
      ),
    "avermate.cohere": () =>
      new CohereWorkflowProviderPlugin(
        dependencies.cohereFetch,
        dependencies.cohereValidationFetch,
      ),
    "ai-sdk.google": () =>
      new GoogleEmbeddingWorkflowProviderPlugin(
        artifacts,
        dependencies.googleEmbeddingFetch,
        dependencies.googleValidationFetch,
      ),
    "avermate.openai-compatible": () =>
      new OpenAICompatibleWorkflowProviderPlugin(
        dependencies.openAICompatibleEmbeddingFetch,
        dependencies.openAICompatibleValidationFetch,
      ),
    "avermate.native-document": () =>
      new NativeDocumentWorkflowProviderPlugin(artifacts),
    "ai-sdk.openai": () =>
      new MediaWorkflowProviderPlugin(openAIWorkflowPluginManifest, artifacts, {
        validation: {
          url: "https://api.openai.com/v1/models/gpt-4.1-mini",
          headerName: "authorization",
          headerValue: (secret) => `Bearer ${secret}`,
          fetch: dependencies.openAIValidationFetch,
        },
        language: {
          ...(dependencies.openAILanguageFetch
            ? { fetch: dependencies.openAILanguageFetch }
            : {}),
          origin: "https://api.openai.com",
          apiVersion: "v1",
          model: {
            provider: "openai",
            providerName: "OpenAI",
            id: "gpt-4.1-mini",
            revision: "gpt-4.1-mini/2026-08-22",
            contextWindow: 1_000_000,
            maximumOutputTokens: 32_768,
            tools: true,
            inputModalities: ["text", "image", "pdf"],
          },
        },
      }),
    "avermate.openrouter": () =>
      new MediaWorkflowProviderPlugin(
        openRouterWorkflowPluginManifest,
        artifacts,
        {
          validation: {
            url: "https://openrouter.ai/api/v1/key",
            headerName: "authorization",
            headerValue: (secret) => `Bearer ${secret}`,
            fetch: dependencies.openRouterValidationFetch,
          },
          language: {
            fetch: createPinnedOpenRouterTransport(dependencies.openRouterLanguageFetch),
            origin: "https://openrouter.ai",
            apiVersion: "api/v1",
            model: {
              provider: "openrouter",
              providerName: "OpenRouter → OpenAI",
              id: "openai/gpt-4.1-mini",
              revision: "openai/gpt-4.1-mini/2026-08-22",
              contextWindow: 1_000_000,
              maximumOutputTokens: 32_768,
              tools: true,
              inputModalities: ["text", "image", "pdf"],
            },
          },
        },
      ),
  };
}

/** Compiled factories consumed by the reviewed static plugin registry. */
export const workflowProviderPluginFactories =
  createWorkflowProviderPluginFactories();
