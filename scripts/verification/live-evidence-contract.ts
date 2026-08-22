import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
export const RELEASE_REVISION_PATTERN = /^[a-f0-9]{40,64}$/u;

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_CONFIGURATION_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MAX_RESULT_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_EVIDENCE_AGE_MS = 31 * 24 * 60 * 60_000;
const MAX_EVIDENCE_VALIDITY_MS = 31 * 24 * 60 * 60_000;

export type LiveEvidenceSource = "deployed-drill" | "external-attestation";

export type LiveEvidenceRecord = {
  schemaVersion?: unknown;
  policyVersion?: unknown;
  kind?: unknown;
  status?: unknown;
  source?: unknown;
  releaseRevision?: unknown;
  checkoutDigest?: unknown;
  configurationDigest?: unknown;
  environmentDigest?: unknown;
  artifactPath?: unknown;
  artifactDigest?: unknown;
  runId?: unknown;
  attestor?: unknown;
  observedAt?: unknown;
  expiresAt?: unknown;
  measurements?: unknown;
};

export type LiveEvidenceManifest = {
  schemaVersion?: unknown;
  manifestType?: unknown;
  policyVersion?: unknown;
  plan?: unknown;
  templateOnly?: unknown;
  release?: unknown;
  deployment?: unknown;
  expectations?: unknown;
  evidence?: unknown;
};

export type LiveEvidencePolicy<Kind extends string> = {
  plan: string;
  manifestType: string;
  policyVersion: string;
  requiredKinds: readonly Kind[];
  validateMeasurements: (kind: Kind, measurements: unknown) => boolean;
  validateManifest?: (manifest: LiveEvidenceManifest) => readonly string[];
};

export type LiveEvidenceBindings = {
  releaseRevision: string;
  checkoutDigest: string;
  configurationDigest: string;
  environmentDigest: string;
};

export type ValidateLiveEvidenceInput<Kind extends string> = {
  manifestPath: string;
  checkoutRoot: string;
  bindings: LiveEvidenceBindings;
  policy: LiveEvidencePolicy<Kind>;
  now?: number;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function childArtifactPath(bundleRoot: string, path: unknown) {
  if (!nonEmptyString(path) || isAbsolute(path)) return undefined;
  const resolved = resolve(bundleRoot, path);
  const fromBundle = relative(bundleRoot, resolved);
  if (
    !fromBundle ||
    fromBundle === ".." ||
    fromBundle.startsWith(`..${sep}`) ||
    isAbsolute(fromBundle)
  ) {
    return undefined;
  }
  return resolved;
}

export function isPathInside(root: string, candidate: string) {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== ".." &&
      !isAbsolute(fromRoot))
  );
}

export function requireExternalEvidencePath(
  checkoutRoot: string,
  manifestPath: string,
  errorPrefix: string,
) {
  const resolved = resolve(manifestPath);
  if (isPathInside(checkoutRoot, resolved)) {
    throw new Error(`${errorPrefix}_EVIDENCE_MUST_BE_OUTSIDE_CHECKOUT`);
  }
  return resolved;
}

export async function fileSha256(path: string) {
  return `sha256:${createHash("sha256")
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest("hex")}`;
}

function checkoutTreeDigest(root: string) {
  const tree = Bun.spawnSync(["git", "ls-tree", "-r", "--full-tree", "HEAD"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (tree.exitCode !== 0) {
    throw new Error("LIVE_EVIDENCE_CHECKOUT_DIGEST_UNAVAILABLE");
  }
  return `sha256:${createHash("sha256").update(tree.stdout).digest("hex")}`;
}

export function assertExactCleanCheckout(
  root: string,
  expectedRevision: string,
  errorPrefix: string,
) {
  if (!RELEASE_REVISION_PATTERN.test(expectedRevision)) {
    throw new Error(`${errorPrefix}_RELEASE_REVISION_INVALID`);
  }
  const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (
    revision.exitCode !== 0 ||
    revision.stdout.toString().trim() !== expectedRevision
  ) {
    throw new Error(`${errorPrefix}_RELEASE_REVISION_MISMATCH`);
  }
  const status = Bun.spawnSync(["git", "status", "--porcelain"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (status.exitCode !== 0 || status.stdout.toString().trim()) {
    throw new Error(`${errorPrefix}_RELEASE_CHECKOUT_NOT_CLEAN`);
  }
  return checkoutTreeDigest(root);
}

export function requireSha256Environment(name: string, errorPrefix: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${errorPrefix}_REQUIRED:${name}`);
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${errorPrefix}_INVALID_SHA256:${name}`);
  }
  return value;
}

function resultArtifactMatches(input: {
  artifact: unknown;
  bindings: LiveEvidenceBindings;
  manifestPlan: string;
  policyVersion: string;
  record: LiveEvidenceRecord;
}) {
  const artifact = object(input.artifact);
  if (!artifact) return false;
  return (
    artifact.schemaVersion === 1 &&
    artifact.artifactType === "avermate.live-evidence-result" &&
    artifact.plan === input.manifestPlan &&
    artifact.policyVersion === input.policyVersion &&
    artifact.kind === input.record.kind &&
    artifact.status === "passed" &&
    artifact.source === input.record.source &&
    artifact.releaseRevision === input.bindings.releaseRevision &&
    artifact.checkoutDigest === input.bindings.checkoutDigest &&
    artifact.configurationDigest === input.bindings.configurationDigest &&
    artifact.environmentDigest === input.bindings.environmentDigest &&
    artifact.runId === input.record.runId &&
    artifact.attestor === input.record.attestor &&
    artifact.observedAt === input.record.observedAt &&
    artifact.expiresAt === input.record.expiresAt &&
    isDeepStrictEqual(artifact.measurements, input.record.measurements)
  );
}

async function recordPasses<Kind extends string>(input: {
  bundleRoot: string;
  bindings: LiveEvidenceBindings;
  kind: Kind;
  manifestPlan: string;
  now: number;
  policy: LiveEvidencePolicy<Kind>;
  record: LiveEvidenceRecord;
}) {
  const { bindings, kind, now, policy, record } = input;
  const observedAt = Date.parse(
    typeof record.observedAt === "string" ? record.observedAt : "",
  );
  const expiresAt = Date.parse(
    typeof record.expiresAt === "string" ? record.expiresAt : "",
  );
  if (
    record.schemaVersion !== 1 ||
    record.policyVersion !== policy.policyVersion ||
    record.kind !== kind ||
    record.status !== "passed" ||
    !["deployed-drill", "external-attestation"].includes(
      typeof record.source === "string" ? record.source : "",
    ) ||
    record.releaseRevision !== bindings.releaseRevision ||
    record.checkoutDigest !== bindings.checkoutDigest ||
    record.configurationDigest !== bindings.configurationDigest ||
    record.environmentDigest !== bindings.environmentDigest ||
    !validDigest(record.artifactDigest) ||
    !nonEmptyString(record.runId) ||
    !nonEmptyString(record.attestor) ||
    !Number.isFinite(observedAt) ||
    !Number.isFinite(expiresAt) ||
    observedAt > now + 5 * 60_000 ||
    observedAt < now - MAX_EVIDENCE_AGE_MS ||
    expiresAt <= now ||
    expiresAt <= observedAt ||
    expiresAt > observedAt + MAX_EVIDENCE_VALIDITY_MS ||
    !policy.validateMeasurements(kind, record.measurements)
  ) {
    return false;
  }

  const artifactPath = childArtifactPath(input.bundleRoot, record.artifactPath);
  if (!artifactPath) return false;
  const artifactFile = Bun.file(artifactPath);
  if (
    !(await artifactFile.exists()) ||
    artifactFile.size > MAX_RESULT_ARTIFACT_BYTES ||
    (await fileSha256(artifactPath)) !== record.artifactDigest
  ) {
    return false;
  }
  let artifact: unknown;
  try {
    artifact = JSON.parse(await artifactFile.text());
  } catch {
    return false;
  }
  return resultArtifactMatches({
    artifact,
    bindings,
    manifestPlan: input.manifestPlan,
    policyVersion: policy.policyVersion,
    record,
  });
}

export async function validateLiveEvidence<Kind extends string>(
  input: ValidateLiveEvidenceInput<Kind>,
) {
  const failures: string[] = [];
  if (isPathInside(input.checkoutRoot, input.manifestPath)) {
    return ["manifest:must-be-outside-checkout"];
  }
  const file = Bun.file(input.manifestPath);
  if (!(await file.exists())) return ["manifest:not-found"];
  if (file.size > MAX_MANIFEST_BYTES) return ["manifest:too-large"];

  let manifest: LiveEvidenceManifest;
  try {
    manifest = JSON.parse(await file.text()) as LiveEvidenceManifest;
  } catch {
    return ["manifest:invalid-json"];
  }
  const release = object(manifest.release);
  const deployment = object(manifest.deployment);
  if (
    manifest.schemaVersion !== 2 ||
    manifest.manifestType !== input.policy.manifestType ||
    manifest.policyVersion !== input.policy.policyVersion ||
    manifest.plan !== input.policy.plan ||
    manifest.templateOnly === true ||
    release?.revision !== input.bindings.releaseRevision ||
    release.checkoutDigest !== input.bindings.checkoutDigest ||
    deployment?.environmentDigest !== input.bindings.environmentDigest ||
    deployment.configurationDigest !== input.bindings.configurationDigest
  ) {
    failures.push("manifest:header-or-binding-mismatch");
  }
  failures.push(...(input.policy.validateManifest?.(manifest) ?? []));

  const bundleRoot = resolve(input.manifestPath, "..");
  const configurationPath = childArtifactPath(
    bundleRoot,
    deployment?.configurationArtifactPath,
  );
  if (!configurationPath) {
    failures.push("manifest:configuration-artifact-path-invalid");
  } else {
    const configuration = Bun.file(configurationPath);
    if (
      !(await configuration.exists()) ||
      configuration.size > MAX_CONFIGURATION_ARTIFACT_BYTES ||
      (await fileSha256(configurationPath)) !==
        input.bindings.configurationDigest
    ) {
      failures.push("manifest:configuration-artifact-digest-mismatch");
    }
  }

  const records = Array.isArray(manifest.evidence)
    ? manifest.evidence.map((value) => object(value)).filter(Boolean)
    : [];
  for (const kind of input.policy.requiredKinds) {
    let accepted = false;
    for (const record of records) {
      if (
        record?.kind === kind &&
        (await recordPasses({
          bundleRoot,
          bindings: input.bindings,
          kind,
          manifestPlan: input.policy.plan,
          now: input.now ?? Date.now(),
          policy: input.policy,
          record: record as LiveEvidenceRecord,
        }))
      ) {
        accepted = true;
        break;
      }
    }
    if (!accepted) failures.push(`${kind}:missing-or-invalid`);
  }
  return failures;
}
