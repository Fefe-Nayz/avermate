import { describe, expect, test } from "bun:test";
import {
  SANDBOX_BASELINE_CHECK_IDS,
  sandboxBaselineEvidenceSchema,
  sandboxDependencyManifestRequestSchema,
  sandboxExecutionProfileSchema,
  sandboxWorkspaceSnapshotRefSchema,
} from "./sandbox";

const digest = `sha256:${"a".repeat(64)}`;

describe("sandbox contracts", () => {
  test("requires every baseline check", () => {
    const checks = Object.fromEntries(
      SANDBOX_BASELINE_CHECK_IDS.map((id) => [
        id,
        { status: "pass", observed: "probe assertion passed" },
      ]),
    );
    const evidence = {
      baselineVersion: 1,
      providerId: "mock",
      profileId: "latex",
      profileVersion: "v1",
      isolationClass: "mock",
      runtimeKind: "fixture",
      runtimeVersion: "1",
      probeVersion: "1",
      imageDigest: digest,
      hostPolicyDigest: digest,
      evidenceNonce: "nonce",
      checkedAt: "2026-08-22T00:00:00.000Z",
      expiresAt: "2026-08-22T01:00:00.000Z",
      checks,
    };

    expect(sandboxBaselineEvidenceSchema.safeParse(evidence).success).toBe(true);
    delete checks["readonly-rootfs"];
    expect(sandboxBaselineEvidenceSchema.safeParse(evidence).success).toBe(false);
  });

  test("keeps image templates and workspace snapshots structurally distinct", () => {
    const snapshot = sandboxWorkspaceSnapshotRefSchema.parse({
      provider: "mock",
      digest,
      format: "tar+zstd-v1",
    });
    expect(snapshot.provider).toBe("mock");
    expect(
      sandboxExecutionProfileSchema.safeParse({
        id: "latex",
        version: "v1",
        enabled: true,
        image: snapshot,
      }).success,
    ).toBe(false);
  });

  test("dependency manifests reject URLs, floating versions, scripts and registry swaps", () => {
    const valid = {
      ecosystem: "pypi",
      packages: [
        {
          name: "numpy",
          version: "2.3.1",
          registry: "pypi",
          installScripts: false,
          nativeBuild: false,
        },
      ],
      requestedBy: "user",
      tenantCacheScope: "tenant-1",
    };
    expect(sandboxDependencyManifestRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      sandboxDependencyManifestRequestSchema.safeParse({
        ...valid,
        packages: [{ ...valid.packages[0], name: "https://evil.invalid/pkg", version: "*" }],
      }).success,
    ).toBe(false);
    expect(
      sandboxDependencyManifestRequestSchema.safeParse({
        ...valid,
        packages: [{ ...valid.packages[0], registry: "npmjs", installScripts: true }],
      }).success,
    ).toBe(false);
  });
});
