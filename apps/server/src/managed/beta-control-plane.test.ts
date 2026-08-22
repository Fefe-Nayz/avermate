import { describe, expect, test } from "bun:test";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "./managed-test-db";
import {
  ManagedBetaControlPlane,
  ManagedBetaError,
} from "./beta-control-plane";
import {
  ManagedCostControlError,
  ManagedCostControls,
} from "../operations/cost-controls";
import type { ManagedCapability } from "@avermate/agent-contracts";

const now = new Date("2026-08-22T12:00:00.000Z");

function inviteInput(email = "student@example.test") {
  return {
    email,
    cohort: "staff-alpha",
    region: "eu-west",
    capabilities: ["storage.bytes", "model.inputTokens"] as ManagedCapability[],
    termsRevision: "terms/1",
    privacyRevision: "privacy/1",
    expiresAt: new Date("2026-08-29T12:00:00.000Z"),
  };
}

describe.serial("managed beta control plane", () => {
  test("issues one-time hashed invites and rejects replay/account mismatch", async () => {
    const client = await createManagedTestDatabase();
    try {
      const service = new ManagedBetaControlPlane({
        client,
        secret: "test-secret-with-at-least-32-characters",
        clock: () => now,
      });
      const invitation = await service.issueInvite(inviteInput(), {
        actorId: "account-b",
        correlationId: "issue-1",
      });
      const stored = await client.execute({
        sql: "SELECT tokenDigest FROM managed_beta_invites WHERE id = ?",
        args: [invitation.id],
      });
      expect(String(stored.rows[0]?.tokenDigest)).not.toContain(
        invitation.token,
      );

      await expect(
        service.redeemInvite({
          accountId: "account-a",
          email: "wrong@example.test",
          token: invitation.token,
          termsRevision: "terms/1",
          privacyRevision: "privacy/1",
          consentedCategories: ["files", "inference"],
          correlationId: "redeem-wrong",
        }),
      ).rejects.toMatchObject({ code: "invite-account-mismatch" });

      const account = await service.redeemInvite({
        accountId: "account-a",
        email: "student@example.test",
        token: invitation.token,
        termsRevision: "terms/1",
        privacyRevision: "privacy/1",
        consentedCategories: ["files", "inference"],
        correlationId: "redeem-1",
      });
      expect(account).toMatchObject({
        state: "active",
        region: "eu-west",
        managedDataConsent: true,
        capabilities: ["model.inputTokens", "storage.bytes"],
      });
      await expect(
        service.updateConsent({
          accountId: "account-a",
          enabled: true,
          categories: [],
          actorId: "account-a",
          correlationId: "consent-invalid",
        }),
      ).rejects.toThrow("At least one managed data category");
      expect(
        await service.updateConsent({
          accountId: "account-a",
          enabled: false,
          categories: [],
          actorId: "account-a",
          correlationId: "consent-revoked",
        }),
      ).toMatchObject({
        managedDataConsent: false,
        consentedCategories: [],
      });
      await expect(
        service.redeemInvite({
          accountId: "account-a",
          email: "student@example.test",
          token: invitation.token,
          termsRevision: "terms/1",
          privacyRevision: "privacy/1",
          consentedCategories: ["files"],
          correlationId: "redeem-replay",
        }),
      ).rejects.toBeInstanceOf(ManagedBetaError);
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("enforces beta eligibility, capability and quota before dispatch", async () => {
    const client = await createManagedTestDatabase();
    try {
      const service = new ManagedBetaControlPlane({
        client,
        secret: "test-secret-with-at-least-32-characters",
        clock: () => now,
      });
      const controls = new ManagedCostControls(client, () => now, {
        betaEnforcementEnabled: true,
      });
      await expect(
        controls.assertAllowed({
          accountId: "account-a",
          capability: "storage.bytes",
          provider: "fixture",
          maximumQuantity: "1",
          unit: "bytes",
        }),
      ).rejects.toMatchObject({ reasonCode: "BETA_INVITE_REQUIRED" });

      const invitation = await service.issueInvite(inviteInput(), {
        actorId: "account-b",
        correlationId: "issue-quota",
      });
      await service.redeemInvite({
        accountId: "account-a",
        email: "student@example.test",
        token: invitation.token,
        termsRevision: "terms/1",
        privacyRevision: "privacy/1",
        consentedCategories: ["files"],
        correlationId: "redeem-quota",
      });
      await service.upsertQuotaPolicy(
        {
          scope: "account",
          scopeId: "account-a",
          capability: "storage.bytes",
          period: "daily",
          hardLimit: "10",
          concurrency: 2,
          enabled: true,
          revision: "quota/1",
          justification: "Small deterministic fixture cap",
        },
        { actorId: "account-b", correlationId: "quota-1" },
      );
      await controls.assertAllowed({
        accountId: "account-a",
        capability: "storage.bytes",
        provider: "fixture",
        maximumQuantity: "10",
        unit: "bytes",
      });
      await expect(
        controls.assertAllowed({
          accountId: "account-a",
          capability: "storage.bytes",
          provider: "fixture",
          maximumQuantity: "11",
          unit: "bytes",
        }),
      ).rejects.toBeInstanceOf(ManagedCostControlError);
      await expect(
        controls.assertAllowed({
          accountId: "account-a",
          capability: "ocr.pages",
          provider: "fixture",
          maximumQuantity: "1",
          unit: "pages",
        }),
      ).rejects.toMatchObject({ reasonCode: "BETA_CAPABILITY_NOT_ELIGIBLE" });
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("cannot close a launch gate with repository-only evidence", async () => {
    const client = await createManagedTestDatabase();
    try {
      const service = new ManagedBetaControlPlane({
        client,
        secret: "test-secret-with-at-least-32-characters",
        clock: () => now,
      });
      const fixture = await service.createEvidence(
        {
          kind: "restore",
          environment: "repository",
          releaseRevision: "test-release",
          status: "passed",
          source: "repository-fixture",
          safeSummary: "Logical fixture restored successfully",
          metrics: { rtoSeconds: 1 },
          observedAt: now,
        },
        { actorId: "account-b", correlationId: "evidence-fixture" },
      );
      await expect(
        service.setLaunchGate({
          key: "restore-drill",
          phase: "D",
          status: "passed",
          evidenceId: fixture.id,
          justification: "Fixture only",
          actorId: "account-b",
          correlationId: "gate-fixture",
        }),
      ).rejects.toMatchObject({ code: "invalid-evidence" });

      const observation = await service.createEvidence(
        {
          kind: "restore",
          environment: "operator-console",
          releaseRevision: "test-release",
          status: "passed",
          source: "operator-observation",
          safeSummary:
            "An operator observed a dashboard without a drill artifact",
          metrics: {},
          observedAt: now,
        },
        { actorId: "account-b", correlationId: "evidence-observation" },
      );
      await expect(
        service.setLaunchGate({
          key: "restore-observation",
          phase: "D",
          status: "passed",
          evidenceId: observation.id,
          justification: "Observation is not a drill",
          actorId: "account-b",
          correlationId: "gate-observation",
        }),
      ).rejects.toMatchObject({ code: "invalid-evidence" });

      const drill = await service.createEvidence(
        {
          kind: "restore",
          environment: "disposable-eu",
          region: "eu-west",
          releaseRevision: "test-release",
          status: "passed",
          source: "deployed-drill",
          safeSummary:
            "Empty-environment restore reconciled all fixture digests",
          metrics: { rpoSeconds: 60, rtoSeconds: 120 },
          artifactDigest: `sha256:${"a".repeat(64)}`,
          observedAt: now,
          expiresAt: new Date("2026-09-22T12:00:00.000Z"),
        },
        { actorId: "account-b", correlationId: "evidence-drill" },
      );
      await service.setLaunchGate({
        key: "restore-drill",
        phase: "D",
        status: "passed",
        evidenceId: drill.id,
        justification: "Deployed drill evidence",
        actorId: "account-b",
        correlationId: "gate-drill",
      });
      const overview = await service.adminOverview();
      expect(overview.gates).toHaveLength(1);
      expect(overview.gates[0]?.status).toBe("passed");
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("exports managed metadata and reports deletion as pending until a real receipt", async () => {
    const client = await createManagedTestDatabase();
    try {
      const service = new ManagedBetaControlPlane({
        client,
        secret: "test-secret-with-at-least-32-characters",
        clock: () => now,
      });
      const invitation = await service.issueInvite(inviteInput(), {
        actorId: "account-b",
        correlationId: "issue-delete",
      });
      await service.redeemInvite({
        accountId: "account-a",
        email: "student@example.test",
        token: invitation.token,
        termsRevision: "terms/1",
        privacyRevision: "privacy/1",
        consentedCategories: ["files"],
        correlationId: "redeem-delete",
      });
      const exported = await service.exportManagedMetadata({
        accountId: "account-a",
        actorId: "account-a",
        correlationId: "export-1",
      });
      expect(exported.manifest).toMatchObject({
        version: 1,
        kind: "managed-metadata-export",
      });
      const deletion = await service.requestManagedDeletion({
        accountId: "account-a",
        actorId: "account-a",
        correlationId: "delete-1",
      });
      expect(deletion).toMatchObject({
        state: "running",
        targetState: "pending_remote_deletion",
      });
      const operations = await service.listPrivacyOperations("account-a");
      expect(operations[0]).toMatchObject({
        kind: "delete-now",
        state: "running",
        targets: [{ state: "pending_remote_deletion" }],
      });
    } finally {
      await closeManagedTestDatabase(client);
    }
  });
});
