export const CITATION_QUALITY_RUBRIC_VERSION = "citation-quality/1" as const;

export const CITATION_QUALITY_THRESHOLDS = Object.freeze({
  supportedClaimFaithfulness: 0.95,
  citationPrecision: 0.95,
  citationClaimCoverage: 0.95,
  abstentionRecall: 0.9,
});

const CITATION_QUALITY_METRIC_NAMES = [
  "supportedClaimFaithfulness",
  "citationPrecision",
  "citationClaimCoverage",
  "abstentionRecall",
] satisfies readonly (keyof typeof CITATION_QUALITY_THRESHOLDS)[];

export type LabelledCitationClaim = {
  id: string;
  text: string;
  externallyCheckable: boolean;
  /** Immutable evidence IDs that the human-authored gold label accepts. */
  supportingEvidenceIds: readonly string[];
  /** Evidence IDs explicitly linked to this claim by the candidate answer. */
  citedEvidenceIds: readonly string[];
};

export type LabelledCitationAnswer = {
  id: string;
  answerable: boolean;
  abstained: boolean;
  claims: readonly LabelledCitationClaim[];
};

export type CitationMetric = {
  numerator: number;
  denominator: number;
  value: number;
};

export type CitationQualityReport = {
  rubricVersion: typeof CITATION_QUALITY_RUBRIC_VERSION;
  evaluationIdentity: CitationEvaluationIdentity;
  answerableQuestions: number;
  unanswerableQuestions: number;
  supportedClaimFaithfulness: CitationMetric;
  citationPrecision: CitationMetric;
  citationClaimCoverage: CitationMetric;
  abstentionRecall: CitationMetric;
};

export type CitationEvaluationIdentity = {
  provider: string;
  model: string;
  modelVersion: string;
  fixtureRevision: string;
};

function metric(numerator: number, denominator: number): CitationMetric {
  return {
    numerator,
    denominator,
    // A release gate must fail closed: producing no claim or citation is not a
    // perfect score for an answerable evaluation set.
    value: denominator === 0 ? 0 : numerator / denominator,
  };
}

/**
 * Deterministic scorer for human-labelled answer/evidence pairs. It does not
 * pretend that lexical overlap proves entailment: support is supplied by the
 * reviewed gold labels, while this function measures linkage and abstention.
 */
export function evaluateCitationQuality(
  answers: readonly LabelledCitationAnswer[],
  evaluationIdentity: CitationEvaluationIdentity,
): CitationQualityReport {
  const ids = new Set<string>();
  let citedClaims = 0;
  let faithfulCitedClaims = 0;
  let citations = 0;
  let preciseCitations = 0;
  let checkableClaims = 0;
  let coveredClaims = 0;
  let answerableQuestions = 0;
  let unanswerableQuestions = 0;
  let correctAbstentions = 0;

  for (const answer of answers) {
    if (ids.has(answer.id))
      throw new Error(`Duplicate evaluation answer: ${answer.id}`);
    ids.add(answer.id);
    if (answer.answerable) {
      answerableQuestions += 1;
    } else {
      unanswerableQuestions += 1;
      if (answer.abstained) correctAbstentions += 1;
    }

    const claimIds = new Set<string>();
    let hasCheckableClaim = false;
    for (const claim of answer.claims) {
      if (claimIds.has(claim.id)) {
        throw new Error(`Duplicate claim ${claim.id} in ${answer.id}`);
      }
      claimIds.add(claim.id);
      const accepted = new Set(claim.supportingEvidenceIds);
      const cited = [...new Set(claim.citedEvidenceIds)];
      if (claim.externallyCheckable) {
        hasCheckableClaim = true;
        checkableClaims += 1;
        if (cited.some((evidenceId) => accepted.has(evidenceId))) {
          coveredClaims += 1;
        }
      }
      if (claim.externallyCheckable && cited.length > 0) {
        citedClaims += 1;
        if (
          accepted.size > 0 &&
          cited.every((evidenceId) => accepted.has(evidenceId))
        ) {
          faithfulCitedClaims += 1;
        }
      }
      citations += cited.length;
      preciseCitations += cited.filter((evidenceId) =>
        accepted.has(evidenceId),
      ).length;
    }
    // Every question in the answerable release set is expected to yield at
    // least one corpus-grounded claim. Count an empty/only-generic answer as an
    // uncovered slot so silence cannot make coverage vacuously perfect.
    if (answer.answerable && !hasCheckableClaim) checkableClaims += 1;
  }

  return {
    rubricVersion: CITATION_QUALITY_RUBRIC_VERSION,
    evaluationIdentity,
    answerableQuestions,
    unanswerableQuestions,
    supportedClaimFaithfulness: metric(faithfulCitedClaims, citedClaims),
    citationPrecision: metric(preciseCitations, citations),
    citationClaimCoverage: metric(coveredClaims, checkableClaims),
    abstentionRecall: metric(correctAbstentions, unanswerableQuestions),
  };
}

export function assertCitationQualityThresholds(report: CitationQualityReport) {
  if (report.answerableQuestions < 40 || report.unanswerableQuestions < 20) {
    throw new Error(
      `Citation evaluation requires at least 40 answerable and 20 unanswerable questions; received ${report.answerableQuestions}/${report.unanswerableQuestions}`,
    );
  }
  for (const name of CITATION_QUALITY_METRIC_NAMES) {
    const threshold = CITATION_QUALITY_THRESHOLDS[name];
    const result = report[name];
    if (result.value < threshold) {
      throw new Error(
        `${name} ${result.numerator}/${result.denominator} (${result.value.toFixed(4)}) is below ${threshold.toFixed(2)}`,
      );
    }
  }
}
