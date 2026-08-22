import type {
  EmbedRequest,
  EmbedResult,
  ModelAccessContext,
  ModelDescriptor,
  ModelGateway,
  ModelGatewayEvent,
  ModelRequest,
  NormalizedUsage,
  TranscriptionRequest,
  TranscriptionResult,
  UsageEstimate,
} from "@avermate/agent-contracts";
import { modelDescriptorSchema } from "@avermate/agent-contracts";
import { canonicalDigest, sha256Digest } from "./canonical-json";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

const unknownUsage = (): NormalizedUsage => ({
  inputTokens: "unknown",
  outputTokens: "unknown",
  reasoningTokens: "unknown",
  cachedReadTokens: "unknown",
  cachedWriteTokens: "unknown",
});

function boundedToken(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : ("unknown" as const);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeOpenAIUsage(value: unknown): NormalizedUsage {
  const usage = record(value);
  if (!usage) return unknownUsage();
  const promptDetails = record(usage.prompt_tokens_details) ?? {};
  const completionDetails = record(usage.completion_tokens_details) ?? {};
  return {
    inputTokens: boundedToken(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: boundedToken(
      usage.completion_tokens ?? usage.output_tokens,
    ),
    reasoningTokens: boundedToken(
      completionDetails.reasoning_tokens ?? usage.reasoning_tokens,
    ),
    cachedReadTokens: boundedToken(
      promptDetails.cached_tokens ?? usage.cache_read_input_tokens,
    ),
    cachedWriteTokens: boundedToken(usage.cache_creation_input_tokens),
  };
}

function finishReason(
  value: unknown,
): Extract<ModelGatewayEvent, { type: "finish" }>["reason"] {
  switch (value) {
    case "stop":
      return "stop";
    case "tool_calls":
    case "function_call":
      return "tool-calls";
    case "length":
      return "length";
    case "content_filter":
      return "content-filter";
    default:
      return "unknown";
  }
}

function endpoint(baseUrl: string, suffix: string) {
  const base = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.hash
  ) {
    throw new Error("NODE_MODEL_ENDPOINT_INVALID");
  }
  base.hash = "";
  base.search = "";
  base.pathname = `${base.pathname.replace(/\/$/u, "")}${suffix}`;
  return base.toString();
}

function providerError(response: Response) {
  if (response.status === 401 || response.status === 403) {
    return "provider_authentication_failed";
  }
  if (response.status === 408 || response.status === 429) {
    return "provider_rate_limited";
  }
  return response.status >= 500
    ? "provider_unavailable"
    : "provider_request_rejected";
}

async function checkedJson(response: Response, maximumBytes = 16 * 1024 ** 2) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maximumBytes) throw new Error("NODE_MODEL_RESPONSE_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw new Error("NODE_MODEL_RESPONSE_TOO_LARGE");
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function* sseJson(
  response: Response,
  maximumBytes = 16 * 1024 ** 2,
) {
  if (!response.body) throw new Error("NODE_MODEL_STREAM_BODY_MISSING");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) throw new Error("NODE_MODEL_RESPONSE_TOO_LARGE");
      buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n/gu, "\n");
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!payload) continue;
        if (payload === "[DONE]") return;
        yield JSON.parse(payload) as unknown;
      }
    }
    buffer += decoder.decode();
    const payload = buffer
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (payload && payload !== "[DONE]") yield JSON.parse(payload) as unknown;
  } finally {
    reader.releaseLock();
  }
}

type CredentialResolver = (ownerId: string) => Promise<string | null>;

export type OpenAICompatibleNodeGatewayOptions = {
  baseUrl: string;
  models: readonly ModelDescriptor[];
  credential?: CredentialResolver;
  fetch?: Fetcher;
  onUsage?: (input: {
    ownerId: string;
    operationId: string;
    modelId: string;
    usage: NormalizedUsage;
    providerRequestId: string | null;
  }) => Promise<void> | void;
};

/** OpenAI-compatible Node model adapter with bounded bodies and safe errors. */
export class OpenAICompatibleNodeGateway implements ModelGateway {
  readonly #baseUrl: string;
  readonly #origin: string;
  readonly #models: ModelDescriptor[];
  readonly #credential: CredentialResolver;
  readonly #fetch: Fetcher;
  readonly #onUsage?: OpenAICompatibleNodeGatewayOptions["onUsage"];

  constructor(options: OpenAICompatibleNodeGatewayOptions) {
    this.#baseUrl = options.baseUrl;
    this.#origin = new URL(endpoint(options.baseUrl, "/v1/models")).origin;
    this.#models = options.models.map((model) =>
      modelDescriptorSchema.parse(model),
    );
    if (new Set(this.#models.map((model) => model.id)).size !== this.#models.length) {
      throw new Error("NODE_MODEL_CATALOGUE_DUPLICATE");
    }
    this.#credential = options.credential ?? (async () => null);
    this.#fetch = options.fetch ?? fetch;
    this.#onUsage = options.onUsage;
  }

  async listModels(context: ModelAccessContext) {
    if (
      context.allowedOrigins.length > 0 &&
      !context.allowedOrigins.some((origin) => new URL(origin).origin === this.#origin)
    ) {
      throw new Error("NODE_MODEL_ORIGIN_NOT_ALLOWED");
    }
    return structuredClone(this.#models);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelGatewayEvent> {
    const model = this.#model(request.modelId, "text");
    const openTools = new Map<number, string>();
    let observedUsage: NormalizedUsage | null = null;
    let finished = false;
    try {
      const response = await this.#request(
        request.ownerId,
        "/v1/chat/completions",
        {
          model: model.id,
          stream: true,
          stream_options: { include_usage: true },
          ...(request.maximumOutputTokens
            ? { max_tokens: request.maximumOutputTokens }
            : {}),
          messages: request.messages.map((block) => ({
            role: block.trust === "system-policy" ? "system" : "user",
            content:
              block.trust === "system-policy"
                ? block.content
                : `[trust=${block.trust}]\n${block.content}`,
          })),
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        },
        request.runId,
        request.abortSignal,
      );
      if (!response.ok) {
        yield {
          type: "error",
          code: providerError(response),
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        };
        return;
      }
      const providerRequestId = response.headers.get("x-request-id");
      for await (const raw of sseJson(response)) {
        const chunk = record(raw);
        if (!chunk) continue;
        const chunkUsage =
          chunk.usage === undefined
            ? null
            : normalizeOpenAIUsage(chunk.usage);
        const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
        const choice = record(choices[0]);
        if (!choice) {
          if (chunkUsage) {
            observedUsage = chunkUsage;
            yield { type: "usage", usage: observedUsage };
          }
          continue;
        }
        const delta = record(choice.delta);
        if (typeof delta?.content === "string" && delta.content) {
          yield { type: "content-delta", delta: delta.content };
        }
        const toolCalls = Array.isArray(delta?.tool_calls)
          ? delta.tool_calls
          : [];
        for (const candidate of toolCalls) {
          const toolCall = record(candidate);
          if (!toolCall || !Number.isSafeInteger(toolCall.index)) continue;
          const index = toolCall.index as number;
          const details = record(toolCall.function);
          const providedId =
            typeof toolCall.id === "string" ? toolCall.id : undefined;
          const previousId = openTools.get(index);
          const callId = providedId ?? previousId;
          if (!previousId && callId && typeof details?.name === "string") {
            openTools.set(index, callId);
            yield {
              type: "tool-call-start",
              callId,
              toolName: details.name,
            };
          }
          if (callId && typeof details?.arguments === "string") {
            yield {
              type: "tool-arguments-delta",
              callId,
              delta: details.arguments,
            };
          }
        }
        if (chunkUsage) {
          observedUsage = chunkUsage;
          yield { type: "usage", usage: observedUsage };
        }
        if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
          for (const callId of openTools.values()) {
            yield { type: "tool-call-end", callId };
          }
          openTools.clear();
          if (!observedUsage) {
            observedUsage = unknownUsage();
            yield { type: "usage", usage: observedUsage };
          }
          await this.#onUsage?.({
            ownerId: request.ownerId,
            operationId: request.runId,
            modelId: request.modelId,
            usage: observedUsage,
            providerRequestId,
          });
          finished = true;
          yield { type: "finish", reason: finishReason(choice.finish_reason) };
          return;
        }
      }
      if (!finished) {
        yield {
          type: "error",
          code: "provider_stream_incomplete",
          retryable: true,
        };
      }
    } catch {
      yield {
        type: "error",
        code: request.abortSignal?.aborted
          ? "cancelled"
          : "provider_stream_error",
        retryable: true,
      };
    }
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    this.#model(request.modelId, "embedding");
    if (request.inputs.length > 256) throw new Error("NODE_EMBED_BATCH_TOO_LARGE");
    const response = await this.#request(
      request.ownerId,
      "/v1/embeddings",
      { model: request.modelId, input: request.inputs, encoding_format: "float" },
      request.operationId ?? `embed_${crypto.randomUUID()}`,
      request.abortSignal,
    );
    if (!response.ok) throw new Error(providerError(response));
    const body = record(await checkedJson(response));
    const data = Array.isArray(body?.data) ? body.data : [];
    if (data.length !== request.inputs.length) {
      throw new Error("NODE_EMBED_RESULT_COUNT_MISMATCH");
    }
    const byIndex = new Map<number, number[]>();
    let dimensions: number | null = null;
    for (const candidate of data) {
      const item = record(candidate);
      if (!item || !Number.isSafeInteger(item.index) || !Array.isArray(item.embedding)) {
        throw new Error("NODE_EMBED_RESULT_MALFORMED");
      }
      const vector = item.embedding.map(Number);
      if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
        throw new Error("NODE_EMBED_RESULT_MALFORMED");
      }
      dimensions ??= vector.length;
      if (dimensions !== vector.length) {
        throw new Error("NODE_EMBED_DIMENSION_MISMATCH");
      }
      byIndex.set(item.index as number, vector);
    }
    const vectors = request.inputs.map((_, index) => {
      const vector = byIndex.get(index);
      if (!vector) throw new Error("NODE_EMBED_RESULT_INDEX_MISMATCH");
      return vector;
    });
    const usage = normalizeOpenAIUsage(body?.usage);
    await this.#onUsage?.({
      ownerId: request.ownerId,
      operationId: request.operationId ?? "embedding-unreserved",
      modelId: request.modelId,
      usage,
      providerRequestId: response.headers.get("x-request-id"),
    });
    return { vectors, usage };
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    this.#model(request.modelId, "audio");
    if (request.media.size > 256 * 1024 ** 2) {
      throw new Error("NODE_TRANSCRIPTION_INPUT_TOO_LARGE");
    }
    const credential = await this.#credential(request.ownerId);
    const headers = new Headers({
      "x-request-id": request.operationId ?? `transcribe_${crypto.randomUUID()}`,
    });
    if (credential) headers.set("authorization", `Bearer ${credential}`);
    const form = new FormData();
    form.set("model", request.modelId);
    form.set("file", request.media, "input");
    form.set("response_format", "verbose_json");
    if (request.language) form.set("language", request.language);
    const response = await this.#fetch(endpoint(this.#baseUrl, "/v1/audio/transcriptions"), {
      method: "POST",
      headers,
      body: form,
      signal: request.abortSignal,
      redirect: "error",
    });
    if (!response.ok) throw new Error(providerError(response));
    const body = record(await checkedJson(response));
    if (!body || typeof body.text !== "string") {
      throw new Error("NODE_TRANSCRIPTION_RESULT_MALFORMED");
    }
    const usage = normalizeOpenAIUsage(body.usage);
    await this.#onUsage?.({
      ownerId: request.ownerId,
      operationId: request.operationId ?? "transcription-unreserved",
      modelId: request.modelId,
      usage,
      providerRequestId: response.headers.get("x-request-id"),
    });
    return {
      text: body.text,
      language: typeof body.language === "string" ? body.language : "unknown",
      durationSeconds:
        typeof body.duration === "number" && body.duration >= 0
          ? body.duration
          : "unknown",
      usage,
    };
  }

  async estimate(request: ModelRequest): Promise<UsageEstimate> {
    this.#model(request.modelId, "text");
    const characters = request.messages.reduce(
      (sum, block) => sum + block.content.length,
      0,
    );
    return {
      usage: {
        ...unknownUsage(),
        inputTokens: Math.ceil(characters / 4),
      },
      estimatedCostMinor: "unknown",
      currency: "unknown",
    };
  }

  #model(modelId: string, modality: ModelDescriptor["modalities"][number]) {
    const model = this.#models.find((candidate) => candidate.id === modelId);
    if (!model || !model.modalities.includes(modality)) {
      throw new Error("NODE_MODEL_NOT_CONFIGURED");
    }
    return model;
  }

  async #request(
    ownerId: string,
    suffix: string,
    body: unknown,
    operationId: string,
    signal?: AbortSignal,
  ) {
    const headers = new Headers({
      "content-type": "application/json",
      "x-request-id": operationId,
    });
    const credential = await this.#credential(ownerId);
    if (credential) headers.set("authorization", `Bearer ${credential}`);
    return this.#fetch(endpoint(this.#baseUrl, suffix), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
      redirect: "error",
    });
  }
}

type VirtualKey = { key: string; expiresAt: number };

export type LiteLLMFallbackChain = {
  modelId: string;
  fallbackModelIds: readonly string[];
};

export class LiteLLMVirtualKeyIssuer {
  readonly #baseUrl: string;
  readonly #adminKey: () => Promise<string>;
  readonly #models: string[];
  readonly #ttlSeconds: number;
  readonly #maximumBudgetMinor: number;
  readonly #requestsPerMinute: number;
  readonly #tokensPerMinute: number;
  readonly #fallbackPolicyDigest: `sha256:${string}`;
  readonly #fetch: Fetcher;
  readonly #cache = new Map<string, VirtualKey>();
  readonly #inflight = new Map<string, Promise<VirtualKey>>();

  constructor(input: {
    baseUrl: string;
    adminKey: () => Promise<string>;
    models: readonly string[];
    ttlSeconds: number;
    maximumBudgetMinor: number;
    requestsPerMinute: number;
    tokensPerMinute: number;
    fallbackChains: readonly LiteLLMFallbackChain[];
    fetch?: Fetcher;
  }) {
    if (input.maximumBudgetMinor < 1) {
      throw new Error("LITELLM_OWNER_BUDGET_REQUIRED");
    }
    if (
      !Number.isSafeInteger(input.requestsPerMinute) ||
      input.requestsPerMinute < 1 ||
      !Number.isSafeInteger(input.tokensPerMinute) ||
      input.tokensPerMinute < 1
    ) {
      throw new Error("LITELLM_OWNER_RATE_LIMIT_REQUIRED");
    }
    const models = new Set(input.models);
    const fallbackSources = new Set<string>();
    for (const chain of input.fallbackChains) {
      if (
        fallbackSources.has(chain.modelId) ||
        !models.has(chain.modelId) ||
        chain.fallbackModelIds.length === 0 ||
        new Set(chain.fallbackModelIds).size !== chain.fallbackModelIds.length ||
        chain.fallbackModelIds.some(
          (modelId) => modelId === chain.modelId || !models.has(modelId),
        )
      ) {
        throw new Error("LITELLM_FALLBACK_POLICY_INVALID");
      }
      fallbackSources.add(chain.modelId);
    }
    const graph = new Map(
      input.fallbackChains.map((chain) => [
        chain.modelId,
        chain.fallbackModelIds,
      ]),
    );
    const visit = (
      modelId: string,
      visiting: Set<string>,
      visited: Set<string>,
    ): boolean => {
      if (visiting.has(modelId)) return false;
      if (visited.has(modelId)) return true;
      visiting.add(modelId);
      for (const fallback of graph.get(modelId) ?? []) {
        if (!visit(fallback, visiting, visited)) return false;
      }
      visiting.delete(modelId);
      visited.add(modelId);
      return true;
    };
    const visited = new Set<string>();
    if (
      [...graph.keys()].some(
        (modelId) => !visit(modelId, new Set(), visited),
      )
    ) {
      throw new Error("LITELLM_FALLBACK_POLICY_INVALID");
    }
    this.#baseUrl = input.baseUrl;
    this.#adminKey = input.adminKey;
    this.#models = [...input.models];
    this.#ttlSeconds = input.ttlSeconds;
    this.#maximumBudgetMinor = input.maximumBudgetMinor;
    this.#requestsPerMinute = input.requestsPerMinute;
    this.#tokensPerMinute = input.tokensPerMinute;
    this.#fallbackPolicyDigest = canonicalDigest(
      input.fallbackChains.map((chain) => ({
        modelId: chain.modelId,
        fallbackModelIds: [...chain.fallbackModelIds],
      })),
    );
    this.#fetch = input.fetch ?? fetch;
  }

  async keyForOwner(ownerId: string, now = Date.now()) {
    const cached = this.#cache.get(ownerId);
    if (cached && cached.expiresAt - now > 30_000) return cached.key;
    const pending = this.#inflight.get(ownerId) ?? this.#issue(ownerId, now);
    this.#inflight.set(ownerId, pending);
    try {
      const key = await pending;
      this.#cache.set(ownerId, key);
      return key.key;
    } finally {
      this.#inflight.delete(ownerId);
    }
  }

  revokeOwner(ownerId: string) {
    this.#cache.delete(ownerId);
  }

  async #issue(ownerId: string, now: number) {
    const adminKey = await this.#adminKey();
    const ownerHash = sha256Digest(ownerId).slice("sha256:".length);
    const response = await this.#fetch(endpoint(this.#baseUrl, "/key/generate"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        models: this.#models,
        user_id: `avermate-${ownerHash}`,
        duration: `${this.#ttlSeconds}s`,
        max_budget: this.#maximumBudgetMinor / 100,
        rpm_limit: this.#requestsPerMinute,
        tpm_limit: this.#tokensPerMinute,
        metadata: {
          avermate_owner_hash: ownerHash,
          avermate_fallback_policy_digest: this.#fallbackPolicyDigest,
        },
        allowed_routes: [
          "/chat/completions",
          "/v1/chat/completions",
          "/embeddings",
          "/v1/embeddings",
          "/audio/transcriptions",
          "/v1/audio/transcriptions",
        ],
      }),
      redirect: "error",
    });
    if (!response.ok) throw new Error(providerError(response));
    const body = record(await checkedJson(response, 256 * 1024));
    const key = typeof body?.key === "string" ? body.key : null;
    const providerExpiry =
      typeof body?.expires === "string" ? Date.parse(body.expires) : Number.NaN;
    const maximumExpiry = now + this.#ttlSeconds * 1_000 + 30_000;
    if (
      !key ||
      key.length < 16 ||
      key.length > 8_192 ||
      !Number.isFinite(providerExpiry) ||
      providerExpiry <= now ||
      providerExpiry > maximumExpiry
    ) {
      throw new Error("LITELLM_VIRTUAL_KEY_RESPONSE_INVALID");
    }
    return { key, expiresAt: providerExpiry };
  }
}

export type LiteLLMNodeGatewayOptions = Omit<
  OpenAICompatibleNodeGatewayOptions,
  "credential"
> & {
  adminKey: () => Promise<string>;
  virtualKeyTtlSeconds: number;
  ownerBudgetMinor: number;
  ownerRequestsPerMinute: number;
  ownerTokensPerMinute: number;
  fallbackChains: readonly LiteLLMFallbackChain[];
};

/** Explicit LiteLLM profile; direct/BYOK gateways do not depend on it. */
export class LiteLLMNodeGateway extends OpenAICompatibleNodeGateway {
  readonly virtualKeys: LiteLLMVirtualKeyIssuer;

  constructor(options: LiteLLMNodeGatewayOptions) {
    const virtualKeys = new LiteLLMVirtualKeyIssuer({
      baseUrl: options.baseUrl,
      adminKey: options.adminKey,
      models: options.models.map((model) => model.id),
      ttlSeconds: options.virtualKeyTtlSeconds,
      maximumBudgetMinor: options.ownerBudgetMinor,
      requestsPerMinute: options.ownerRequestsPerMinute,
      tokensPerMinute: options.ownerTokensPerMinute,
      fallbackChains: options.fallbackChains,
      fetch: options.fetch,
    });
    super({
      ...options,
      credential: (ownerId) => virtualKeys.keyForOwner(ownerId),
    });
    this.virtualKeys = virtualKeys;
  }
}
