import { afterEach, describe, expect, test } from "bun:test";

import { validateLiveEvidence } from "./live-evidence-contract";
import { createSyntheticEvidenceFixture } from "./live-evidence-test-fixture";
import {
  PLAN035_EVIDENCE_KINDS,
  PLAN035_LIVE_EVIDENCE_POLICY,
  PLAN035_POLICY_VERSION,
  PLAN035_QUALITY_POLICY_VERSION,
  PLAN035_THRESHOLDS,
  type Plan035EvidenceKind,
} from "./plan-035-live-contract";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function passingMeasurements(kind: Plan035EvidenceKind): unknown {
  switch (kind) {
    case "direct-byok-provider-contract":
      return {
        providerId: "openai",
        modelRevision: "openai/model@immutable",
        promptRevision: "assistant-prompt/v2",
        scenarioCount: 4,
        contractPassed: true,
      };
    case "paired-node-model-contract":
      return {
        nodeId: "node-redacted",
        modelRevision: "local/model@immutable",
        promptRevision: "assistant-prompt/v2",
        scenarioCount: 5,
        reconnectPassed: true,
        contractPassed: true,
      };
    case "annotated-quality":
      return {
        modelRevision: "provider/model@immutable",
        promptRevision: "assistant-prompt/v2",
        datasetRevision: "french-school-reviewed/v2",
        qualityPolicyVersion: PLAN035_QUALITY_POLICY_VERSION,
        answerableQuestionCount: PLAN035_THRESHOLDS.minimumAnswerableQuestions,
        unanswerableQuestionCount:
          PLAN035_THRESHOLDS.minimumUnanswerableQuestions,
        modelConfigurationCount: PLAN035_THRESHOLDS.minimumModelConfigurations,
        supportedClaimFaithfulness: 0.96,
        citationPrecision: 0.97,
        citationClaimCoverage: 0.96,
        exactLocatorResolution: 1,
        proofManifestMembership: 1,
        abstentionRecall: 0.92,
        secretLeaks: 0,
        crossOwnerLeaks: 0,
      };
    case "web-chromium-production-flow":
      return {
        scenarioCount: 6,
        realProvider: true,
        editRetryPassed: true,
        reconnectPassed: true,
        cancellationPassed: true,
        accessibilityViolations: 0,
      };
    case "load-isolation-100-runs":
      return {
        concurrentRuns: PLAN035_THRESHOLDS.minimumConcurrentRuns,
        ownerCount: 10,
        crossOwnerLeaks: 0,
        duplicateDispatches: 0,
        credentialLeaks: 0,
      };
    case "security-redaction":
      return {
        scenarioCount: 12,
        secretLeaks: 0,
        crossOwnerLeaks: 0,
        rawReasoningLeaks: 0,
        signedUrlLeaks: 0,
      };
  }
}

async function fixture(input?: {
  kinds?: readonly Plan035EvidenceKind[];
  measurements?: (kind: Plan035EvidenceKind) => unknown;
}) {
  const created = await createSyntheticEvidenceFixture({
    plan: "035",
    manifestType: "avermate.plan-035.live-evidence",
    policyVersion: PLAN035_POLICY_VERSION,
    kinds: input?.kinds ?? PLAN035_EVIDENCE_KINDS,
    measurements: input?.measurements ?? passingMeasurements,
    expectations: {
      qualityPolicyVersion: PLAN035_QUALITY_POLICY_VERSION,
      minimumAnswerableQuestions: PLAN035_THRESHOLDS.minimumAnswerableQuestions,
      minimumUnanswerableQuestions:
        PLAN035_THRESHOLDS.minimumUnanswerableQuestions,
      minimumModelConfigurations: PLAN035_THRESHOLDS.minimumModelConfigurations,
      realProvidersRequired: true,
    },
  });
  cleanups.push(created.cleanup);
  return created;
}

describe("plan 035 live evidence v2", () => {
  test("accepts a fully digest-bound typed bundle", async () => {
    const created = await fixture();
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy: PLAN035_LIVE_EVIDENCE_POLICY,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  test("rejects a boolean-only quality assertion", async () => {
    const created = await fixture({
      kinds: ["annotated-quality"],
      measurements: () => ({ thresholdsPassed: true }),
    });
    const policy = {
      ...PLAN035_LIVE_EVIDENCE_POLICY,
      requiredKinds: ["annotated-quality"] as const,
    };
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toContain("annotated-quality:missing-or-invalid");
  });

  test("rejects a numeric metric below the ratified policy", async () => {
    const created = await fixture({
      kinds: ["annotated-quality"],
      measurements: (kind) => ({
        ...(passingMeasurements(kind) as Record<string, unknown>),
        supportedClaimFaithfulness: 0.949,
      }),
    });
    const policy = {
      ...PLAN035_LIVE_EVIDENCE_POLICY,
      requiredKinds: ["annotated-quality"] as const,
    };
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toContain("annotated-quality:missing-or-invalid");
  });
});
