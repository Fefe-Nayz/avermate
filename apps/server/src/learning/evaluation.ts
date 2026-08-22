import type {
  LearningCopyProposalV1,
  LearningErrorTaxonomy,
} from "../db/schema/learning";

export interface CopyEvaluationLabel {
  page: number;
  textIncludes: string;
  awarded: { value: number; outOf: number } | null;
  objectiveId?: string;
  errorTaxonomy?: LearningErrorTaxonomy;
}

export interface CopyEvaluationMetrics {
  labelledRegions: number;
  locatedRegions: number;
  regionRecall: number;
  scorePrecision: number;
  scoreRecall: number;
  objectiveTopKAccuracy: number | null;
  errorTaxonomyAccuracy: number | null;
  unsupportedScoreRate: number;
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 1 : numerator / denominator;
}

/**
 * Deterministic offline scorer for synthetic or separately consented/redacted
 * copy fixtures. It never stores or exports a user's source data.
 */
export function evaluateCopyProposal(
  proposal: LearningCopyProposalV1,
  labels: CopyEvaluationLabel[],
): CopyEvaluationMetrics {
  const predicted = proposal.pages.flatMap((page) =>
    page.regions.map((region) => ({ page: page.page, region })),
  );
  const matches = labels.map((label) => ({
    label,
    prediction: predicted.find(
      ({ page, region }) =>
        page === label.page &&
        region.text
          .toLocaleLowerCase("fr")
          .includes(label.textIncludes.toLocaleLowerCase("fr")),
    )?.region,
  }));
  const expectedScores = labels.filter((label) => label.awarded !== null);
  const predictedScores = predicted.filter(({ region }) => region.awarded);
  const correctScores = matches.filter(
    ({ label, prediction }) =>
      label.awarded !== null &&
      prediction?.awarded?.value === label.awarded.value &&
      prediction.awarded.outOf === label.awarded.outOf,
  ).length;
  const objectiveLabels = matches.filter(({ label }) => label.objectiveId);
  const correctObjectives = objectiveLabels.filter(
    ({ label, prediction }) =>
      prediction?.suggestedObjectiveIds.includes(label.objectiveId!) ?? false,
  ).length;
  const errorLabels = matches.filter(({ label }) => label.errorTaxonomy);
  const correctErrors = errorLabels.filter(
    ({ label, prediction }) =>
      prediction?.suggestedError?.taxonomy === label.errorTaxonomy,
  ).length;
  const unsupportedScores = matches.filter(
    ({ label, prediction }) =>
      label.awarded === null && prediction?.awarded !== undefined,
  ).length;

  return {
    labelledRegions: labels.length,
    locatedRegions: matches.filter(({ prediction }) => prediction).length,
    regionRecall: ratio(
      matches.filter(({ prediction }) => prediction).length,
      labels.length,
    ),
    scorePrecision: ratio(correctScores, predictedScores.length),
    scoreRecall: ratio(correctScores, expectedScores.length),
    objectiveTopKAccuracy: objectiveLabels.length
      ? correctObjectives / objectiveLabels.length
      : null,
    errorTaxonomyAccuracy: errorLabels.length
      ? correctErrors / errorLabels.length
      : null,
    unsupportedScoreRate: ratio(unsupportedScores, labels.length),
  };
}
