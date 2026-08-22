import {
  SANDBOX_BASELINE_CHECK_IDS,
  sandboxBaselineEvidenceSchema,
  type SandboxBaselineEvidence,
  type SandboxPreflightInput,
  type SandboxPreflightResult,
  type SandboxProviderId,
} from "@avermate/agent-contracts";

const MAX_EVIDENCE_CLOCK_SKEW_MS = 5_000;

export function validateSandboxBaselineEvidence(input: {
  providerId: SandboxProviderId;
  request: SandboxPreflightInput;
  evidence: unknown;
}): SandboxPreflightResult {
  const parsed = sandboxBaselineEvidenceSchema.safeParse(input.evidence);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "EVIDENCE_MISSING",
      message: "The provider did not return a complete baseline-v1 evidence envelope.",
    };
  }

  const evidence = parsed.data;
  const profile = input.request.profile;
  if (
    evidence.providerId !== input.providerId ||
    evidence.profileId !== profile.id ||
    evidence.profileVersion !== profile.version ||
    evidence.imageDigest !== profile.image.imageDigest ||
    evidence.hostPolicyDigest !== input.request.expectedHostPolicyDigest
  ) {
    return {
      ok: false,
      reason: "EVIDENCE_FAILED",
      message: "The evidence is not bound to the requested provider, profile, image, and host policy.",
    };
  }

  const now = input.request.now ?? new Date();
  const checkedAt = new Date(evidence.checkedAt);
  const expiresAt = new Date(evidence.expiresAt);
  const age = now.getTime() - checkedAt.getTime();
  if (
    !Number.isFinite(age) ||
    age < -MAX_EVIDENCE_CLOCK_SKEW_MS ||
    age > input.request.maxEvidenceAgeMs ||
    expiresAt.getTime() <= now.getTime()
  ) {
    return {
      ok: false,
      reason: "EVIDENCE_STALE",
      message: "The baseline evidence is stale, future-dated, or expired.",
    };
  }

  const failed = SANDBOX_BASELINE_CHECK_IDS.filter(
    (id) => evidence.checks[id].status !== "pass",
  );
  if (failed.length > 0) {
    return {
      ok: false,
      reason: "EVIDENCE_FAILED",
      message: `Baseline checks are not proven: ${failed.join(", ")}.`,
    };
  }

  return { ok: true, evidence };
}

export function evidenceFingerprint(evidence: SandboxBaselineEvidence): string {
  return [
    evidence.providerId,
    evidence.profileId,
    evidence.profileVersion,
    evidence.imageDigest,
    evidence.hostPolicyDigest,
    evidence.evidenceNonce,
  ].join(":");
}
