import { describe, expect, test } from "bun:test";
import {
  corpusEmbeddingConfiguration,
  createConfiguredCorpusVectorRuntime,
  OpenAICompatibleEmbeddingProvider,
  QdrantVectorIndex,
} from "./vector-runtime";

const descriptor = {
  id: "space-test-v1",
  provider: "fixture",
  model: "embed-fixture",
  dimension: 3,
  distance: "cosine" as const,
  normalization: "fixture-v1",
  modality: "text" as const,
  preprocessingVersion: "fixture-v1",
};

describe("optional corpus embedding configuration", () => {
  test("requires an explicit opt-in and every non-secret endpoint field", () => {
    expect(corpusEmbeddingConfiguration({})).toMatchObject({
      complete: false,
      reason: "disabled",
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
        CORPUS_VECTOR_URL: "http://qdrant.test",
        CORPUS_EMBEDDING_LOCAL: "true",
      }),
    ).toMatchObject({
      complete: true,
      reason: "configured",
      sendsSourceContentToThirdParties: false,
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
    });
    expect(apiKeys).toContain("qdrant-secret");
    expect(queryBody).toMatchObject({
      filter: {
        must: [
          { key: "ownerId", match: { value: "owner-a" } },
          { key: "spaceId", match: { value: descriptor.id } },
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
