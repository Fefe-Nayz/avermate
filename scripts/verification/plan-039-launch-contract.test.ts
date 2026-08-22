import { afterEach, describe, expect, test } from "bun:test";

import { validateLiveEvidence } from "./live-evidence-contract";
import { createSyntheticEvidenceFixture } from "./live-evidence-test-fixture";
import {
  createPlan039EvidencePolicy,
  PLAN039_EVIDENCE_KINDS,
  PLAN039_POLICY_VERSION,
  PLAN039_SCENARIOS,
  type Plan039EvidenceKind,
} from "./plan-039-launch-contract";

const cleanups: Array<() => Promise<void>> = [];
const digest = (character: string) => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function base(kind: Plan039EvidenceKind) {
  return {
    scenarioIds: [...PLAN039_SCENARIOS[kind]],
    scenarioCount: PLAN039_SCENARIOS[kind].length,
  };
}

function passingMeasurements(kind: Plan039EvidenceKind): unknown {
  switch (kind) {
    case "provider":
      return {
        ...base(kind),
        adapterCount: 4,
        timeoutCases: 1,
        retryCases: 1,
        cancellationCases: 1,
        realProviders: true,
        unreconciledOperations: 0,
        usageDriftUnits: 0,
        costDriftMinorUnits: 0,
      };
    case "isolation":
      return {
        ...base(kind),
        attestedStrongIsolation: true,
        attackAttempts: 5,
        tenantCount: 2,
        crossTenantLeaks: 0,
        unauthorizedSuccesses: 0,
        secretLeaks: 0,
      };
    case "backup":
      return {
        ...base(kind),
        tableRows: 1,
        objectCount: 1,
        backupDigest: digest("d"),
        inventoryDigest: digest("e"),
        encrypted: true,
        consistentRecoveryPoint: true,
        missingRequiredKeys: 0,
        tamperDetected: true,
      };
    case "restore":
      return {
        ...base(kind),
        rpoSeconds: 86_400,
        rtoSeconds: 14_400,
        dataDigestBefore: digest("f"),
        dataDigestAfter: digest("f"),
        restoreTargetWasEmpty: true,
        tamperedBackupsAccepted: 0,
        nonEmptyTargetsAccepted: 0,
        unreconciledProviderObjects: 0,
      };
    case "load":
      return {
        ...base(kind),
        simulatedDays: 30,
        operations: 1_000,
        peakConcurrentUsers: 2,
        queueP95Milliseconds: 30_000,
        sseFirstEventP95Milliseconds: 5_000,
        negativeBalances: 0,
        doubleCharges: 0,
        doubleGrants: 0,
        oversubscriptions: 0,
        crossTenantLeaks: 0,
        unreconciledOperations: 0,
        usageDriftUnits: 0,
        costDriftMinorUnits: 0,
      };
    case "privacy":
      return {
        ...base(kind),
        criticalFindings: 0,
        highFindings: 0,
        secretLeaks: 0,
        rawContentTelemetryLeaks: 0,
        supportRoleBypasses: 0,
        dpiaApproved: true,
        childDataProcessorsReviewed: true,
        deletionExercises: 1,
      };
    case "alert":
      return {
        ...base(kind),
        exercisesRun: 8,
        alertsExpected: 8,
        alertsDelivered: 8,
        undeliveredAlerts: 0,
        deduplicationFailures: 0,
        maximumDetectionSeconds: 300,
        maximumAcknowledgementSeconds: 900,
        onCallAcknowledged: true,
      };
    case "billing-test":
      return {
        ...base(kind),
        providerMode: "test",
        eventsProcessed: 8,
        replayedEvents: 1,
        outOfOrderEvents: 1,
        unknownEventsQuarantined: 2,
        signatureBypasses: 0,
        duplicateEffects: 0,
        entitlementRegressions: 0,
        reconciliationDriftMinorUnits: 0,
        productionCheckoutEnabled: false,
      };
    case "web-customer-operator":
      return {
        ...base(kind),
        chromium: true,
        viewportCount: 2,
        customerScenarios: 3,
        operatorScenarios: 2,
        roleBypasses: 0,
        accessibilityViolations: 0,
        rawContentLeaks: 0,
        productionCheckoutEnabled: false,
      };
    case "airgap":
      return {
        ...base(kind),
        monitoredSeconds: 60,
        networkAttempts: 0,
        externalDnsQueries: 0,
        registryPulls: 0,
        bundleDigest: digest("1"),
        parityFlowPassed: true,
      };
  }
}

async function fixture(input?: {
  kinds?: readonly Plan039EvidenceKind[];
  measurements?: (kind: Plan039EvidenceKind) => unknown;
  airgapRequired?: boolean;
}) {
  const created = await createSyntheticEvidenceFixture({
    plan: "039",
    manifestType: "avermate.plan-039.launch-evidence",
    policyVersion: PLAN039_POLICY_VERSION,
    kinds: input?.kinds ?? PLAN039_EVIDENCE_KINDS,
    measurements: input?.measurements ?? passingMeasurements,
    expectations: { airgapRequired: input?.airgapRequired ?? true },
  });
  cleanups.push(created.cleanup);
  return created;
}

describe("plan 039 launch evidence v2", () => {
  test("accepts a positive synthetic fixture with every typed launch exercise", async () => {
    const created = await fixture();
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy: createPlan039EvidencePolicy({ airgapRequired: true }),
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toEqual([]);
  }, 30_000);

  test("accepts omission of air-gap evidence only when the expected profile says not applicable", async () => {
    const kinds = PLAN039_EVIDENCE_KINDS.filter((kind) => kind !== "airgap");
    const created = await fixture({ kinds, airgapRequired: false });
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy: createPlan039EvidencePolicy({ airgapRequired: false }),
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  test("rejects status=passed without measurements", async () => {
    const created = await fixture({
      kinds: ["provider"],
      measurements: () => undefined,
    });
    const policy = createPlan039EvidencePolicy({
      requestedKind: "provider",
      airgapRequired: true,
    });
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toContain("provider:missing-or-invalid");
  });

  test("rejects a fully linked isolation result with one cross-tenant leak", async () => {
    const created = await fixture({
      kinds: ["isolation"],
      measurements: (kind) => ({
        ...(passingMeasurements(kind) as Record<string, unknown>),
        crossTenantLeaks: 1,
      }),
    });
    const policy = createPlan039EvidencePolicy({
      requestedKind: "isolation",
      airgapRequired: true,
    });
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toContain("isolation:missing-or-invalid");
  });

  test("rejects a restore drill whose measured RTO is above policy", async () => {
    const created = await fixture({
      kinds: ["restore"],
      measurements: (kind) => ({
        ...(passingMeasurements(kind) as Record<string, unknown>),
        rtoSeconds: 14_401,
      }),
    });
    const policy = createPlan039EvidencePolicy({
      requestedKind: "restore",
      airgapRequired: true,
    });
    expect(
      await validateLiveEvidence({
        manifestPath: created.manifestPath,
        checkoutRoot: import.meta.dir,
        bindings: created.bindings,
        policy,
        now: Date.parse("2030-01-15T12:00:00.000Z"),
      }),
    ).toContain("restore:missing-or-invalid");
  });

  test("does not let the manifest waive air-gap evidence against the expected profile", async () => {
    const kinds = PLAN039_EVIDENCE_KINDS.filter((kind) => kind !== "airgap");
    const created = await fixture({ kinds, airgapRequired: false });
    const failures = await validateLiveEvidence({
      manifestPath: created.manifestPath,
      checkoutRoot: import.meta.dir,
      bindings: created.bindings,
      policy: createPlan039EvidencePolicy({ airgapRequired: true }),
      now: Date.parse("2030-01-15T12:00:00.000Z"),
    });
    expect(failures).toContain("manifest:airgap-expectation-mismatch");
    expect(failures).toContain("airgap:missing-or-invalid");
  });
});
