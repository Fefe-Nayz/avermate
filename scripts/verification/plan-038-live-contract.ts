import type {
  LiveEvidenceManifest,
  LiveEvidencePolicy,
} from "./live-evidence-contract";

export const PLAN038_POLICY_VERSION = "plan-038-live-v3";

export const PLAN038_LOCAL_TRANSCRIPTION_MODEL_ID =
  "selfhost/whisper-large-v3-turbo-q5_0";
export const PLAN038_LOCAL_TRANSCRIPTION_PROFILE_ID = "speech-to-text";

export const PLAN038_EVIDENCE_KINDS = [
  "pairing-relay-revocation",
  "full-self-host-flow",
  "storage-adoption-deletion",
  "conversation-retrieval-model-placement",
  "embedding-rerank-placement",
  "corpus-placement-migration",
  "sandbox-isolation",
  "runtime-checkpoint",
  "opencode-worker",
  "openhands-worker",
  "configurator-redaction",
  "hosted-web-node-lifecycle",
  "backup-restore",
  "upgrade-n-minus-one",
  "airgap",
] as const;

export type Plan038EvidenceKind = (typeof PLAN038_EVIDENCE_KINDS)[number];

export const PLAN038_THRESHOLDS = Object.freeze({
  relayMinimumOrderedFrames: 100,
  adoptionDeletionCrashWindows: 4,
  corpusMinimumDocuments: 1,
  sandboxMinimumEscapeAttempts: 5,
  workerMinimumHostileCases: 5,
  airgapMinimumMonitoredSeconds: 60,
});

const scenarios = {
  "pairing-relay-revocation": [
    "one-use-pairing",
    "account-mismatch-rejected",
    "fingerprint-mismatch-rejected",
    "expiry-rejected",
    "pairing-replay-rejected",
    "identity-rotation",
    "active-stream-revocation",
    "reconnect-after-revocation",
    "ordered-delivery",
    "ack-resume",
    "gap-detection",
    "backpressure",
    "cancel",
    "deadline",
    "protocol-downgrade-rejected",
  ],
  "full-self-host-flow": [
    "auth",
    "academic-crud",
    "upload-range-delete",
    "ocr-index-search-rerank-citation",
    "local-stt-transcription",
    "chat-stream-branch",
    "approved-mutation",
    "sandbox-artifact",
  ],
  "storage-adoption-deletion": [
    "adoption-crash-before-local-commit",
    "adoption-crash-after-local-commit",
    "deletion-crash-before-remote-delete",
    "deletion-crash-after-remote-delete",
    "durable-reconciliation",
  ],
  "conversation-retrieval-model-placement": [
    "node-online",
    "node-offline-no-fallback",
    "conversation-branch",
    "retrieval-model-placement",
    "authoritative-usage-reconciliation",
  ],
  "embedding-rerank-placement": [
    "gemini-cloud-embedding",
    "node-local-embedding",
    "cloud-reranker",
    "node-local-reranker",
    "node-offline-no-fallback",
  ],
  "corpus-placement-migration": [
    "core-to-node",
    "node-to-node",
    "node-to-core",
    "aad-tamper-rejected",
    "legacy-sealing",
    "candidate-reauthorization",
    "exact-body-hash",
  ],
  "sandbox-isolation": [
    "filesystem-escape",
    "network-escape",
    "process-escape",
    "secret-exfiltration",
    "cross-tenant-access",
  ],
  "runtime-checkpoint": [
    "logical-snapshot-restore",
    "native-checkpoint-restore",
    "incompatible-checkpoint-fallback",
    "expired-checkpoint-fallback",
  ],
  "opencode-worker": [
    "bounded-artifact",
    "path-traversal",
    "symlink-escape",
    "oversized-output",
    "network-egress",
    "cancel-deadline",
  ],
  "openhands-worker": [
    "bounded-artifact",
    "path-traversal",
    "symlink-escape",
    "oversized-output",
    "network-egress",
    "cancel-deadline",
  ],
  "configurator-redaction": [
    "browser-apply-real-config",
    "html-secret-redaction",
    "network-secret-redaction",
    "log-secret-redaction",
    "redacted-config-export",
  ],
  "hosted-web-node-lifecycle": [
    "pairing-code",
    "fingerprint-confirmation",
    "capability-placement",
    "placement-migration",
    "offline-state",
    "node-revocation",
    "responsive-accessible-chromium",
  ],
  "backup-restore": [
    "seeded-backup",
    "destroy-disposable-environment",
    "restore-empty-environment",
    "tamper-rejected",
    "non-empty-target-rejected",
    "offline-restore",
  ],
  "upgrade-n-minus-one": [
    "populated-n-minus-one-upgrade",
    "pre-migration-failure",
    "post-migration-failure",
    "verified-backup-recovery",
  ],
  airgap: [
    "offline-bundle-import",
    "full-self-host-user-flow",
    "network-monitor",
    "registry-unavailable",
  ],
} as const satisfies Record<Plan038EvidenceKind, readonly string[]>;

type Values = Record<string, unknown>;

function values(input: unknown): Values | undefined {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Values)
    : undefined;
}

function finite(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}

function integerAtLeast(input: unknown, minimum: number) {
  return Number.isInteger(input) && (input as number) >= minimum;
}

function nonEmpty(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
}

function digest(input: unknown): input is string {
  return typeof input === "string" && /^sha256:[a-f0-9]{64}$/u.test(input);
}

function hasScenarios(kind: Plan038EvidenceKind, input: unknown) {
  if (!Array.isArray(input) || !input.every(nonEmpty)) return false;
  const observed = new Set(input);
  return scenarios[kind].every((scenario) => observed.has(scenario));
}

function common(kind: Plan038EvidenceKind, measurement: Values) {
  return (
    hasScenarios(kind, measurement.scenarioIds) &&
    integerAtLeast(measurement.scenarioCount, scenarios[kind].length)
  );
}

function hostileWorkerPasses(
  kind: "opencode-worker" | "openhands-worker",
  measurement: Values,
) {
  return (
    common(kind, measurement) &&
    measurement.workerKind ===
      (kind === "opencode-worker" ? "opencode" : "openhands") &&
    integerAtLeast(
      measurement.hostileCases,
      PLAN038_THRESHOLDS.workerMinimumHostileCases,
    ) &&
    integerAtLeast(measurement.completedBoundedJobs, 1) &&
    measurement.successfulBoundaryViolations === 0 &&
    measurement.artifactsOutsideWorkspace === 0 &&
    measurement.unauthorizedNetworkSuccesses === 0 &&
    measurement.crossTenantLeaks === 0 &&
    measurement.cancelDeadlinePassed === true
  );
}

export function plan038MeasurementsPass(
  kind: Plan038EvidenceKind,
  input: unknown,
) {
  const measurement = values(input);
  if (!measurement || !common(kind, measurement)) return false;
  switch (kind) {
    case "pairing-relay-revocation":
      return (
        integerAtLeast(
          measurement.orderedFrames,
          PLAN038_THRESHOLDS.relayMinimumOrderedFrames,
        ) &&
        measurement.acknowledgedFrames === measurement.orderedFrames &&
        integerAtLeast(measurement.replayAttempts, 2) &&
        measurement.replayAccepted === 0 &&
        measurement.orderViolations === 0 &&
        measurement.duplicateEffects === 0 &&
        integerAtLeast(measurement.gapsDetected, 1) &&
        measurement.ackResumePassed === true
      );
    case "full-self-host-flow":
      return (
        measurement.failedScenarios === 0 &&
        measurement.managedFallbacks === 0 &&
        integerAtLeast(measurement.persistedArtifacts, 1) &&
        measurement.releaseImagesPinned === true &&
        integerAtLeast(measurement.localTranscriptionJobs, 1) &&
        integerAtLeast(measurement.localTranscriptionSegments, 1) &&
        measurement.localTranscriptionTimestampedSegments ===
          measurement.localTranscriptionSegments &&
        measurement.localTranscriptionModelId ===
          PLAN038_LOCAL_TRANSCRIPTION_MODEL_ID &&
        nonEmpty(measurement.localTranscriptionModelRevision) &&
        measurement.localTranscriptionSandboxProfileId ===
          PLAN038_LOCAL_TRANSCRIPTION_PROFILE_ID &&
        digest(measurement.localTranscriptionImageDigest) &&
        measurement.localTranscriptionCloudFallbacks === 0
      );
    case "storage-adoption-deletion":
      return (
        integerAtLeast(
          measurement.crashWindowsExercised,
          PLAN038_THRESHOLDS.adoptionDeletionCrashWindows,
        ) &&
        integerAtLeast(measurement.reconciliationRuns, 4) &&
        measurement.orphanedObjects === 0 &&
        measurement.duplicateAdoptions === 0 &&
        measurement.undeletedObjects === 0 &&
        measurement.reconciliationConverged === true
      );
    case "conversation-retrieval-model-placement":
      return (
        integerAtLeast(measurement.placementRoutes, 3) &&
        measurement.crossOwnerLeaks === 0 &&
        measurement.unauthorizedFallbacks === 0 &&
        measurement.usageReconciliationDrift === 0 &&
        measurement.offlineFailedClosed === true
      );
    case "embedding-rerank-placement":
      return (
        integerAtLeast(measurement.adapterCount, 4) &&
        measurement.crossOwnerLeaks === 0 &&
        measurement.unauthorizedFallbacks === 0 &&
        finite(measurement.maximumParityDelta) &&
        measurement.maximumParityDelta <= 0.05 &&
        measurement.providerNeutralLocators === true
      );
    case "corpus-placement-migration":
      return (
        integerAtLeast(
          measurement.documentsSeeded,
          PLAN038_THRESHOLDS.corpusMinimumDocuments,
        ) &&
        integerAtLeast(measurement.placementTransitions, 3) &&
        measurement.bodyHashMismatches === 0 &&
        measurement.locatorMismatches === 0 &&
        integerAtLeast(measurement.aadTamperAttempts, 1) &&
        measurement.aadTamperAccepted === 0 &&
        measurement.legacySealingPassed === true &&
        measurement.candidateReauthorizationPassed === true
      );
    case "sandbox-isolation":
      return (
        measurement.attestedRuntime === true &&
        integerAtLeast(
          measurement.escapeAttempts,
          PLAN038_THRESHOLDS.sandboxMinimumEscapeAttempts,
        ) &&
        measurement.successfulEscapes === 0 &&
        measurement.crossTenantLeaks === 0 &&
        measurement.secretLeaks === 0 &&
        measurement.hostPrivilegeEscalations === 0
      );
    case "runtime-checkpoint":
      return (
        integerAtLeast(measurement.logicalRestores, 1) &&
        integerAtLeast(measurement.nativeRestores, 1) &&
        integerAtLeast(measurement.fallbacksExercised, 2) &&
        measurement.portableTruthClaims === 0 &&
        measurement.stateDigestMismatches === 0 &&
        measurement.expiryPassed === true
      );
    case "opencode-worker":
    case "openhands-worker":
      return hostileWorkerPasses(kind, measurement);
    case "configurator-redaction":
      return (
        measurement.realConfigApplied === true &&
        measurement.browserFlowPassed === true &&
        measurement.htmlSecretLeaks === 0 &&
        measurement.networkSecretLeaks === 0 &&
        measurement.logSecretLeaks === 0 &&
        measurement.redactedExportLeaks === 0
      );
    case "hosted-web-node-lifecycle":
      return (
        measurement.chromium === true &&
        integerAtLeast(measurement.viewportCount, 2) &&
        measurement.pairingPassed === true &&
        measurement.fingerprintConfirmationPassed === true &&
        measurement.placementApplied === true &&
        integerAtLeast(measurement.migrationReceipts, 1) &&
        measurement.offlineStatePassed === true &&
        integerAtLeast(measurement.revocationReceipts, 1) &&
        measurement.accessibilityViolations === 0 &&
        measurement.secretLeaks === 0
      );
    case "backup-restore":
      return (
        integerAtLeast(measurement.seededRecords, 1) &&
        integerAtLeast(measurement.seededObjects, 1) &&
        digest(measurement.dataDigestBefore) &&
        measurement.dataDigestAfter === measurement.dataDigestBefore &&
        digest(measurement.identityDigestBefore) &&
        measurement.identityDigestAfter === measurement.identityDigestBefore &&
        measurement.tamperedBackupsAccepted === 0 &&
        measurement.nonEmptyTargetsAccepted === 0 &&
        measurement.networkAttempts === 0 &&
        measurement.restoreCompleted === true
      );
    case "upgrade-n-minus-one":
      return (
        nonEmpty(measurement.sourceVersion) &&
        nonEmpty(measurement.targetVersion) &&
        measurement.sourceVersion !== measurement.targetVersion &&
        integerAtLeast(measurement.seededRecords, 1) &&
        digest(measurement.dataDigestBefore) &&
        measurement.dataDigestAfter === measurement.dataDigestBefore &&
        integerAtLeast(measurement.injectedFailures, 2) &&
        measurement.unrecoverableFailures === 0 &&
        measurement.backupVerified === true &&
        measurement.recoveryVerified === true
      );
    case "airgap":
      return (
        integerAtLeast(
          measurement.monitoredSeconds,
          PLAN038_THRESHOLDS.airgapMinimumMonitoredSeconds,
        ) &&
        measurement.networkAttempts === 0 &&
        measurement.externalDnsQueries === 0 &&
        measurement.registryPulls === 0 &&
        digest(measurement.bundleDigest) &&
        measurement.fullSelfHostFlowPassed === true
      );
  }
}

function manifestChecks(manifest: LiveEvidenceManifest) {
  const expectations = values(manifest.expectations);
  const failures: string[] = [];
  if (expectations?.airgapRequired !== true) {
    failures.push("manifest:airgap-must-be-required");
  }

  const expectedModelId = expectations?.localTranscriptionModelId;
  const expectedModelRevision = expectations?.localTranscriptionModelRevision;
  const expectedProfileId = expectations?.localTranscriptionSandboxProfileId;
  const expectedImageDigest = expectations?.localTranscriptionImageDigest;
  if (
    expectedModelId !== PLAN038_LOCAL_TRANSCRIPTION_MODEL_ID ||
    !nonEmpty(expectedModelRevision) ||
    expectedProfileId !== PLAN038_LOCAL_TRANSCRIPTION_PROFILE_ID ||
    !digest(expectedImageDigest)
  ) {
    failures.push("manifest:local-transcription-expectations-invalid");
    return failures;
  }

  const evidence = Array.isArray(manifest.evidence) ? manifest.evidence : [];
  const hasExactLocalTranscription = evidence.some((candidate) => {
    const record = values(candidate);
    const measurement = values(record?.measurements);
    return (
      record?.kind === "full-self-host-flow" &&
      measurement !== undefined &&
      plan038MeasurementsPass("full-self-host-flow", measurement) &&
      measurement.localTranscriptionModelId === expectedModelId &&
      measurement.localTranscriptionModelRevision === expectedModelRevision &&
      measurement.localTranscriptionSandboxProfileId === expectedProfileId &&
      measurement.localTranscriptionImageDigest === expectedImageDigest
    );
  });
  if (!hasExactLocalTranscription) {
    failures.push("manifest:local-transcription-evidence-mismatch");
  }
  return failures;
}

export const PLAN038_LIVE_EVIDENCE_POLICY: LiveEvidencePolicy<Plan038EvidenceKind> =
  {
    plan: "038",
    manifestType: "avermate.plan-038.live-evidence",
    policyVersion: PLAN038_POLICY_VERSION,
    requiredKinds: PLAN038_EVIDENCE_KINDS,
    validateMeasurements: plan038MeasurementsPass,
    validateManifest: manifestChecks,
  };

export const PLAN038_SCENARIOS: Readonly<
  Record<Plan038EvidenceKind, readonly string[]>
> = scenarios;
