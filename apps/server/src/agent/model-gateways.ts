import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { dynamicTool, jsonSchema, streamText, type LanguageModel } from "ai";
import {
  modelDescriptorSchema,
  type EmbedRequest,
  type EmbedResult,
  type ModelAccessContext,
  type ModelDescriptor,
  type ModelGateway,
  type ModelGatewayEvent,
  type ModelRequest,
  type NormalizedUsage,
  type TranscriptionRequest,
  type TranscriptionResult,
  type UsageEstimate,
} from "@avermate/agent-contracts";
import {
  safeModelFetchResponse,
  type BoundModelCredential,
  type ModelEndpointPolicy,
  type ModelTransport,
} from "./model-endpoint-policy";
import {
  ContextMediaError,
  prepareModelPrompt,
  type ContextAssetResolver,
  type ContextMediaBudgets,
  type PreparedModelPrompt,
} from "./multimodal-context";

type UnknownRecord = Record<string, unknown>;
type AiSdkStreamFactory = (
  request: ModelRequest,
  model: LanguageModel,
  prompt: PreparedModelPrompt,
) => AsyncIterable<unknown>;

export class UnsupportedGatewayCapabilityError extends Error {
  constructor(capability: string) {
    super(`The selected model gateway does not implement ${capability}`);
    this.name = "UnsupportedGatewayCapabilityError";
  }
}

const unknownUsage: NormalizedUsage = {
  inputTokens: "unknown",
  outputTokens: "unknown",
  reasoningTokens: "unknown",
  cachedReadTokens: "unknown",
  cachedWriteTokens: "unknown",
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: UnknownRecord, name: string): string | null {
  return typeof value[name] === "string" ? value[name] : null;
}

function numericOrUnknown(value: unknown): number | "unknown" {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : "unknown";
}

export function normalizeAiSdkUsage(value: unknown): NormalizedUsage {
  if (!isRecord(value)) return { ...unknownUsage };
  const inputDetails = isRecord(value.inputTokenDetails)
    ? value.inputTokenDetails
    : {};
  const outputDetails = isRecord(value.outputTokenDetails)
    ? value.outputTokenDetails
    : {};
  return {
    inputTokens: numericOrUnknown(value.inputTokens),
    outputTokens: numericOrUnknown(value.outputTokens),
    reasoningTokens: numericOrUnknown(outputDetails.reasoningTokens),
    cachedReadTokens: numericOrUnknown(inputDetails.cacheReadTokens),
    cachedWriteTokens: numericOrUnknown(inputDetails.cacheWriteTokens),
  };
}

function normalizeFinishReason(
  value: unknown,
): Extract<ModelGatewayEvent, { type: "finish" }>["reason"] {
  switch (value) {
    case "stop":
    case "tool-calls":
    case "length":
    case "content-filter":
      return value;
    default:
      return "unknown";
  }
}

export async function* normalizeAiSdkStream(
  stream: AsyncIterable<unknown>,
  options: { reasoningSummaryAuthorized: boolean },
): AsyncIterable<ModelGatewayEvent> {
  const reasoning = new Map<string, string>();
  const opaqueReasoning = new Set<string>();

  for await (const rawPart of stream) {
    if (!isRecord(rawPart) || typeof rawPart.type !== "string") continue;
    switch (rawPart.type) {
      case "text-delta": {
        const delta =
          stringField(rawPart, "text") ?? stringField(rawPart, "delta");
        if (delta) yield { type: "content-delta", delta };
        break;
      }
      case "tool-input-start": {
        const callId = stringField(rawPart, "id");
        const toolName = stringField(rawPart, "toolName");
        if (callId && toolName) {
          yield { type: "tool-call-start", callId, toolName };
        }
        break;
      }
      case "tool-input-delta": {
        const callId = stringField(rawPart, "id");
        const delta = stringField(rawPart, "delta");
        if (callId && delta !== null) {
          yield { type: "tool-arguments-delta", callId, delta };
        }
        break;
      }
      case "tool-input-end": {
        const callId = stringField(rawPart, "id");
        if (callId) yield { type: "tool-call-end", callId };
        break;
      }
      case "reasoning-start": {
        const id = stringField(rawPart, "id");
        if (!id) break;
        if (options.reasoningSummaryAuthorized) reasoning.set(id, "");
        else if (!opaqueReasoning.has(id)) {
          opaqueReasoning.add(id);
          yield {
            type: "opaque-reasoning-state",
            continuationRef: `provider:${id}`,
          };
        }
        break;
      }
      case "reasoning-delta": {
        const id = stringField(rawPart, "id");
        const text =
          stringField(rawPart, "text") ?? stringField(rawPart, "delta");
        if (id && text && options.reasoningSummaryAuthorized) {
          reasoning.set(id, `${reasoning.get(id) ?? ""}${text}`);
        }
        break;
      }
      case "reasoning-end": {
        const id = stringField(rawPart, "id");
        const summary = id ? reasoning.get(id) : undefined;
        if (id) reasoning.delete(id);
        if (summary) {
          yield {
            type: "reasoning-summary",
            summary,
            providerAuthorized: true,
          };
        }
        break;
      }
      case "finish": {
        const usage = normalizeAiSdkUsage(rawPart.totalUsage ?? rawPart.usage);
        yield { type: "usage", usage };
        yield {
          type: "finish",
          reason: normalizeFinishReason(rawPart.finishReason),
        };
        break;
      }
      case "abort":
        yield { type: "error", code: "cancelled", retryable: true };
        break;
      case "error":
        yield { type: "error", code: "provider_stream_error", retryable: true };
        break;
    }
  }
}

function defaultStreamFactory(
  request: ModelRequest,
  model: LanguageModel,
  prompt: PreparedModelPrompt,
): AsyncIterable<unknown> {
  const tools = Object.fromEntries(
    request.tools.map((tool) => [
      tool.name,
      dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema(tool.inputSchema as never),
      }),
    ]),
  );
  return streamText({
    model,
    ...(prompt.system ? { system: prompt.system } : {}),
    messages: prompt.messages,
    tools,
    ...(request.maximumOutputTokens
      ? { maxOutputTokens: request.maximumOutputTokens }
      : {}),
    abortSignal: request.abortSignal,
    telemetry: { isEnabled: false },
    onError: () => undefined,
  }).fullStream;
}

export type AiSdkDirectGatewayOptions = {
  models: readonly ModelDescriptor[];
  resolveModel: (modelId: string) => LanguageModel;
  streamFactory?: AiSdkStreamFactory;
  embed?: (request: EmbedRequest) => Promise<EmbedResult>;
  transcribe?: (request: TranscriptionRequest) => Promise<TranscriptionResult>;
  estimate?: (request: ModelRequest) => Promise<UsageEstimate>;
  /** Server/Node-local resolver; opaque handles are never sent to providers. */
  contextAssetResolver?: ContextAssetResolver;
  contextMediaBudgets?: Partial<ContextMediaBudgets>;
  /** Observability/citation hook after immutable verification, before dispatch. */
  onContextPrepared?: (
    request: ModelRequest,
    prompt: PreparedModelPrompt,
  ) => void | Promise<void>;
};

export class AiSdkDirectGateway implements ModelGateway {
  readonly #models: ModelDescriptor[];
  readonly #resolveModel: (modelId: string) => LanguageModel;
  readonly #streamFactory: AiSdkStreamFactory;
  readonly #embed?: AiSdkDirectGatewayOptions["embed"];
  readonly #transcribe?: AiSdkDirectGatewayOptions["transcribe"];
  readonly #estimate?: AiSdkDirectGatewayOptions["estimate"];
  readonly #contextAssetResolver?: ContextAssetResolver;
  readonly #contextMediaBudgets?: Partial<ContextMediaBudgets>;
  readonly #onContextPrepared?: AiSdkDirectGatewayOptions["onContextPrepared"];

  constructor(options: AiSdkDirectGatewayOptions) {
    this.#models = options.models.map((model) =>
      modelDescriptorSchema.parse(model),
    );
    this.#resolveModel = options.resolveModel;
    this.#streamFactory = options.streamFactory ?? defaultStreamFactory;
    this.#embed = options.embed;
    this.#transcribe = options.transcribe;
    this.#estimate = options.estimate;
    this.#contextAssetResolver = options.contextAssetResolver;
    this.#contextMediaBudgets = options.contextMediaBudgets;
    this.#onContextPrepared = options.onContextPrepared;
  }

  async listModels(_context: ModelAccessContext): Promise<ModelDescriptor[]> {
    return this.#models.map((model) => ({
      ...model,
      modalities: [...model.modalities],
      capabilities: { ...model.capabilities },
    }));
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelGatewayEvent> {
    const descriptor = this.#models.find(
      (model) => model.id === request.modelId,
    );
    if (!descriptor) throw new Error("Unknown model ID");
    try {
      const prompt = await prepareModelPrompt({
        request,
        descriptor,
        assetResolver: this.#contextAssetResolver,
        mediaBudgets: this.#contextMediaBudgets,
      });
      await this.#onContextPrepared?.(request, prompt);
      yield* normalizeAiSdkStream(
        this.#streamFactory(
          request,
          this.#resolveModel(request.modelId),
          prompt,
        ),
        {
          reasoningSummaryAuthorized: descriptor.capabilities.reasoningSummary,
        },
      );
    } catch (error) {
      yield {
        type: "error",
        code:
          request.abortSignal?.aborted
            ? "cancelled"
            : error instanceof ContextMediaError
              ? error.code.toLowerCase()
              : "provider_stream_error",
        retryable:
          request.abortSignal?.aborted || !(error instanceof ContextMediaError),
      };
    }
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    if (!this.#embed) throw new UnsupportedGatewayCapabilityError("embeddings");
    return this.#embed(request);
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    if (!this.#transcribe) {
      throw new UnsupportedGatewayCapabilityError("transcription");
    }
    return this.#transcribe(request);
  }

  async estimate(request: ModelRequest): Promise<UsageEstimate> {
    if (this.#estimate) return this.#estimate(request);
    return {
      usage: { ...unknownUsage },
      estimatedCostMinor: "unknown",
      currency: "unknown",
    };
  }
}

export type OpenAICompatibleGatewayOptions = {
  baseUrl: string;
  providerName: string;
  credential?: BoundModelCredential;
  endpointPolicy: ModelEndpointPolicy;
  models: readonly ModelDescriptor[];
  transport?: ModelTransport;
  contextAssetResolver?: ContextAssetResolver;
  contextMediaBudgets?: Partial<ContextMediaBudgets>;
  onContextPrepared?: AiSdkDirectGatewayOptions["onContextPrepared"];
};

export class OpenAICompatibleGateway extends AiSdkDirectGateway {
  constructor(options: OpenAICompatibleGatewayOptions) {
    const secureFetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const request = input instanceof Request ? input : null;
      const headers = new Headers(request?.headers);
      new Headers(init?.headers).forEach((value, name) => {
        headers.set(name, value);
      });
      return safeModelFetchResponse(request?.url ?? String(input), {
        policy: options.endpointPolicy,
        credential: options.credential,
        method: init?.method ?? request?.method ?? "POST",
        headers,
        body: (init?.body as BodyInit | null | undefined) ?? undefined,
        signal: init?.signal ?? request?.signal,
        transport: options.transport,
      });
    }) as typeof fetch;
    const provider = createOpenAICompatible({
      baseURL: options.baseUrl.replace(/\/$/, ""),
      name: options.providerName,
      includeUsage: true,
      fetch: secureFetch,
    });
    super({
      models: options.models,
      resolveModel: (modelId) => provider.chatModel(modelId),
      contextAssetResolver: options.contextAssetResolver,
      contextMediaBudgets: options.contextMediaBudgets,
      onContextPrepared: options.onContextPrepared,
    });
  }
}

/**
 * Optional managed/multi-tenant adapter. LiteLLM speaks the same wire format,
 * but a named adapter keeps that operational placement explicit instead of
 * making it an implicit dependency of BYOK or self-hosting. Virtual keys use
 * the same origin-bound, SSRF-safe transport as every compatible endpoint.
 */
export type LiteLLMProxyGatewayOptions = Omit<
  OpenAICompatibleGatewayOptions,
  "providerName"
> & { providerName?: string };

export class LiteLLMProxyGateway extends OpenAICompatibleGateway {
  constructor(options: LiteLLMProxyGatewayOptions) {
    super({
      ...options,
      providerName: options.providerName ?? "litellm-proxy",
    });
  }
}
