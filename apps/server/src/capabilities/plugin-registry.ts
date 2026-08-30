import { createHash } from "node:crypto";
import {
  canonicalCapabilityJson,
  providerPluginManifestSchema,
  type CapabilityKind,
  type ProviderPlugin,
  type ProviderPluginManifest,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { validateModelEndpoint } from "../agent/model-endpoint-policy";
import { workflowProviderPluginFactories } from "./providers/plugins";
import { createCoreNodeProviderPlugin } from "./providers/node";
import {
  huggingFaceConnectionConfigSchema,
  huggingFacePluginManifest,
  liteLlmConnectionConfigSchema,
  liteLlmPluginManifest,
  proxyProviderPluginFactories,
} from "./providers/proxy-plugins";

type ConnectionConfigSchema = z.ZodType<Record<string, unknown>>;

export type ProviderPluginFactory = {
  /** Core accepts only factories compiled into the reviewed server bundle. */
  source: "compiled";
  manifest: ProviderPluginManifest;
  connectionConfigSchema: ConnectionConfigSchema;
  instantiate?: () => ProviderPlugin;
};

export type CapabilityOriginValidator = (input: {
  origin: string;
  placement: "hosted-core" | "node" | "full-self-host";
}) => Promise<void>;

export class ProviderPluginRegistry {
  readonly #factories = new Map<string, ProviderPluginFactory>();

  register(factory: ProviderPluginFactory): void {
    if (factory.source !== "compiled") {
      throw new Error("Core provider plugins must be compiled and reviewed");
    }
    const manifest = providerPluginManifestSchema.parse(factory.manifest);
    if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
      throw new Error(`Provider plugin ${manifest.id} repeats a capability`);
    }
    const slots = manifest.secretSlots.map((slot) => slot.name);
    if (new Set(slots).size !== slots.length) {
      throw new Error(`Provider plugin ${manifest.id} repeats a secret slot`);
    }
    if (this.#factories.has(manifest.id)) {
      throw new Error(`Provider plugin ${manifest.id} is already registered`);
    }
    this.#factories.set(
      manifest.id,
      Object.freeze({ ...factory, manifest: Object.freeze(manifest) }),
    );
  }

  get(pluginId: string): ProviderPluginFactory | null {
    return this.#factories.get(pluginId) ?? null;
  }

  require(pluginId: string): ProviderPluginFactory {
    const factory = this.get(pluginId);
    if (!factory) throw new Error(`Unknown provider plugin: ${pluginId}`);
    return factory;
  }

  list(): readonly ProviderPluginFactory[] {
    return [...this.#factories.values()].sort((left, right) =>
      left.manifest.id.localeCompare(right.manifest.id),
    );
  }

  catalogueDigest(): `sha256:${string}` {
    const canonical = canonicalCapabilityJson(
      this.list().map(({ manifest }) => manifest),
    );
    return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
  }

  parseConnectionConfig(
    pluginId: string,
    config: unknown,
  ): Record<string, unknown> {
    return this.require(pluginId).connectionConfigSchema.parse(config);
  }

  async validateConnectionConfig(input: {
    pluginId: string;
    config: unknown;
    placement: "hosted-core" | "node" | "full-self-host";
    placementOrigin?: string;
    validateOrigin?: CapabilityOriginValidator;
  }): Promise<Record<string, unknown>> {
    const config = this.parseConnectionConfig(input.pluginId, input.config);
    const validateOrigin =
      input.validateOrigin ?? defaultCapabilityOriginValidator;
    if (typeof config.origin === "string") {
      await validateOrigin({
        origin: config.origin,
        placement: input.placement,
      });
    }
    if (input.placementOrigin) {
      const placementOrigin = new URL(input.placementOrigin).origin;
      await validateOrigin({
        origin: placementOrigin,
        placement: input.placement,
      });
      if (
        typeof config.origin === "string" &&
        new URL(config.origin).origin !== placementOrigin
      ) {
        throw new Error(
          `Provider plugin ${input.pluginId} configuration origin does not match its direct placement`,
        );
      }
      const canonicalOrigin = canonicalProviderOrigins[input.pluginId];
      if (canonicalOrigin && placementOrigin !== canonicalOrigin) {
        throw new Error(
          `Provider plugin ${input.pluginId} is bound to ${canonicalOrigin}`,
        );
      }
    }
    return config;
  }
}

export async function defaultCapabilityOriginValidator(input: {
  origin: string;
  placement: "hosted-core" | "node" | "full-self-host";
}) {
  const origin = new URL(input.origin).origin;
  await validateModelEndpoint(origin, {
    placement: input.placement,
    allowedOrigins: [origin],
  });
}

const optionalRegionConfigSchema = z.strictObject({
  region: z.string().trim().min(1).max(128).optional(),
  projectId: z.string().trim().min(1).max(256).optional(),
});

const fixedEndpointConfigSchema = z.strictObject({
  region: z.string().trim().min(1).max(128).optional(),
});

const openAiCompatibleEndpointConfigSchema = z.strictObject({
  origin: z
    .url()
    .max(2_048)
    .transform((value) => new URL(value).origin),
  apiVersion: z.string().trim().min(1).max(64).optional(),
  organization: z.string().trim().min(1).max(256).optional(),
  modelId: z.string().trim().min(1).max(256),
  dimensions: z.number().int().positive().max(65_536).optional(),
  modelRevision: z.string().trim().min(1).max(256).optional(),
  preprocessingRevision: z.string().trim().min(1).max(256).optional(),
});

const emptyConnectionConfigSchema = z.strictObject({});

/** Exact reviewed origins for plugins whose transport endpoint is not configurable. */
export const canonicalProviderOrigins: Readonly<Record<string, string>> =
  Object.freeze({
    "avermate.mistral": "https://api.mistral.ai",
    "ai-sdk.google": "https://generativelanguage.googleapis.com",
    "avermate.cohere": "https://api.cohere.com",
    "ai-sdk.openai": "https://api.openai.com",
    "avermate.openrouter": "https://openrouter.ai",
    "ai-sdk.deepgram": "https://api.deepgram.com",
    "ai-sdk.elevenlabs": "https://api.elevenlabs.io",
    "avermate.huggingface-inference": "https://router.huggingface.co",
  });

const nodeConnectionConfigSchema = z.strictObject({
  nodeId: z.string().trim().min(1).max(256),
  configRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});

const apiKeySlot = Object.freeze({
  name: "apiKey",
  required: true,
  kind: "api-key" as const,
  validation: "remote-minimal-call" as const,
});

function manifest(input: {
  id: string;
  displayName: string;
  capabilities: CapabilityKind[];
  trust?: ProviderPluginManifest["executionTrust"];
  secretSlots?: ProviderPluginManifest["secretSlots"];
  configurationFields?: ProviderPluginManifest["configurationFields"];
}): ProviderPluginManifest {
  return {
    apiVersion: "avermate.provider-plugin/v1",
    id: input.id,
    version: "1.0.0",
    displayName: input.displayName,
    executionTrust: input.trust ?? "core-reviewed",
    capabilities: input.capabilities,
    connectionSchemaVersion: 1,
    configurationFields: input.configurationFields ?? [],
    secretSlots: input.secretSlots ?? [apiKeySlot],
  };
}

const regionFields: ProviderPluginManifest["configurationFields"] = [
  {
    key: "region",
    label: "Region",
    kind: "text",
    required: false,
    options: [],
    placeholder: null,
    help: "Optional provider region used for discovery and data-boundary display.",
  },
];

const googleFields: ProviderPluginManifest["configurationFields"] = [
  ...regionFields,
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

const compatibleFields: ProviderPluginManifest["configurationFields"] = [
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
];

const openAiCompatibleFields: ProviderPluginManifest["configurationFields"] = [
  ...compatibleFields,
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

const nodeFields: ProviderPluginManifest["configurationFields"] = [
  {
    key: "nodeId",
    label: "Avermate Node",
    kind: "select",
    required: true,
    options: [],
    placeholder: null,
    help: "Paired Node that advertises the capability offerings.",
  },
  {
    key: "configRevision",
    label: "Configuration revision",
    kind: "text",
    required: true,
    options: [],
    placeholder: "sha256:…",
    help: "Signed Node configuration revision fence.",
  },
];

const reviewedFactories: readonly ProviderPluginFactory[] = [
  {
    source: "compiled",
    manifest: manifest({
      id: "avermate.mistral",
      displayName: "Mistral AI",
      capabilities: [
        "language.generate",
        "embedding.generate",
        "speech.transcribe",
        "speech.synthesize",
        "document.ocr",
      ],
      configurationFields: regionFields,
    }),
    connectionConfigSchema: fixedEndpointConfigSchema,
  },
  {
    source: "compiled",
    manifest: manifest({
      id: "ai-sdk.google",
      displayName: "Google Gemini",
      capabilities: ["embedding.generate"],
      configurationFields: googleFields,
    }),
    connectionConfigSchema: optionalRegionConfigSchema,
  },
  {
    source: "compiled",
    manifest: manifest({
      id: "avermate.cohere",
      displayName: "Cohere",
      capabilities: ["rerank.score"],
      configurationFields: regionFields,
    }),
    connectionConfigSchema: fixedEndpointConfigSchema,
  },
  {
    source: "compiled",
    manifest: manifest({
      id: "avermate.openai-compatible",
      displayName: "OpenAI-compatible endpoint",
      capabilities: ["language.generate", "embedding.generate"],
      configurationFields: openAiCompatibleFields,
    }),
    connectionConfigSchema: openAiCompatibleEndpointConfigSchema,
  },
  {
    source: "compiled",
    manifest: manifest({
      id: "avermate.native-document",
      displayName: "Avermate native document extraction",
      capabilities: ["document.extract"],
      secretSlots: [],
      configurationFields: [],
    }),
    connectionConfigSchema: emptyConnectionConfigSchema,
  },
  {
    source: "compiled",
    manifest: manifest({
      id: "ai-sdk.openai",
      displayName: "OpenAI",
      capabilities: ["language.generate"],
      configurationFields: regionFields,
    }),
    connectionConfigSchema: fixedEndpointConfigSchema,
  },
  {
    source: "compiled",
    manifest: manifest({
      id: "avermate.openrouter",
      displayName: "OpenRouter",
      capabilities: ["language.generate"],
      configurationFields: regionFields,
    }),
    connectionConfigSchema: fixedEndpointConfigSchema,
  },
  {
    source: "compiled",
    manifest: manifest({
      id: "ai-sdk.deepgram",
      displayName: "Deepgram",
      capabilities: ["speech.transcribe"],
      configurationFields: regionFields,
    }),
    connectionConfigSchema: fixedEndpointConfigSchema,
  },
  {
    source: "compiled",
    manifest: manifest({
      id: "ai-sdk.elevenlabs",
      displayName: "ElevenLabs",
      capabilities: ["speech.synthesize"],
      configurationFields: regionFields,
    }),
    connectionConfigSchema: fixedEndpointConfigSchema,
  },
  {
    source: "compiled",
    manifest: liteLlmPluginManifest,
    connectionConfigSchema: liteLlmConnectionConfigSchema,
  },
  {
    source: "compiled",
    manifest: huggingFacePluginManifest,
    connectionConfigSchema: huggingFaceConnectionConfigSchema,
  },
  {
    source: "compiled",
    manifest: manifest({
      id: "avermate.node",
      displayName: "Avermate Node",
      capabilities: [
        "language.generate",
        "embedding.generate",
        "rerank.score",
        "speech.transcribe",
        "speech.synthesize",
        "document.ocr",
        "document.extract",
        "image.generate",
        "video.generate",
      ],
      trust: "node-reviewed",
      secretSlots: [],
      configurationFields: nodeFields,
    }),
    connectionConfigSchema: nodeConnectionConfigSchema,
  },
] as const;

export function createStaticProviderPluginRegistry() {
  const registry = new ProviderPluginRegistry();
  for (const factory of reviewedFactories) {
    const instantiate =
      factory.manifest.id === "avermate.node"
        ? () => createCoreNodeProviderPlugin(factory.manifest)
        : (workflowProviderPluginFactories[factory.manifest.id] ??
          proxyProviderPluginFactories[factory.manifest.id]);
    registry.register({
      ...factory,
      ...(instantiate ? { instantiate } : {}),
    });
  }
  return registry;
}

export const staticProviderPluginRegistry =
  createStaticProviderPluginRegistry();
