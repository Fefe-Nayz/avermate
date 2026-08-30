import { createHash } from "node:crypto";
import {
  embeddingRequestV1Schema,
  embeddingResultV1Schema,
  type CapabilityOfferingSnapshot,
  type EmbeddingProvider,
  type EmbeddingRequestV1,
  type EmbeddingRequestContext,
  type EmbeddingSpaceDescriptor,
  type EmbeddingVector,
  type MediaEmbeddingInput,
  type TextEmbeddingInput,
  type UnaryCapabilityAdapter,
} from "@avermate/agent-contracts";
import { safeModelFetchResponse } from "../../agent/model-endpoint-policy";
import {
  GEMINI_EMBEDDING_DISCLOSURE_REVISION,
  GeminiEmbeddingProvider,
} from "../../search/gemini-embedding";
import {
  boundedProviderJson,
  redactedProviderHttpError,
  type ProviderFetcher,
} from "../../search/provider-transport";
import type { CapabilityArtifactIo } from "../artifact-io";
import type { CapabilityRegistryInvoker } from "../registry-invoker";
import { capabilityRuntime, type CapabilityRuntime } from "../runtime";

export const GEMINI_EMBEDDING_CAPABILITY_ADAPTER_REVISION =
  "gemini-embedding-2/capability-v1";
export const OPENAI_COMPATIBLE_EMBEDDING_CAPABILITY_ADAPTER_REVISION =
  "openai-compatible-embedding/capability-v1";

function withoutShaPrefix(value: string) {
  return value.replace(/^sha256:/u, "");
}

function providerUsage(vectors: readonly EmbeddingVector[]) {
  const first = vectors.find((vector) => vector.usage)?.usage;
  return {
    inputTokens: first?.inputTokens ?? null,
    providerRequestId: first?.providerRequestId ?? null,
  };
}

function capabilityUsage(inputTokens: number | null, vectors: number) {
  return {
    version: 1 as const,
    items: [
      {
        unit: "vector" as const,
        quantity: String(vectors),
        source: "measured" as const,
      },
      ...(inputTokens === null
        ? []
        : [
            {
              unit: "input-token" as const,
              quantity: String(inputTokens),
              source: "provider" as const,
            },
          ]),
    ],
    cost: {
      amountMinor: null,
      currency: null,
      authoritative: false,
      pricingSnapshotId: null,
    },
  };
}

function mediaLocator(input: Extract<
  ReturnType<typeof embeddingRequestV1Schema.parse>["inputs"][number],
  { type: "image" | "pdf-page" | "audio" | "video" }
>) {
  if (input.type === "pdf-page") {
    return { kind: "pdf" as const, page: input.page };
  }
  if (input.type === "audio" || input.type === "video") {
    return {
      kind: input.type,
      startMs: input.startMs,
      endMs: input.endMs,
    };
  }
  // Image embedding validation does not consume a source locator, but the
  // compatibility provider contract requires one.
  return { kind: "text" as const, startOffset: 0, endOffset: 1 };
}

/** Gemini text/media embedding with artifact resolution kept inside Core. */
export class GeminiEmbeddingCapabilityAdapter
  implements UnaryCapabilityAdapter<"embedding.generate">
{
  readonly kind = "embedding.generate" as const;

  constructor(
    private readonly offering: CapabilityOfferingSnapshot<"embedding.generate">,
    private readonly artifacts: CapabilityArtifactIo,
    private readonly providerFetch?: ProviderFetcher,
  ) {
    if (
      offering.adapterRevision !== GEMINI_EMBEDDING_CAPABILITY_ADAPTER_REVISION ||
      offering.provider !== "gemini" ||
      ![768, 1536, 3072].includes(offering.specification.dimensions)
    ) {
      throw new Error("EMBEDDING_CAPABILITY_ADAPTER_DESCRIPTOR_MISMATCH");
    }
  }

  descriptor() {
    return this.offering;
  }

  async invoke(
    context: Parameters<UnaryCapabilityAdapter<"embedding.generate">["invoke"]>[0],
    rawInput: Parameters<UnaryCapabilityAdapter<"embedding.generate">["invoke"]>[1],
  ) {
    const input = embeddingRequestV1Schema.parse(rawInput);
    const specification = this.offering.specification;
    if (
      input.inputs.length > specification.maximumInputs ||
      (this.offering.limits.maxBatchSize !== null &&
        input.inputs.length > this.offering.limits.maxBatchSize) ||
      new Set(input.inputs.map((entry) => entry.contentHash)).size !==
        input.inputs.length
    ) {
      throw new Error("EMBEDDING_CAPABILITY_BATCH_UNSUPPORTED");
    }
    for (const entry of input.inputs) {
      if (!specification.modalities.includes(entry.type)) {
        throw new Error("EMBEDDING_CAPABILITY_MODALITY_UNSUPPORTED");
      }
      if (
        entry.type !== "text" &&
        (entry.assetRef.object.ownerId !== context.ownerId ||
          entry.assetRef.digest !== entry.contentHash)
      ) {
        throw new Error("EMBEDDING_CAPABILITY_ARTIFACT_MISMATCH");
      }
    }
    const credential = await context.credential("apiKey");
    if (!credential) throw new Error("EMBEDDING_CAPABILITY_CREDENTIAL_UNAVAILABLE");
    const artifactsByHash = new Map(
      input.inputs
        .filter((entry) => entry.type !== "text")
        .map((entry) => [withoutShaPrefix(entry.contentHash), entry] as const),
    );
    const provider = new GeminiEmbeddingProvider({
      apiKey: credential.secret,
      dimensions: specification.dimensions as 768 | 1536 | 3072,
      modelRevision: this.offering.modelRevision,
      deadlineMs: Math.max(
        1,
        Math.min(60_000, context.deadline.getTime() - Date.now()),
      ),
      ...(this.providerFetch ? { fetch: this.providerFetch } : {}),
      resolveMedia: async (media, signal) => {
        const entry = artifactsByHash.get(media.contentHash);
        if (!entry) {
          throw new Error("EMBEDDING_CAPABILITY_ARTIFACT_UNAVAILABLE");
        }
        return {
          bytes: await this.artifacts.read(context.ownerId, entry.assetRef, {
            maximumBytes: Math.min(
              entry.assetRef.byteSize,
              this.offering.limits.maxInputBytes ?? entry.assetRef.byteSize,
            ),
            signal,
          }),
          mediaType: entry.assetRef.mimeType,
        };
      },
    });
    if (provider.descriptor().id !== specification.embeddingSpaceId) {
      throw new Error("EMBEDDING_CAPABILITY_SPACE_MISMATCH");
    }
    const requestContext: EmbeddingRequestContext = {
      operationId: context.operationId,
      signal: context.signal,
      consent: {
        provider: "gemini",
        capability: "embedding",
        disclosureRevision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
        grantedAt: new Date().toISOString(),
      },
      authorize: context.authorize,
    };
    const textEntries = input.inputs.filter((entry) => entry.type === "text");
    const mediaEntries = input.inputs.filter(
      (entry): entry is Exclude<(typeof input.inputs)[number], { type: "text" }> =>
        entry.type !== "text",
    );
    const vectorsByHash = new Map<string, EmbeddingVector>();
    if (textEntries.length > 0) {
      const vectors = await provider.embedText(
        textEntries.map((entry) => ({
          contentHash: withoutShaPrefix(entry.contentHash),
          text: entry.text,
          purpose: entry.purpose,
          ...(entry.title === undefined ? {} : { title: entry.title }),
        })),
        requestContext,
      );
      for (const vector of vectors) vectorsByHash.set(vector.contentHash, vector);
    }
    if (mediaEntries.length > 0) {
      const vectors = await provider.embedMedia!(
        mediaEntries.map((entry) => ({
          contentHash: withoutShaPrefix(entry.contentHash),
          modality: entry.type,
          mediaType: entry.assetRef.mimeType,
          opaqueFileHandle: entry.contentHash,
          locator: mediaLocator(entry),
          byteLength: entry.assetRef.byteSize,
          estimatedInputTokens: Math.max(
            1,
            Math.min(8_192, Math.ceil(entry.assetRef.byteSize / 1_024)),
          ),
          ...(entry.type === "audio" || entry.type === "video"
            ? { durationMs: entry.endMs - entry.startMs }
            : {}),
        })),
        requestContext,
      );
      for (const vector of vectors) vectorsByHash.set(vector.contentHash, vector);
    }
    const ordered = input.inputs.map((entry) => {
      const vector = vectorsByHash.get(withoutShaPrefix(entry.contentHash));
      if (!vector) throw new Error("EMBEDDING_CAPABILITY_RESULT_MISSING");
      return vector;
    });
    const usage = providerUsage(ordered);
    return embeddingResultV1Schema.parse({
      schemaVersion: 1,
      vectors: ordered.map((vector) => vector.values),
      dimensions: specification.dimensions,
      embeddingSpaceId: specification.embeddingSpaceId,
      usage: capabilityUsage(usage.inputTokens, ordered.length),
      providerMetadata: {
        provider: this.offering.provider,
        modelId: this.offering.modelId,
        providerRequestId: usage.providerRequestId,
      },
    });
  }
}

export type OpenAICompatibleEmbeddingConnection = {
  origin: string;
  apiVersion?: string;
};

/** One bounded OpenAI-compatible `/embeddings` request; no SDK retry/fallback. */
export class OpenAICompatibleEmbeddingCapabilityAdapter
  implements UnaryCapabilityAdapter<"embedding.generate">
{
  readonly kind = "embedding.generate" as const;
  readonly #origin: string;
  readonly #apiVersion: string;

  constructor(
    private readonly offering: CapabilityOfferingSnapshot<"embedding.generate">,
    connection: OpenAICompatibleEmbeddingConnection,
    private readonly providerFetch?: ProviderFetcher,
  ) {
    if (
      offering.adapterRevision !==
        OPENAI_COMPATIBLE_EMBEDDING_CAPABILITY_ADAPTER_REVISION ||
      offering.specification.modalities.length !== 1 ||
      offering.specification.modalities[0] !== "text"
    ) {
      throw new Error("EMBEDDING_CAPABILITY_ADAPTER_DESCRIPTOR_MISMATCH");
    }
    this.#origin = new URL(connection.origin).origin;
    this.#apiVersion = connection.apiVersion ?? "v1";
    if (!/^[a-zA-Z0-9._-]+$/u.test(this.#apiVersion)) {
      throw new Error("EMBEDDING_CAPABILITY_API_VERSION_INVALID");
    }
  }

  descriptor() {
    return this.offering;
  }

  async invoke(
    context: Parameters<UnaryCapabilityAdapter<"embedding.generate">["invoke"]>[0],
    rawInput: Parameters<UnaryCapabilityAdapter<"embedding.generate">["invoke"]>[1],
  ) {
    const input = embeddingRequestV1Schema.parse(rawInput);
    if (
      input.inputs.some((entry) => entry.type !== "text") ||
      input.inputs.length > this.offering.specification.maximumInputs ||
      (this.offering.limits.maxBatchSize !== null &&
        input.inputs.length > this.offering.limits.maxBatchSize)
    ) {
      throw new Error("EMBEDDING_CAPABILITY_INPUT_UNSUPPORTED");
    }
    const credential = await context.credential("apiKey");
    if (!credential) throw new Error("EMBEDDING_CAPABILITY_CREDENTIAL_UNAVAILABLE");
    await context.authorize();
    const endpoint = `${this.#origin}/${this.#apiVersion}/embeddings`;
    const response = await (this.providerFetch ??
      ((url, init) =>
        safeModelFetchResponse(url, {
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
          method: init?.method,
          headers: init?.headers,
          body: init?.body,
          signal: init?.signal ?? undefined,
          maxResponseBytes: 16 * 1024 * 1024,
          totalTimeoutMs: Math.max(
            1,
            Math.min(60_000, context.deadline.getTime() - Date.now()),
          ),
        })))(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model: this.offering.modelId,
        input: input.inputs.map((entry) =>
          entry.type === "text" ? entry.text : "",
        ),
        dimensions: this.offering.specification.dimensions,
        encoding_format: "float",
      }),
      signal: context.signal,
    });
    if (!response.ok) {
      throw redactedProviderHttpError("OPENAI_COMPATIBLE_EMBEDDING", response);
    }
    const body = await boundedProviderJson(response, 16 * 1024 * 1024);
    const object =
      body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const data = object?.data;
    if (!Array.isArray(data) || data.length !== input.inputs.length) {
      throw new Error("EMBEDDING_CAPABILITY_RESULT_COUNT_MISMATCH");
    }
    const vectors = new Map<number, number[]>();
    for (const raw of data) {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      const index = Number(row?.index);
      const vector = row?.embedding;
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= input.inputs.length ||
        vectors.has(index) ||
        !Array.isArray(vector) ||
        vector.length !== this.offering.specification.dimensions
      ) {
        throw new Error("EMBEDDING_CAPABILITY_MALFORMED_VECTOR");
      }
      const values = vector.map(Number);
      if (!values.every(Number.isFinite)) {
        throw new Error("EMBEDDING_CAPABILITY_NON_FINITE_VECTOR");
      }
      vectors.set(index, values);
    }
    const usageObject =
      object?.usage && typeof object.usage === "object"
        ? (object.usage as Record<string, unknown>)
        : null;
    const promptTokens = Number(usageObject?.prompt_tokens);
    return embeddingResultV1Schema.parse({
      schemaVersion: 1,
      vectors: input.inputs.map((_entry, index) => {
        const vector = vectors.get(index);
        if (!vector) throw new Error("EMBEDDING_CAPABILITY_RESULT_MISSING");
        return vector;
      }),
      dimensions: this.offering.specification.dimensions,
      embeddingSpaceId: this.offering.specification.embeddingSpaceId,
      usage: capabilityUsage(
        Number.isSafeInteger(promptTokens) && promptTokens >= 0
          ? promptTokens
          : null,
        input.inputs.length,
      ),
      providerMetadata: {
        provider: this.offering.provider,
        modelId: this.offering.modelId,
        providerRequestId: response.headers.get("x-request-id"),
      },
    });
  }
}

type RegistryEmbeddingInvoker = Pick<
  CapabilityRegistryInvoker,
  "invoke" | "resolve"
>;

function operationKey(prefix: string, input: unknown, explicit?: string) {
  if (explicit?.trim()) return `${prefix}:${explicit}`;
  return `${prefix}:${createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")}`;
}

function artifactInput(ownerId: string, input: MediaEmbeddingInput) {
  if (!input.opaqueFileHandle.startsWith("file:")) {
    throw new Error("EMBEDDING_CAPABILITY_OWNED_FILE_HANDLE_REQUIRED");
  }
  const assetRef = {
    object: {
      ownerId,
      namespace: "files",
      key: input.opaqueFileHandle.slice("file:".length),
    },
    digest: `sha256:${input.contentHash}` as const,
    byteSize: input.byteLength,
    mimeType: input.mediaType,
  };
  if (input.modality === "pdf-page") {
    if (input.locator.kind !== "pdf") {
      throw new Error("EMBEDDING_CAPABILITY_PDF_LOCATOR_REQUIRED");
    }
    return {
      type: "pdf-page" as const,
      contentHash: assetRef.digest,
      assetRef,
      page: input.locator.page,
    };
  }
  if (input.modality === "image") {
    if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(input.mediaType)) {
      throw new Error("EMBEDDING_CAPABILITY_IMAGE_MIME_UNSUPPORTED");
    }
    return {
      type: "image" as const,
      contentHash: assetRef.digest,
      assetRef,
      mimeType: input.mediaType as "image/png" | "image/jpeg" | "image/webp",
    };
  }
  if (input.locator.kind !== input.modality) {
    throw new Error("EMBEDDING_CAPABILITY_MEDIA_LOCATOR_REQUIRED");
  }
  return {
    type: input.modality,
    contentHash: assetRef.digest,
    assetRef,
    startMs: input.locator.startMs,
    endMs: input.locator.endMs,
  };
}

/** Runtime facade preserving immutable embedding-space and publication fences. */
export class CapabilityBackedEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly ownerId: string,
    private readonly legacyDelegate: EmbeddingProvider | null,
    private readonly space: EmbeddingSpaceDescriptor = legacyDelegate!.descriptor(),
    private readonly runtime: Pick<CapabilityRuntime, "invoke"> = capabilityRuntime,
    private readonly registry?: RegistryEmbeddingInvoker,
  ) {}

  async #registry() {
    return (
      this.registry ??
      (await import("../registry-invoker")).capabilityRegistryInvoker
    );
  }

  descriptor() {
    return { ...this.space, modalities: [...this.space.modalities] };
  }

  embedText(
    input: readonly TextEmbeddingInput[],
    context?: EmbeddingRequestContext,
  ) {
    const request = {
      schemaVersion: 1 as const,
      inputs: input.map((entry) => ({
        type: "text" as const,
        contentHash: `sha256:${entry.contentHash}` as const,
        text: entry.text,
        purpose: entry.purpose ?? "document",
        ...(entry.title ? { title: entry.title } : {}),
      })),
    };
    return this.#invoke(request, input, context);
  }

  embedMedia(
    input: readonly MediaEmbeddingInput[],
    context: EmbeddingRequestContext,
  ) {
    const request = {
      schemaVersion: 1 as const,
      inputs: input.map((entry) => artifactInput(this.ownerId, entry)),
    };
    return this.#invoke(request, input, context);
  }

  #invoke(
    request: EmbeddingRequestV1,
    legacyInput: readonly TextEmbeddingInput[] | readonly MediaEmbeddingInput[],
    context?: EmbeddingRequestContext,
  ) {
    const descriptor = this.descriptor();
    const selection = {
      offeringId: descriptor.id,
      routeKey: `${descriptor.provider}:${descriptor.model}@${descriptor.modelRevision}:${descriptor.id}`,
      provider: descriptor.provider,
      modelId: descriptor.model,
      reason: "immutable-embedding-space",
    };
    const route = {
      provider: descriptor.provider,
      modelId: descriptor.model,
      modelRevision: descriptor.modelRevision,
      embeddingSpaceId: descriptor.id,
    };
    const requiredFeatures = request.inputs.map(
      (entry) => `modality.${entry.type}`,
    );
    return this.runtime.invoke({
      ownerId: this.ownerId,
      capability: "embedding.generate",
      purpose: request.inputs.every(
        (entry) => entry.type === "text" && entry.purpose === "query",
      )
        ? "corpus.query-embedding"
        : "corpus.document-embedding",
      legacy: {
        resolve: async () => selection,
        execute: async () => {
          if (!this.legacyDelegate) {
            throw new Error("EMBEDDING_LEGACY_EXECUTOR_UNAVAILABLE");
          }
          if (request.inputs.every((entry) => entry.type === "text")) {
            return this.legacyDelegate.embedText(
              legacyInput as readonly TextEmbeddingInput[],
              context,
            );
          }
          if (!this.legacyDelegate.embedMedia || !context) {
            throw new Error("EMBEDDING_MEDIA_UNSUPPORTED");
          }
          return this.legacyDelegate.embedMedia(
            legacyInput as readonly MediaEmbeddingInput[],
            context,
          );
        },
      },
      registry: {
        resolve: async () =>
          (await this.#registry()).resolve({
            ownerId: this.ownerId,
            capability: "embedding.generate",
            purpose: request.inputs.every(
              (entry) => entry.type === "text" && entry.purpose === "query",
            )
              ? "corpus.query-embedding"
              : "corpus.document-embedding",
            route,
            requirements: {
              requiredFeatures,
              batchSize: request.inputs.length,
            },
          }),
        execute: async () => {
          await context?.authorize?.();
          const result = await (await this.#registry()).invoke({
            ownerId: this.ownerId,
            capability: "embedding.generate",
            purpose: request.inputs.every(
              (entry) => entry.type === "text" && entry.purpose === "query",
            )
              ? "corpus.query-embedding"
              : "corpus.document-embedding",
            request,
            idempotencyKey: operationKey(
              "embedding",
              request,
              context?.operationId,
            ),
            route,
            requirements: {
              requiredFeatures,
              batchSize: request.inputs.length,
            },
            signal: context?.signal,
          });
          await context?.authorize?.();
          if (
            result.embeddingSpaceId !== descriptor.id ||
            result.dimensions !== descriptor.dimensions
          ) {
            throw new Error("EMBEDDING_CAPABILITY_SPACE_MISMATCH");
          }
          return result.vectors.map((values, index) => ({
            contentHash: legacyInput[index]!.contentHash,
            values,
          }));
        },
      },
    });
  }
}
