import { afterEach, describe, expect, test } from "bun:test";

import { validateLiveEvidence } from "./live-evidence-contract";
import { createSyntheticEvidenceFixture } from "./live-evidence-test-fixture";
import {
  PLAN038_EVIDENCE_KINDS,
  PLAN038_LIVE_EVIDENCE_POLICY,
  PLAN038_LOCAL_TRANSCRIPTION_MODEL_ID,
  PLAN038_LOCAL_TRANSCRIPTION_PROFILE_ID,
  PLAN038_POLICY_VERSION,
  PLAN038_SCENARIOS,
  type Plan038EvidenceKind,
} from "./plan-038-live-contract";

const cleanups: Array<() => Promise<void>> = [];
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const localTranscriptionModelRevision = "whisper-large-v3-turbo-q5_0-2026-08";
const localTranscriptionImageDigest = digest("7");

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function base(kind: Plan038EvidenceKind) {
  return {
    scenarioIds: [...PLAN038_SCENARIOS[kind]],
    scenarioCount: PLAN038_SCENARIOS[kind].length,
  };
}

function passingMeasurements(kind: Plan038EvidenceKind): unknown {
  switch (kind) {
    case "pairing-relay-revocation":
      return {
        ...base(kind),
        orderedFrames: 100,
        acknowledgedFrames: 100,
        replayAttempts: 2,
        replayAccepted: 0,
        orderViolations: 0,
        duplicateEffects: 0,
        gapsDetected: 1,
        ackResumePassed: true,
      };
    case "full-self-host-flow":
      return {
        ...base(kind),
        failedScenarios: 0,
        managedFallbacks: 0,
        persistedArtifacts: 1,
        releaseImagesPinned: true,
        localTranscriptionJobs: 1,
        localTranscriptionSegments: 3,
        localTranscriptionTimestampedSegments: 3,
        localTranscriptionModelId: PLAN038_LOCAL_TRANSCRIPTION_MODEL_ID,
        localTranscriptionModelRevision,
        localTranscriptionSandboxProfileId:
          PLAN038_LOCAL_TRANSCRIPTION_PROFILE_ID,
        localTranscriptionImageDigest,
        localTranscriptionCloudFallbacks: 0,
      };
    case "storage-adoption-deletion":
      return {
        ...base(kind),
        crashWindowsExercised: 4,
        reconciliationRuns: 4,
        orphanedObjects: 0,
        duplicateAdoptions: 0,
        undeletedObjects: 0,
        reconciliationConverged: true,
      };
    case "conversation-retrieval-model-placement":
      return {
        ...base(kind),
        placementRoutes: 3,
        crossOwnerLeaks: 0,
        unauthorizedFallbacks: 0,
        usageReconciliationDrift: 0,
        offlineFailedClosed: true,
      };
    case "embedding-rerank-placement":
      return {
        ...base(kind),
        adapterCount: 4,
        crossOwnerLeaks: 0,
        unauthorizedFallbacks: 0,
        maximumParityDelta: 0.05,
        providerNeutralLocators: true,
      };
    case "corpus-placement-migration":
      return {
        ...base(kind),
        documentsSeeded: 1,
        placementTransitions: 3,
        bodyHashMismatches: 0,
        locatorMismatches: 0,
        aadTamperAttempts: 1,
        aadTamperAccepted: 0,
        legacySealingPassed: true,
        candidateReauthorizationPassed: true,
      };
    case "sandbox-isolation":
      return {
        ...base(kind),
        attestedRuntime: true,
        escapeAttempts: 5,
        successfulEscapes: 0,
        crossTenantLeaks: 0,
        secretLeaks: 0,
        hostPrivilegeEscalations: 0,
      };
    case "runtime-checkpoint":
      return {
        ...base(kind),
        logicalRestores: 1,
        nativeRestores: 1,
        fallbacksExercised: 2,
        portableTruthClaims: 0,
        stateDigestMismatches: 0,
        expiryPassed: true,
      };
    case "opencode-worker":
    case "openhands-worker":
      return {
        ...base(kind),
        workerKind: kind === "opencode-worker" ? "opencode" : "openhands",
        hostileCases: 5,
        completedBoundedJobs: 1,
        successfulBoundaryViolations: 0,
        artifactsOutsideWorkspace: 0,
        unauthorizedNetworkSuccesses: 0,
        crossTenantLeaks: 0,
        cancelDeadlinePassed: true,
      };
    case "configurator-redaction":
      return {
        ...base(kind),
        realConfigApplied: true,
        browserFlowPassed: true,
        htmlSecretLeaks: 0,
        networkSecretLeaks: 0,
        logSecretLeaks: 0,
        redactedExportLeaks: 0,
      };
    case "hosted-web-node-lifecycle":
      return {
        ...base(kind),
        chromium: true,
        viewportCount: 2,
        pairingPassed: true,
        fingerprintConfirmationPassed: true,
        placementApplied: true,
        migrationReceipts: 1,
        offlineStatePassed: true,
        revocationReceipts: 1,
        accessibilityViolations: 0,
        secretLeaks: 0,
      };
    case "backup-restore":
      return {
        ...base(kind),
        seededRecords: 1,
        seededObjects: 1,
        dataDigestBefore: digest("d"),
        dataDigestAfter: digest("d"),
        identityDigestBefore: digest("e"),
        identityDigestAfter: digest("e"),
        tamperedBackupsAccepted: 0,
        nonEmptyTargetsAccepted: 0,
        networkAttempts: 0,
        restoreCompleted: true,
      };
    case "upgrade-n-minus-one":
      return {
        ...base(kind),
        sourceVersion: "1.0.0",
        targetVersion: "1.1.0",
        seededRecords: 1,
        dataDigestBefore: digest("f"),
        dataDigestAfter: digest("f"),
        injectedFailures: 2,
        unrecoverableFailures: 0,
        backupVerified: true,
        recoveryVerified: true,
      };
    case "airgap":
      return {
        ...base(kind),
        monitoredSeconds: 60,
        networkAttempts: 0,
        externalDnsQueries: 0,
        registryPulls: 0,
        bundleDigest: digest("1"),
        fullSelfHostFlowPassed: true,
      };
  }
}

async function fixture(input?: {
  kinds?: readonly Plan038EvidenceKind[];
  measurements?: (kind: Plan038EvidenceKind) => unknown;
}) {
  const created = await createSyntheticEvidenceFixture({
    plan: "038",
    manifestType: "avermate.plan-038.live-evidence",
    policyVersion: PLAN038_POLICY_VERSION,
    kinds: input?.kinds ?? PLAN038_EVIDENCE_KINDS,
    measurements: input?.measurements ?? passingMeasurements,
    expectations: {
      airgapRequired: true,
      localTranscriptionModelId: PLAN038_LOCAL_TRANSCRIPTION_MODEL_ID,
      localTranscriptionModelRevision,
      localTranscriptionSandboxProfileId:
        PLAN038_LOCAL_TRANSCRIPTION_PROFILE_ID,
      localTranscriptionImageDigest,
    },
  });
  cleanups.push(created.cleanup);
  return created;
}

describe("plan 038 live evidence v3", () => {
  test("accepts a digest-bound synthetic fixture covering every typed scenario", async () => {
    const created = await fixture();
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy: PLAN038_LIVE_EVIDENCE_POLICY,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toEqual([]);
  }, 30_000);

  test("rejects status=passed when typed measurements are absent", async () => {
    const created = await fixture({
      kinds: ["airgap"],
      measurements: () => ({}),
    });
    const policy = {
      ...PLAN038_LIVE_EVIDENCE_POLICY,
      requiredKinds: ["airgap"] as const,
    };
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toContain("airgap:missing-or-invalid");
  });

  test("rejects a fully linked air-gap result with one external network attempt", async () => {
    const created = await fixture({
      kinds: ["airgap"],
      measurements: (kind) => ({
        ...(passingMeasurements(kind) as Record<string, unknown>),
        networkAttempts: 1,
      }),
    });
    const policy = {
      ...PLAN038_LIVE_EVIDENCE_POLICY,
      requiredKinds: ["airgap"] as const,
    };
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toContain("airgap:missing-or-invalid");
  });

  test("rejects local transcription evidence bound to another model revision", async () => {
    const created = await fixture({
      kinds: ["full-self-host-flow"],
      measurements: (kind) => ({
        ...(passingMeasurements(kind) as Record<string, unknown>),
        localTranscriptionModelRevision: "different-unreviewed-revision",
      }),
    });
    const policy = {
      ...PLAN038_LIVE_EVIDENCE_POLICY,
      requiredKinds: ["full-self-host-flow"] as const,
    };
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toContain("manifest:local-transcription-evidence-mismatch");
  });

  test("rejects local transcription without complete timestamps or with cloud fallback", async () => {
    const created = await fixture({
      kinds: ["full-self-host-flow"],
      measurements: (kind) => ({
        ...(passingMeasurements(kind) as Record<string, unknown>),
        localTranscriptionTimestampedSegments: 2,
        localTranscriptionCloudFallbacks: 1,
      }),
    });
    const policy = {
      ...PLAN038_LIVE_EVIDENCE_POLICY,
      requiredKinds: ["full-self-host-flow"] as const,
    };
    const failures = await validateLiveEvidence({
      manifestPath: created.manifestPath,
      checkoutRoot: import.meta.dir,
      bindings: created.bindings,
      policy,
      now: Date.parse("2030-01-15T12:00:00.000Z"),
    });
    expect(failures).toContain(
      "manifest:local-transcription-evidence-mismatch",
    );
    expect(failures).toContain("full-self-host-flow:missing-or-invalid");
  });

  test("rejects evidence bound to another checkout digest", async () => {
    const created = await fixture({ kinds: ["airgap"] });
    const policy = {
      ...PLAN038_LIVE_EVIDENCE_POLICY,
      requiredKinds: ["airgap"] as const,
    };
    const failures = await validateLiveEvidence({
      manifestPath: created.manifestPath,
      checkoutRoot: import.meta.dir,
      bindings: { ...created.bindings, checkoutDigest: digest("9") },
      policy,
      now: Date.parse("2030-01-15T12:00:00.000Z"),
    });
    expect(failures).toContain("manifest:header-or-binding-mismatch");
    expect(failures).toContain("airgap:missing-or-invalid");
  });
});
