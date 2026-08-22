import { describe, expect, test } from "bun:test";
import {
  configRevision,
  defaultDevZeroConfig,
  loadNodeConfig,
  nodeConfigSchema,
  publicConfig,
  serializeNodeConfig,
} from "./config";
import { parse } from "yaml";
import { fileURLToPath } from "node:url";

describe("node config", () => {
  const profileEnvironment = {
    ...process.env,
    AVERMATE_NODE_PUBLIC_EMBEDDING_REVISION: "release-2026-08-22-gte",
    AVERMATE_NODE_PUBLIC_QWEN3_RERANKER_DIGEST: `sha256:${"1".repeat(64)}`,
    AVERMATE_NODE_PUBLIC_MODEL_REVISION: "release-2026-08-22-model",
    AVERMATE_NODE_PUBLIC_FALLBACK_MODEL_REVISION:
      "release-2026-08-22-fallback-model",
    AVERMATE_NODE_PUBLIC_OCR_MODEL_REVISION:
      "tesseract-5.5.1-fra-eng-traineddata-2026-08",
    AVERMATE_NODE_PUBLIC_TRANSCRIPTION_MODEL_REVISION:
      "whisper-large-v3-turbo-q5_0-2026-08",
    AVERMATE_NODE_PUBLIC_SANDBOX_HOST_POLICY_DIGEST: `sha256:${"2".repeat(64)}`,
    AVERMATE_NODE_PUBLIC_SANDBOX_EVIDENCE_ENDPOINT:
      "https://sandbox-attestor.example/evidence",
    AVERMATE_NODE_PUBLIC_SANDBOX_RUNTIME_VERSION: "opensandbox-0.1.11",
    AVERMATE_NODE_PUBLIC_MEDIA_WORKER_IMAGE:
      "ghcr.io/avermate/media:v1@sha256:" + "5".repeat(64),
    AVERMATE_NODE_PUBLIC_MEDIA_WORKER_DIGEST: `sha256:${"5".repeat(64)}`,
    AVERMATE_NODE_PUBLIC_OCR_WORKER_IMAGE:
      "ghcr.io/avermate/ocr:v1@sha256:" + "a".repeat(64),
    AVERMATE_NODE_PUBLIC_OCR_WORKER_DIGEST: `sha256:${"a".repeat(64)}`,
    AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_IMAGE:
      "ghcr.io/avermate/speech-to-text:v1@sha256:" + "b".repeat(64),
    AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_DIGEST: `sha256:${"b".repeat(64)}`,
    AVERMATE_NODE_PUBLIC_LATEX_WORKER_IMAGE:
      "ghcr.io/avermate/latex:v1@sha256:" + "6".repeat(64),
    AVERMATE_NODE_PUBLIC_LATEX_WORKER_DIGEST: `sha256:${"6".repeat(64)}`,
    AVERMATE_NODE_PUBLIC_SLIDES_WORKER_IMAGE:
      "ghcr.io/avermate/slides:v1@sha256:" + "7".repeat(64),
    AVERMATE_NODE_PUBLIC_SLIDES_WORKER_DIGEST: `sha256:${"7".repeat(64)}`,
    AVERMATE_NODE_PUBLIC_MANIM_WORKER_IMAGE:
      "ghcr.io/avermate/manim:v1@sha256:" + "8".repeat(64),
    AVERMATE_NODE_PUBLIC_MANIM_WORKER_DIGEST: `sha256:${"8".repeat(64)}`,
    AVERMATE_NODE_PUBLIC_OPENCODE_IMAGE:
      "ghcr.io/anomalyco/opencode:1.18.17@sha256:" + "3".repeat(64),
    AVERMATE_NODE_PUBLIC_OPENCODE_DIGEST: `sha256:${"3".repeat(64)}`,
    AVERMATE_NODE_PUBLIC_OPENHANDS_IMAGE:
      "docker.io/openhands/openhands:1.8.0@sha256:" + "4".repeat(64),
    AVERMATE_NODE_PUBLIC_OPENHANDS_DIGEST: `sha256:${"4".repeat(64)}`,
    AVERMATE_NODE_PUBLIC_RELEASE_VERSION: "2026.08.22",
  };
  test("dev-zero is bootable without Garage or a model provider", () => {
    const config = defaultDevZeroConfig("/tmp/node");
    expect(config.storage.driver).toBe("filesystem");
    expect(config.models.enabled).toBe(false);
    expect(config.sandbox.provider).toBe("disabled");
    expect(nodeConfigSchema.parse(parse(serializeNodeConfig(config)))).toEqual(
      config,
    );
  });

  test("rejects public configurator binds and incomplete storage profiles", () => {
    const base = defaultDevZeroConfig();
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        bind: { host: "0.0.0.0", port: 5_188 },
      }).success,
    ).toBe(false);
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        profile: "node-storage",
        storage: { ...base.storage, driver: "s3", filesystemRoot: undefined },
      }).success,
    ).toBe(false);
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        relay: { coreUrl: "https://core.example" },
      }).success,
    ).toBe(false);
  });

  test("config revisions are stable", () => {
    const config = defaultDevZeroConfig();
    expect(configRevision(config)).toBe(
      configRevision(structuredClone(config)),
    );
  });

  test("redacts both sandbox runtime and evidence secret references", () => {
    const config = defaultDevZeroConfig();
    config.sandbox.providerSecretRef = "secret:runtime";
    config.sandbox.evidenceSecretRef = "secret:evidence";
    const publicValue = publicConfig(config);
    expect(publicValue.sandbox.providerSecretRef).toBe("configured");
    expect(publicValue.sandbox.evidenceSecretRef).toBe("configured");
    expect(JSON.stringify(publicValue)).not.toContain("secret:evidence");
  });

  test("requires the lexical backend whenever retrieval is enabled", () => {
    const base = defaultDevZeroConfig();
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        retrieval: { ...base.retrieval, enabled: true, lexical: false },
      }).success,
    ).toBe(false);
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        retrieval: { ...base.retrieval, enabled: false, lexical: false },
      }).success,
    ).toBe(true);
  });

  test("requires an explicit, normalized endpoint allowlist for Node MCP", () => {
    const base = defaultDevZeroConfig();
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        mcp: {
          ...base.mcp,
          enabled: true,
          allowedEndpoints: ["http://mcp.internal/mcp"],
        },
      }).success,
    ).toBe(true);
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        mcp: {
          ...base.mcp,
          enabled: false,
          allowedEndpoints: ["http://mcp.internal/mcp"],
        },
      }).success,
    ).toBe(false);
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        mcp: {
          ...base.mcp,
          enabled: true,
          allowedEndpoints: ["http://mcp.internal/mcp?token=leak"],
        },
      }).success,
    ).toBe(false);
  });

  test("restricts plaintext relay transport to the exact offline Compose profile", async () => {
    const path = fileURLToPath(
      new URL(
        "../../../infra/node/profiles/full-self-host.yaml",
        import.meta.url,
      ),
    );
    const fullSelfHost = {
      ...(await loadNodeConfig(path, profileEnvironment)),
      relay: {
        transport: "local-compose" as const,
        coreUrl: "http://api:5000",
        credentialSecretRef: "secret:relay-test",
        capabilityCredentialSecretRef: "secret:capability-test",
        coreGrantKeyId: "core-test",
        coreGrantPublicKey: "A".repeat(64),
      },
    };
    expect(nodeConfigSchema.safeParse(fullSelfHost).success).toBe(true);
    expect(
      nodeConfigSchema.safeParse({
        ...fullSelfHost,
        relay: { ...fullSelfHost.relay, coreUrl: "http://evil:5000" },
      }).success,
    ).toBe(false);
    expect(
      nodeConfigSchema.safeParse({
        ...fullSelfHost,
        profile: "node-lite",
      }).success,
    ).toBe(false);
    expect(
      nodeConfigSchema.safeParse({
        ...fullSelfHost,
        lifecycle: { ...fullSelfHost.lifecycle, offline: false },
      }).success,
    ).toBe(false);
  });

  test("all checked-in profile manifests pass the runtime schema", async () => {
    const directory = new URL("../../../infra/node/profiles/", import.meta.url);
    const directoryPath = fileURLToPath(directory);
    const profiles: string[] = [];
    for await (const name of new Bun.Glob("*.yaml").scan({
      cwd: directoryPath,
      onlyFiles: true,
    })) {
      profiles.push(
        (
          await loadNodeConfig(
            fileURLToPath(new URL(name, directory)),
            profileEnvironment,
          )
        ).profile,
      );
    }
    expect(profiles.sort()).toEqual([
      "full-self-host",
      "node-byok",
      "node-creator",
      "node-lite",
      "node-local-ai",
      "node-local-gpu",
      "node-observable",
      "node-storage",
    ]);
  });

  test("full-self-host public release pins are required and never read as secrets", async () => {
    const path = fileURLToPath(
      new URL(
        "../../../infra/node/profiles/full-self-host.yaml",
        import.meta.url,
      ),
    );
    await expect(loadNodeConfig(path, {})).rejects.toThrow(
      "NODE_PUBLIC_CONFIG_VALUE_REQUIRED",
    );
    const config = await loadNodeConfig(path, profileEnvironment);
    expect(config.models.gateway).toBe("litellm");
    expect(config.relay.transport).toBe("local-compose");
    expect(config.models.ownerRequestsPerMinute).toBe(60);
    expect(config.models.ownerTokensPerMinute).toBe(120_000);
    expect(config.models.fallbackChains).toEqual([
      {
        modelId: "selfhost/default",
        fallbackModelIds: ["selfhost/fallback"],
      },
    ]);
    expect(config.retrieval.rerankProvider).toBe("qwen3");
    expect(config.workers.opencode.image).toContain(":1.18.17@sha256:");
    expect(config.workers.openhands.image).toContain(":1.8.0@sha256:");
  });

  test("binds local OCR and STT profiles to exact immutable model attestations", async () => {
    const path = fileURLToPath(
      new URL(
        "../../../infra/node/profiles/full-self-host.yaml",
        import.meta.url,
      ),
    );
    const config = await loadNodeConfig(path, profileEnvironment);
    const withoutSttRevision = structuredClone(config);
    delete withoutSttRevision.models.modelRevisions[
      "selfhost/whisper-large-v3-turbo-q5_0"
    ];
    expect(nodeConfigSchema.safeParse(withoutSttRevision).success).toBe(false);

    const wrongOcrProvider = structuredClone(config);
    const ocr = wrongOcrProvider.models.catalogue.find(
      (model) => model.id === "tesseract-ocr",
    );
    expect(ocr).toBeDefined();
    if (ocr) ocr.provider = "unattested-ocr";
    expect(nodeConfigSchema.safeParse(wrongOcrProvider).success).toBe(false);
  });
});
