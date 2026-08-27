import { describe, expect, test } from "bun:test";
import type { LexicalCandidate } from "@avermate/agent-contracts";
import {
  composeAssistantRetrievalCandidates,
  type RetrievedCandidate,
} from "./run-service";

function visualPage(page: number, fusedScore: number): RetrievedCandidate {
  const title = "Cours de physique";
  const base: LexicalCandidate = {
    sourceId: "source-scan",
    versionId: "snapshot-n",
    chunkId: `visual-page-${page}`,
    ordinal: page - 1,
    score: fusedScore,
    snippet: title,
    locator: { kind: "pdf", page },
    contentHash: page.toString(16).padStart(64, "0"),
    evidenceKind: "visual-only",
  };
  return {
    ...base,
    channels: ["dense"],
    fusedScore,
    text: title,
    tokenEstimate: 5,
    headingPath: null,
  };
}

describe("assistant retrieval composition", () => {
  test("keeps the hybrid visual page ahead of a same-title lexical snapshot window", () => {
    const query = "Cours de physique";
    const densePage = visualPage(27, 1);
    const lexicalFallback = Array.from({ length: 30 }, (_, index) => ({
      ...visualPage(index + 1, 1 / (61 + index)),
      channels: ["lexical" as const],
    }));

    const selected = composeAssistantRetrievalCandidates({
      explicitHybrid: [densePage],
      snapshotLexicalFallback: lexicalFallback,
      remainingTiers: [],
      limit: 12,
    });

    expect(query).toBe("Cours de physique");
    expect(selected).toHaveLength(12);
    expect(selected[0]).toMatchObject({
      chunkId: "visual-page-27",
      channels: ["dense"],
      locator: { kind: "pdf", page: 27 },
    });
    expect(
      selected.filter((candidate) => candidate.chunkId === "visual-page-27"),
    ).toHaveLength(1);
  });
});
