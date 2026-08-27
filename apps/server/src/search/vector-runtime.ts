import { createHash } from "node:crypto";
import type {
  EmbeddingProvider,
  EmbeddingRequestContext,
  EmbeddingSpaceDescriptor,
  EmbeddingVector,
  IndexedVector,
  TextEmbeddingInput,
  VectorCandidate,
  VectorCapabilities,
  VectorIndex,
  VectorQuery,
  ProviderConsent,
} from "@avermate/agent-contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { ModelEndpointPlacement } from "../agent/model-endpoint-policy";
import { safeModelFetchResponse } from "../agent/model-endpoint-policy";
import { db } from "../db";
import { retrievalProviderConsents } from "../db/schema";
import {
  resolveProviderServiceKey,
  type ResolvedServiceKey,
} from "../lib/service-keys";
import { requireFile } from "../lib/ownership";
import { readOwnedFileBytes } from "../lib/owned-file-storage";
import {
  GEMINI_EMBEDDING_DISCLOSURE_REVISION,
  GeminiEmbeddingProvider,
} from "./gemini-embedding";
import { readEmbeddingPublicationFence } from "./embedding-publication-fence";
import { canonicalJson, sha256 } from "./values";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function required(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanBaseUrl(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  ) {
    throw new Error(
      "Corpus provider URLs must be credential-free HTTP(S) URLs",
    );
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function responseError(label: string, response: Response) {
  // Deliberately never include a response body: providers sometimes echo input.
  return new Error(`${label} returned HTTP ${response.status}`);
}

export type OpenAICompatibleEmbeddingOptions = {
  baseUrl: string;
  model: string;
  dimension: number;
  providerName: string;
  modelRevision?: string;
  preprocessingRevision?: string;
  placementDescriptor?: EmbeddingSpaceDescriptor["placement"];
  apiKey?: string | null;
  placement?: ModelEndpointPlacement;
  fetch?: Fetcher;
};

/** Explicitly configured OpenAI-compatible text embeddings, never an implicit fallback. */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly #endpoint: string;
  readonly #descriptor: EmbeddingSpaceDescriptor;
  readonly #fetch: Fetcher;

  constructor(private readonly options: OpenAICompatibleEmbeddingOptions) {
    if (!Number.isSafeInteger(options.dimension) || options.dimension < 1) {
      throw new Error("Embedding dimension must be a positive integer");
    }
    const baseUrl = cleanBaseUrl(options.baseUrl);
    this.#endpoint = `${baseUrl}/embeddings`;
    this.#descriptor = {
      id: `emb_${sha256(
        canonicalJson({
          provider: options.providerName,
          model: options.model,
          modelRevision: options.modelRevision ?? options.model,
          dimensions: options.dimension,
          modalities: ["text"],
          normalization: "provider-unit",
          preprocessingRevision:
            options.preprocessingRevision ?? "avermate-corpus-text-v1",
          placement: options.placementDescriptor ?? "node",
        }),
      )}`,
      provider: options.providerName,
      model: options.model,
      modelRevision: options.modelRevision ?? options.model,
      dimensions: options.dimension,
      modalities: ["text"],
      normalization: "provider-unit",
      preprocessingRevision:
        options.preprocessingRevision ?? "avermate-corpus-text-v1",
      placement: options.placementDescriptor ?? "node",
    };
    this.#fetch =
      options.fetch ??
      ((input, init) =>
        safeModelFetchResponse(input, {
          policy: {
            placement: options.placement ?? "hosted-core",
            allowedOrigins: [new URL(baseUrl).origin],
          },
          credential: options.apiKey
            ? {
                origin: new URL(baseUrl).origin,
                headerName: "authorization",
                value: `Bearer ${options.apiKey}`,
              }
            : undefined,
          method: init?.method,
          headers: init?.headers,
          body: init?.body,
          signal: init?.signal ?? undefined,
          maxResponseBytes: 16 * 1024 * 1024,
        }));
  }

  descriptor() {
    return { ...this.#descriptor };
  }

  async embedText(
    input: readonly TextEmbeddingInput[],
    context?: EmbeddingRequestContext,
  ): Promise<EmbeddingVector[]> {
    if (input.length === 0) return [];
    if (input.length > 256)
      throw new Error("Embedding batches are limited to 256 inputs");
    await context?.authorize?.();
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        input: input.map((entry) => entry.text),
        dimensions: this.options.dimension,
        encoding_format: "float",
      }),
      signal: context?.signal,
    });
    if (!response.ok) throw responseError("Embedding provider", response);
    const body = (await response.json()) as {
      data?: Array<{ index?: unknown; embedding?: unknown }>;
    };
    if (!Array.isArray(body.data) || body.data.length !== input.length) {
      throw new Error("Embedding provider returned an unexpected result count");
    }
    const byIndex = new Map<number, readonly number[]>();
    for (const entry of body.data) {
      if (
        !Number.isSafeInteger(entry.index) ||
        !Array.isArray(entry.embedding)
      ) {
        throw new Error("Embedding provider returned malformed vectors");
      }
      const values = entry.embedding.map(Number);
      if (
        values.length !== this.options.dimension ||
        values.some((value) => !Number.isFinite(value))
      ) {
        throw new Error(
          "Embedding provider returned an invalid vector dimension",
        );
      }
      byIndex.set(Number(entry.index), values);
    }
    return input.map((entry, index) => {
      const values = byIndex.get(index);
      if (!values)
        throw new Error("Embedding provider omitted an input vector");
      return { contentHash: entry.contentHash, values };
    });
  }
}

type QdrantPayload = {
  ownerId: string;
  spaceId: string;
  sourceId: string;
  versionId: string;
  chunkId: string;
  contentHash?: string;
};

export type ContentHashedVector = IndexedVector & { contentHash: string };

function qdrantPointId(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(
    17,
    20,
  )}-${hex.slice(20)}`;
}

function collectionToken(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "avermate_corpus"
  );
}

export type QdrantVectorIndexOptions = {
  baseUrl: string;
  apiKey?: string | null;
  collectionPrefix?: string;
  descriptor: EmbeddingSpaceDescriptor;
  /** Owned aliases prevent one user's generation switch hiding another's. */
  ownerId?: string;
  /** Staging collections are immutable and promoted by one alias transaction. */
  generationId?: string;
  fetch?: Fetcher;
};

/** Persistent Qdrant adapter with a durable, atomically switched active alias. */
export class QdrantVectorIndex implements VectorIndex {
  readonly #baseUrl: string;
  readonly #fetch: Fetcher;
  readonly #apiKey: string | null;
  readonly #collection: string;
  readonly #alias: string;

  constructor(readonly options: QdrantVectorIndexOptions) {
    this.#baseUrl = cleanBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? fetch;
    this.#apiKey = options.apiKey?.trim() || null;
    const prefix = collectionToken(
      options.collectionPrefix ?? "avermate_corpus",
    );
    const spaceToken = sha256(options.descriptor.id).slice(0, 16);
    if (options.ownerId) {
      const ownerToken = sha256(options.ownerId).slice(0, 16);
      const generationToken = sha256(options.generationId ?? "default").slice(
        0,
        16,
      );
      this.#collection = `${prefix}_${spaceToken}_${ownerToken}_${generationToken}`;
      this.#alias = `${prefix}_${spaceToken}_${ownerToken}_active`;
    } else {
      // Compatibility for explicitly configured single-tenant/self-hosted
      // installations. Production owned factories always set ownerId.
      this.#collection = `${prefix}_${sha256(options.descriptor.id).slice(0, 24)}`;
      this.#alias = `${prefix}_active`;
    }
  }

  get spaceId() {
    return this.options.descriptor.id;
  }

  get dimension() {
    return this.options.descriptor.dimensions;
  }

  /**
   * Reads from an immutable generation when one was selected explicitly.
   * The mutable active alias is only a discovery/default pointer; it must not
   * override the generation recorded by Core for an in-flight retrieval.
   */
  private get readTarget() {
    return this.options.ownerId && this.options.generationId
      ? this.#collection
      : this.#alias;
  }

  forGeneration(ownerId: string, generationId: string) {
    if (!ownerId.trim() || !generationId.trim()) {
      throw new Error("Vector generation requires owner and generation ids");
    }
    return new QdrantVectorIndex({
      ...this.options,
      ownerId,
      generationId,
    });
  }

  private async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined)
      headers.set("content-type", "application/json");
    if (this.#apiKey) headers.set("api-key", this.#apiKey);
    return this.#fetch(`${this.#baseUrl}${path}`, { ...init, headers });
  }

  private async collectionInfo(name: string) {
    const response = await this.request(
      `/collections/${encodeURIComponent(name)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw responseError("Vector index", response);
    return (await response.json()) as Record<string, unknown>;
  }

  private dimensionFromInfo(body: Record<string, unknown>) {
    const result = body.result as Record<string, unknown> | undefined;
    const config = result?.config as Record<string, unknown> | undefined;
    const params = config?.params as Record<string, unknown> | undefined;
    const vectors = params?.vectors as Record<string, unknown> | undefined;
    return typeof vectors?.size === "number" ? vectors.size : null;
  }

  async ensureCollection() {
    const current = await this.collectionInfo(this.#collection);
    if (current) {
      if (this.dimensionFromInfo(current) !== this.dimension) {
        throw new Error(
          "Vector collection dimension does not match the embedding space",
        );
      }
      return;
    }
    const response = await this.request(
      `/collections/${encodeURIComponent(this.#collection)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          vectors: {
            size: this.dimension,
            distance: "Cosine",
          },
          on_disk_payload: true,
        }),
      },
    );
    if (!response.ok && response.status !== 409) {
      throw responseError("Vector collection creation", response);
    }
  }

  async capabilities(): Promise<VectorCapabilities> {
    try {
      const info = await this.collectionInfo(this.readTarget);
      const available =
        info !== null && this.dimensionFromInfo(info) === this.dimension;
      return {
        available,
        implementation: available ? "qdrant-http-v1" : "qdrant-not-activated",
        dimensions: available ? [this.dimension] : [],
      };
    } catch {
      return {
        available: false,
        implementation: "qdrant-unavailable",
        dimensions: [],
      };
    }
  }

  private validateVector(vector: IndexedVector) {
    if (vector.spaceId !== this.spaceId)
      throw new Error("Vector belongs to another space");
    if (
      vector.values.length !== this.dimension ||
      vector.values.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("Vector has an invalid dimension or non-finite value");
    }
  }

  async upsert(batch: readonly IndexedVector[]) {
    return this.upsertContent(
      batch.map((entry) => ({ ...entry, contentHash: sha256(entry.chunkId) })),
    );
  }

  async upsertContent(batch: readonly ContentHashedVector[]) {
    if (batch.length === 0) return;
    if (
      this.options.ownerId &&
      batch.some((entry) => entry.ownerId !== this.options.ownerId)
    ) {
      throw new Error(
        "Owned vector generation received another owner's vector",
      );
    }
    await this.ensureCollection();
    for (const vector of batch) this.validateVector(vector);
    const response = await this.request(
      `/collections/${encodeURIComponent(this.#collection)}/points?wait=true`,
      {
        method: "PUT",
        body: JSON.stringify({
          points: batch.map((entry) => ({
            id: qdrantPointId(
              `${entry.ownerId}:${entry.spaceId}:${entry.chunkId}`,
            ),
            vector: entry.values,
            payload: {
              ownerId: entry.ownerId,
              spaceId: entry.spaceId,
              sourceId: entry.sourceId,
              versionId: entry.versionId,
              chunkId: entry.chunkId,
              contentHash: entry.contentHash,
            } satisfies QdrantPayload,
          })),
        }),
      },
    );
    if (!response.ok) throw responseError("Vector upsert", response);
  }

  async reusable(contentHashes: readonly string[], ownerId: string) {
    const unique = [...new Set(contentHashes)];
    if (unique.length === 0) return new Map<string, readonly number[]>();
    const targets = [this.#collection];
    if (this.options.generationId) targets.push(this.#alias);
    const found = new Map<string, readonly number[]>();
    for (const target of targets) {
      if (!(await this.collectionInfo(target))) continue;
      const response = await this.request(
        `/collections/${encodeURIComponent(target)}/points/scroll`,
        {
          method: "POST",
          body: JSON.stringify({
            filter: {
              must: [
                { key: "ownerId", match: { value: ownerId } },
                { key: "spaceId", match: { value: this.spaceId } },
                { key: "contentHash", match: { any: unique } },
              ],
            },
            limit: Math.min(10_000, unique.length * 4),
            with_payload: true,
            with_vector: true,
          }),
        },
      );
      if (!response.ok) throw responseError("Vector reuse lookup", response);
      const body = (await response.json()) as {
        result?: {
          points?: Array<{ payload?: QdrantPayload; vector?: unknown }>;
        };
      };
      for (const point of body.result?.points ?? []) {
        const payload = point.payload;
        if (
          payload?.ownerId !== ownerId ||
          payload.spaceId !== this.spaceId ||
          !payload.contentHash ||
          !Array.isArray(point.vector)
        ) {
          continue;
        }
        const values = point.vector.map(Number);
        if (values.length === this.dimension && values.every(Number.isFinite)) {
          found.set(payload.contentHash, values);
        }
      }
    }
    return found;
  }

  async activate() {
    await this.ensureCollection();
    const aliases = await this.request(
      `/aliases/${encodeURIComponent(this.#alias)}`,
    );
    const existing = aliases.ok
      ? ((
          (await aliases.json()) as {
            result?: { aliases?: Array<{ alias_name?: string }> };
          }
        ).result?.aliases ?? [])
      : [];
    if (!aliases.ok && aliases.status !== 404)
      throw responseError("Vector alias lookup", aliases);
    const actions: Array<Record<string, unknown>> = [];
    if (existing.some((entry) => entry.alias_name === this.#alias)) {
      actions.push({ delete_alias: { alias_name: this.#alias } });
    }
    actions.push({
      create_alias: {
        collection_name: this.#collection,
        alias_name: this.#alias,
      },
    });
    const response = await this.request("/collections/aliases", {
      method: "POST",
      body: JSON.stringify({ actions }),
    });
    if (!response.ok) throw responseError("Vector alias activation", response);
  }

  async remove(versionIds: readonly string[]) {
    const target =
      this.options.ownerId && !this.options.generationId
        ? this.#alias
        : this.#collection;
    if (versionIds.length === 0 || !(await this.collectionInfo(target))) return;
    const response = await this.request(
      `/collections/${encodeURIComponent(target)}/points/delete?wait=true`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            must: [
              { key: "versionId", match: { any: [...new Set(versionIds)] } },
            ],
          },
        }),
      },
    );
    if (!response.ok) throw responseError("Vector deletion", response);
  }

  async search(query: VectorQuery): Promise<VectorCandidate[]> {
    if (
      query.spaceId !== this.spaceId ||
      query.values.length !== this.dimension ||
      (this.options.ownerId !== undefined &&
        query.ownerId !== this.options.ownerId)
    )
      return [];
    const capabilities = await this.capabilities();
    if (!capabilities.available) return [];
    const versionIds = [...new Set(query.versionIds ?? [])];
    const response = await this.request(
      `/collections/${encodeURIComponent(this.readTarget)}/points/query`,
      {
        method: "POST",
        body: JSON.stringify({
          query: query.values,
          filter: {
            must: [
              { key: "ownerId", match: { value: query.ownerId } },
              { key: "spaceId", match: { value: query.spaceId } },
              ...(versionIds.length > 0
                ? [{ key: "versionId", match: { any: versionIds } }]
                : []),
            ],
          },
          limit: Math.max(1, Math.min(800, query.limit)),
          with_payload: true,
          with_vector: false,
        }),
      },
    );
    if (!response.ok) throw responseError("Vector query", response);
    const body = (await response.json()) as {
      result?: { points?: Array<{ score?: unknown; payload?: QdrantPayload }> };
    };
    return (body.result?.points ?? [])
      .flatMap((point) => {
        const payload = point.payload;
        if (
          payload?.ownerId !== query.ownerId ||
          payload.spaceId !== query.spaceId ||
          (versionIds.length > 0 &&
            !versionIds.includes(payload.versionId ?? "")) ||
          !payload.sourceId ||
          !payload.versionId ||
          !payload.chunkId ||
          !Number.isFinite(Number(point.score))
        ) {
          return [];
        }
        return [
          {
            sourceId: payload.sourceId,
            versionId: payload.versionId,
            chunkId: payload.chunkId,
            score: Number(point.score),
          },
        ];
      })
      .slice(0, query.limit);
  }
}

export type CorpusVectorRuntime = {
  embedding: EmbeddingProvider;
  vector: QdrantVectorIndex;
  consent?: ProviderConsent;
  authorizeEmbedding?: () => Promise<void>;
};

export type CorpusEmbeddingConfiguration = {
  enabled: boolean;
  complete: boolean;
  provider: string | null;
  placement: "hosted-core" | "node" | "full-self-host" | null;
  sendsSourceContentToThirdParties: boolean;
  reason: "disabled" | "incomplete" | "unsupported-placement" | "configured";
};

export function corpusEmbeddingConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): CorpusEmbeddingConfiguration {
  const enabled = environment.CORPUS_EMBEDDING_ENABLED === "true";
  const provider = required(environment.CORPUS_EMBEDDING_PROVIDER);
  const rawPlacement = required(environment.CORPUS_EMBEDDING_PLACEMENT);
  const placement = ["hosted-core", "node", "full-self-host"].includes(
    rawPlacement ?? "",
  )
    ? (rawPlacement as CorpusEmbeddingConfiguration["placement"])
    : null;
  const gemini = provider === "gemini";
  const supportedPlacement = !gemini || placement === "hosted-core";
  const complete = Boolean(
    enabled &&
    provider &&
    placement &&
    supportedPlacement &&
    (gemini || required(environment.CORPUS_EMBEDDING_BASE_URL)) &&
    (gemini || required(environment.CORPUS_EMBEDDING_MODEL)) &&
    boundedInteger(environment.CORPUS_EMBEDDING_DIMENSION, 1, 65_536) &&
    required(environment.CORPUS_VECTOR_URL),
  );
  return {
    enabled,
    complete,
    provider,
    placement,
    sendsSourceContentToThirdParties:
      complete && (gemini || environment.CORPUS_EMBEDDING_LOCAL !== "true"),
    reason: !enabled
      ? "disabled"
      : gemini && placement !== "hosted-core"
        ? "unsupported-placement"
        : complete
          ? "configured"
          : "incomplete",
  };
}

export function createConfiguredCorpusVectorRuntime(
  environment: NodeJS.ProcessEnv = process.env,
  ownerId?: string,
  options: { nodeProviderFetch?: Fetcher } = {},
): CorpusVectorRuntime | null {
  const state = corpusEmbeddingConfiguration(environment);
  if (!state.complete) return null;
  if (state.provider === "gemini") {
    throw new Error("GEMINI_EMBEDDING_REQUIRES_OWNED_CONSENT_RUNTIME");
  }
  const placement = required(environment.CORPUS_EMBEDDING_PLACEMENT);
  if (
    placement &&
    !["hosted-core", "node", "full-self-host"].includes(placement)
  ) {
    throw new Error("CORPUS_EMBEDDING_PLACEMENT is invalid");
  }
  if (!placement || placement === "hosted-core") {
    throw new Error(
      "CORPUS_HOSTED_EMBEDDING_REQUIRES_METERED_EXECUTION_ROUTER",
    );
  }
  if (placement === "node") {
    if (!options.nodeProviderFetch) {
      throw new Error("CORPUS_NODE_EMBEDDING_REQUIRES_NODE_EXECUTION_ROUTER");
    }
  }
  if (
    placement === "full-self-host" &&
    environment.AVERMATE_DEPLOYMENT_MODE !== "full-self-host"
  ) {
    throw new Error("CORPUS_FULL_SELF_HOST_PLACEMENT_REQUIRES_SELF_HOST_MODE");
  }
  const embedding = new OpenAICompatibleEmbeddingProvider({
    baseUrl: environment.CORPUS_EMBEDDING_BASE_URL!,
    model: environment.CORPUS_EMBEDDING_MODEL!,
    dimension: Number(environment.CORPUS_EMBEDDING_DIMENSION),
    providerName: environment.CORPUS_EMBEDDING_PROVIDER!,
    apiKey: environment.CORPUS_EMBEDDING_API_KEY,
    placement: placement as ModelEndpointPlacement,
    placementDescriptor: "node",
    ...(options.nodeProviderFetch ? { fetch: options.nodeProviderFetch } : {}),
  });
  return {
    embedding,
    vector: new QdrantVectorIndex({
      baseUrl: environment.CORPUS_VECTOR_URL!,
      apiKey: environment.CORPUS_VECTOR_API_KEY,
      collectionPrefix: environment.CORPUS_VECTOR_COLLECTION_PREFIX,
      descriptor: embedding.descriptor(),
      ownerId,
    }),
  };
}

export async function loadRetrievalProviderConsent(
  ownerId: string,
  provider: string,
  capability: "embedding" | "rerank",
  disclosureRevision: string,
) {
  const [consent] = await db
    .select({
      provider: retrievalProviderConsents.provider,
      disclosureRevision: retrievalProviderConsents.disclosureRevision,
      capability: retrievalProviderConsents.capability,
      grantedAt: retrievalProviderConsents.grantedAt,
    })
    .from(retrievalProviderConsents)
    .where(
      and(
        eq(retrievalProviderConsents.userId, ownerId),
        eq(retrievalProviderConsents.provider, provider),
        eq(retrievalProviderConsents.capability, capability),
        eq(retrievalProviderConsents.disclosureRevision, disclosureRevision),
        isNull(retrievalProviderConsents.revokedAt),
      ),
    )
    .limit(1);
  return consent
    ? {
        provider: consent.provider,
        disclosureRevision: consent.disclosureRevision,
        capability: consent.capability,
        grantedAt: consent.grantedAt.toISOString(),
      }
    : null;
}

/** Build the BYOK Gemini runtime only after both credential and disclosure resolve. */
export async function createOwnedCorpusVectorRuntime(
  ownerId: string,
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: {
    createNodeFetcher?: (input: {
      ownerId: string;
      nodeId?: string;
      purpose: "embedding";
    }) => Promise<Fetcher>;
    resolveServiceKey?: typeof resolveProviderServiceKey;
    loadConsent?: typeof loadRetrievalProviderConsent;
    readPublicationFence?: typeof readEmbeddingPublicationFence;
  } = {},
): Promise<CorpusVectorRuntime | null> {
  const state = corpusEmbeddingConfiguration(environment);
  if (!state.complete) return null;
  const readPublicationFence =
    dependencies.readPublicationFence ?? readEmbeddingPublicationFence;
  const capturedPublicationFence = await readPublicationFence(ownerId);
  const authorizePublication = async () => {
    const current = await readPublicationFence(ownerId);
    if (
      !current.enabled ||
      current.publicationEpoch !== capturedPublicationFence.publicationEpoch
    ) {
      throw new Error("CORPUS_EMBEDDING_PUBLICATION_FENCE_CHANGED");
    }
  };
  if (state.provider !== "gemini") {
    if (environment.CORPUS_EMBEDDING_PLACEMENT === "node") {
      const createNodeFetcher =
        dependencies.createNodeFetcher ??
        (await import("../node/services")).createPairedNodeProviderFetcher;
      const nodeId = required(environment.CORPUS_EMBEDDING_NODE_ID);
      const nodeProviderFetch = await createNodeFetcher({
        ownerId,
        ...(nodeId ? { nodeId } : {}),
        purpose: "embedding",
      });
      const runtime = createConfiguredCorpusVectorRuntime(
        environment,
        ownerId,
        {
          nodeProviderFetch,
        },
      );
      return runtime
        ? { ...runtime, authorizeEmbedding: authorizePublication }
        : null;
    }
    const runtime = createConfiguredCorpusVectorRuntime(environment, ownerId);
    return runtime
      ? { ...runtime, authorizeEmbedding: authorizePublication }
      : null;
  }
  if (state.placement !== "hosted-core") {
    throw new Error("GEMINI_EMBEDDING_REQUIRES_HOSTED_CORE_BYOK_PLACEMENT");
  }
  const dimensions = boundedInteger(
    environment.CORPUS_EMBEDDING_DIMENSION,
    768,
    3072,
  );
  if (![768, 1536, 3072].includes(dimensions ?? 0)) {
    throw new Error("GEMINI_EMBEDDING_DIMENSION_MUST_BE_768_1536_OR_3072");
  }
  const loadConsent = dependencies.loadConsent ?? loadRetrievalProviderConsent;
  const [credential, consent] = await Promise.all([
    (dependencies.resolveServiceKey ?? resolveProviderServiceKey)(
      ownerId,
      "inference",
      "gemini",
    ) as Promise<ResolvedServiceKey | null>,
    loadConsent(
      ownerId,
      "gemini",
      "embedding",
      GEMINI_EMBEDDING_DISCLOSURE_REVISION,
    ),
  ]);
  if (!credential || !consent) return null;
  if (credential.source !== "user") {
    throw new Error("GEMINI_OPERATOR_KEY_REQUIRES_MANAGED_METERED_ROUTER");
  }
  const embedding = new GeminiEmbeddingProvider({
    apiKey: credential.key,
    dimensions: dimensions as 768 | 1536 | 3072,
    resolveMedia: async (input, signal) => {
      signal.throwIfAborted();
      const fileId = input.opaqueFileHandle.replace(/^file:/u, "");
      const file = await requireFile(ownerId, fileId);
      if (
        file.status !== "stored" ||
        file.mimeType !== input.mediaType ||
        file.byteSize !== input.byteLength
      ) {
        throw new Error("GEMINI_EMBEDDING_OWNED_MEDIA_UNAVAILABLE");
      }
      const bytes = await readOwnedFileBytes(ownerId, file, {
        maxBytes: Math.min(100 * 1024 * 1024, input.byteLength),
      });
      signal.throwIfAborted();
      return { bytes: new Uint8Array(bytes), mediaType: file.mimeType };
    },
  });
  return {
    embedding,
    consent,
    authorizeEmbedding: async () => {
      await authorizePublication();
      const current = await loadConsent(
        ownerId,
        "gemini",
        "embedding",
        GEMINI_EMBEDDING_DISCLOSURE_REVISION,
      );
      if (!current) {
        throw new Error("GEMINI_EMBEDDING_EXPLICIT_CONSENT_REQUIRED");
      }
    },
    vector: new QdrantVectorIndex({
      baseUrl: environment.CORPUS_VECTOR_URL!,
      apiKey: environment.CORPUS_VECTOR_API_KEY,
      collectionPrefix: environment.CORPUS_VECTOR_COLLECTION_PREFIX,
      descriptor: embedding.descriptor(),
      ownerId,
    }),
  };
}
