import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertExactCleanCheckout,
  requireExternalEvidencePath,
  requireSha256Environment,
  validateLiveEvidence,
} from "./live-evidence-contract";
import { PLAN037_LIVE_EVIDENCE_POLICY } from "./plan-037-live-contract";

const root = fileURLToPath(new URL("../..", import.meta.url));

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PLAN037_LIVE_REQUIRED:${name}`);
  return value;
}

if (process.env.PLAN037_LIVE_CONFIRM !== "strict-real-learning-flow") {
  throw new Error("PLAN037_LIVE_CONFIRM_REQUIRED:strict-real-learning-flow");
}

const expectedRevision = required("EXPECTED_LEARNING_RELEASE_REVISION");
const checkoutDigest = assertExactCleanCheckout(
  root,
  expectedRevision,
  "PLAN037_LIVE",
);
const configurationDigest = requireSha256Environment(
  "EXPECTED_LEARNING_CONFIG_DIGEST",
  "PLAN037_LIVE",
);
const environmentDigest = requireSha256Environment(
  "EXPECTED_LEARNING_ENVIRONMENT_DIGEST",
  "PLAN037_LIVE",
);
const configuredEvidencePath = required("PLAN037_LIVE_EVIDENCE");
const manifestPath = requireExternalEvidencePath(
  root,
  isAbsolute(configuredEvidencePath)
    ? configuredEvidencePath
    : resolve(root, configuredEvidencePath),
  "PLAN037_LIVE",
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
  policy: PLAN037_LIVE_EVIDENCE_POLICY,
});
if (failures.length > 0) {
  throw new Error(`PLAN037_LIVE_EVIDENCE_INCOMPLETE:${failures.join(",")}`);
}

console.log(
  "[plan-037] strict v2 provider, labelled-learning, Web, grade and Node lifecycle evidence passed",
);
