import { describe, expect, test } from "bun:test";
import {
  deriveProjectRetrievalPolicyState,
  type ProjectRetrievalPolicyEnvironment,
} from "./project-retrieval-policy-state";

const embeddingSpace = {
  id: "emb_current",
  provider: "gemini",
  model: "gemini-embedding-2-preview",
  modelRevision: "stable-2026-04",
  dimensions: 1536,
  modalities: ["text", "image", "pdf-page"] as (
    "text" | "image" | "pdf-page"
  )[],
  normalization: "provider-unit" as const,
  preprocessingRevision: "avermate-retrieval-v1",
  placement: "core" as const,
  registered: true,
};

const rerankSpace = {
  id: "rerank_current",
  provider: "cohere",
  model: "rerank-v4.0-fast",
  modelRevision: "2026-01",
  languages: ["fr", "en"],
  modalities: ["text"] as ["text"],
  maximumCandidates: 100,
  maximumTokensPerCandidate: 4_096,
  scoreSemantics: "relevance-ordered" as const,
  placement: "core" as const,
  costUnit: "search-unit" as const,
};

function environment(
  overrides: Partial<ProjectRetrievalPolicyEnvironment> = {},
): ProjectRetrievalPolicyEnvironment {
  return {
    lexical: {
      available: true,
      implementation: "sqlite-fts5-unicode61-v1",
    },
    embedding: {
      configurationReady: true,
      provider: "gemini",
      placement: "hosted-core",
      sendsSourceContentToThirdParties: true,
      credentialReady: true,
      consentRequired: true,
      consentReady: true,
      runtimeReady: true,
      vectorAvailable: true,
      vectorImplementation: "qdrant-v1",
      compatibleSpace: embeddingSpace,
    },
    rerank: {
      configurationReady: true,
      provider: "cohere",
      placement: "core",
      credentialReady: true,
      consentRequired: true,
      consentReady: true,
      runtimeReady: true,
      compatibleSpace: rerankSpace,
    },
    generation: {
      id: "egen_current",
      state: "active",
      eligibleVersionCount: 3,
      indexedVersionCount: 3,
      unsupportedVersionCount: 0,
    },
    ...overrides,
  };
}

describe("project retrieval policy state", () => {
  test("keeps lexical-only active without claiming optional providers are active", () => {
    const state = deriveProjectRetrievalPolicyState(
      {
        projectId: "project-a",
        revision: 4,
        retrievalMode: "lexical-only",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: null,
        rerankSpaceId: null,
      },
      environment({
        embedding: {
          ...environment().embedding,
          configurationReady: false,
          runtimeReady: false,
          vectorAvailable: false,
          compatibleSpace: null,
        },
      }),
    );

    expect(state).toMatchObject({
      status: "active",
      effectiveMode: "lexical",
      fallbackActive: false,
      reasons: [],
    });
  });

  test("reports an exact active reranked pipeline only for compatible spaces and coverage", () => {
    const state = deriveProjectRetrievalPolicyState(
      {
        projectId: "project-a",
        revision: 5,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: embeddingSpace.id,
        rerankSpaceId: rerankSpace.id,
      },
      environment(),
    );

    expect(state).toMatchObject({
      status: "active",
      effectiveMode: "reranked",
      fallbackActive: false,
      reasons: [],
      embedding: { selectedSpaceCompatible: true },
      rerank: { selectedSpaceCompatible: true },
      reindex: { required: false, indexedVersionCount: 3 },
    });
  });

  test("degrades to the selected fallback and exposes reindexing separately", () => {
    const state = deriveProjectRetrievalPolicyState(
      {
        projectId: "project-a",
        revision: 6,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: embeddingSpace.id,
        rerankSpaceId: rerankSpace.id,
      },
      environment({
        generation: {
          id: null,
          state: null,
          eligibleVersionCount: 3,
          indexedVersionCount: 0,
          unsupportedVersionCount: 0,
        },
      }),
    );

    expect(state.status).toBe("degraded");
    expect(state.effectiveMode).toBe("lexical");
    expect(state.fallbackActive).toBe(true);
    expect(state.reasons).toEqual(["embedding-reindex-required"]);
    expect(state.reindex).toMatchObject({ required: true, canReindex: true });
  });

  test("treats a missing first generation as rebuildable bootstrap, not a vector outage", () => {
    const state = deriveProjectRetrievalPolicyState(
      {
        projectId: "project-fresh",
        revision: 1,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: embeddingSpace.id,
        rerankSpaceId: rerankSpace.id,
      },
      environment({
        embedding: {
          ...environment().embedding,
          vectorAvailable: false,
          vectorImplementation: "vector-generation-unavailable",
        },
        generation: {
          id: null,
          state: null,
          eligibleVersionCount: 3,
          indexedVersionCount: 0,
          unsupportedVersionCount: 0,
        },
      }),
    );

    expect(state).toMatchObject({
      status: "degraded",
      effectiveMode: "lexical",
      reasons: ["embedding-reindex-required"],
      reindex: { required: true, canReindex: true, generationId: null },
    });
    expect(state.reasons).not.toContain("vector-index-unavailable");
  });

  test("keeps a missing published generation distinct from a failed vector backend", () => {
    const state = deriveProjectRetrievalPolicyState(
      {
        projectId: "project-published",
        revision: 3,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "fail",
        embeddingSpaceId: embeddingSpace.id,
        rerankSpaceId: rerankSpace.id,
      },
      environment({
        embedding: {
          ...environment().embedding,
          vectorAvailable: false,
          vectorImplementation: "qdrant-unavailable",
        },
        generation: {
          id: "egen-published",
          state: "active",
          eligibleVersionCount: 3,
          indexedVersionCount: 3,
          unsupportedVersionCount: 0,
        },
      }),
    );

    expect(state.reasons).toContain("vector-index-unavailable");
    expect(state.reindex.canReindex).toBe(false);
  });

  test("uses hybrid-without-rerank only when dense retrieval is genuinely ready", () => {
    const unavailableRerank = {
      ...environment().rerank,
      runtimeReady: false,
      compatibleSpace: null,
    };
    const state = deriveProjectRetrievalPolicyState(
      {
        projectId: "project-a",
        revision: 7,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "hybrid-without-rerank",
        embeddingSpaceId: embeddingSpace.id,
        rerankSpaceId: rerankSpace.id,
      },
      environment({ rerank: unavailableRerank }),
    );

    expect(state.status).toBe("degraded");
    expect(state.effectiveMode).toBe("hybrid");
    expect(state.reasons).toContain("rerank-runtime-unavailable");
    expect(state.reasons).toContain("rerank-space-incompatible");
  });

  test("fails closed when an eligible source is not on the Core embedding plane", () => {
    const state = deriveProjectRetrievalPolicyState(
      {
        projectId: "project-a",
        revision: 8,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: embeddingSpace.id,
        rerankSpaceId: rerankSpace.id,
      },
      environment({
        generation: {
          id: "egen-current",
          state: "active",
          eligibleVersionCount: 2,
          indexedVersionCount: 2,
          unsupportedVersionCount: 1,
        },
      }),
    );

    expect(state).toMatchObject({
      status: "degraded",
      effectiveMode: "lexical",
      fallbackActive: true,
      reindex: {
        required: false,
        eligibleVersionCount: 2,
        indexedVersionCount: 2,
        unsupportedVersionCount: 1,
      },
    });
    expect(state.reasons).toContain("embedding-source-placement-unsupported");
  });
});
