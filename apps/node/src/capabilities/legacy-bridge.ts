import {
  embeddingRequestV1Schema,
  embeddingResultV1Schema,
  emptyCapabilityUsage,
  languageGenerationRequestV1Schema,
  nodeCapabilityOfferingSchema,
  nodeCapabilityResultV1Schema,
  rerankRequestV1Schema,
  rerankResultV1Schema,
  type CapabilityUsage,
  type ModelGateway,
  type ModelGatewayEvent,
  type NodeCapabilityEventV1,
  type NodeCapabilityOffering,
  type NodeCapabilityRequestV1,
  type NodeCapabilityResultV1,
  type NodeProviderFetchResponse,
  type NormalizedUsage,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { canonicalDigest } from "../canonical-json";
import type { BoundedNodeProviderFetcher } from "../provider-fetch";
import { normalizeOpenAIUsage } from "../model-gateway";
import type {
  NodeCapabilityAdapter,
  NodeCapabilityAdapterContext,
} from "./registry";

const providerResponseSchema = z.strictObject({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()),
  body: z.strictObject({
    encoding: z.literal("base64url"),
    byteLength: z.number().int().nonnegative(),
    data: z.string(),
  }),
});

function usageItem(
  unit: "input-token" | "output-token" | "reasoning-token" | "cached-input-token",
  quantity: number | "unknown",
) {
  return quantity === "unknown"
    ? []
    : [{ unit, quantity: String(quantity), source: "provider" as const }];
}

function capabilityUsage(usage: NormalizedUsage): CapabilityUsage {
  return {
    version: 1,
    items: [
      ...usageItem("input-token", usage.inputTokens),
      ...usageItem("output-token", usage.outputTokens),
      ...usageItem("reasoning-token", usage.reasoningTokens),
      ...usageItem("cached-input-token", usage.cachedReadTokens),
      ...usageItem("cached-input-token", usage.cachedWriteTokens),
    ],
    cost: {
      amountMinor: null,
      currency: null,
      authoritative: false,
      pricingSnapshotId: null,
    },
  };
}

function resultEnvelope(input: {
  request: NodeCapabilityRequestV1;
  result: unknown;
  usage: CapabilityUsage;
  providerRequestId?: string | null;
}): NodeCapabilityResultV1 {
  const outputArtifacts: [] = [];
  const result = {
    schemaVersion: 1 as const,
    operationId: input.request.operationId,
    offeringId: input.request.offeringId,
    requestDigest: input.request.requestDigest,
    outputDigest: canonicalDigest({
      result: input.result,
      outputArtifacts,
    }),
    result: input.result,
    outputArtifacts,
    usage: input.usage,
    providerRequestId: input.providerRequestId ?? null,
  };
  return nodeCapabilityResultV1Schema.parse(result);
}

function body(response: NodeProviderFetchResponse) {
  const parsed = providerResponseSchema.parse(response);
  const bytes = Buffer.from(parsed.body.data, "base64url");
  if (bytes.byteLength !== parsed.body.byteLength) {
    throw new Error("NODE_CAPABILITY_PROVIDER_RESPONSE_MALFORMED");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("NODE_CAPABILITY_PROVIDER_RESPONSE_MALFORMED");
  }
}

function providerRequestId(response: NodeProviderFetchResponse) {
  const headers = response.headers as Record<string, string | undefined>;
  return headers["x-request-id"] ?? headers["request-id"] ?? null;
}

function assertProviderOk(response: NodeProviderFetchResponse) {
  if (response.status >= 200 && response.status < 300) return;
  if (response.status === 401 || response.status === 403) {
    throw new Error("NODE_CAPABILITY_PROVIDER_UNAUTHORIZED");
  }
  if (response.status === 408 || response.status === 429) {
    throw new Error("NODE_CAPABILITY_PROVIDER_RATE_LIMITED");
  }
  throw new Error(
    response.status >= 500
      ? "NODE_CAPABILITY_PROVIDER_UNAVAILABLE"
      : "NODE_CAPABILITY_PROVIDER_REJECTED",
  );
}

function wireJson(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    encoding: "base64url" as const,
    byteLength: bytes.byteLength,
    data: Buffer.from(bytes).toString("base64url"),
  };
}

/** Streaming bridge for the existing Node ModelGateway catalogue. */
export class LegacyModelCapabilityAdapter implements NodeCapabilityAdapter {
  readonly invocationModes = ["stream-relay"] as const;
  readonly offering: NodeCapabilityOffering;
  readonly #gateway: ModelGateway;
  readonly #modelId: string;

  constructor(input: {
    offering: NodeCapabilityOffering;
    gateway: ModelGateway;
    modelId: string;
  }) {
    this.offering = nodeCapabilityOfferingSchema.parse(input.offering);
    this.#gateway = input.gateway;
    this.#modelId = input.modelId;
  }

  async health() {
    const placement = this.offering.descriptor.placement;
    await this.#gateway.listModels({
      ownerId: "health",
      placement: placement.kind === "node" ? "node" : "full-self-host",
      allowedOrigins: [],
    });
  }

  async *stream(
    context: NodeCapabilityAdapterContext,
    request: NodeCapabilityRequestV1,
  ): AsyncIterable<NodeCapabilityEventV1> {
    const parsed = languageGenerationRequestV1Schema.parse(request.input);
    if (parsed.responseFormat !== "text" || parsed.temperature !== undefined || parsed.tools.length > 0) {
      throw new Error("NODE_CAPABILITY_MODEL_OPTION_UNSUPPORTED");
    }
    const messages = parsed.messages.map((message, index) => ({
      id: `capability-context-${index}`,
      trust:
        message.role === "system"
          ? ("system-policy" as const)
          : ("user-instruction" as const),
      mediaType: "text/plain",
      content: message.parts
        .map((part) => {
          if (part.type !== "text") {
            throw new Error("NODE_CAPABILITY_MODEL_ARTIFACT_INPUT_UNSUPPORTED");
          }
          return part.text;
        })
        .join("\n"),
      sourceRef: null,
      redactions: [],
    }));
    let sequence = 0;
    yield {
      schemaVersion: 1,
      operationId: request.operationId,
      offeringId: request.offeringId,
      sequence: sequence++,
      type: "acknowledged",
      payload: null,
    };
    let completed = false;
    for await (const event of this.#gateway.stream({
      ownerId: context.ownerId,
      runId: context.operationId,
      requestKey: context.operationId,
      modelId: this.#modelId,
      messages,
      tools: [],
      maximumOutputTokens: parsed.maximumOutputTokens,
      abortSignal: context.signal,
    })) {
      if (event.type === "error") {
        throw new Error("NODE_CAPABILITY_PROVIDER_STREAM_FAILED");
      }
      if (event.type === "usage") {
        yield {
          schemaVersion: 1,
          operationId: request.operationId,
          offeringId: request.offeringId,
          sequence: sequence++,
          type: "usage",
          payload: capabilityUsage(event.usage),
        };
        continue;
      }
      if (event.type === "finish") {
        completed = true;
        yield {
          schemaVersion: 1,
          operationId: request.operationId,
          offeringId: request.offeringId,
          sequence: sequence++,
          type: "completed",
          payload: { finishReason: event.reason },
        };
        continue;
      }
      yield {
        schemaVersion: 1,
        operationId: request.operationId,
        offeringId: request.offeringId,
        sequence: sequence++,
        type: "chunk",
        payload: event satisfies Exclude<
          ModelGatewayEvent,
          { type: "usage" | "finish" | "error" }
        >,
      };
    }
    if (!completed) throw new Error("NODE_CAPABILITY_PROVIDER_STREAM_INCOMPLETE");
  }
}

/** Unary bridge for the existing bounded embedding/rerank provider routes. */
export class LegacyRetrievalCapabilityAdapter
  implements NodeCapabilityAdapter
{
  readonly invocationModes = ["unary-relay"] as const;
  readonly offering: NodeCapabilityOffering;
  readonly #fetcher: BoundedNodeProviderFetcher;
  readonly #endpoint: string;

  constructor(input: {
    offering: NodeCapabilityOffering;
    fetcher: BoundedNodeProviderFetcher;
    endpoint: string;
  }) {
    this.offering = nodeCapabilityOfferingSchema.parse(input.offering);
    this.#fetcher = input.fetcher;
    this.#endpoint = input.endpoint;
  }

  async invoke(
    context: NodeCapabilityAdapterContext,
    request: NodeCapabilityRequestV1,
  ) {
    return this.offering.descriptor.capability === "embedding.generate"
      ? this.#embedding(context, request)
      : this.#rerank(context, request);
  }

  async #embedding(
    context: NodeCapabilityAdapterContext,
    request: NodeCapabilityRequestV1,
  ) {
    const input = embeddingRequestV1Schema.parse(request.input);
    if (this.offering.descriptor.capability !== "embedding.generate") {
      throw new Error("NODE_CAPABILITY_EMBEDDING_OFFERING_INVALID");
    }
    const specification = this.offering.descriptor.specification;
    const maximumBatch = Math.min(
      specification.maximumInputs,
      this.offering.descriptor.limits.maxBatchSize ?? specification.maximumInputs,
    );
    if (input.inputs.length > maximumBatch) {
      throw new Error("NODE_CAPABILITY_EMBEDDING_BATCH_TOO_LARGE");
    }
    const texts = input.inputs.map((item) => {
      if (item.type !== "text") {
        throw new Error("NODE_CAPABILITY_EMBEDDING_MODALITY_UNSUPPORTED");
      }
      return item.text;
    });
    const response = await this.#fetcher.fetch(
      {
        purpose: "embedding",
        url: this.#endpoint,
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: wireJson({
          model: this.offering.descriptor.modelId,
          input: texts,
          encoding_format: "float",
        }),
      },
      context.signal,
    );
    assertProviderOk(response);
    const raw = body(response) as Record<string, unknown>;
    const data = Array.isArray(raw.data) ? raw.data : [];
    const byIndex = new Map<number, number[]>();
    for (const candidate of data) {
      const item = candidate as Record<string, unknown>;
      if (
        !Number.isSafeInteger(item.index) ||
        (item.index as number) < 0 ||
        (item.index as number) >= texts.length ||
        byIndex.has(item.index as number) ||
        !Array.isArray(item.embedding)
      ) {
        throw new Error("NODE_CAPABILITY_PROVIDER_RESPONSE_MALFORMED");
      }
      const vector = item.embedding.map(Number);
      if (vector.some((value) => !Number.isFinite(value))) {
        throw new Error("NODE_CAPABILITY_PROVIDER_RESPONSE_MALFORMED");
      }
      byIndex.set(item.index as number, vector);
    }
    const vectors = texts.map((_, index) => {
      const vector = byIndex.get(index);
      if (!vector) throw new Error("NODE_CAPABILITY_PROVIDER_RESPONSE_MALFORMED");
      return vector;
    });
    if (vectors.some((vector) => vector.length !== specification.dimensions)) {
      throw new Error("NODE_CAPABILITY_EMBEDDING_DIMENSION_MISMATCH");
    }
    const usage = capabilityUsage(normalizeOpenAIUsage(raw.usage));
    const normalized = embeddingResultV1Schema.parse({
      schemaVersion: 1,
      vectors,
      dimensions: specification.dimensions,
      embeddingSpaceId: specification.embeddingSpaceId,
      usage,
      providerMetadata: null,
    });
    return resultEnvelope({
      request,
      result: normalized,
      usage,
      providerRequestId: providerRequestId(response),
    });
  }

  async #rerank(
    context: NodeCapabilityAdapterContext,
    request: NodeCapabilityRequestV1,
  ): Promise<NodeCapabilityResultV1> {
    const input = rerankRequestV1Schema.parse(request.input);
    if (this.offering.descriptor.capability !== "rerank.score") {
      throw new Error("NODE_CAPABILITY_RERANK_OFFERING_INVALID");
    }
    const maximumBatch = Math.min(
      this.offering.descriptor.specification.maxCandidates,
      this.offering.descriptor.limits.maxBatchSize ??
        this.offering.descriptor.specification.maxCandidates,
    );
    if (input.candidates.length > maximumBatch || input.topK > input.candidates.length) {
      throw new Error("NODE_CAPABILITY_RERANK_BATCH_TOO_LARGE");
    }
    const response = await this.#fetcher.fetch(
      {
        purpose: "rerank",
        url: this.#endpoint,
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: wireJson({
          model: this.offering.descriptor.modelId,
          query: input.query,
          documents: input.candidates.map((candidate) => candidate.text),
          top_n: Math.min(input.topK, input.candidates.length),
        }),
      },
      context.signal,
    );
    assertProviderOk(response);
    const raw = body(response) as Record<string, unknown>;
    const results = Array.isArray(raw.results) ? raw.results : [];
    if (results.length > input.topK) {
      throw new Error("NODE_CAPABILITY_PROVIDER_RESPONSE_MALFORMED");
    }
    const seen = new Set<number>();
    const scores = results.map((candidate, rank) => {
      const value = candidate as Record<string, unknown>;
      const index = Number(value.index);
      const score = Number(value.relevance_score ?? value.score);
      const source = input.candidates[index];
      if (
        !Number.isSafeInteger(index) ||
        seen.has(index) ||
        !source ||
        !Number.isFinite(score)
      ) {
        throw new Error("NODE_CAPABILITY_PROVIDER_RESPONSE_MALFORMED");
      }
      seen.add(index);
      return { id: source.id, score, rank };
    });
    const usage = raw.usage
      ? capabilityUsage(normalizeOpenAIUsage(raw.usage))
      : emptyCapabilityUsage();
    const normalized = rerankResultV1Schema.parse({
      schemaVersion: 1,
      scores,
      usage,
      providerMetadata: null,
    });
    return resultEnvelope({
      request,
      result: normalized,
      usage,
      providerRequestId: providerRequestId(response),
    });
  }
}
