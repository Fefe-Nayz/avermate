import { describe, expect, test } from "bun:test";
import {
  assertFrenchSchoolQualityGate,
  assertFrenchSchoolRegressionGate,
  evaluateObservedRankings,
  evaluateFrenchSchoolFixture,
  evaluateFixtureRanking,
  frenchSchoolFixture,
} from "./evaluation";

describe("French-school retrieval evaluation", () => {
  test("keeps a reviewed multimodal fixture with exact locators", () => {
    expect(frenchSchoolFixture.queries.length).toBeGreaterThanOrEqual(8);
    expect(
      new Set(frenchSchoolFixture.documents.map((entry) => entry.modality))
        .size,
    ).toBeGreaterThanOrEqual(8);
    expect(
      frenchSchoolFixture.documents.every((entry) => entry.locator.kind),
    ).toBe(true);
  });

  test("reports the complete required metric set and deterministic digests", () => {
    const first = evaluateFrenchSchoolFixture();
    const second = evaluateFrenchSchoolFixture();
    expect(first).toEqual(second);
    expect(Object.keys(evaluateFixtureRanking("rrf"))).toEqual([
      "recallAt5",
      "recallAt10",
      "recallAt20",
      "mrrAt10",
      "ndcgAt10",
      "map",
      "sourceDiversityAt10",
      "citationLocatorAccuracy",
      "multimodalRelevantRecallAt10",
    ]);
  });

  test("labels pre-ranked results as regression evidence, never live quality", () => {
    const report = evaluateFrenchSchoolFixture();
    expect(report).toMatchObject({
      evidenceClass: "deterministic-pre-ranked-regression-fixture",
      provesLiveProviderQuality: false,
    });
    expect(assertFrenchSchoolRegressionGate()).toEqual(
      assertFrenchSchoolQualityGate(),
    );
  });

  test("scores real run observations without inventing unknown provider cost", () => {
    const metrics = evaluateObservedRankings({
      documents: [
        {
          id: "relevant",
          sourceId: "lesson",
          modality: "diagram",
          locator: { kind: "pdf", page: 2 },
        },
        {
          id: "noise",
          sourceId: "other",
          modality: "native-pdf",
          locator: { kind: "pdf", page: 1 },
        },
      ],
      queries: [
        {
          id: "q1",
          relevance: [{ documentId: "relevant", grade: 3 }],
        },
      ],
      observations: [
        {
          queryId: "q1",
          rankedDocumentIds: ["relevant", "noise"],
          citationDocumentIds: ["relevant"],
          abstained: false,
          latencyMs: 42,
          providerCostMinor: null,
        },
      ],
    });
    expect(metrics).toMatchObject({
      recallAt10: 1,
      citationPrecisionAt10: 1,
      citationCoverageAt10: 1,
      abstentionAccuracy: 1,
      p50LatencyMs: 42,
      p95LatencyMs: 42,
      totalProviderCostMinor: null,
    });
  });
});
