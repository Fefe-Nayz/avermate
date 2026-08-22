import { describe, expect, test } from "bun:test";
import type {
  RerankProvider,
  RerankSpaceDescriptor,
} from "@avermate/agent-contracts";
import {
  deduplicateRetrievalCandidates,
  diversifyRetrievalCandidates,
  expandParentAndNeighbors,
  packRetrievalContext,
  rerankRetrievalCandidates,
  type PolicyCandidate,
} from "./retrieval-policy";

function candidate(
  id: string,
  sourceId: string,
  page: number,
  ordinal: number,
  score: number,
): PolicyCandidate {
  return {
    sourceId,
    versionId: `version-${sourceId}`,
    chunkId: id,
    ordinal,
    score,
    fusedScore: score,
    channels: ["lexical"],
    snippet: `preuve ${id}`,
    text: `preuve complète ${id}`,
    tokenEstimate: 3,
    locator: { kind: "pdf", page },
    contentHash: id.padEnd(64, "a").slice(0, 64),
    evidenceKind: "native-text",
    headingPath: ["Chapitre", `Section ${page}`],
  };
}

describe("advanced retrieval policy", () => {
  test("deduplicates immutable pages then diversifies sources deterministically", () => {
    const candidates = [
      candidate("a1", "a", 1, 0, 0.9),
      candidate("a2", "a", 1, 1, 0.8),
      candidate("a3", "a", 2, 2, 0.7),
      candidate("b1", "b", 1, 0, 0.6),
      candidate("c1", "c", 1, 0, 0.5),
    ];
    const deduplicated = deduplicateRetrievalCandidates(candidates);
    expect(deduplicated.map((entry) => entry.chunkId)).toEqual([
      "a1",
      "a3",
      "b1",
      "c1",
    ]);
    expect(
      diversifyRetrievalCandidates(deduplicated, {
        limit: 3,
        maximumPerSource: 2,
        maximumPerLocator: 1,
      }).map((entry) => entry.chunkId),
    ).toEqual(["a1", "b1", "c1"]);
  });

  test("keeps winners ahead of neighbor expansion and enforces packing budgets", () => {
    const winnerA = candidate("a1", "a", 1, 1, 0.9);
    const winnerB = candidate("b1", "b", 1, 0, 0.8);
    const neighbor = candidate("a2", "a", 2, 2, 0.1);
    const expanded = expandParentAndNeighbors(
      [winnerA, winnerB],
      [winnerA, winnerB, neighbor],
    );
    expect(expanded.map((entry) => entry.chunkId)).toEqual([
      "a1",
      "b1",
      "a2",
    ]);
    expect(expanded[2]?.expandedFromId).toBe("a1");
    const packed = packRetrievalContext(expanded, {
      maximumTokens: 6,
      maximumUtf8Bytes: 1024,
      maximumVisualItems: 2,
      maximumEvidenceItems: 2,
    });
    expect(packed.packed.map((entry) => entry.chunkId)).toEqual(["a1", "b1"]);
    expect(packed.excluded[0]?.reason).toBe("evidence-count");
  });

  test("fails closed on duplicate provider ids even behind the neutral contract", async () => {
    const descriptor: RerankSpaceDescriptor = {
      id: "hostile-reranker",
      provider: "fixture",
      model: "fixture",
      modelRevision: "fixture-1",
      languages: ["fr"],
      modalities: ["text"],
      maximumCandidates: 10,
      maximumTokensPerCandidate: 100,
      scoreSemantics: "relevance-ordered",
      placement: "node",
      costUnit: "none",
    };
    const provider: RerankProvider = {
      descriptor: () => descriptor,
      rerank: async ({ operationId, candidates }) => [
        {
          operationId,
          candidateId: candidates[0]!.id,
          score: 1,
          rank: 0,
        },
        {
          operationId,
          candidateId: candidates[0]!.id,
          score: 0.5,
          rank: 1,
        },
      ],
    };
    await expect(
      rerankRetrievalCandidates({
        operationId: "operation",
        query: "question",
        candidates: [
          candidate("a1", "a", 1, 0, 0.9),
          candidate("b1", "b", 1, 0, 0.8),
        ],
        provider,
        topN: 2,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("OUTSIDE_OPERATION");
  });
});
