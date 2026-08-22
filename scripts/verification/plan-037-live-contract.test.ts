import { afterEach, describe, expect, test } from "bun:test";

import { validateLiveEvidence } from "./live-evidence-contract";
import { createSyntheticEvidenceFixture } from "./live-evidence-test-fixture";
import {
  PLAN037_EVALUATION_POLICY_VERSION,
  PLAN037_EVIDENCE_KINDS,
  PLAN037_LIVE_EVIDENCE_POLICY,
  PLAN037_POLICY_VERSION,
  PLAN037_THRESHOLDS,
  type Plan037EvidenceKind,
} from "./plan-037-live-contract";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function passingMeasurements(kind: Plan037EvidenceKind): unknown {
  switch (kind) {
    case "copy-analysis-provider":
      return {
        provider: "node-local",
        modelRevision: "selfhost/ocr@immutable",
        promptRevision: "grade-copy-analysis/v1",
        copyCount: 10,
        pageCount: 24,
        exactLocatorsPassed: true,
        crossOwnerLeaks: 0,
      };
    case "labelled-learning-evaluation":
      return {
        evaluationPolicyVersion: PLAN037_EVALUATION_POLICY_VERSION,
        algorithmVersion: "mastery/v1",
        datasetRevision: "learning-reviewed/v1",
        sampleCount: PLAN037_THRESHOLDS.minimumSamples,
        regionRecall: 0.92,
        scorePrecision: 0.97,
        scoreRecall: 0.92,
        objectiveTopKAccuracy: 0.91,
        errorTaxonomyAccuracy: 0.86,
        unsupportedScoreRate: 0.01,
        unsupportedDiagnosisRegressions: 0,
      };
    case "copy-to-mastery-web":
      return {
        scenarioCount: 5,
        viewportCount: 2,
        chromium: true,
        copyUploadPassed: true,
        confirmDiagnosisPassed: true,
        planApplyPassed: true,
        quizCompletionPassed: true,
        evidenceUpdatePassed: true,
        accessibilityViolations: 0,
      };
    case "provider-grade-integrity":
      return {
        scenarioCount: 4,
        providerGradeMutationCount: 0,
        localOverlayPassed: true,
      };
    case "node-export-delete-retention":
      return {
        scenarioCount: 4,
        verifiedDeletionReceipts: 2,
        exportPassed: true,
        offlineRetryPassed: true,
        orphanedPersonalRecords: 0,
      };
  }
}

async function fixture(input?: {
  kinds?: readonly Plan037EvidenceKind[];
  measurements?: (kind: Plan037EvidenceKind) => unknown;
}) {
  const created = await createSyntheticEvidenceFixture({
    plan: "037",
    manifestType: "avermate.plan-037.live-evidence",
    policyVersion: PLAN037_POLICY_VERSION,
    kinds: input?.kinds ?? PLAN037_EVIDENCE_KINDS,
    measurements: input?.measurements ?? passingMeasurements,
    expectations: {
      evaluationPolicyVersion: PLAN037_EVALUATION_POLICY_VERSION,
      minimumSamples: PLAN037_THRESHOLDS.minimumSamples,
      providerGradesImmutable: true,
      minimumResponsiveViewports: 2,
    },
  });
  cleanups.push(created.cleanup);
  return created;
}

describe("plan 037 live evidence v2", () => {
  test("accepts a fully digest-bound typed bundle", async () => {
    const created = await fixture();
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy: PLAN037_LIVE_EVIDENCE_POLICY,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  test("rejects a boolean-only labelled evaluation", async () => {
    const created = await fixture({
      kinds: ["labelled-learning-evaluation"],
      measurements: () => ({ thresholdsPassed: true }),
    });
    const policy = {
      ...PLAN037_LIVE_EVIDENCE_POLICY,
      requiredKinds: ["labelled-learning-evaluation"] as const,
    };
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toContain("labelled-learning-evaluation:missing-or-invalid");
  });

  test("rejects unsupported-score drift above policy", async () => {
    const created = await fixture({
      kinds: ["labelled-learning-evaluation"],
      measurements: (kind) => ({
        ...(passingMeasurements(kind) as Record<string, unknown>),
        unsupportedScoreRate: 0.021,
      }),
    });
    const policy = {
      ...PLAN037_LIVE_EVIDENCE_POLICY,
      requiredKinds: ["labelled-learning-evaluation"] as const,
    };
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toContain("labelled-learning-evaluation:missing-or-invalid");
  });
});
