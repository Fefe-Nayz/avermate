import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fileSha256,
  type LiveEvidenceBindings,
} from "./live-evidence-contract";

export type SyntheticEvidenceFixture<Kind extends string> = {
  bundleRoot: string;
  manifestPath: string;
  bindings: LiveEvidenceBindings;
  cleanup: () => Promise<void>;
};

const digestLiteral = (character: string) => `sha256:${character.repeat(64)}`;

export async function createSyntheticEvidenceFixture<
  Kind extends string,
>(input: {
  plan: string;
  manifestType: string;
  policyVersion: string;
  kinds: readonly Kind[];
  measurements: (kind: Kind) => unknown;
  expectations: Record<string, unknown>;
  now?: number;
}) {
  const bundleRoot = await mkdtemp(
    join(tmpdir(), "avermate-live-evidence-test-"),
  );
  const artifactRoot = join(bundleRoot, "artifacts");
  await mkdir(artifactRoot);
  const configurationArtifactPath = "redacted-deployment-config.json";
  const configurationPath = join(bundleRoot, configurationArtifactPath);
  await Bun.write(
    configurationPath,
    `${JSON.stringify({ schemaVersion: 1, redacted: true })}\n`,
  );
  const bindings: LiveEvidenceBindings = {
    releaseRevision: "a".repeat(40),
    checkoutDigest: digestLiteral("b"),
    configurationDigest: await fileSha256(configurationPath),
    environmentDigest: digestLiteral("c"),
  };
  const now = input.now ?? Date.parse("2030-01-15T12:00:00.000Z");
  const observedAt = new Date(now - 60_000).toISOString();
  const expiresAt = new Date(now + 86_400_000).toISOString();
  const evidence: Record<string, unknown>[] = [];

  for (const [index, kind] of input.kinds.entries()) {
    const measurements = input.measurements(kind);
    const runId = `synthetic-unit-fixture-${kind}-${index}`;
    const artifactPath = `artifacts/${kind}.json`;
    const result = {
      schemaVersion: 1,
      artifactType: "avermate.live-evidence-result",
      plan: input.plan,
      policyVersion: input.policyVersion,
      kind,
      status: "passed",
      source: "deployed-drill",
      ...bindings,
      runId,
      attestor: "synthetic-unit-test-only",
      observedAt,
      expiresAt,
      measurements,
    };
    const artifactFile = join(bundleRoot, artifactPath);
    await Bun.write(artifactFile, `${JSON.stringify(result)}\n`);
    evidence.push({
      schemaVersion: 1,
      policyVersion: input.policyVersion,
      kind,
      status: "passed",
      source: "deployed-drill",
      ...bindings,
      artifactPath,
      artifactDigest: await fileSha256(artifactFile),
      runId,
      attestor: "synthetic-unit-test-only",
      observedAt,
      expiresAt,
      measurements,
    });
  }

  const manifestPath = join(bundleRoot, "manifest.json");
  await Bun.write(
    manifestPath,
    `${JSON.stringify({
      schemaVersion: 2,
      manifestType: input.manifestType,
      policyVersion: input.policyVersion,
      plan: input.plan,
      release: {
        revision: bindings.releaseRevision,
        checkoutDigest: bindings.checkoutDigest,
      },
      deployment: {
        environmentDigest: bindings.environmentDigest,
        configurationArtifactPath,
        configurationDigest: bindings.configurationDigest,
      },
      expectations: input.expectations,
      evidence,
    })}\n`,
  );
  return {
    bundleRoot,
    manifestPath,
    bindings,
    cleanup: () => rm(bundleRoot, { recursive: true, force: true }),
  } satisfies SyntheticEvidenceFixture<Kind>;
}
