import { describe, expect, test } from "bun:test";
import type {
  LexicalCandidate,
  RerankProvider,
} from "@avermate/agent-contracts";
import type { SqliteFts5LexicalSearchBackend } from "./lexical";
import type { CorpusVectorRuntime } from "./vector-runtime";
import { hybridCorpusSearch } from "./hybrid";

const embeddingSpaceId = "embedding-space-fixture";
const rerankSpaceId = "rerank-space-fixture";
const texts = new Map([
  ["chunk-lexical", "La photosynthèse transforme l'énergie lumineuse."],
  ["chunk-dense", "Les chloroplastes produisent de la matière organique."],
  ["chunk-neighbor", "Cette réaction libère également du dioxygène."],
]);

function locator(text: string) {
  return { kind: "text" as const, startOffset: 0, endOffset: text.length };
}

function candidate(
  chunkId: string,
  sourceId: string,
  versionId: string,
  ordinal: number,
  score: number,
): LexicalCandidate {
  const text = texts.get(chunkId)!;
  return {
    sourceId,
    versionId,
    chunkId,
    ordinal,
    score,
    snippet: text,
    locator: locator(text),
    contentHash: ordinal.toString(16).padStart(64, "a").slice(-64),
    evidenceKind: "native-text",
  };
}

const lexicalCandidates = [
  candidate("chunk-lexical", "source-a", "version-a", 0, 10),
  candidate("chunk-neighbor", "source-a", "version-a", 1, 5),
];
const allCandidates = [
  ...lexicalCandidates,
  candidate("chunk-dense", "source-b", "version-b", 0, 9),
];

function fakeClient(
  fallbackPolicy: "fail" | "lexical-only" | "hybrid-without-rerank",
) {
  return {
    async execute(input: string | { sql: string }) {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("FROM study_projects")) {
        return {
          rows: [
            {
              id: "project-a",
              retrievalMode: "advanced-auto",
              retrievalFallbackPolicy: fallbackPolicy,
              embeddingSpaceId,
              rerankSpaceId,
            },
          ],
        };
      }
      if (
        sql.includes("SELECT chunks.id AS chunkId") &&
        !sql.includes("chunks.text")
      ) {
        return {
          rows: allCandidates.map((entry) => ({
            chunkId: entry.chunkId,
            versionId: entry.versionId,
            ordinal: entry.ordinal,
            contentHash: entry.contentHash,
            locatorJson: JSON.stringify(entry.locator),
            evidenceKind: entry.evidenceKind,
            sourceId: entry.sourceId,
          })),
        };
      }
      if (sql.includes("SELECT chunks.id, chunks.text")) {
        return {
          rows: allCandidates.map((entry) => ({
            id: entry.chunkId,
            text: texts.get(entry.chunkId),
            tokenEstimate: 12,
            headingPathJson: JSON.stringify(["SVT", "Photosynthèse"]),
          })),
        };
      }
      if (
        sql.includes("SELECT chunks.id AS chunkId") &&
        sql.includes("chunks.text")
      ) {
        return {
          rows: allCandidates.map((entry) => ({
            chunkId: entry.chunkId,
            versionId: entry.versionId,
            ordinal: entry.ordinal,
            text: texts.get(entry.chunkId),
            tokenEstimate: 12,
            contentHash: entry.contentHash,
            locatorJson: JSON.stringify(entry.locator),
            headingPathJson: JSON.stringify(["SVT", "Photosynthèse"]),
            evidenceKind: entry.evidenceKind,
            sourceId: entry.sourceId,
          })),
        };
      }
      throw new Error(`Unexpected hybrid-search query: ${sql}`);
    },
    async transaction() {
      throw new Error("Hybrid retrieval must not mutate through a transaction");
    },
  };
}

const lexical = {
  search: async () => lexicalCandidates,
} as unknown as SqliteFts5LexicalSearchBackend;

const runtime = {
  embedding: {
    descriptor: () => ({
      id: embeddingSpaceId,
      provider: "fixture",
      model: "fixture-embedding",
      modelRevision: "fixture-embedding@1",
      dimensions: 3,
      modalities: ["text" as const],
      normalization: "provider-unit" as const,
      preprocessingRevision: "fixture-v1",
      placement: "node" as const,
    }),
    embedText: async (input: readonly { contentHash: string }[]) =>
      input.map((entry) => ({
        contentHash: entry.contentHash,
        values: [1, 0, 0],
      })),
  },
  vector: {
    capabilities: async () => ({
      available: true,
      implementation: "fixture-vector-index",
      dimensions: [3],
    }),
    search: async () => [
      {
        sourceId: "source-b",
        versionId: "version-b",
        chunkId: "chunk-dense",
        score: 0.98,
      },
      {
        sourceId: "source-a",
        versionId: "version-a",
        chunkId: "chunk-lexical",
        score: 0.72,
      },
    ],
  },
} as unknown as CorpusVectorRuntime;

function reranker(options: { fail?: boolean } = {}): RerankProvider {
  return {
    descriptor: () => ({
      id: rerankSpaceId,
      provider: "fixture",
      model: "fixture-reranker",
      modelRevision: "fixture-reranker@1",
      languages: ["fr"],
      modalities: ["text"],
      maximumCandidates: 50,
      maximumTokensPerCandidate: 8_192,
      scoreSemantics: "sigmoid-relevance",
      placement: "node",
      costUnit: "compute-token",
    }),
    rerank: async ({ operationId, candidates, topN }) => {
      if (options.fail) throw new Error("fixture-reranker-offline");
      const order = ["chunk-dense", "chunk-lexical", "chunk-neighbor"];
      return candidates
        .filter((entry) => order.includes(entry.id))
        .sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id))
        .slice(0, topN)
        .map((entry, rank) => ({
          operationId,
          candidateId: entry.id,
          rank,
          score: 1 - rank / 10,
        }));
    },
  };
}

function query(
  fallbackPolicy: "fail" | "lexical-only" | "hybrid-without-rerank",
) {
  return {
    ownerId: "owner-a",
    query: "Comment fonctionne la photosynthèse ?",
    mode: "terms" as const,
    projectIds: ["project-a"],
    yearIds: [],
    subjectIds: [],
    originKinds: [],
    limit: 2,
    cursor: null,
    fallbackPolicy,
    operationId: `operation-${fallbackPolicy}`,
  };
}

describe("advanced hybrid retrieval pipeline", () => {
  test("executes dense retrieval, RRF, reranking, expansion and bounded packing", async () => {
    const result = await hybridCorpusSearch(query("fail"), {
      client: fakeClient("fail") as never,
      lexical,
      runtime,
      reranker: reranker(),
      corpusGenerationId: "generation-fixture",
      persistTrace: false,
    });

    expect(result.retrievalMode).toBe("reranked");
    expect(result.vectorUsed).toBe(true);
    expect(result.rerankUsed).toBe(true);
    expect(result.candidates[0]?.chunkId).toBe("chunk-dense");
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chunkId: "chunk-lexical" }),
      ]),
    );
    expect(result.stages.map((entry) => entry.stage)).toEqual([
      "scope",
      "lexical",
      "dense",
      "fusion",
      "diversity",
      "rerank",
      "expansion",
      "packing",
    ]);
    expect(result.stages.every((entry) => entry.status === "used")).toBe(true);
  });

  test("keeps the dense result and records degradation when reranking is unavailable", async () => {
    const result = await hybridCorpusSearch(query("hybrid-without-rerank"), {
      client: fakeClient("hybrid-without-rerank") as never,
      lexical,
      runtime,
      reranker: reranker({ fail: true }),
      corpusGenerationId: "generation-fixture",
      persistTrace: false,
    });

    expect(result.retrievalMode).toBe("hybrid");
    expect(result.vectorUsed).toBe(true);
    expect(result.rerankUsed).toBe(false);
    expect(result.fallbackReason).toBe("rerank:fixture-reranker-offline");
    expect(
      result.stages.find((entry) => entry.stage === "rerank"),
    ).toMatchObject({
      status: "degraded",
      safeReason: "fixture-reranker-offline",
    });
  });

  test("fails closed when an advanced project forbids reranker fallback", async () => {
    await expect(
      hybridCorpusSearch(query("fail"), {
        client: fakeClient("fail") as never,
        lexical,
        runtime,
        reranker: reranker({ fail: true }),
        corpusGenerationId: "generation-fixture",
        persistTrace: false,
      }),
    ).rejects.toThrow("RETRIEVAL_RERANK_FAILED");
  });
});
