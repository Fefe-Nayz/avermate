import { describe, expect, test } from "bun:test";
import {
  corpusEmbeddingConfiguration,
  createConfiguredCorpusVectorRuntime,
  createOwnedCorpusVectorRuntime,
  OpenAICompatibleEmbeddingProvider,
  QdrantVectorIndex,
} from "./vector-runtime";
import { GEMINI_EMBEDDING_DISCLOSURE_REVISION } from "./gemini-embedding";

const descriptor = {
  id: "space-test-v1",
  provider: "fixture",
  model: "embed-fixture",
  modelRevision: "embed-fixture@test-1",
  dimensions: 3,
  modalities: ["text" as const],
  normalization: "provider-unit" as const,
  preprocessingRevision: "fixture-v1",
  placement: "node" as const,
};

describe("optional corpus embedding configuration", () => {
  test("requires an explicit opt-in and every non-secret endpoint field", () => {
    expect(corpusEmbeddingConfiguration({})).toMatchObject({
      complete: false,
      reason: "disabled",
      placement: null,
      sendsSourceContentToThirdParties: false,
    });
    expect(
      corpusEmbeddingConfiguration({ CORPUS_EMBEDDING_ENABLED: "true" }),
    ).toMatchObject({ complete: false, reason: "incomplete" });
    expect(
      corpusEmbeddingConfiguration({
        CORPUS_EMBEDDING_ENABLED: "true",
        CORPUS_EMBEDDING_PROVIDER: "self-hosted",
        CORPUS_EMBEDDING_BASE_URL: "http://embeddings.test/v1",
        CORPUS_EMBEDDING_MODEL: "school-v1",
        CORPUS_EMBEDDING_DIMENSION: "3",
        CORPUS_EMBEDDING_PLACEMENT: "full-self-host",
        CORPUS_VECTOR_URL: "http://qdrant.test",
        CORPUS_EMBEDDING_LOCAL: "true",
      }),
    ).toMatchObject({
      complete: true,
      reason: "configured",
      sendsSourceContentToThirdParties: false,
      placement: "full-self-host",
    });
  });

  test("never presents Gemini as local or silently ignores its placement", () => {
    const base = {
      CORPUS_EMBEDDING_ENABLED: "true",
      CORPUS_EMBEDDING_PROVIDER: "gemini",
      CORPUS_EMBEDDING_DIMENSION: "768",
      CORPUS_VECTOR_URL: "https://qdrant.example.test",
      CORPUS_EMBEDDING_LOCAL: "true",
    };
    expect(
      corpusEmbeddingConfiguration({
        ...base,
        CORPUS_EMBEDDING_PLACEMENT: "node",
      }),
    ).toMatchObject({
      complete: false,
      placement: "node",
      reason: "unsupported-placement",
      sendsSourceContentToThirdParties: false,
    });
    expect(
      corpusEmbeddingConfiguration({
        ...base,
        CORPUS_EMBEDDING_PLACEMENT: "hosted-core",
      }),
    ).toMatchObject({
      complete: true,
      placement: "hosted-core",
      reason: "configured",
      sendsSourceContentToThirdParties: true,
    });
  });

  test("cannot bypass managed accounting or node routing with an environment key", () => {
    const configured = {
      CORPUS_EMBEDDING_ENABLED: "true",
      CORPUS_EMBEDDING_PROVIDER: "openai-compatible",
      CORPUS_EMBEDDING_BASE_URL: "https://embeddings.example.test/v1",
      CORPUS_EMBEDDING_API_KEY: "operator-key",
      CORPUS_EMBEDDING_MODEL: "school-v1",
      CORPUS_EMBEDDING_DIMENSION: "3",
      CORPUS_VECTOR_URL: "https://qdrant.example.test",
    };
    expect(() =>
      createConfiguredCorpusVectorRuntime({
        ...configured,
        CORPUS_EMBEDDING_PLACEMENT: "hosted-core",
      }),
    ).toThrow("CORPUS_HOSTED_EMBEDDING_REQUIRES_METERED_EXECUTION_ROUTER");
    expect(() =>
      createConfiguredCorpusVectorRuntime({
        ...configured,
        CORPUS_EMBEDDING_PLACEMENT: "node",
      }),
    ).toThrow("CORPUS_NODE_EMBEDDING_REQUIRES_NODE_EXECUTION_ROUTER");
    expect(() =>
      createConfiguredCorpusVectorRuntime({
        ...configured,
        CORPUS_EMBEDDING_PLACEMENT: "full-self-host",
        AVERMATE_DEPLOYMENT_MODE: "hosted",
      }),
    ).toThrow("CORPUS_FULL_SELF_HOST_PLACEMENT_REQUIRES_SELF_HOST_MODE");

    expect(
      createConfiguredCorpusVectorRuntime({
        ...configured,
        CORPUS_EMBEDDING_PLACEMENT: "full-self-host",
        AVERMATE_DEPLOYMENT_MODE: "full-self-host",
      }),
    ).not.toBeNull();
  });

  test("injects the paired Node provider fetcher for Node embeddings", async () => {
    let nodeRequest: unknown;
    let providerBody: unknown;
    const runtime = await createOwnedCorpusVectorRuntime(
      "owner-1",
      {
        CORPUS_EMBEDDING_ENABLED: "true",
        CORPUS_EMBEDDING_PROVIDER: "openai-compatible",
        CORPUS_EMBEDDING_BASE_URL: "http://embedding-worker:8080/v1",
        CORPUS_EMBEDDING_MODEL: "embedding-fixture",
        CORPUS_EMBEDDING_DIMENSION: "3",
        CORPUS_EMBEDDING_PLACEMENT: "node",
        CORPUS_EMBEDDING_NODE_ID: "node-1",
        CORPUS_EMBEDDING_LOCAL: "true",
        CORPUS_VECTOR_URL: "http://qdrant:6333",
      },
      {
        readPublicationFence: async () => ({
          enabled: true,
          publicationEpoch: 0,
        }),
        createNodeFetcher: async (input) => {
          nodeRequest = input;
          return async (_url, init) => {
            providerBody = JSON.parse(String(init?.body));
            return Response.json({
              data: [{ index: 0, embedding: [1, 0, 0] }],
            });
          };
        },
      },
    );
    expect(nodeRequest).toEqual({
      ownerId: "owner-1",
      nodeId: "node-1",
      purpose: "embedding",
    });
    const vectors = await runtime!.embedding.embedText([
      { contentHash: "a".repeat(64), text: "contenu privé" },
    ]);
    expect(providerBody).toMatchObject({
      model: "embedding-fixture",
      input: ["contenu privé"],
      dimensions: 3,
    });
    expect(vectors[0]?.values).toEqual([1, 0, 0]);
  });

  test("carries the exact owner consent into the Gemini indexing and query runtime", async () => {
    const grantedAt = "2026-08-22T12:00:00.000Z";
    let consentActive = true;
    let consentLoads = 0;
    let publicationFence = { enabled: true, publicationEpoch: 4 };
    const runtime = await createOwnedCorpusVectorRuntime(
      "owner-1",
      {
        CORPUS_EMBEDDING_ENABLED: "true",
        CORPUS_EMBEDDING_PROVIDER: "gemini",
        CORPUS_EMBEDDING_DIMENSION: "768",
        CORPUS_EMBEDDING_PLACEMENT: "hosted-core",
        CORPUS_VECTOR_URL: "https://qdrant.example.test",
      },
      {
        readPublicationFence: async () => publicationFence,
        resolveServiceKey: async () => ({
          key: "fixture-key-never-sent",
          source: "user",
          invalidationToken: "fixture-cas-token",
        }),
        loadConsent: async () => {
          consentLoads += 1;
          return consentActive
            ? {
                provider: "gemini",
                capability: "embedding",
                disclosureRevision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
                grantedAt,
              }
            : null;
        },
      },
    );

    expect(runtime?.consent).toEqual({
      provider: "gemini",
      capability: "embedding",
      disclosureRevision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
      grantedAt,
    });
    expect(runtime?.embedding.descriptor()).toMatchObject({
      provider: "gemini",
      model: "gemini-embedding-2",
      dimensions: 768,
    });
    expect(consentLoads).toBe(1);
    await runtime?.authorizeEmbedding?.();
    expect(consentLoads).toBe(2);
    consentActive = false;
    await expect(runtime?.authorizeEmbedding?.()).rejects.toThrow(
      "EXPLICIT_CONSENT_REQUIRED",
    );
    expect(consentLoads).toBe(3);

    consentActive = true;
    publicationFence = { enabled: true, publicationEpoch: 6 };
    await expect(runtime?.authorizeEmbedding?.()).rejects.toThrow(
      "CORPUS_EMBEDDING_PUBLICATION_FENCE_CHANGED",
    );
    // A stale runtime is rejected at the owner fence before consent is read;
    // re-enabling at a newer epoch must not resurrect it.
    expect(consentLoads).toBe(3);
  });

  test("validates provider ordering, finiteness and exact dimensions", async () => {
    let requestBody: unknown;
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embeddings.example.test/v1",
      providerName: "fixture",
      model: "fixture-v1",
      dimension: 3,
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json({
          data: [
            { index: 1, embedding: [0, 1, 0] },
            { index: 0, embedding: [1, 0, 0] },
          ],
        });
      },
    });
    const result = await provider.embedText([
      { contentHash: "a".repeat(64), text: "texte privé A" },
      { contentHash: "b".repeat(64), text: "texte privé B" },
    ]);
    expect(requestBody).toEqual({
      model: "fixture-v1",
      input: ["texte privé A", "texte privé B"],
      dimensions: 3,
      encoding_format: "float",
    });
    expect(result.map((entry) => entry.values)).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);

    const malformed = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embeddings.example.test/v1",
      providerName: "fixture",
      model: "fixture-v1",
      dimension: 3,
      fetch: async () =>
        Response.json({ data: [{ index: 0, embedding: [1, 2] }] }),
    });
    await expect(
      malformed.embedText([{ contentHash: "c".repeat(64), text: "secret" }]),
    ).rejects.toThrow("dimension");
  });
});

describe("persistent Qdrant vector adapter", () => {
  test("reads a selected generation collection without consulting the active alias", async () => {
    const requests: string[] = [];
    const vector = new QdrantVectorIndex({
      baseUrl: "https://qdrant.example.test",
      collectionPrefix: "school",
      descriptor,
      ownerId: "owner-a",
      fetch: async (input, init) => {
        const url = String(input);
        requests.push(`${init?.method ?? "GET"} ${url}`);
        if ((init?.method ?? "GET") === "POST") {
          return Response.json({ result: { points: [] } });
        }
        return Response.json({
          result: { config: { params: { vectors: { size: 3 } } } },
        });
      },
    }).forGeneration("owner-a", "generation-a");

    expect((await vector.capabilities()).available).toBe(true);
    await vector.search({
      ownerId: "owner-a",
      spaceId: descriptor.id,
      values: [1, 0, 0],
      limit: 5,
    });

    expect(requests.some((request) => request.includes("_active"))).toBe(false);
    const collectionTargets = requests.map(
      (request) => request.match(/\/collections\/([^/]+)/u)?.[1] ?? null,
    );
    expect(collectionTargets).not.toContain(null);
    expect(new Set(collectionTargets).size).toBe(1);
  });

  test("filters ownership at query time and rejects hostile payload rows", async () => {
    let queryBody: Record<string, unknown> | null = null;
    const apiKeys: Array<string | null> = [];
    const vector = new QdrantVectorIndex({
      baseUrl: "https://qdrant.example.test",
      apiKey: "qdrant-secret",
      collectionPrefix: "school",
      descriptor,
      fetch: async (input, init) => {
        apiKeys.push(new Headers(init?.headers).get("api-key"));
        const url = String(input);
        if (init?.method === "POST" && url.endsWith("/points/query")) {
          queryBody = JSON.parse(String(init.body));
          return Response.json({
            result: {
              points: [
                {
                  score: 0.9,
                  payload: {
                    ownerId: "owner-a",
                    spaceId: descriptor.id,
                    sourceId: "source-a",
                    versionId: "version-a",
                    chunkId: "chunk-a",
                  },
                },
                {
                  score: 1,
                  payload: {
                    ownerId: "owner-b",
                    spaceId: descriptor.id,
                    sourceId: "private-source",
                    versionId: "private-version",
                    chunkId: "private-chunk",
                  },
                },
                {
                  score: 0.95,
                  payload: {
                    ownerId: "owner-a",
                    spaceId: descriptor.id,
                    sourceId: "source-current",
                    versionId: "current-n-plus-one",
                    chunkId: "hostile-unfenced-version",
                  },
                },
              ],
            },
          });
        }
        return Response.json({
          result: { config: { params: { vectors: { size: 3 } } } },
        });
      },
    });
    const found = await vector.search({
      ownerId: "owner-a",
      spaceId: descriptor.id,
      values: [1, 0, 0],
      limit: 5,
      versionIds: ["version-a"],
    });
    expect(apiKeys).toContain("qdrant-secret");
    expect(queryBody).toMatchObject({
      filter: {
        must: [
          { key: "ownerId", match: { value: "owner-a" } },
          { key: "spaceId", match: { value: descriptor.id } },
          { key: "versionId", match: { any: ["version-a"] } },
        ],
      },
    });
    expect(found.map((entry) => entry.chunkId)).toEqual(["chunk-a"]);
  });

  test("creates a space collection and switches the active alias in one transaction", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const vector = new QdrantVectorIndex({
      baseUrl: "http://qdrant.internal:6333",
      collectionPrefix: "school",
      descriptor,
      fetch: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        requests.push({ url, method, body });
        if (method === "GET" && url.includes("/collections/school_")) {
          return new Response(null, { status: 404 });
        }
        if (method === "GET" && url.endsWith("/aliases/school_active")) {
          return Response.json({
            result: { aliases: [{ alias_name: "school_active" }] },
          });
        }
        return Response.json({ result: true });
      },
    });
    await vector.activate();
    const activation = requests.find((entry) =>
      entry.url.endsWith("/collections/aliases"),
    );
    expect(activation?.method).toBe("POST");
    expect(activation?.body).toMatchObject({
      actions: [
        { delete_alias: { alias_name: "school_active" } },
        {
          create_alias: {
            alias_name: "school_active",
          },
        },
      ],
    });
  });
});
