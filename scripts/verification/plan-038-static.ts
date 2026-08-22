import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type {
  ObjectStorageProvider,
  SandboxExecutionProfile,
  SandboxProvider,
} from "@avermate/agent-contracts";
import {
  ArtifactSandboxJobHandler,
  configuredArtifactSandboxProfiles,
  NODE_ARTIFACT_WORKER_DEFINITIONS,
} from "../../apps/node/src/artifact-workers";
import {
  loadNodeConfig,
  nodeConfigSchema,
  type NodeConfig,
} from "../../apps/node/src/config";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string) => Bun.file(`${root}/${path}`).text();

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`PLAN038_STATIC_${code}`);
}

async function assertConfigRejected(
  environment: NodeJS.ProcessEnv,
  code: string,
) {
  let rejected = false;
  try {
    await loadNodeConfig(
      `${root}/infra/node/profiles/full-self-host.yaml`,
      environment,
    );
  } catch {
    rejected = true;
  }
  assert(rejected, code);
}

function withoutEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  removedName: string,
) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => name !== removedName),
  );
}

function configuredArtifactKinds(config: NodeConfig) {
  const profiles = new Set(
    configuredArtifactSandboxProfiles(config).map(({ id }) => id),
  );
  return Object.values(NODE_ARTIFACT_WORKER_DEFINITIONS)
    .filter(({ profileId }) => profiles.has(profileId))
    .map(({ kind }) => kind);
}

const [
  compose,
  composeEnvironment,
  baseCompose,
  serverEnv,
  workerContract,
  liteLlmConfig,
  configurator,
  daemon,
  liveGate,
  controlChannel,
  opensandboxRuntime,
  nodeDockerfile,
  nodePackage,
  liveEvidenceContract,
  sharedLiveEvidenceContract,
] = await Promise.all([
  read("infra/compose/plan-038.yml"),
  read("infra/compose/plan-038.env.example"),
  read("infra/compose/avermate.yml"),
  read("apps/server/.env.example"),
  read("infra/workers/qwen3-reranker/worker-contract.json"),
  read("infra/litellm/config.yaml"),
  read("apps/node/src/configurator.ts"),
  read("apps/node/src/daemon.ts"),
  read("scripts/verification/plan-038-live.ts"),
  read("apps/node/src/control-channel.ts"),
  read("apps/node/src/opensandbox-runtime.ts"),
  read("apps/node/Dockerfile"),
  read("apps/node/package.json"),
  read("scripts/verification/plan-038-live-contract.ts"),
  read("scripts/verification/live-evidence-contract.ts"),
]);

const liveEvidenceSurface = [
  liveGate,
  liveEvidenceContract,
  sharedLiveEvidenceContract,
].join("\n");

for (const marker of [
  "EXPECTED_NODE_RELEASE_REVISION",
  "EXPECTED_NODE_CONFIG_DIGEST",
  "EXPECTED_NODE_ENVIRONMENT_DIGEST",
  "PLAN038_LIVE_EVIDENCE",
  "assertExactCleanCheckout",
  "requireExternalEvidencePath",
  "schemaVersion !== 2",
  "checkoutDigest",
  "configurationDigest",
  "artifactDigest",
  "environmentDigest",
  "pairing-relay-revocation",
  "runtime-checkpoint",
  "opencode-worker",
  "openhands-worker",
  "backup-restore",
  "upgrade-n-minus-one",
  "airgap",
]) {
  assert(liveEvidenceSurface.includes(marker), `LIVE_GATE_${marker}`);
}

for (const marker of [
  "storage.driver",
  "retrieval.embeddingProvider",
  "retrieval.rerankProvider",
  "models.gateway",
  "sandbox.runtimeCheckpoints",
  "workers.opencode.commandCatalogue",
  "workers.openhands.commandCatalogue",
  "lifecycle.backupDir",
  "/api/setup/config/validate",
  "/api/setup/config/apply",
  "/api/setup/config/rollback",
  "/api/setup/secret",
  "/api/setup/deployment/preview",
]) {
  assert(configurator.includes(marker), `CONFIGURATOR_${marker}`);
}
assert(
  configurator.includes('aria-live="polite"') &&
    configurator.includes('aria-live="assertive"') &&
    configurator.includes("aria-busy"),
  "CONFIGURATOR_ACCESSIBLE_STATES",
);
assert(
  configurator.includes('id="setup-language"') &&
    configurator.includes("localStorage.setItem(localeKey,locale)") &&
    configurator.includes("englishGroups[group.id]") &&
    configurator.includes("englishLabels[field.path]") &&
    configurator.includes("tr('invalidNumber')") &&
    configurator.includes("action('valid'"),
  "CONFIGURATOR_FR_EN_DYNAMIC",
);
assert(
  configurator.includes("publicConfig(config)") &&
    configurator.includes("CONFIGURED_SECRET") &&
    configurator.includes("#discardPendingSecrets"),
  "CONFIGURATOR_SECRET_REDACTION",
);
assert(
  configurator.includes(".previous") &&
    configurator.includes("restartRequired") &&
    configurator.includes("changePreview"),
  "CONFIGURATOR_APPLY_ROLLBACK",
);
assert(
  configurator.includes("backupCreate") &&
    configurator.includes("restorePlan") &&
    configurator.includes("upgradePlan") &&
    configurator.includes("composeDigest"),
  "CONFIGURATOR_OPERATOR_PLAN",
);
assert(
  !/docker\.sock|Bun\.spawn|execFile|spawn\s*\(/u.test(configurator),
  "CONFIGURATOR_PRIVILEGED_EXECUTION",
);
assert(
  baseCompose.includes("AVERMATE_NODE_CONFIG: /data/node/avermate-node.yaml") &&
    baseCompose.includes(
      "AVERMATE_NODE_CONFIG_TEMPLATE: /config/profile.yaml",
    ) &&
    baseCompose.includes('AVERMATE_NODE_CONTAINER_BRIDGE_PORT: "5189"') &&
    baseCompose.includes("127.0.0.1:${AVERMATE_NODE_SETUP_PORT:-5188}:5189") &&
    daemon.includes("initializeMutableConfig") &&
    daemon.includes("AVERMATE_NODE_CONFIG_TEMPLATE") &&
    daemon.includes("NODE_CONTAINER_BRIDGE_PORT_INVALID") &&
    configurator.includes("avermate-node.template.yaml"),
  "MUTABLE_CONFIG_BOOTSTRAP",
);
assert(
  baseCompose.includes("full-self-host-internal") &&
    controlChannel.includes("NODE_RELAY_LOCAL_COMPOSE_TARGET_INVALID") &&
    controlChannel.includes("ws://api:5000/api/node/control") &&
    daemon.includes("config.relay.transport") &&
    configurator.includes("pairingCoreUrl") &&
    configurator.includes("http://api:5000"),
  "LOCAL_COMPOSE_RELAY_EXACT_TARGET",
);
assert(
  opensandboxRuntime.includes("new OpenSandboxSdkTransport") &&
    opensandboxRuntime.includes("NodePortableWorkspaceSnapshotStore") &&
    opensandboxRuntime.includes("createSpecialistSandboxProfile") &&
    daemon.includes("createConfiguredNodeSandboxProvider") &&
    nodeDockerfile.includes("apps/server/src/sandbox") &&
    nodePackage.includes('"@alibaba-group/opensandbox": "0.1.11"'),
  "PRODUCTION_SPECIALIST_PROVIDER_WIRED",
);

for (const service of [
  "litellm",
  "model-api",
  "model-api-fallback",
  "qdrant",
  "tei-embedding",
  "tei-gte-reranker",
  "qwen3-reranker",
  "opencode-worker",
  "openhands-worker",
  "opensandbox",
]) {
  assert(
    new RegExp(`^  ${service}:`, "mu").test(compose),
    `SERVICE_${service}`,
  );
}
assert(!/docker\.sock|privileged:\s*true/iu.test(compose), "HOST_ESCAPE");
assert(
  !/image:\s*[^\n]*(?::latest|:main|:nightly)(?:\s|$)/iu.test(compose),
  "MUTABLE_IMAGE",
);
const imageLines = compose
  .split(/\r?\n/u)
  .filter((line) => /^\s+image:/u.test(line));
assert(imageLines.length >= 9, "IMAGE_CELLS_MISSING");
assert(
  imageLines.every((line) => /\$\{[A-Z0-9_]+:\?/u.test(line)),
  "IMAGE_NOT_FAIL_CLOSED",
);
assert(
  /qwen3-reranker:[\s\S]*QWEN3_RERANK_MODEL_REVISION:[ ]*e61197ed45024b0ed8a2d74b80b4d909f1255473/u.test(
    compose,
  ),
  "QWEN3_REVISION",
);
assert(
  /tei-gte-reranker:/u.test(compose) &&
    !/tei-gte-reranker:[\s\S]{0,800}Qwen\/Qwen3-Reranker/iu.test(compose),
  "QWEN3_MISREPRESENTED_AS_TEI",
);
assert(
  compose.includes("CORPUS_EMBEDDING_BASE_URL: http://tei-embedding:8080/v1") &&
    (await read("infra/node/profiles/full-self-host.yaml")).includes(
      "embeddingEndpoint: http://tei-embedding:8080/v1",
    ),
  "TEI_OPENAI_V1_BASE_PATH",
);

for (const name of [
  "CORPUS_EMBEDDING_ENABLED",
  "CORPUS_EMBEDDING_PROVIDER",
  "CORPUS_EMBEDDING_DIMENSION",
  "CORPUS_VECTOR_URL",
  "CORPUS_RERANK_ENABLED",
  "CORPUS_RERANK_PROVIDER",
  "CORPUS_RERANK_IMAGE_DIGEST",
]) {
  assert(new RegExp(`^${name}=`, "mu").test(serverEnv), `ENV_${name}`);
}

const worker = JSON.parse(workerContract) as Record<string, unknown>;
assert(worker.model === "Qwen/Qwen3-Reranker-0.6B", "QWEN3_MODEL");
assert(
  worker.modelRevision === "e61197ed45024b0ed8a2d74b80b4d909f1255473",
  "QWEN3_MODEL_REVISION",
);
assert(worker.teiCompatible === false, "QWEN3_TEI_FLAG");
assert(worker.networkAtRuntime === "denied", "QWEN3_NETWORK");
const preprocessing = worker.preprocessing as Record<string, unknown>;
assert(
  preprocessing.revision ===
    "sha256:ef9a802ca5f4290952f308895a019a475295ef17b9c890cf9375cd3e8bc85cbf" &&
    preprocessing.promptName === "avermate-french-school-learning-v1",
  "QWEN3_SCHOOL_PROMPT_REVISION",
);
assert(
  worker.imageDigestCoversModelAdapterAndPreprocessing === true &&
    compose.includes("sentence-transformers-5.4.0-school-fr-prompt-ef9a802c"),
  "QWEN3_PREPROCESSING_ATTESTATION",
);

const liteLlm = parse(liteLlmConfig) as Record<string, unknown>;
assert(Array.isArray(liteLlm.model_list), "LITELLM_MODEL_LIST");
assert(/telemetry:\s*false/u.test(liteLlmConfig), "LITELLM_TELEMETRY");
assert(/num_retries:\s*0/u.test(liteLlmConfig), "LITELLM_IMPLICIT_RETRY");
assert(
  /rpm_limit|ownerRequestsPerMinute/u.test(
    `${liteLlmConfig}\n${await read("infra/node/profiles/full-self-host.yaml")}`,
  ),
  "LITELLM_RPM",
);
assert(
  /tpm_limit|ownerTokensPerMinute/u.test(
    `${liteLlmConfig}\n${await read("infra/node/profiles/full-self-host.yaml")}`,
  ),
  "LITELLM_TPM",
);
assert(
  /fallbacks:[\s\S]*selfhost\/default:[\s\S]*selfhost\/fallback/u.test(
    liteLlmConfig,
  ),
  "LITELLM_EXPLICIT_FALLBACK",
);

const publicEnvironment = {
  AVERMATE_NODE_PUBLIC_EMBEDDING_REVISION: "release-2026-08-22-gte",
  AVERMATE_NODE_PUBLIC_QWEN3_RERANKER_DIGEST: `sha256:${"1".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_MODEL_REVISION: "release-2026-08-22-model",
  AVERMATE_NODE_PUBLIC_FALLBACK_MODEL_REVISION:
    "release-2026-08-22-fallback-model",
  AVERMATE_NODE_PUBLIC_OCR_MODEL_REVISION:
    "tesseract-poppler-fra-eng-2026-08-22",
  AVERMATE_NODE_PUBLIC_TRANSCRIPTION_MODEL_REVISION:
    "whisper-large-v3-turbo-q5_0-2026-08-22",
  AVERMATE_NODE_PUBLIC_SANDBOX_HOST_POLICY_DIGEST: `sha256:${"2".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_SANDBOX_EVIDENCE_ENDPOINT:
    "https://sandbox-attestor.example/evidence",
  AVERMATE_NODE_PUBLIC_SANDBOX_RUNTIME_VERSION: "opensandbox-0.1.11",
  AVERMATE_NODE_PUBLIC_MEDIA_WORKER_IMAGE: `ghcr.io/reviewed/avermate-media:2026.08.22@sha256:${"5".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_MEDIA_WORKER_DIGEST: `sha256:${"5".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_OCR_WORKER_IMAGE: `ghcr.io/reviewed/avermate-ocr:2026.08.22@sha256:${"9".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_OCR_WORKER_DIGEST: `sha256:${"9".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_IMAGE: `ghcr.io/reviewed/avermate-transcription:2026.08.22@sha256:${"a".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_DIGEST: `sha256:${"a".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_LATEX_WORKER_IMAGE: `ghcr.io/reviewed/avermate-latex:2026.08.22@sha256:${"6".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_LATEX_WORKER_DIGEST: `sha256:${"6".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_SLIDES_WORKER_IMAGE: `ghcr.io/reviewed/avermate-slides:2026.08.22@sha256:${"7".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_SLIDES_WORKER_DIGEST: `sha256:${"7".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_MANIM_WORKER_IMAGE: `ghcr.io/reviewed/avermate-manim:2026.08.22@sha256:${"8".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_MANIM_WORKER_DIGEST: `sha256:${"8".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_OPENCODE_IMAGE: `ghcr.io/reviewed/opencode:1.18.17@sha256:${"3".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_OPENCODE_DIGEST: `sha256:${"3".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_OPENHANDS_IMAGE: `registry.example/openhands:1.8.0@sha256:${"4".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_OPENHANDS_DIGEST: `sha256:${"4".repeat(64)}`,
  AVERMATE_NODE_PUBLIC_RELEASE_VERSION: "2026.08.22",
};
const profile: NodeConfig = await loadNodeConfig(
  `${root}/infra/node/profiles/full-self-host.yaml`,
  publicEnvironment,
);

for (const [publicName, composeName] of [
  ["AVERMATE_NODE_PUBLIC_OCR_WORKER_IMAGE", "OCR_WORKER_IMAGE"],
  ["AVERMATE_NODE_PUBLIC_OCR_WORKER_DIGEST", "OCR_WORKER_DIGEST"],
  [
    "AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_IMAGE",
    "TRANSCRIPTION_WORKER_IMAGE",
  ],
  [
    "AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_DIGEST",
    "TRANSCRIPTION_WORKER_DIGEST",
  ],
] as const) {
  assert(
    compose.includes(`${publicName}: \${${composeName}:?required}`) &&
      new RegExp(`^${composeName}=$`, "mu").test(composeEnvironment),
    `COMPOSE_REQUIRED_${composeName}`,
  );
}
assert(
  compose.includes(
    "AVERMATE_NODE_PUBLIC_OCR_MODEL_REVISION: ${AVERMATE_NODE_PUBLIC_OCR_MODEL_REVISION:?required}",
  ) &&
    compose.includes(
      "AVERMATE_NODE_PUBLIC_TRANSCRIPTION_MODEL_REVISION: ${AVERMATE_NODE_PUBLIC_TRANSCRIPTION_MODEL_REVISION:?required}",
    ) &&
    /^AVERMATE_NODE_PUBLIC_OCR_MODEL_REVISION=$/mu.test(composeEnvironment) &&
    /^AVERMATE_NODE_PUBLIC_TRANSCRIPTION_MODEL_REVISION=$/mu.test(
      composeEnvironment,
    ),
  "COMPOSE_REQUIRED_DOCUMENT_AI_MODEL_REVISION",
);
assert(
  /DISABLE_OCR:\s*["']?false["']?/u.test(compose) &&
    /OCR_PROVIDER:\s*node/u.test(compose) &&
    /DISABLE_TRANSCRIPTION:\s*["']?false["']?/u.test(compose) &&
    /TRANSCRIPTION_PROVIDER:\s*node/u.test(compose),
  "API_DOCUMENT_AI_NODE_ONLY",
);
assert(
  !/(?:MISTRAL_API_KEY|OCR_API_KEY|TRANSCRIPTION_API_KEY)/u.test(compose),
  "DOCUMENT_AI_CLOUD_KEY",
);
assert(
  !/^  (?:ocr|transcription|stt|whisper)(?:-worker)?:/mu.test(compose) &&
    !/(?:WHISPER_(?:MODEL|WEIGHTS)(?:_DIR|_FILE)?|\/models\/whisper)/u.test(
      compose,
    ),
  "DOCUMENT_AI_UNBOUNDED_HTTP_OR_WEIGHT_MOUNT",
);

const transcriptionModelId = "selfhost/whisper-large-v3-turbo-q5_0";
const ocrModelId = "tesseract-ocr";
const ocrModel = profile.models.catalogue.find(({ id }) => id === ocrModelId);
const transcriptionModel = profile.models.catalogue.find(
  ({ id }) => id === transcriptionModelId,
);
assert(
  ocrModel?.provider === "tesseract+poppler" &&
    ocrModel.modalities.length === 1 &&
    ocrModel.modalities[0] === "image" &&
    profile.models.modelRevisions[ocrModelId] ===
      publicEnvironment.AVERMATE_NODE_PUBLIC_OCR_MODEL_REVISION,
  "OCR_MODEL_EXACT",
);
assert(
  transcriptionModel?.provider === "whisper.cpp" &&
    transcriptionModel.modalities.length === 1 &&
    transcriptionModel.modalities[0] === "audio" &&
    profile.models.modelRevisions[transcriptionModelId] ===
      publicEnvironment.AVERMATE_NODE_PUBLIC_TRANSCRIPTION_MODEL_REVISION,
  "TRANSCRIPTION_MODEL_EXACT",
);

const artifactProfiles = configuredArtifactSandboxProfiles(profile);
const ocrProfile = artifactProfiles.find(({ id }) => id === "ocr");
const transcriptionProfile = artifactProfiles.find(
  ({ id }) => id === "speech-to-text",
);
assert(
  ocrProfile?.image.imageDigest ===
    publicEnvironment.AVERMATE_NODE_PUBLIC_OCR_WORKER_DIGEST &&
    ocrProfile.entrypoints.includes("/opt/avermate/bin/local-ocr") &&
    ocrProfile.egress.mode === "none" &&
    ocrProfile.resources.networkBytes === 0 &&
    ocrProfile.resources.networkRequests === 0,
  "OCR_PROFILE_EXACT",
);
assert(
  transcriptionProfile?.image.imageDigest ===
    publicEnvironment.AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_DIGEST &&
    transcriptionProfile.entrypoints.includes(
      "/opt/avermate/bin/local-transcription",
    ) &&
    transcriptionProfile.egress.mode === "none" &&
    transcriptionProfile.resources.networkBytes === 0 &&
    transcriptionProfile.resources.networkRequests === 0,
  "TRANSCRIPTION_PROFILE_EXACT",
);
assert(
  profile.sandbox.images.some(
    (image) =>
      image.profileId === "ocr" &&
      image.image === publicEnvironment.AVERMATE_NODE_PUBLIC_OCR_WORKER_IMAGE &&
      image.digest === publicEnvironment.AVERMATE_NODE_PUBLIC_OCR_WORKER_DIGEST,
  ) &&
    profile.sandbox.images.some(
      (image) =>
        image.profileId === "speech-to-text" &&
        image.image ===
          publicEnvironment.AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_IMAGE &&
        image.digest ===
          publicEnvironment.AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_DIGEST,
    ),
  "DOCUMENT_AI_IMAGE_DIGEST_BINDING",
);
for (const profileId of ["ocr", "speech-to-text"] as const) {
  const mismatchedImage: NodeConfig = {
    ...profile,
    sandbox: {
      ...profile.sandbox,
      images: profile.sandbox.images.map((image) =>
        image.profileId === profileId
          ? { ...image, digest: `sha256:${"b".repeat(64)}` }
          : image,
      ),
    },
  };
  assert(
    !nodeConfigSchema.safeParse(mismatchedImage).success,
    `${profileId}_ADVERTISED_WITH_IMAGE_DIGEST_MISMATCH`,
  );
}
assert(
  NODE_ARTIFACT_WORKER_DEFINITIONS["artifact.local-ocr"].executable ===
    "/opt/avermate/bin/local-ocr" &&
    NODE_ARTIFACT_WORKER_DEFINITIONS["artifact.local-ocr"].network ===
      "denied" &&
    NODE_ARTIFACT_WORKER_DEFINITIONS["artifact.local-transcription"]
      .executable === "/opt/avermate/bin/local-transcription" &&
    NODE_ARTIFACT_WORKER_DEFINITIONS["artifact.local-transcription"].network ===
      "denied",
  "DOCUMENT_AI_WORKER_DEFINITIONS",
);

for (const requiredName of [
  "AVERMATE_NODE_PUBLIC_OCR_MODEL_REVISION",
  "AVERMATE_NODE_PUBLIC_TRANSCRIPTION_MODEL_REVISION",
  "AVERMATE_NODE_PUBLIC_OCR_WORKER_IMAGE",
  "AVERMATE_NODE_PUBLIC_OCR_WORKER_DIGEST",
  "AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_IMAGE",
  "AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_DIGEST",
] as const) {
  await assertConfigRejected(
    withoutEnvironmentValue(publicEnvironment, requiredName),
    `MISSING_${requiredName}`,
  );
}

const withoutOcrModel: NodeConfig = {
  ...profile,
  models: {
    ...profile.models,
    catalogue: profile.models.catalogue.filter(({ id }) => id !== ocrModelId),
    modelRevisions: Object.fromEntries(
      Object.entries(profile.models.modelRevisions).filter(
        ([id]) => id !== ocrModelId,
      ),
    ),
  },
};
assert(
  !nodeConfigSchema.safeParse(withoutOcrModel).success,
  "OCR_ADVERTISED_WITHOUT_EXACT_MODEL_REVISION",
);

const withoutTranscriptionModel: NodeConfig = {
  ...profile,
  models: {
    ...profile.models,
    catalogue: profile.models.catalogue.filter(
      ({ id }) => id !== transcriptionModelId,
    ),
    modelRevisions: Object.fromEntries(
      Object.entries(profile.models.modelRevisions).filter(
        ([id]) => id !== transcriptionModelId,
      ),
    ),
  },
};
assert(
  !nodeConfigSchema.safeParse(withoutTranscriptionModel).success,
  "TRANSCRIPTION_ADVERTISED_WITHOUT_EXACT_MODEL_REVISION",
);

const withoutOcrProfile: NodeConfig = {
  ...profile,
  sandbox: {
    ...profile.sandbox,
    images: profile.sandbox.images.filter(
      ({ profileId }) => profileId !== "ocr",
    ),
  },
};
const withoutTranscriptionProfile: NodeConfig = {
  ...profile,
  sandbox: {
    ...profile.sandbox,
    images: profile.sandbox.images.filter(
      ({ profileId }) => profileId !== "speech-to-text",
    ),
  },
};
assert(
  !configuredArtifactKinds(withoutOcrProfile).includes("artifact.local-ocr") &&
    !configuredArtifactKinds(withoutTranscriptionProfile).includes(
      "artifact.local-transcription",
    ),
  "DOCUMENT_AI_ADVERTISED_WITHOUT_PROFILE",
);

const unavailableProvider = {
  id: profile.sandbox.provider,
  preflight: () => {
    throw new Error("STATIC_GATE_PROVIDER_MUST_NOT_BE_CALLED");
  },
} as unknown as SandboxProvider;
const unusedStorage = {} as ObjectStorageProvider;
async function assertMissingBinaryNotHealthy(
  kind: "artifact.local-ocr" | "artifact.local-transcription",
  exactProfile: SandboxExecutionProfile,
  executable: string,
) {
  const handler = new ArtifactSandboxJobHandler({
    kind,
    provider: unavailableProvider,
    profile: {
      ...exactProfile,
      entrypoints: exactProfile.entrypoints.filter(
        (entrypoint) => entrypoint !== executable,
      ),
    },
    hostPolicyDigest: profile.sandbox.hostPolicyDigest!,
    maxEvidenceAgeMs: profile.sandbox.maxEvidenceAgeSeconds * 1_000,
    storage: unusedStorage,
  });
  assert(!(await handler.healthy()), `${kind}_ADVERTISED_WITHOUT_BINARY`);
}
await assertMissingBinaryNotHealthy(
  "artifact.local-ocr",
  ocrProfile,
  "/opt/avermate/bin/local-ocr",
);
await assertMissingBinaryNotHealthy(
  "artifact.local-transcription",
  transcriptionProfile,
  "/opt/avermate/bin/local-transcription",
);
assert(
  profile.models.enabled && profile.models.gateway === "litellm",
  "PROFILE_LITELLM",
);
assert(profile.retrieval.rerankProvider === "qwen3", "PROFILE_QWEN3");
assert(profile.workers.opencode.enabled, "PROFILE_OPENCODE");
assert(profile.workers.openhands.enabled, "PROFILE_OPENHANDS");
assert(profile.relay.transport === "local-compose", "PROFILE_LOCAL_RELAY");
assert(
  profile.sandbox.provider === "opensandbox" &&
    Boolean(profile.sandbox.evidenceEndpoint) &&
    profile.sandbox.runtimeCheckpoints &&
    Boolean(profile.sandbox.runtimeVersion),
  "PROFILE_ATTESTED_SANDBOX",
);
assert(profile.lifecycle.offline, "PROFILE_AIRGAP");

console.log(
  "[plan-038] static full-self-host cells/configuration passed; no live service claim was made.",
);
