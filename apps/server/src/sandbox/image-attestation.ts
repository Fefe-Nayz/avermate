import { createHash } from "node:crypto";
import {
  sandboxImageBuildAttestationSchema,
  type SandboxExecutionProfile,
  type SandboxImageBuildAttestation,
  type SandboxImageTemplateRef,
} from "@avermate/agent-contracts";
import { validateSandboxBaselineEvidence } from "./evidence";
import { SandboxUnavailableError } from "./errors";

export interface SandboxImageAttestationVerifier {
  verifySignature(attestation: SandboxImageBuildAttestation): Promise<boolean>;
  verifyReferencedDocument(input: {
    kind: "sbom" | "provenance";
    digest: string;
  }): Promise<boolean>;
  verifyProvenanceBinding(input: {
    attestation: SandboxImageBuildAttestation;
    expectedProposalId: string;
  }): Promise<boolean>;
}

/**
 * Final post-build gate. Signature keys and document stores belong to this
 * trusted verifier and never enter the image-builder sandbox.
 */
export async function authorizeAttestedSandboxImage(input: {
  attestation: unknown;
  builderProfile: SandboxExecutionProfile;
  expected: {
    proposalId: string;
    targetProfileId: SandboxExecutionProfile["id"];
    targetProfileVersion: string;
    sourceImageDigest: string;
    dependencyLockDigest: string;
    builderPolicyDigest: string;
    egressPolicyDigest: string;
    tenantCacheScope: string;
    signerKeyIds: readonly string[];
    hostPolicyDigest: string;
    maxEvidenceAgeMs: number;
  };
  verifier: SandboxImageAttestationVerifier;
  now?: Date;
}): Promise<{
  image: SandboxImageTemplateRef;
  attestationDigest: string;
}> {
  const parsed = sandboxImageBuildAttestationSchema.safeParse(input.attestation);
  if (!parsed.success) {
    throw new SandboxUnavailableError(
      "EVIDENCE_MISSING",
      "Image build attestation is incomplete or invalid.",
    );
  }
  const attestation = parsed.data;
  if (
    input.builderProfile.id !== "image-builder" ||
    attestation.proposalId !== input.expected.proposalId ||
    attestation.profileId !== input.expected.targetProfileId ||
    attestation.profileVersion !== input.expected.targetProfileVersion ||
    attestation.sourceImageDigest !== input.expected.sourceImageDigest ||
    attestation.dependencyLockDigest !== input.expected.dependencyLockDigest ||
    attestation.builderPolicyDigest !== input.expected.builderPolicyDigest ||
    attestation.egressPolicyDigest !== input.expected.egressPolicyDigest ||
    attestation.tenantCacheScope !== input.expected.tenantCacheScope ||
    !input.expected.signerKeyIds.includes(attestation.signerKeyId)
  ) {
    throw new SandboxUnavailableError(
      "EVIDENCE_FAILED",
      "Image attestation does not match the approved proposal and tenant policy.",
    );
  }
  if (attestation.resultImageDigest === attestation.sourceImageDigest) {
    throw new SandboxUnavailableError(
      "EVIDENCE_FAILED",
      "Image-builder result must be a new immutable digest.",
    );
  }
  const baseline = validateSandboxBaselineEvidence({
    providerId: attestation.baselineEvidence.providerId,
    request: {
      profile: input.builderProfile,
      expectedHostPolicyDigest: input.expected.hostPolicyDigest,
      maxEvidenceAgeMs: input.expected.maxEvidenceAgeMs,
      now: input.now,
    },
    evidence: attestation.baselineEvidence,
  });
  if (!baseline.ok) {
    throw new SandboxUnavailableError(baseline.reason, baseline.message);
  }

  const [signature, sbom, provenance, binding] = await Promise.all([
    input.verifier.verifySignature(attestation),
    input.verifier.verifyReferencedDocument({ kind: "sbom", digest: attestation.sbomDigest }),
    input.verifier.verifyReferencedDocument({
      kind: "provenance",
      digest: attestation.provenanceDigest,
    }),
    input.verifier.verifyProvenanceBinding({
      attestation,
      expectedProposalId: input.expected.proposalId,
    }),
  ]);
  if (!signature || !sbom || !provenance || !binding) {
    throw new SandboxUnavailableError(
      "EVIDENCE_FAILED",
      "Image signature, SBOM, provenance, or proposal binding could not be verified.",
    );
  }

  // Zod materializes this strict schema (including nested evidence) in schema
  // declaration order, so the verified domain object has one canonical JSON form.
  const canonical = JSON.stringify(attestation);
  return Object.freeze({
    image: Object.freeze({
      imageDigest: attestation.resultImageDigest,
      profileVersion: attestation.profileVersion,
    }),
    attestationDigest: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
  });
}
