import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  languageGenerationRequestV1Schema,
  type CapabilityOfferingSnapshot,
  type LanguageGenerationRequestV1,
  type ModelAccessContext,
  type ModelDescriptor,
  type ModelGateway,
  type ModelGatewayEvent,
  type ModelRequest,
  type StreamingCapabilityAdapter,
} from "@avermate/agent-contracts";
import { dynamicTool, jsonSchema, streamText, type ModelMessage } from "ai";
import { safeModelFetchResponse } from "../../agent/model-endpoint-policy";
import { normalizeAiSdkStream } from "../../agent/model-gateways";
import { requestMessageCommitment } from "../../assistant/model-attempts";
import {
  prepareModelPrompt,
  type ContextAssetResolver,
  type ContextMediaBudgets,
} from "../../agent/multimodal-context";
import type { ProviderFetcher } from "../../search/provider-transport";
import {
  coreCapabilityArtifactIo,
  type CapabilityArtifactIo,
} from "../artifact-io";
import type {
  CapabilityRegistryInvoker,
  CapabilityWorkflowScope,
} from "../registry-invoker";
import { capabilityRuntime, type CapabilityRuntime } from "../runtime";
import { capabilityDigest } from "../values";

export const OPENAI_COMPATIBLE_LANGUAGE_CAPABILITY_ADAPTER_REVISION =
  "ai-sdk-openai-compatible-stream/capability-v1";

export type OpenAICompatibleLanguageConnection = {
  origin: string;
  apiVersion?: string;
};

/** Text/tool stream under one immutable offering; artifact bytes never bypass IO policy. */
export class OpenAICompatibleLanguageCapabilityAdapter implements StreamingCapabilityAdapter<
  "language.generate",
  ModelGatewayEvent
> {
  readonly kind = "language.generate" as const;
  readonly #origin: string;
  readonly #apiVersion: string;

  constructor(
    private readonly offering: CapabilityOfferingSnapshot<"language.generate">,
    connection: OpenAICompatibleLanguageConnection,
    private readonly providerFetch?: ProviderFetcher,
    private readonly artifacts: CapabilityArtifactIo = coreCapabilityArtifactIo,
  ) {
    if (
      offering.adapterRevision !==
        OPENAI_COMPATIBLE_LANGUAGE_CAPABILITY_ADAPTER_REVISION ||
      !offering.specification.streaming ||
      !offering.specification.inputModalities.includes("text")
    ) {
      throw new Error("LANGUAGE_CAPABILITY_ADAPTER_DESCRIPTOR_MISMATCH");
    }
    this.#origin = new URL(connection.origin).origin;
    this.#apiVersion = connection.apiVersion ?? "v1";
    if (!/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/u.test(this.#apiVersion)) {
      throw new Error("LANGUAGE_CAPABILITY_API_VERSION_INVALID");
    }
  }

  descriptor() {
    return this.offering;
  }

  async *stream(
    context: Parameters<
      StreamingCapabilityAdapter<
        "language.generate",
        ModelGatewayEvent
      >["stream"]
    >[0],
    rawInput: Parameters<
      StreamingCapabilityAdapter<
        "language.generate",
        ModelGatewayEvent
      >["stream"]
    >[1],
  ): AsyncIterable<ModelGatewayEvent> {
    const input = languageGenerationRequestV1Schema.parse(rawInput);
    if (
      input.responseFormat !== "text" ||
      input.messages.some((message) => message.role === "tool") ||
      (input.tools.length > 0 && !this.offering.specification.tools)
    ) {
      throw new Error("LANGUAGE_CAPABILITY_V1_INPUT_UNSUPPORTED");
    }
    const inputBytes =
      new TextEncoder().encode(
        input.messages
          .flatMap((message) =>
            message.parts.map((part) =>
              part.type === "text" ? part.text : "",
            ),
          )
          .join("\n"),
      ).byteLength +
      input.messages.reduce(
        (total, message) =>
          total +
          message.parts.reduce(
            (partTotal, part) =>
              partTotal +
              (part.type === "artifact" ? part.artifact.byteSize : 0),
            0,
          ),
        0,
      ) +
      new TextEncoder().encode(JSON.stringify(input.tools)).byteLength;
    if (
      (this.offering.limits.maxInputBytes !== null &&
        inputBytes > this.offering.limits.maxInputBytes) ||
      (typeof this.offering.specification.maximumOutputTokens === "number" &&
        input.maximumOutputTokens >
          this.offering.specification.maximumOutputTokens)
    ) {
      throw new Error("LANGUAGE_CAPABILITY_INPUT_LIMIT_EXCEEDED");
    }
    const credential = await context.credential("apiKey");
    if (!credential)
      throw new Error("LANGUAGE_CAPABILITY_CREDENTIAL_UNAVAILABLE");
    await context.authorize();
    const messages: ModelMessage[] = [];
    for (const message of input.messages) {
      const content: Array<Record<string, unknown>> = [];
      for (const part of message.parts) {
        if (part.type === "text") {
          content.push({ type: "text", text: part.text });
          continue;
        }
        if (
          message.role !== "user" ||
          part.artifact.object.ownerId !== context.ownerId
        ) {
          throw new Error(
            "LANGUAGE_CAPABILITY_ARTIFACT_OWNER_OR_ROLE_MISMATCH",
          );
        }
        const mimeType = part.artifact.mimeType.toLowerCase();
        const modality = mimeType.startsWith("image/")
          ? "image"
          : mimeType === "application/pdf"
            ? "pdf"
            : null;
        if (
          !modality ||
          !this.offering.specification.inputModalities.includes(modality)
        ) {
          throw new Error("LANGUAGE_CAPABILITY_ARTIFACT_MODALITY_UNSUPPORTED");
        }
        const bytes = await this.artifacts.read(
          context.ownerId,
          part.artifact,
          {
            maximumBytes: Math.min(
              part.artifact.byteSize,
              this.offering.limits.maxInputBytes ?? part.artifact.byteSize,
            ),
            signal: context.signal,
          },
        );
        content.push(
          modality === "image"
            ? { type: "image", image: bytes, mediaType: mimeType }
            : {
                type: "file",
                data: bytes,
                mediaType: "application/pdf",
                filename: "context.pdf",
              },
        );
      }
      if (message.role === "system") {
        if (content.some((part) => part.type !== "text")) {
          throw new Error("LANGUAGE_CAPABILITY_SYSTEM_MEDIA_UNSUPPORTED");
        }
        messages.push({
          role: "system",
          content: content.map((part) => String(part.text ?? "")).join("\n"),
        });
      } else {
        messages.push({ role: message.role, content } as ModelMessage);
      }
    }
    const secureFetch = (async (
      raw: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const request = raw instanceof Request ? raw : null;
      const headers = new Headers(request?.headers);
      new Headers(init?.headers).forEach((value, name) =>
        headers.set(name, value),
      );
      headers.delete("authorization");
      if (this.providerFetch) {
        headers.set("authorization", `Bearer ${credential.secret}`);
        return this.providerFetch(
          raw instanceof Request ? raw.url : String(raw),
          { ...init, headers },
        );
      }
      return safeModelFetchResponse(request?.url ?? String(raw), {
        policy: {
          placement:
            this.offering.placement.kind === "full-self-host"
              ? "full-self-host"
              : "hosted-core",
          allowedOrigins: [this.#origin],
        },
        credential: {
          origin: this.#origin,
          headerName: "authorization",
          value: `Bearer ${credential.secret}`,
        },
        method: init?.method ?? request?.method ?? "POST",
        headers,
        body: (init?.body as BodyInit | null | undefined) ?? undefined,
        signal: init?.signal ?? request?.signal,
        maxResponseBytes: 16 * 1024 * 1024,
        totalTimeoutMs: Math.max(
          1,
          Math.min(120_000, context.deadline.getTime() - Date.now()),
        ),
      });
    }) as typeof fetch;
    const provider = createOpenAICompatible({
      baseURL: `${this.#origin}/${this.#apiVersion}`,
      name: this.offering.provider,
      apiKey: credential.secret,
      includeUsage: true,
      fetch: secureFetch,
    });
    const tools = Object.fromEntries(
      input.tools.map((tool) => [
        tool.name,
        dynamicTool({
          description: tool.description,
          inputSchema: jsonSchema(tool.inputSchema as never),
        }),
      ]),
    );
    const result = streamText({
      model: provider.chatModel(this.offering.modelId),
      messages,
      maxOutputTokens: input.maximumOutputTokens,
      ...(input.tools.length > 0 ? { tools } : {}),
      ...(input.temperature === undefined
        ? {}
        : { temperature: input.temperature }),
      maxRetries: 0,
      abortSignal: context.signal,
      telemetry: { isEnabled: false },
      onError: () => undefined,
    });
    for await (const event of normalizeAiSdkStream(result.fullStream, {
      reasoningSummaryAuthorized: this.offering.specification.reasoningSummary,
    })) {
      if (event.type === "error") {
        throw new Error(`LANGUAGE_CAPABILITY_PROVIDER_STREAM_${event.code}`);
      }
      yield event;
    }
  }
}

export type LanguageGatewayRoute = {
  provider: string;
  modelId: string;
  modelRevision: string;
  offeringId?: string | null;
  inputModalities?: readonly ("text" | "image" | "pdf")[];
  maximumOutputTokens?: number;
};

type RegistryLanguageInvoker = Pick<
  CapabilityRegistryInvoker,
  "resolve" | "streamLanguage"
>;

type LanguageGatewayDependencies = {
  contextAssetResolver?: ContextAssetResolver;
  contextMediaBudgets?: Partial<ContextMediaBudgets>;
  artifacts?: CapabilityArtifactIo;
  /** Resolves an owner-checked durable run/thread, never model-supplied scope. */
  workflowScope?: (request: ModelRequest) => Promise<CapabilityWorkflowScope>;
};

async function languageRequest(
  request: ModelRequest,
  route: LanguageGatewayRoute,
  dependencies: LanguageGatewayDependencies,
  operationId: string,
): Promise<LanguageGenerationRequestV1> {
  const inputModalities = route.inputModalities ?? ["text"];
  const prepared = await prepareModelPrompt({
    request,
    descriptor: {
      id: route.modelId,
      provider: route.provider,
      displayName: route.modelId,
      modalities: [
        "text",
        ...(inputModalities.includes("image") ? (["image"] as const) : []),
        ...(inputModalities.includes("pdf") ? (["file"] as const) : []),
      ],
      capabilities: {
        tools: request.tools.length > 0,
        reasoningSummary: false,
        cachedUsage: false,
        structuredOutput: false,
      },
      contextWindow: "unknown",
    },
    assetResolver: dependencies.contextAssetResolver,
    mediaBudgets: dependencies.contextMediaBudgets,
  });
  const signal = request.abortSignal ?? new AbortController().signal;
  const artifacts = dependencies.artifacts ?? coreCapabilityArtifactIo;
  const messages: LanguageGenerationRequestV1["messages"] = [];
  if (prepared.system.trim()) {
    messages.push({
      role: "system",
      parts: [{ type: "text", text: prepared.system }],
    });
  }
  let artifactIndex = 0;
  for (const message of prepared.messages) {
    const parts: LanguageGenerationRequestV1["messages"][number]["parts"] = [];
    const content =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;
    for (const part of content) {
      if (part.type === "text") {
        parts.push({ type: "text", text: part.text });
        continue;
      }
      if (part.type !== "image" && part.type !== "file") {
        throw new Error("LANGUAGE_CAPABILITY_PREPARED_PART_UNSUPPORTED");
      }
      const raw = part.type === "image" ? part.image : part.data;
      if (!(raw instanceof Uint8Array)) {
        throw new Error("LANGUAGE_CAPABILITY_PREPARED_MEDIA_NOT_BYTES");
      }
      const mimeType = part.mediaType;
      if (!mimeType)
        throw new Error("LANGUAGE_CAPABILITY_PREPARED_MEDIA_MIME_MISSING");
      artifactIndex += 1;
      const artifact = await artifacts.write({
        ownerId: request.ownerId,
        operationId,
        bytes: new Uint8Array(raw),
        mimeType,
        nameHint: `${operationId}-context-${artifactIndex}`,
        purpose: "document-artifact",
        signal,
      });
      parts.push({ type: "artifact", artifact });
    }
    if (parts.length > 0) {
      messages.push({ role: "user", parts });
    }
  }
  if (messages.length < 1) {
    throw new Error("LANGUAGE_CAPABILITY_EMPTY_PROMPT");
  }
  return {
    schemaVersion: 1,
    messages,
    tools: request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    })),
    maximumOutputTokens: Math.min(
      request.maximumOutputTokens ?? 4_096,
      route.maximumOutputTokens ?? Infinity,
    ),
    responseFormat: "text",
  };
}

/** ModelGateway compatibility facade with a real registry stream or fail-closed. */
export class CapabilityBackedModelGateway implements ModelGateway {
  constructor(
    private readonly delegate: ModelGateway,
    private readonly routeFor: (modelId: string) => LanguageGatewayRoute,
    private readonly dependencies: LanguageGatewayDependencies = {},
    private readonly runtime: Pick<
      CapabilityRuntime,
      "stream"
    > = capabilityRuntime,
    private readonly registry?: RegistryLanguageInvoker,
  ) {}

  async #registry() {
    return (
      this.registry ??
      (await import("../registry-invoker")).capabilityRegistryInvoker
    );
  }

  listModels(context: ModelAccessContext): Promise<ModelDescriptor[]> {
    return this.delegate.listModels(context);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelGatewayEvent> {
    const route = this.routeFor(request.modelId);
    if (route.modelId !== request.modelId) {
      throw new Error("LANGUAGE_CAPABILITY_ROUTE_MODEL_MISMATCH");
    }
    const selection = {
      offeringId: route.offeringId ?? null,
      routeKey: `${route.provider}:${route.modelId}@${route.modelRevision}`,
      provider: route.provider,
      modelId: route.modelId,
      reason: "frozen-assistant-selection",
    };
    const routeConstraint = {
      ...(route.offeringId ? { offeringId: route.offeringId } : {}),
      provider: route.provider,
      modelId: route.modelId,
      modelRevision: route.modelRevision,
    };
    const legacy = () => this.delegate.stream(request);
    // A run can call the model repeatedly after tools. Only the same frozen
    // model request may replay an operation; transport retries reuse this key.
    const operationKey = () =>
      `language:${capabilityDigest({
        runId: request.runId,
        requestKey: request.requestKey ?? null,
        modelId: request.modelId,
        offeringId: route.offeringId ?? null,
        provider: route.provider,
        modelRevision: route.modelRevision,
        messages: request.messages.map(requestMessageCommitment),
        tools: request.tools,
        maximumOutputTokens: request.maximumOutputTokens ?? 4_096,
      }).slice(7)}`;
    let scope: Promise<CapabilityWorkflowScope> | undefined;
    const workflowScope = () =>
      (scope ??=
        this.dependencies.workflowScope?.(request) ?? Promise.resolve({}));
    const requestedMedia = request.messages.flatMap((block) =>
      (block.parts ?? []).flatMap((part) =>
        part.type === "image"
          ? ["image" as const]
          : part.type === "pdf-page"
            ? ["pdf" as const]
            : [],
      ),
    );
    const requiredModalities = requestedMedia.filter((modality) =>
      (route.inputModalities ?? ["text"]).includes(modality),
    );
    const requiredFeatures = [
      "streaming",
      "modality.text",
      ...new Set(requiredModalities.map((modality) => `modality.${modality}`)),
      ...(request.tools.length > 0 ? ["tools"] : []),
    ];
    yield* this.runtime.stream({
      ownerId: request.ownerId,
      capability: "language.generate",
      purpose: "assistant.chat",
      legacy: { resolve: async () => selection, stream: legacy },
      registry: {
        resolve: async () =>
          (await this.#registry()).resolve({
            ...(await workflowScope()),
            ownerId: request.ownerId,
            capability: "language.generate",
            purpose: "assistant.chat",
            route: routeConstraint,
            requirements: {
              requiredFeatures,
            },
          }),
        stream: async function* (this: CapabilityBackedModelGateway) {
          const dispatchKey = operationKey();
          const input = await languageRequest(
            request,
            route,
            this.dependencies,
            dispatchKey,
          );
          yield* (await this.#registry()).streamLanguage({
            ...(await workflowScope()),
            ownerId: request.ownerId,
            purpose: "assistant.chat",
            request: input,
            idempotencyKey: dispatchKey,
            route: routeConstraint,
            requirements: {
              requiredFeatures,
              inputBytes:
                new TextEncoder().encode(
                  `${input.messages
                    .flatMap((message) =>
                      message.parts.map((part) =>
                        part.type === "text" ? part.text : "",
                      ),
                    )
                    .join("\n")}\n${JSON.stringify(input.tools)}`,
                ).byteLength +
                input.messages.reduce(
                  (total, message) =>
                    total +
                    message.parts.reduce(
                      (partTotal, part) =>
                        partTotal +
                        (part.type === "artifact" ? part.artifact.byteSize : 0),
                      0,
                    ),
                  0,
                ),
              batchSize: 1,
            },
            signal: request.abortSignal,
          });
        }.bind(this),
      },
    });
  }

  embed(request: Parameters<ModelGateway["embed"]>[0]) {
    return this.delegate.embed(request);
  }

  transcribe(request: Parameters<ModelGateway["transcribe"]>[0]) {
    return this.delegate.transcribe(request);
  }

  estimate(request: Parameters<ModelGateway["estimate"]>[0]) {
    return this.delegate.estimate(request);
  }
}
