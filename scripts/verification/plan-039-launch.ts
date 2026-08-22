import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertExactCleanCheckout,
  requireExternalEvidencePath,
  requireSha256Environment,
  validateLiveEvidence,
} from "./live-evidence-contract";
import {
  createPlan039EvidencePolicy,
  parsePlan039EvidenceKind,
} from "./plan-039-launch-contract";

const root = fileURLToPath(new URL("../..", import.meta.url));

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PLAN039_LAUNCH_REQUIRED:${name}`);
  return value;
}

function expectedAirgap() {
  const value = required("EXPECTED_MANAGED_AIRGAP");
  if (value === "required") return true;
  if (value === "not-applicable") return false;
  throw new Error(
    "PLAN039_LAUNCH_EXPECTED_MANAGED_AIRGAP_INVALID:required|not-applicable",
  );
}

try {
  const requestedKind = parsePlan039EvidenceKind(
    process.argv.find((value) => value.startsWith("--kind="))?.slice(7),
  );
  const releaseRevision = required("EXPECTED_MANAGED_RELEASE_REVISION");
  const checkoutDigest = assertExactCleanCheckout(
    root,
    releaseRevision,
    "PLAN039_LAUNCH",
  );
  const configurationDigest = requireSha256Environment(
    "EXPECTED_MANAGED_CONFIG_DIGEST",
    "PLAN039_LAUNCH",
  );
  const environmentDigest = requireSha256Environment(
    "EXPECTED_MANAGED_ENVIRONMENT_DIGEST",
    "PLAN039_LAUNCH",
  );
  const airgapRequired = expectedAirgap();
  const configuredPath = required("MANAGED_039_LAUNCH_EVIDENCE");
  const manifestPath = requireExternalEvidencePath(
    root,
    isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath),
    "PLAN039_LAUNCH",
  );
  const policy = createPlan039EvidencePolicy({
    requestedKind,
    airgapRequired,
  });
  const failures = await validateLiveEvidence({
    manifestPath,
    checkoutRoot: root,
    bindings: {
      releaseRevision,
      checkoutDigest,
      configurationDigest,
      environmentDigest,
    },
    policy,
  });
  if (failures.length > 0) {
    throw new Error(`PLAN039_LAUNCH_EVIDENCE_INCOMPLETE:${failures.join(",")}`);
  }

  console.log(
    `Plan 039 v2 digest-bound deployed evidence passed for: ${policy.requiredKinds.join(", ")}`,
  );
} catch (error) {
  console.error(
    `Plan 039 launch gate BLOCKED: ${error instanceof Error ? error.message : "unknown validation error"}`,
  );
  process.exit(1);
}
