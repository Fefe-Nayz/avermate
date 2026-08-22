import type {
  LiveEvidenceManifest,
  LiveEvidencePolicy,
} from "./live-evidence-contract";

export const PLAN037_POLICY_VERSION = "plan-037-live-v2";
export const PLAN037_EVALUATION_POLICY_VERSION = "learning-evaluation-v1";

export const PLAN037_EVIDENCE_KINDS = [
  "copy-analysis-provider",
  "labelled-learning-evaluation",
  "copy-to-mastery-web",
  "provider-grade-integrity",
  "node-export-delete-retention",
] as const;

export type Plan037EvidenceKind = (typeof PLAN037_EVIDENCE_KINDS)[number];

export const PLAN037_THRESHOLDS = Object.freeze({
  minimumSamples: 30,
  minimumRegionRecall: 0.9,
  minimumScorePrecision: 0.95,
  minimumScoreRecall: 0.9,
  minimumObjectiveTopKAccuracy: 0.9,
  minimumErrorTaxonomyAccuracy: 0.85,
  maximumUnsupportedScoreRate: 0.02,
});

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteAtLeast(value: unknown, minimum: number) {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum
  );
}

function finiteAtMost(value: unknown, maximum: number) {
  return (
    typeof value === "number" && Number.isFinite(value) && value <= maximum
  );
}

function exactZero(value: unknown) {
  return value === 0;
}

function validateMeasurements(kind: Plan037EvidenceKind, input: unknown) {
  const value = object(input);
  if (!value) return false;
  switch (kind) {
    case "copy-analysis-provider":
      return (
        nonEmpty(value.provider) &&
        nonEmpty(value.modelRevision) &&
        nonEmpty(value.promptRevision) &&
        finiteAtLeast(value.copyCount, 1) &&
        finiteAtLeast(value.pageCount, value.copyCount as number) &&
        value.exactLocatorsPassed === true &&
        exactZero(value.crossOwnerLeaks)
      );
    case "labelled-learning-evaluation":
      return (
        value.evaluationPolicyVersion === PLAN037_EVALUATION_POLICY_VERSION &&
        nonEmpty(value.algorithmVersion) &&
        nonEmpty(value.datasetRevision) &&
        finiteAtLeast(value.sampleCount, PLAN037_THRESHOLDS.minimumSamples) &&
        finiteAtLeast(
          value.regionRecall,
          PLAN037_THRESHOLDS.minimumRegionRecall,
        ) &&
        finiteAtLeast(
          value.scorePrecision,
          PLAN037_THRESHOLDS.minimumScorePrecision,
        ) &&
        finiteAtLeast(
          value.scoreRecall,
          PLAN037_THRESHOLDS.minimumScoreRecall,
        ) &&
        finiteAtLeast(
          value.objectiveTopKAccuracy,
          PLAN037_THRESHOLDS.minimumObjectiveTopKAccuracy,
        ) &&
        finiteAtLeast(
          value.errorTaxonomyAccuracy,
          PLAN037_THRESHOLDS.minimumErrorTaxonomyAccuracy,
        ) &&
        finiteAtMost(
          value.unsupportedScoreRate,
          PLAN037_THRESHOLDS.maximumUnsupportedScoreRate,
        ) &&
        exactZero(value.unsupportedDiagnosisRegressions)
      );
    case "copy-to-mastery-web":
      return (
        finiteAtLeast(value.scenarioCount, 1) &&
        finiteAtLeast(value.viewportCount, 2) &&
        value.chromium === true &&
        value.copyUploadPassed === true &&
        value.confirmDiagnosisPassed === true &&
        value.planApplyPassed === true &&
        value.quizCompletionPassed === true &&
        value.evidenceUpdatePassed === true &&
        exactZero(value.accessibilityViolations)
      );
    case "provider-grade-integrity":
      return (
        finiteAtLeast(value.scenarioCount, 1) &&
        exactZero(value.providerGradeMutationCount) &&
        value.localOverlayPassed === true
      );
    case "node-export-delete-retention":
      return (
        finiteAtLeast(value.scenarioCount, 1) &&
        finiteAtLeast(value.verifiedDeletionReceipts, 1) &&
        value.exportPassed === true &&
        value.offlineRetryPassed === true &&
        exactZero(value.orphanedPersonalRecords)
      );
  }
}

function validateManifest(manifest: LiveEvidenceManifest) {
  const expectations = object(manifest.expectations);
  if (
    expectations?.evaluationPolicyVersion !==
      PLAN037_EVALUATION_POLICY_VERSION ||
    expectations.minimumSamples !== PLAN037_THRESHOLDS.minimumSamples ||
    expectations.providerGradesImmutable !== true ||
    expectations.minimumResponsiveViewports !== 2
  ) {
    return ["manifest:learning-expectations-mismatch"];
  }
  return [];
}

export const PLAN037_LIVE_EVIDENCE_POLICY = {
  plan: "037",
  manifestType: "avermate.plan-037.live-evidence",
  policyVersion: PLAN037_POLICY_VERSION,
  requiredKinds: PLAN037_EVIDENCE_KINDS,
  validateMeasurements,
  validateManifest,
} satisfies LiveEvidencePolicy<Plan037EvidenceKind>;
