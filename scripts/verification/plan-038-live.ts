import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertExactCleanCheckout,
  requireExternalEvidencePath,
  requireSha256Environment,
  validateLiveEvidence,
} from "./live-evidence-contract";
import { PLAN038_LIVE_EVIDENCE_POLICY } from "./plan-038-live-contract";

const root = fileURLToPath(new URL("../..", import.meta.url));

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PLAN038_LIVE_REQUIRED:${name}`);
  return value;
}

async function probe(
  name: string,
  url: string,
  validate: (body: unknown) => boolean,
) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`PLAN038_LIVE_${name}_HTTP_${response.status}`);
  }
  const body = await response.json();
  if (!validate(body)) throw new Error(`PLAN038_LIVE_${name}_INVALID`);
}

if (process.env.PLAN038_LIVE_CONFIRM !== "strict-real-services") {
  throw new Error("PLAN038_LIVE_CONFIRM_REQUIRED:strict-real-services");
}

const expectedRevision = required("EXPECTED_NODE_RELEASE_REVISION");
const checkoutDigest = assertExactCleanCheckout(
  root,
  expectedRevision,
  "PLAN038_LIVE",
);
const configurationDigest = requireSha256Environment(
  "EXPECTED_NODE_CONFIG_DIGEST",
  "PLAN038_LIVE",
);
const environmentDigest = requireSha256Environment(
  "EXPECTED_NODE_ENVIRONMENT_DIGEST",
  "PLAN038_LIVE",
);
const configuredEvidencePath = required("PLAN038_LIVE_EVIDENCE");
const manifestPath = requireExternalEvidencePath(
  root,
  isAbsolute(configuredEvidencePath)
    ? configuredEvidencePath
    : resolve(root, configuredEvidencePath),
  "PLAN038_LIVE",
);
const evidenceFailures = await validateLiveEvidence({
  manifestPath,
  checkoutRoot: root,
  bindings: {
    releaseRevision: expectedRevision,
    checkoutDigest,
    configurationDigest,
    environmentDigest,
  },
  policy: PLAN038_LIVE_EVIDENCE_POLICY,
});
if (evidenceFailures.length > 0) {
  throw new Error(
    `PLAN038_LIVE_EVIDENCE_INCOMPLETE:${evidenceFailures.join(",")}`,
  );
}

await probe("NODE", required("PLAN038_NODE_HEALTH_URL"), (body) => {
  const value = body as {
    status?: unknown;
    manifest?: { features?: Record<string, unknown> };
  };
  const features = value.manifest?.features;
  return (
    value.status === "ok" &&
    Boolean(features?.storage) &&
    Boolean(features?.conversations) &&
    Boolean(features?.retrieval) &&
    Boolean(features?.models) &&
    Boolean(features?.sandbox) &&
    Boolean(features?.jobs)
  );
});
await probe("CORE", required("PLAN038_CORE_HEALTH_URL"), (body) => {
  const value = body as { status?: unknown };
  return value.status === "ok" || value.status === "healthy";
});
await probe("LITELLM", required("PLAN038_LITELLM_HEALTH_URL"), (body) =>
  Boolean(body && typeof body === "object"),
);
await probe("QDRANT", required("PLAN038_QDRANT_HEALTH_URL"), (body) =>
  Boolean(body && typeof body === "object"),
);
await probe("TEI", required("PLAN038_TEI_HEALTH_URL"), (body) =>
  Boolean(body && typeof body === "object"),
);
await probe("QWEN3", required("PLAN038_QWEN3_HEALTH_URL"), (body) => {
  const value = body as { model?: unknown; revision?: unknown };
  return (
    value.model === "Qwen/Qwen3-Reranker-0.6B" &&
    value.revision === "e61197ed45024b0ed8a2d74b80b4d909f1255473"
  );
});

console.log(
  "[plan-038] strict live services and v2 digest-bound deployed evidence passed",
);
