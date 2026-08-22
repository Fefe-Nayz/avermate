import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertExactCleanCheckout,
  requireExternalEvidencePath,
  requireSha256Environment,
  validateLiveEvidence,
} from "./live-evidence-contract";
import { PLAN035_LIVE_EVIDENCE_POLICY } from "./plan-035-live-contract";

const root = fileURLToPath(new URL("../..", import.meta.url));

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PLAN035_LIVE_REQUIRED:${name}`);
  return value;
}

if (process.env.PLAN035_LIVE_CONFIRM !== "strict-real-providers") {
  throw new Error("PLAN035_LIVE_CONFIRM_REQUIRED:strict-real-providers");
}

const expectedRevision = required("EXPECTED_AGENT_RELEASE_REVISION");
const checkoutDigest = assertExactCleanCheckout(
  root,
  expectedRevision,
  "PLAN035_LIVE",
);
const configurationDigest = requireSha256Environment(
  "EXPECTED_AGENT_CONFIG_DIGEST",
  "PLAN035_LIVE",
);
const environmentDigest = requireSha256Environment(
  "EXPECTED_AGENT_ENVIRONMENT_DIGEST",
  "PLAN035_LIVE",
);
const configuredEvidencePath = required("PLAN035_LIVE_EVIDENCE");
const manifestPath = requireExternalEvidencePath(
  root,
  isAbsolute(configuredEvidencePath)
    ? configuredEvidencePath
    : resolve(root, configuredEvidencePath),
  "PLAN035_LIVE",
);
const failures = await validateLiveEvidence({
  manifestPath,
  checkoutRoot: root,
  bindings: {
    releaseRevision: expectedRevision,
    checkoutDigest,
    configurationDigest,
    environmentDigest,
  },
  policy: PLAN035_LIVE_EVIDENCE_POLICY,
});
if (failures.length > 0) {
  throw new Error(`PLAN035_LIVE_EVIDENCE_INCOMPLETE:${failures.join(",")}`);
}

console.log(
  "[plan-035] strict v2 real-provider, quality, Web, load and redaction evidence passed",
);
