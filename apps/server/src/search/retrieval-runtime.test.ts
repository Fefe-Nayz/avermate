import { describe, expect, test } from "bun:test";
import type { RerankProvider } from "@avermate/agent-contracts";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";

const imageDigest = `sha256:${"a".repeat(64)}`;

describe("configured rerank runtime", () => {
  test("projects an invalid hostile endpoint without exposing server topology or URL secrets", async () => {
    const { publicCorpusRerankConfiguration } =
      await import("./retrieval-runtime");
    const hostileUrl =
      "https://operator:private-token@rerank.internal:8443?api_key=do-not-return";
    const projection = publicCorpusRerankConfiguration({
      CORPUS_RERANK_ENABLED: "true",
      CORPUS_RERANK_PROVIDER: "tei",
      CORPUS_RERANK_MODEL: "Alibaba-NLP/gte-multilingual-reranker-base",
      CORPUS_RERANK_PLACEMENT: "node",
      CORPUS_RERANK_BASE_URL: hostileUrl,
      CORPUS_RERANK_NODE_ID: "private-node-identity",
      CORPUS_RERANK_MODEL_REVISION: "b".repeat(40),
      CORPUS_RERANK_IMAGE_DIGEST: imageDigest,
      CORPUS_RERANK_TEI_REVISION: "c".repeat(40),
    });

    expect(projection).toEqual({
      enabled: true,
      complete: false,
      provider: "tei",
      model: "Alibaba-NLP/gte-multilingual-reranker-base",
      modelRevision: "b".repeat(40),
      placement: "node",
      descriptorId: null,
      reason: "incomplete",
    });
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(hostileUrl);
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("private-node-identity");
    expect(serialized).not.toContain("rerank.internal");
  });

  test("injects the paired Node fetch transport into the TEI provider", async () => {
    const { createOwnedConfiguredRerankProvider } =
      await import("./retrieval-runtime");
    let fetcherRequested: unknown;
    const provider = await createOwnedConfiguredRerankProvider(
      "owner-1",
      {
        CORPUS_RERANK_ENABLED: "true",
        CORPUS_RERANK_PROVIDER: "tei",
        CORPUS_RERANK_MODEL: "Alibaba-NLP/gte-multilingual-reranker-base",
        CORPUS_RERANK_PLACEMENT: "node",
        CORPUS_RERANK_BASE_URL: "http://tei:8080",
        CORPUS_RERANK_NODE_ID: "node-1",
        CORPUS_RERANK_MODEL_REVISION: "b".repeat(40),
        CORPUS_RERANK_IMAGE_DIGEST: imageDigest,
        CORPUS_RERANK_TEI_REVISION: "c".repeat(40),
      },
      {
        createNodeFetcher: (async (input: {
          ownerId: string;
          nodeId?: string;
          purpose: "rerank";
        }) => {
          fetcherRequested = input;
          return async () => Response.json({ ranks: [] });
        }) as never,
      },
    );
    expect(fetcherRequested).toEqual({
      ownerId: "owner-1",
      nodeId: "node-1",
      purpose: "rerank",
    });
    expect(provider?.descriptor()).toMatchObject({
      provider: "tei",
      placement: "node",
      modalities: ["text"],
    });
  });

  test("selects the dedicated Qwen3 worker without presenting it as TEI", async () => {
    const { corpusRerankConfiguration, createOwnedConfiguredRerankProvider } =
      await import("./retrieval-runtime");
    const environment = {
      CORPUS_RERANK_ENABLED: "true",
      CORPUS_RERANK_PROVIDER: "qwen3",
      CORPUS_RERANK_MODEL: "Qwen/Qwen3-Reranker-0.6B",
      CORPUS_RERANK_PLACEMENT: "node",
      CORPUS_RERANK_BASE_URL: "http://qwen3-reranker:8080",
      CORPUS_RERANK_MODEL_REVISION: "e61197ed45024b0ed8a2d74b80b4d909f1255473",
      CORPUS_RERANK_IMAGE_DIGEST: imageDigest,
      CORPUS_RERANK_RUNTIME_REVISION:
        "sentence-transformers-5.4.0+transformers-4.57.3+torch-2.8.0",
    };
    expect(corpusRerankConfiguration(environment)).toMatchObject({
      complete: true,
      provider: "qwen3",
      placement: "node",
    });
    let creatorInput: unknown;
    const expected: RerankProvider = {
      descriptor: () => ({
        id: "rerank-fixture",
        provider: "qwen3",
        model: "Qwen/Qwen3-Reranker-0.6B",
        modelRevision: "fixture-v1",
        languages: ["multilingual"],
        modalities: ["text"],
        maximumCandidates: 128,
        maximumTokensPerCandidate: 8_192,
        scoreSemantics: "sigmoid-relevance",
        placement: "node",
        costUnit: "compute-token",
      }),
      rerank: async () => [],
    };
    const provider = await createOwnedConfiguredRerankProvider(
      "owner-1",
      environment,
      {
        createNodeProvider: (async (input: {
          ownerId: string;
          provider: "tei" | "qwen3";
        }) => {
          creatorInput = input;
          return expected;
        }) as never,
      },
    );
    expect(creatorInput).toMatchObject({
      provider: "qwen3",
      ownerId: "owner-1",
    });
    expect(provider).not.toBe(expected);
    expect(provider?.descriptor()).toEqual(expected.descriptor());
  });

  test("revalidates Cohere consent and credential on a stale runtime", async () => {
    const { createOwnedConfiguredRerankProvider } =
      await import("./retrieval-runtime");
    let consentActive = true;
    let consentLoads = 0;
    const credential = {
      key: "fixture-key-never-sent",
      source: "user" as const,
      invalidationToken: "fixture-credential-v1",
    };
    const provider = await createOwnedConfiguredRerankProvider(
      "owner-1",
      {
        CORPUS_RERANK_ENABLED: "true",
        CORPUS_RERANK_PROVIDER: "cohere",
        CORPUS_RERANK_MODEL: "rerank-v4.0-fast",
        CORPUS_RERANK_MODEL_REVISION: "rerank-v4.0-fast@fixture",
        CORPUS_RERANK_PLACEMENT: "core",
      },
      {
        resolveServiceKey: async () => credential,
        loadConsent: async () => {
          consentLoads += 1;
          return consentActive
            ? {
                provider: "cohere",
                capability: "rerank",
                disclosureRevision: "cohere-rerank-school-content/1",
                grantedAt: "2026-08-27T10:00:00.000Z",
              }
            : null;
        },
      },
    );

    expect(provider).not.toBeNull();
    expect(consentLoads).toBe(1);
    consentActive = false;
    await expect(
      provider!.rerank({
        operationId: "stale-cohere-runtime",
        query: "question privée",
        candidates: [
          { id: "chunk-a", text: "preuve privée", tokenEstimate: 3 },
        ],
        topN: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("COHERE_RERANK_EXPLICIT_CONSENT_REQUIRED");
    expect(consentLoads).toBe(2);
  });
});
