import { describe, expect, test } from "bun:test";
import {
  assertCitationQualityThresholds,
  evaluateCitationQuality,
} from "./citation-quality";
import {
  CITATION_EVALUATION_029,
  CITATION_EVALUATION_FIXTURE_VERSION,
} from "./fixtures/citation-evaluation-029";

const identity = {
  provider: "deterministic-protocol-fixture",
  model: "extractive-gold",
  modelVersion: "1",
  fixtureRevision: CITATION_EVALUATION_FIXTURE_VERSION,
};

describe("plan 029 deterministic citation-quality evaluation", () => {
  test("meets the pinned 40/20 faithfulness, precision, coverage and abstention gates", () => {
    const report = evaluateCitationQuality(CITATION_EVALUATION_029, identity);
    expect(report.answerableQuestions).toBe(40);
    expect(report.unanswerableQuestions).toBe(20);
    expect(report.supportedClaimFaithfulness).toEqual({
      numerator: 40,
      denominator: 40,
      value: 1,
    });
    expect(report.citationPrecision.value).toBe(1);
    expect(report.citationClaimCoverage.value).toBe(1);
    expect(report.abstentionRecall.value).toBe(1);
    expect(() => assertCitationQualityThresholds(report)).not.toThrow();
  });

  test("fails each metric independently instead of hiding it in an aggregate score", () => {
    const broken = CITATION_EVALUATION_029.map((answer, index) => {
      if (answer.answerable && index < 4) {
        return {
          ...answer,
          claims: answer.claims.map((claim) => ({
            ...claim,
            citedEvidenceIds:
              index === 0 ? [] : [`fabricated-${String(index)}`],
          })),
        };
      }
      if (!answer.answerable && index >= 40 && index < 43) {
        return { ...answer, abstained: false };
      }
      return answer;
    });
    const report = evaluateCitationQuality(broken, identity);
    expect(report.supportedClaimFaithfulness.value).toBeLessThan(0.95);
    expect(report.citationPrecision.value).toBeLessThan(0.95);
    expect(report.citationClaimCoverage.value).toBeLessThan(0.95);
    expect(report.abstentionRecall.value).toBeLessThan(0.9);
    expect(() => assertCitationQualityThresholds(report)).toThrow();
  });

  test("fails closed when answerable outputs contain no checkable claims or citations", () => {
    const vacuous = CITATION_EVALUATION_029.map((answer) =>
      answer.answerable
        ? { ...answer, abstained: true, claims: [] }
        : answer,
    );
    const report = evaluateCitationQuality(vacuous, identity);

    expect(report.supportedClaimFaithfulness.value).toBe(0);
    expect(report.citationPrecision.value).toBe(0);
    expect(report.citationClaimCoverage).toEqual({
      numerator: 0,
      denominator: 40,
      value: 0,
    });
    expect(() => assertCitationQualityThresholds(report)).toThrow();
  });
});
