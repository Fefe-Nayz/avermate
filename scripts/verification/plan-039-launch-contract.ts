import type {
  LiveEvidenceManifest,
  LiveEvidencePolicy,
} from "./live-evidence-contract";

export const PLAN039_POLICY_VERSION = "plan-039-launch-v2";

export const PLAN039_EVIDENCE_KINDS = [
  "provider",
  "isolation",
  "backup",
  "restore",
  "load",
  "privacy",
  "alert",
  "billing-test",
  "web-customer-operator",
  "airgap",
] as const;

export type Plan039EvidenceKind = (typeof PLAN039_EVIDENCE_KINDS)[number];

export const PLAN039_THRESHOLDS = Object.freeze({
  providerMinimumAdapters: 4,
  isolationMinimumAttempts: 5,
  maximumRpoSeconds: 86_400,
  maximumRtoSeconds: 14_400,
  loadMinimumSimulatedDays: 30,
  loadMinimumOperations: 1_000,
  loadMaximumQueueP95Milliseconds: 30_000,
  loadMaximumSseFirstEventP95Milliseconds: 5_000,
  alertMaximumDetectionSeconds: 300,
  alertMaximumAcknowledgementSeconds: 900,
  airgapMinimumMonitoredSeconds: 60,
});

const scenarios = {
  provider: [
    "storage-adapter",
    "model-adapter",
    "retrieval-rerank-adapter",
    "sandbox-adapter",
    "timeout",
    "bounded-retry",
    "cancellation",
    "usage-reconciliation",
    "cost-reconciliation",
  ],
  isolation: [
    "storage-cross-tenant",
    "vector-cross-tenant",
    "conversation-cross-tenant",
    "sandbox-cross-tenant",
    "model-cross-tenant",
    "secret-redaction",
  ],
  backup: [
    "consistent-recovery-point",
    "encrypted-backup",
    "object-inventory",
    "key-inventory",
    "tamper-detection",
  ],
  restore: [
    "empty-environment-restore",
    "provider-object-reconciliation",
    "table-object-ledger-digest",
    "tamper-rejected",
    "non-empty-target-rejected",
    "partial-provider-failure",
  ],
  load: [
    "school-calendar-burst",
    "document-batch",
    "concurrent-chat",
    "ocr-embedding-rerank",
    "tts-sandbox-artifacts",
    "retry-replay-reconciliation",
  ],
  privacy: [
    "prompt-tool-exfiltration",
    "ssrf",
    "decompression-json-bomb",
    "malicious-document",
    "sandbox-escape-boundary",
    "secret-redaction",
    "support-role-abuse",
    "export-delete",
    "child-data-processor-review",
  ],
  alert: [
    "provider-outage",
    "cost-spike",
    "suspected-cross-tenant-leak",
    "lost-webhook",
    "quota-drift",
    "stuck-deletion",
    "backup-failure",
    "regional-recovery",
  ],
  "billing-test": [
    "signature-rejection",
    "event-replay",
    "out-of-order-events",
    "unknown-price-quarantine",
    "unknown-customer-quarantine",
    "checkout-return",
    "grace-cancel-portal",
    "invoice-entitlement-reconciliation",
  ],
  "web-customer-operator": [
    "waitlist-invite-consent",
    "usage-quota-enforcement",
    "export-delete",
    "operator-role-isolation",
    "provider-breaker",
    "checkout-disabled",
    "responsive-accessible-chromium",
  ],
  airgap: [
    "offline-bundle-import",
    "managed-parity-flow",
    "network-monitor",
    "registry-unavailable",
  ],
} as const satisfies Record<Plan039EvidenceKind, readonly string[]>;

type Values = Record<string, unknown>;

function values(input: unknown): Values | undefined {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Values)
    : undefined;
}

function nonEmpty(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
}

function finite(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}

function integerAtLeast(input: unknown, minimum: number) {
  return Number.isInteger(input) && (input as number) >= minimum;
}

function digest(input: unknown): input is string {
  return typeof input === "string" && /^sha256:[a-f0-9]{64}$/u.test(input);
}

function hasScenarios(kind: Plan039EvidenceKind, input: unknown) {
  if (!Array.isArray(input) || !input.every(nonEmpty)) return false;
  const observed = new Set(input);
  return scenarios[kind].every((scenario) => observed.has(scenario));
}

function common(kind: Plan039EvidenceKind, measurement: Values) {
  return (
    hasScenarios(kind, measurement.scenarioIds) &&
    integerAtLeast(measurement.scenarioCount, scenarios[kind].length)
  );
}

export function plan039MeasurementsPass(
  kind: Plan039EvidenceKind,
  input: unknown,
) {
  const measurement = values(input);
  if (!measurement || !common(kind, measurement)) return false;
  switch (kind) {
    case "provider":
      return (
        integerAtLeast(
          measurement.adapterCount,
          PLAN039_THRESHOLDS.providerMinimumAdapters,
        ) &&
        integerAtLeast(measurement.timeoutCases, 1) &&
        integerAtLeast(measurement.retryCases, 1) &&
        integerAtLeast(measurement.cancellationCases, 1) &&
        measurement.realProviders === true &&
        measurement.unreconciledOperations === 0 &&
        measurement.usageDriftUnits === 0 &&
        measurement.costDriftMinorUnits === 0
      );
    case "isolation":
      return (
        measurement.attestedStrongIsolation === true &&
        integerAtLeast(
          measurement.attackAttempts,
          PLAN039_THRESHOLDS.isolationMinimumAttempts,
        ) &&
        integerAtLeast(measurement.tenantCount, 2) &&
        measurement.crossTenantLeaks === 0 &&
        measurement.unauthorizedSuccesses === 0 &&
        measurement.secretLeaks === 0
      );
    case "backup":
      return (
        integerAtLeast(measurement.tableRows, 1) &&
        integerAtLeast(measurement.objectCount, 1) &&
        digest(measurement.backupDigest) &&
        digest(measurement.inventoryDigest) &&
        measurement.encrypted === true &&
        measurement.consistentRecoveryPoint === true &&
        measurement.missingRequiredKeys === 0 &&
        measurement.tamperDetected === true
      );
    case "restore":
      return (
        finite(measurement.rpoSeconds) &&
        measurement.rpoSeconds >= 0 &&
        measurement.rpoSeconds <= PLAN039_THRESHOLDS.maximumRpoSeconds &&
        finite(measurement.rtoSeconds) &&
        measurement.rtoSeconds > 0 &&
        measurement.rtoSeconds <= PLAN039_THRESHOLDS.maximumRtoSeconds &&
        digest(measurement.dataDigestBefore) &&
        measurement.dataDigestAfter === measurement.dataDigestBefore &&
        measurement.restoreTargetWasEmpty === true &&
        measurement.tamperedBackupsAccepted === 0 &&
        measurement.nonEmptyTargetsAccepted === 0 &&
        measurement.unreconciledProviderObjects === 0
      );
    case "load":
      return (
        integerAtLeast(
          measurement.simulatedDays,
          PLAN039_THRESHOLDS.loadMinimumSimulatedDays,
        ) &&
        integerAtLeast(
          measurement.operations,
          PLAN039_THRESHOLDS.loadMinimumOperations,
        ) &&
        integerAtLeast(measurement.peakConcurrentUsers, 2) &&
        finite(measurement.queueP95Milliseconds) &&
        measurement.queueP95Milliseconds <=
          PLAN039_THRESHOLDS.loadMaximumQueueP95Milliseconds &&
        finite(measurement.sseFirstEventP95Milliseconds) &&
        measurement.sseFirstEventP95Milliseconds <=
          PLAN039_THRESHOLDS.loadMaximumSseFirstEventP95Milliseconds &&
        measurement.negativeBalances === 0 &&
        measurement.doubleCharges === 0 &&
        measurement.doubleGrants === 0 &&
        measurement.oversubscriptions === 0 &&
        measurement.crossTenantLeaks === 0 &&
        measurement.unreconciledOperations === 0 &&
        measurement.usageDriftUnits === 0 &&
        measurement.costDriftMinorUnits === 0
      );
    case "privacy":
      return (
        measurement.criticalFindings === 0 &&
        measurement.highFindings === 0 &&
        measurement.secretLeaks === 0 &&
        measurement.rawContentTelemetryLeaks === 0 &&
        measurement.supportRoleBypasses === 0 &&
        measurement.dpiaApproved === true &&
        measurement.childDataProcessorsReviewed === true &&
        integerAtLeast(measurement.deletionExercises, 1)
      );
    case "alert":
      return (
        integerAtLeast(measurement.exercisesRun, scenarios.alert.length) &&
        integerAtLeast(measurement.alertsExpected, scenarios.alert.length) &&
        measurement.alertsDelivered === measurement.alertsExpected &&
        measurement.undeliveredAlerts === 0 &&
        measurement.deduplicationFailures === 0 &&
        finite(measurement.maximumDetectionSeconds) &&
        measurement.maximumDetectionSeconds <=
          PLAN039_THRESHOLDS.alertMaximumDetectionSeconds &&
        finite(measurement.maximumAcknowledgementSeconds) &&
        measurement.maximumAcknowledgementSeconds <=
          PLAN039_THRESHOLDS.alertMaximumAcknowledgementSeconds &&
        measurement.onCallAcknowledged === true
      );
    case "billing-test":
      return (
        measurement.providerMode === "test" &&
        integerAtLeast(measurement.eventsProcessed, 8) &&
        integerAtLeast(measurement.replayedEvents, 1) &&
        integerAtLeast(measurement.outOfOrderEvents, 1) &&
        integerAtLeast(measurement.unknownEventsQuarantined, 2) &&
        measurement.signatureBypasses === 0 &&
        measurement.duplicateEffects === 0 &&
        measurement.entitlementRegressions === 0 &&
        measurement.reconciliationDriftMinorUnits === 0 &&
        measurement.productionCheckoutEnabled === false
      );
    case "web-customer-operator":
      return (
        measurement.chromium === true &&
        integerAtLeast(measurement.viewportCount, 2) &&
        integerAtLeast(measurement.customerScenarios, 3) &&
        integerAtLeast(measurement.operatorScenarios, 2) &&
        measurement.roleBypasses === 0 &&
        measurement.accessibilityViolations === 0 &&
        measurement.rawContentLeaks === 0 &&
        measurement.productionCheckoutEnabled === false
      );
    case "airgap":
      return (
        integerAtLeast(
          measurement.monitoredSeconds,
          PLAN039_THRESHOLDS.airgapMinimumMonitoredSeconds,
        ) &&
        measurement.networkAttempts === 0 &&
        measurement.externalDnsQueries === 0 &&
        measurement.registryPulls === 0 &&
        digest(measurement.bundleDigest) &&
        measurement.parityFlowPassed === true
      );
  }
}

export function plan039RequiredKinds(input: {
  requestedKind?: Plan039EvidenceKind;
  airgapRequired: boolean;
}) {
  if (input.requestedKind) return [input.requestedKind] as const;
  return PLAN039_EVIDENCE_KINDS.filter(
    (kind) => kind !== "airgap" || input.airgapRequired,
  );
}

export function createPlan039EvidencePolicy(input: {
  requestedKind?: Plan039EvidenceKind;
  airgapRequired: boolean;
}): LiveEvidencePolicy<Plan039EvidenceKind> {
  return {
    plan: "039",
    manifestType: "avermate.plan-039.launch-evidence",
    policyVersion: PLAN039_POLICY_VERSION,
    requiredKinds: plan039RequiredKinds(input),
    validateMeasurements: plan039MeasurementsPass,
    validateManifest(manifest: LiveEvidenceManifest) {
      const expectations = values(manifest.expectations);
      return expectations?.airgapRequired === input.airgapRequired
        ? []
        : ["manifest:airgap-expectation-mismatch"];
    },
  };
}

export function parsePlan039EvidenceKind(
  input: string | undefined,
): Plan039EvidenceKind | undefined {
  if (!input) return undefined;
  if (PLAN039_EVIDENCE_KINDS.includes(input as Plan039EvidenceKind)) {
    return input as Plan039EvidenceKind;
  }
  throw new Error(`PLAN039_LAUNCH_UNKNOWN_KIND:${input}`);
}

export const PLAN039_SCENARIOS: Readonly<
  Record<Plan039EvidenceKind, readonly string[]>
> = scenarios;
