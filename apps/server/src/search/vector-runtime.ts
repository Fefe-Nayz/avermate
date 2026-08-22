import { createHash } from "node:crypto";
import type {
  EmbeddingProvider,
  EmbeddingSpaceDescriptor,
  EmbeddingVector,
  IndexedVector,
  TextEmbeddingInput,
  VectorCandidate,
  VectorCapabilities,
  VectorIndex,
  VectorQuery,
} from "@avermate/agent-contracts";
import type { ModelEndpointPlacement } from "../agent/model-endpoint-policy";
import { safeModelFetchResponse } from "../agent/model-endpoint-policy";
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
          dimension: options.dimension,
          distance: "cosine",
          normalization: "provider-output-v1",
          modality: "text",
          preprocessingVersion: "avermate-corpus-text-v1",
        }),
      )}`,
      provider: options.providerName,
      model: options.model,
      dimension: options.dimension,
      distance: "cosine",
      normalization: "provider-output-v1",
      modality: "text",
      preprocessingVersion: "avermate-corpus-text-v1",
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
  ): Promise<EmbeddingVector[]> {
    if (input.length === 0) return [];
    if (input.length > 256)
      throw new Error("Embedding batches are limited to 256 inputs");
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        input: input.map((entry) => entry.text),
        dimensions: this.options.dimension,
        encoding_format: "float",
      }),
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
    this.#collection = `${prefix}_${sha256(options.descriptor.id).slice(0, 24)}`;
    this.#alias = `${prefix}_active`;
  }

  get spaceId() {
    return this.options.descriptor.id;
  }

  get dimension() {
    return this.options.descriptor.dimension;
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
            distance:
              this.options.descriptor.distance === "dot"
                ? "Dot"
                : this.options.descriptor.distance === "euclidean"
                  ? "Euclid"
                  : "Cosine",
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
      const info = await this.collectionInfo(this.#alias);
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
    if (unique.length === 0 || !(await this.collectionInfo(this.#collection))) {
      return new Map<string, readonly number[]>();
    }
    const response = await this.request(
      `/collections/${encodeURIComponent(this.#collection)}/points/scroll`,
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
    const found = new Map<string, readonly number[]>();
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
    if (
      versionIds.length === 0 ||
      !(await this.collectionInfo(this.#collection))
    )
      return;
    const response = await this.request(
      `/collections/${encodeURIComponent(this.#collection)}/points/delete?wait=true`,
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
      query.values.length !== this.dimension
    )
      return [];
    const capabilities = await this.capabilities();
    if (!capabilities.available) return [];
    const response = await this.request(
      `/collections/${encodeURIComponent(this.#alias)}/points/query`,
      {
        method: "POST",
        body: JSON.stringify({
          query: query.values,
          filter: {
            must: [
              { key: "ownerId", match: { value: query.ownerId } },
              { key: "spaceId", match: { value: query.spaceId } },
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
  embedding: OpenAICompatibleEmbeddingProvider;
  vector: QdrantVectorIndex;
};

export type CorpusEmbeddingConfiguration = {
  enabled: boolean;
  complete: boolean;
  provider: string | null;
  sendsSourceContentToThirdParties: boolean;
  reason: "disabled" | "incomplete" | "configured";
};

export function corpusEmbeddingConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): CorpusEmbeddingConfiguration {
  const enabled = environment.CORPUS_EMBEDDING_ENABLED === "true";
  const provider = required(environment.CORPUS_EMBEDDING_PROVIDER);
  const complete = Boolean(
    enabled &&
    provider &&
    required(environment.CORPUS_EMBEDDING_BASE_URL) &&
    required(environment.CORPUS_EMBEDDING_MODEL) &&
    boundedInteger(environment.CORPUS_EMBEDDING_DIMENSION, 1, 65_536) &&
    required(environment.CORPUS_VECTOR_URL),
  );
  return {
    enabled,
    complete,
    provider,
    sendsSourceContentToThirdParties:
      complete && environment.CORPUS_EMBEDDING_LOCAL !== "true",
    reason: !enabled ? "disabled" : complete ? "configured" : "incomplete",
  };
}

export function createConfiguredCorpusVectorRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): CorpusVectorRuntime | null {
  const state = corpusEmbeddingConfiguration(environment);
  if (!state.complete) return null;
  const placement = required(environment.CORPUS_EMBEDDING_PLACEMENT);
  if (placement && !["hosted-core", "node", "full-self-host"].includes(placement)) {
    throw new Error("CORPUS_EMBEDDING_PLACEMENT is invalid");
  }
  if (!placement || placement === "hosted-core") {
    throw new Error(
      "CORPUS_HOSTED_EMBEDDING_REQUIRES_METERED_EXECUTION_ROUTER",
    );
  }
  if (placement === "node") {
    throw new Error("CORPUS_NODE_EMBEDDING_REQUIRES_NODE_EXECUTION_ROUTER");
  }
  if (environment.AVERMATE_DEPLOYMENT_MODE !== "full-self-host") {
    throw new Error("CORPUS_FULL_SELF_HOST_PLACEMENT_REQUIRES_SELF_HOST_MODE");
  }
  const embedding = new OpenAICompatibleEmbeddingProvider({
    baseUrl: environment.CORPUS_EMBEDDING_BASE_URL!,
    model: environment.CORPUS_EMBEDDING_MODEL!,
    dimension: Number(environment.CORPUS_EMBEDDING_DIMENSION),
    providerName: environment.CORPUS_EMBEDDING_PROVIDER!,
    apiKey: environment.CORPUS_EMBEDDING_API_KEY,
    placement: placement as ModelEndpointPlacement,
  });
  return {
    embedding,
    vector: new QdrantVectorIndex({
      baseUrl: environment.CORPUS_VECTOR_URL!,
      apiKey: environment.CORPUS_VECTOR_API_KEY,
      collectionPrefix: environment.CORPUS_VECTOR_COLLECTION_PREFIX,
      descriptor: embedding.descriptor(),
    }),
  };
}
