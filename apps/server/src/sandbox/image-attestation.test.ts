import { describe, expect, test } from "bun:test";
import {
  authorizeAttestedSandboxImage,
  type SandboxImageAttestationVerifier,
} from "./image-attestation";
import { MockSandboxProvider } from "./mock-provider";
import { enableSandboxProfile } from "./profiles";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const hostPolicyDigest = digest("f");
const now = new Date("2026-08-22T12:00:00.000Z");
const builderProfile = enableSandboxProfile("image-builder", {
  version: "builder-v1",
  imageDigest: digest("1"),
});

async function fixtureAttestation() {
  const provider = new MockSandboxProvider({
    allowMock: true,
    hostPolicyDigest,
    profiles: [builderProfile],
    now: () => now,
  });
  const preflight = await provider.preflight({
    profile: builderProfile,
    expectedHostPolicyDigest: hostPolicyDigest,
    maxEvidenceAgeMs: 60_000,
    now,
  });
  if (!preflight.ok) throw new Error("fixture preflight failed");
  return {
    schemaVersion: 1 as const,
    proposalId: "proposal-1",
    sourceImageDigest: digest("2"),
    resultImageDigest: digest("3"),
    profileId: "latex" as const,
    profileVersion: "latex-bundle-v2",
    dependencyLockDigest: digest("4"),
    builderPolicyDigest: digest("5"),
    egressPolicyDigest: digest("6"),
    sbomDigest: digest("7"),
    provenanceDigest: digest("8"),
    signature: "test-signature-value",
    signerKeyId: "trusted-test-signer",
    tenantCacheScope: "tenant-1",
    scanStatus: "pass" as const,
    quarantined: false as const,
    builtAt: now.toISOString(),
    baselineEvidence: preflight.evidence,
  };
}

const expected = {
  proposalId: "proposal-1",
  targetProfileId: "latex" as const,
  targetProfileVersion: "latex-bundle-v2",
  sourceImageDigest: digest("2"),
  dependencyLockDigest: digest("4"),
  builderPolicyDigest: digest("5"),
  egressPolicyDigest: digest("6"),
  tenantCacheScope: "tenant-1",
  signerKeyIds: ["trusted-test-signer"],
  hostPolicyDigest,
  maxEvidenceAgeMs: 60_000,
};

function verifier(result: boolean): SandboxImageAttestationVerifier {
  return {
    async verifySignature() {
      return result;
    },
    async verifyReferencedDocument() {
      return result;
    },
    async verifyProvenanceBinding() {
      return result;
    },
  };
}

describe("sandbox image attestation", () => {
  test("authorizes only a signed, scanned, fully bound immutable image", async () => {
    expect(
      await authorizeAttestedSandboxImage({
        attestation: await fixtureAttestation(),
        builderProfile,
        expected,
        verifier: verifier(true),
        now,
      }),
    ).toMatchObject({
      image: { imageDigest: digest("3"), profileVersion: "latex-bundle-v2" },
    });
  });

  test("quarantines unverifiable builder output", async () => {
    expect(
      authorizeAttestedSandboxImage({
        attestation: await fixtureAttestation(),
        builderProfile,
        expected,
        verifier: verifier(false),
        now,
      }),
    ).rejects.toMatchObject({ reason: "EVIDENCE_FAILED" });
  });
});
