import type {
  CapabilityAdapter,
  CapabilityKind,
  CapabilityOfferingSnapshot,
  ProviderConnectionPublicSnapshot,
  ProviderPlugin,
  ProviderPluginManifest,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { safeModelFetchResponse } from "../../agent/model-endpoint-policy";
import type { ProviderFetcher } from "../../search/provider-transport";
import { OpenAICompatibleLanguageCapabilityAdapter } from "../adapters/language-generation";
import { capabilityOfferingIdentity } from "../offering-store";
import { languageOffering, validateRemoteApiKey } from "./plugins";

const modelId = z.string().trim().min(1).max(256);
const origin = z
  .url()
  .max(2_048)
  .refine((value) => {
    const parsed = new URL(value);
    return (
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      parsed.pathname === "/" &&
      ["https:", "http:"].includes(parsed.protocol)
    );
  }, "An origin without a path, query or credentials is required")
  .transform((value) => new URL(value).origin);

export const liteLlmConnectionConfigSchema = z.strictObject({
  origin,
  modelId,
  modelRevision: modelId,
  /** Operator declaration: this deployment maps to one upstream, not a model group. */
  singleDeploymentConfirmed: z.literal(true),
});

export const huggingFaceConnectionConfigSchema = z.strictObject({
  modelId: modelId.refine((value) => {
    const match = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+:([a-z0-9-]+)$/u.exec(
      value,
    );
    return Boolean(
      match &&
      !["auto", "fastest", "cheapest", "preferred"].includes(match[1]!),
    );
  }, "Pin an explicit provider with organization/model:provider; automatic routing is not supported"),
  modelRevision: modelId,
});

function field(
  key: string,
  label: string,
  kind: ProviderPluginManifest["configurationFields"][number]["kind"],
  help: string,
): ProviderPluginManifest["configurationFields"][number] {
  return {
    key,
    label,
    kind,
    required: true,
    options: [],
    placeholder: null,
    help,
  };
}

const revisionField = field(
  "modelRevision",
  "Pinned deployment revision",
  "text",
  "Operator/provider revision of this exact deployment. Change it whenever weights or upstream configuration change.",
);

function manifest(
  id: string,
  displayName: string,
  fields: ProviderPluginManifest["configurationFields"],
): ProviderPluginManifest {
  return {
    apiVersion: "avermate.provider-plugin/v1",
    id,
    version: "1.0.0",
    displayName,
    executionTrust: "core-reviewed",
    capabilities: ["language.generate"],
    connectionSchemaVersion: 1,
    configurationFields: fields,
    secretSlots: [
      {
        name: "apiKey",
        required: true,
        kind: "api-key",
        validation: "remote-minimal-call",
      },
    ],
  };
}

export const liteLlmPluginManifest = manifest("avermate.litellm", "LiteLLM", [
  field(
    "origin",
    "Proxy origin",
    "url",
    "HTTPS public origin in hosted Core; use a paired Node for a private-network proxy.",
  ),
  field(
    "modelId",
    "Exact deployment ID",
    "text",
    "One deployment and one upstream; no wildcard, automatic router or load-balanced model group.",
  ),
  revisionField,
  field(
    "singleDeploymentConfirmed",
    "Dedicated deployment without hidden fallback",
    "boolean",
    "I configured this proxy with one upstream, retries disabled and all fallback lists empty. Avermate cannot inspect a remote proxy's internal configuration.",
  ),
]);

export const huggingFacePluginManifest = manifest(
  "avermate.huggingface-inference",
  "Hugging Face Inference Providers",
  [
    field(
      "modelId",
      "Model and inference provider",
      "text",
      "Exact organization/model:provider, for example openai/gpt-oss-120b:groq. No automatic provider selection.",
    ),
    revisionField,
  ],
);

const HF_ORIGIN = "https://router.huggingface.co";

/** Narrow optional proxy connectors: no claims about non-chat provider endpoints. */
class ProxyLanguagePlugin implements ProviderPlugin {
  constructor(
    readonly manifest: ProviderPluginManifest,
    private readonly providerFetch?: ProviderFetcher,
    private readonly validationFetch?: ProviderFetcher,
  ) {}

  #config(value: unknown) {
    if (this.manifest.id === liteLlmPluginManifest.id) {
      return liteLlmConnectionConfigSchema.parse(value);
    }
    return {
      ...huggingFaceConnectionConfigSchema.parse(value),
      origin: HF_ORIGIN,
    };
  }

  async validateConnection(
    context: Parameters<ProviderPlugin["validateConnection"]>[0],
    value: unknown,
  ) {
    let config: { origin: string; modelId: string; modelRevision: string };
    try {
      config = this.#config(value);
    } catch {
      return {
        valid: false as const,
        error: {
          version: 1 as const,
          code: "UNSUPPORTED_INPUT" as const,
          message:
            "Pin a valid model, deployment revision and explicit upstream before connecting",
          retryable: false,
          ambiguous: false,
          providerRequestId: null,
          safeDiagnostic: null,
        },
      };
    }
    // HF's model catalogue is public: it is not a credential validation endpoint.
    const url =
      this.manifest.id === huggingFacePluginManifest.id
        ? "https://huggingface.co/api/whoami-v2"
        : `${config.origin}/v1/models`;
    return validateRemoteApiKey(
      context,
      { valid: true, safeMetadata: {} },
      {
        url,
        headerName: "authorization",
        headerValue: (secret) => `Bearer ${secret}`,
        fetch: this.validationFetch,
      },
    );
  }

  #offering(connection: ProviderConnectionPublicSnapshot) {
    if (
      connection.pluginId !== this.manifest.id ||
      connection.pluginVersion !== this.manifest.version
    ) {
      throw new Error("CAPABILITY_PLUGIN_CONNECTION_MISMATCH");
    }
    const config = this.#config(connection.config);
    if (
      connection.placement.kind === "direct-byok" &&
      connection.placement.origin !== config.origin
    ) {
      throw new Error("CAPABILITY_PLUGIN_ORIGIN_MISMATCH");
    }
    const upstream =
      this.manifest.id === huggingFacePluginManifest.id
        ? config.modelId.split(":")[1]!
        : config.modelId;
    const { id: _id, ...offering } = languageOffering({
      connection,
      manifest: this.manifest,
      provider:
        this.manifest.id === liteLlmPluginManifest.id
          ? "litellm"
          : "huggingface-inference",
      providerName: `${this.manifest.displayName} → ${upstream}`,
      modelId: config.modelId,
      modelRevision: config.modelRevision,
      contextWindow: "unknown",
      maximumOutputTokens: "unknown",
      tools: false,
      inputModalities: ["text"],
    });
    // A compatible endpoint does not prove caching, vision or tool-call support.
    offering.specification.cachedUsage = false;
    return { id: capabilityOfferingIdentity(offering), ...offering };
  }

  async discoverOfferings(
    context: Parameters<ProviderPlugin["discoverOfferings"]>[0],
    connection: ProviderConnectionPublicSnapshot,
  ) {
    context.signal.throwIfAborted();
    return [this.#offering(connection)];
  }

  async createAdapter<K extends CapabilityKind>(
    context: Parameters<ProviderPlugin["createAdapter"]>[0],
    offering: CapabilityOfferingSnapshot<K>,
  ): Promise<CapabilityAdapter<K>> {
    context.signal.throwIfAborted();
    if (
      offering.capability !== "language.generate" ||
      offering.id !== this.#offering(context.connection).id
    ) {
      throw new Error("CAPABILITY_PLUGIN_OFFERING_SNAPSHOT_MISMATCH");
    }
    const config = this.#config(context.connection.config);
    const transport: ProviderFetcher = async (raw, init) => {
      const url = new URL(raw);
      if (
        url.origin !== config.origin ||
        url.pathname !== "/v1/chat/completions" ||
        init?.method !== "POST"
      ) {
        throw new Error("CAPABILITY_PROXY_ENDPOINT_MISMATCH");
      }
      if (typeof init.body !== "string")
        throw new Error("CAPABILITY_PROXY_BODY_INVALID");
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (body.model !== config.modelId)
        throw new Error("CAPABILITY_PROXY_MODEL_MISMATCH");
      if (this.manifest.id === liteLlmPluginManifest.id) {
        // Defence in depth. Operator confirmation above is still required: a proxy
        // can override/ignore client flags, especially during a partially sent stream.
        Object.assign(body, {
          disable_fallbacks: true,
          num_retries: 0,
          max_fallbacks: 0,
          fallbacks: [],
          context_window_fallbacks: [],
          content_policy_fallbacks: [],
        });
      }
      const headers = new Headers(init.headers);
      const authorization = headers.get("authorization");
      if (!authorization)
        throw new Error("CAPABILITY_PROXY_CREDENTIAL_MISSING");
      const request = {
        ...init,
        redirect: "manual" as const,
        body: JSON.stringify(body),
      };
      if (this.providerFetch) return this.providerFetch(url, request);
      headers.delete("authorization");
      return safeModelFetchResponse(url, {
        policy: {
          placement:
            offering.placement.kind === "full-self-host"
              ? "full-self-host"
              : "hosted-core",
          allowedOrigins: [config.origin],
        },
        credential: {
          origin: config.origin,
          headerName: "authorization",
          value: authorization,
        },
        method: "POST",
        headers,
        body: request.body,
        signal: init.signal ?? undefined,
        maxRedirects: 0,
        maxResponseBytes: 16 * 1024 * 1024,
        totalTimeoutMs: 120_000,
      });
    };
    return new OpenAICompatibleLanguageCapabilityAdapter(
      offering as CapabilityOfferingSnapshot<"language.generate">,
      { origin: config.origin },
      transport,
    ) as unknown as CapabilityAdapter<K>;
  }
}

export function createProxyProviderPluginFactories(
  dependencies: {
    providerFetch?: ProviderFetcher;
    validationFetch?: ProviderFetcher;
  } = {},
): Partial<Record<string, () => ProviderPlugin>> {
  return {
    "avermate.litellm": () =>
      new ProxyLanguagePlugin(
        liteLlmPluginManifest,
        dependencies.providerFetch,
        dependencies.validationFetch,
      ),
    "avermate.huggingface-inference": () =>
      new ProxyLanguagePlugin(
        huggingFacePluginManifest,
        dependencies.providerFetch,
        dependencies.validationFetch,
      ),
  };
}

export const proxyProviderPluginFactories =
  createProxyProviderPluginFactories();
