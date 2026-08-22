import type {
  LiveEvidenceManifest,
  LiveEvidencePolicy,
} from "./live-evidence-contract";

export const PLAN035_POLICY_VERSION = "plan-035-live-v2";
export const PLAN035_QUALITY_POLICY_VERSION = "assistant-quality-v2";

export const PLAN035_EVIDENCE_KINDS = [
  "direct-byok-provider-contract",
  "paired-node-model-contract",
  "annotated-quality",
  "web-chromium-production-flow",
  "load-isolation-100-runs",
  "security-redaction",
] as const;

export type Plan035EvidenceKind = (typeof PLAN035_EVIDENCE_KINDS)[number];

export const PLAN035_THRESHOLDS = Object.freeze({
  minimumAnswerableQuestions: 40,
  minimumUnanswerableQuestions: 20,
  minimumModelConfigurations: 2,
  minimumSupportedClaimFaithfulness: 0.95,
  minimumCitationPrecision: 0.95,
  minimumCitationClaimCoverage: 0.95,
  minimumExactLocatorResolution: 1,
  minimumProofManifestMembership: 1,
  minimumAbstentionRecall: 0.9,
  minimumConcurrentRuns: 100,
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

function exactZero(value: unknown) {
  return value === 0;
}

function validateMeasurements(kind: Plan035EvidenceKind, input: unknown) {
  const value = object(input);
  if (!value) return false;
  switch (kind) {
    case "direct-byok-provider-contract":
      return (
        nonEmpty(value.providerId) &&
        nonEmpty(value.modelRevision) &&
        nonEmpty(value.promptRevision) &&
        finiteAtLeast(value.scenarioCount, 1) &&
        value.contractPassed === true
      );
    case "paired-node-model-contract":
      return (
        nonEmpty(value.nodeId) &&
        nonEmpty(value.modelRevision) &&
        nonEmpty(value.promptRevision) &&
        finiteAtLeast(value.scenarioCount, 1) &&
        value.reconnectPassed === true &&
        value.contractPassed === true
      );
    case "annotated-quality":
      return (
        nonEmpty(value.modelRevision) &&
        nonEmpty(value.promptRevision) &&
        nonEmpty(value.datasetRevision) &&
        value.qualityPolicyVersion === PLAN035_QUALITY_POLICY_VERSION &&
        finiteAtLeast(
          value.answerableQuestionCount,
          PLAN035_THRESHOLDS.minimumAnswerableQuestions,
        ) &&
        finiteAtLeast(
          value.unanswerableQuestionCount,
          PLAN035_THRESHOLDS.minimumUnanswerableQuestions,
        ) &&
        finiteAtLeast(
          value.modelConfigurationCount,
          PLAN035_THRESHOLDS.minimumModelConfigurations,
        ) &&
        finiteAtLeast(
          value.supportedClaimFaithfulness,
          PLAN035_THRESHOLDS.minimumSupportedClaimFaithfulness,
        ) &&
        finiteAtLeast(
          value.citationPrecision,
          PLAN035_THRESHOLDS.minimumCitationPrecision,
        ) &&
        finiteAtLeast(
          value.citationClaimCoverage,
          PLAN035_THRESHOLDS.minimumCitationClaimCoverage,
        ) &&
        finiteAtLeast(
          value.exactLocatorResolution,
          PLAN035_THRESHOLDS.minimumExactLocatorResolution,
        ) &&
        finiteAtLeast(
          value.proofManifestMembership,
          PLAN035_THRESHOLDS.minimumProofManifestMembership,
        ) &&
        finiteAtLeast(
          value.abstentionRecall,
          PLAN035_THRESHOLDS.minimumAbstentionRecall,
        ) &&
        exactZero(value.secretLeaks) &&
        exactZero(value.crossOwnerLeaks)
      );
    case "web-chromium-production-flow":
      return (
        finiteAtLeast(value.scenarioCount, 1) &&
        value.realProvider === true &&
        value.editRetryPassed === true &&
        value.reconnectPassed === true &&
        value.cancellationPassed === true &&
        exactZero(value.accessibilityViolations)
      );
    case "load-isolation-100-runs":
      return (
        finiteAtLeast(
          value.concurrentRuns,
          PLAN035_THRESHOLDS.minimumConcurrentRuns,
        ) &&
        finiteAtLeast(value.ownerCount, 2) &&
        exactZero(value.crossOwnerLeaks) &&
        exactZero(value.duplicateDispatches) &&
        exactZero(value.credentialLeaks)
      );
    case "security-redaction":
      return (
        finiteAtLeast(value.scenarioCount, 1) &&
        exactZero(value.secretLeaks) &&
        exactZero(value.crossOwnerLeaks) &&
        exactZero(value.rawReasoningLeaks) &&
        exactZero(value.signedUrlLeaks)
      );
  }
}

function validateManifest(manifest: LiveEvidenceManifest) {
  const expectations = object(manifest.expectations);
  const failures: string[] = [];
  if (
    expectations?.qualityPolicyVersion !== PLAN035_QUALITY_POLICY_VERSION ||
    expectations.minimumAnswerableQuestions !==
      PLAN035_THRESHOLDS.minimumAnswerableQuestions ||
    expectations.minimumUnanswerableQuestions !==
      PLAN035_THRESHOLDS.minimumUnanswerableQuestions ||
    expectations.minimumModelConfigurations !==
      PLAN035_THRESHOLDS.minimumModelConfigurations ||
    expectations.realProvidersRequired !== true
  ) {
    failures.push("manifest:quality-expectations-mismatch");
  }
  return failures;
}

export const PLAN035_LIVE_EVIDENCE_POLICY = {
  plan: "035",
  manifestType: "avermate.plan-035.live-evidence",
  policyVersion: PLAN035_POLICY_VERSION,
  requiredKinds: PLAN035_EVIDENCE_KINDS,
  validateMeasurements,
  validateManifest,
} satisfies LiveEvidencePolicy<Plan035EvidenceKind>;
