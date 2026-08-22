import { describe, expect, test } from "bun:test";
import {
  PairedNodeRerankProvider,
  reviewedQwen3TextRerankProfile,
  reviewedQwen3VlProfiles,
} from "./paired-node-rerank-provider";

const imageDigest = `sha256:${"a".repeat(64)}`;

describe("paired Node rerank provider", () => {
  test("normalizes the dedicated Qwen3 worker through RerankProvider", async () => {
    let requestBody: unknown;
    const provider = new PairedNodeRerankProvider({
      fetch: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json({
          ranks: [
            { index: 1, score: 0.9 },
            { index: 0, score: 0.2 },
          ],
        });
      },
      baseUrl: "http://qwen3-reranker:8080",
      provider: "qwen3",
      model: reviewedQwen3TextRerankProfile.model,
      modelRevision: reviewedQwen3TextRerankProfile.modelRevision,
      runtimeRevision: reviewedQwen3TextRerankProfile.runtimeRevision,
      imageDigest,
    });
    expect(provider.descriptor()).toMatchObject({
      provider: "qwen3",
      placement: "node",
      modalities: ["text"],
      maximumCandidates: 128,
    });
    const scores = await provider.rerank({
      operationId: "rerank-1",
      query: "mars",
      candidates: [
        { id: "candidate-1", text: "venus", tokenEstimate: 1 },
        { id: "candidate-2", text: "mars", tokenEstimate: 1 },
      ],
      topN: 1,
      signal: new AbortController().signal,
    });
    expect(requestBody).toEqual({
      query: "mars",
      texts: ["venus", "mars"],
      truncate: false,
      raw_scores: false,
      return_text: false,
    });
    expect(scores).toEqual([
      {
        operationId: "rerank-1",
        candidateId: "candidate-2",
        score: 0.9,
        rank: 0,
      },
    ]);
  });

  test("fails mutable pins and never advertises VL over the text-only lane", () => {
    expect(
      () =>
        new PairedNodeRerankProvider({
          fetch,
          baseUrl: "http://qwen3-reranker:8080",
          provider: "qwen3",
          model: reviewedQwen3TextRerankProfile.model,
          modelRevision: reviewedQwen3TextRerankProfile.modelRevision,
          runtimeRevision: "latest",
          imageDigest,
        }),
    ).toThrow("NODE_RERANK_IMMUTABLE_PIN_REQUIRED");
    expect(reviewedQwen3VlProfiles).toMatchObject({
      advertised: false,
      reason: "MULTIMODAL_OBJECT_TRANSFER_AND_PROVIDER_CONTRACT_NOT_CONFORMANT",
    });
  });
});
