import { afterEach, describe, expect, test } from "bun:test";
import { LOCAL_TRANSCRIPTION_MODEL_ID } from "@avermate/agent-contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalDigest } from "../canonical-json";
import {
  configRevision,
  defaultDevZeroConfig,
  LOCAL_TRANSCRIPTION_MODEL_PROVIDER,
  nodeCapabilitySidecarConfigSchema,
} from "../config";
import { createNodeDaemon } from "../daemon";
import { verifyNodeManifest } from "../protocol";
import { NodeSecretStore } from "../secret-store";
import {
  bridgeLegacyNodeCapabilityOfferings,
  nodeCapabilityProtocolV1Enabled,
} from "./manifest";

const roots: string[] = [];
const originalFlag = process.env.NODE_CAPABILITY_PROTOCOL_V1;

afterEach(async () => {
  if (originalFlag === undefined) {
    delete process.env.NODE_CAPABILITY_PROTOCOL_V1;
  } else {
    process.env.NODE_CAPABILITY_PROTOCOL_V1 = originalFlag;
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Node capability v1 manifest bridges", () => {
  test("is opt-in and signs endpoint-free model offerings", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-capability-manifest-"));
    roots.push(root);
    const config = defaultDevZeroConfig(root);
    config.storage.filesystemRoot = join(root, "objects");
    config.models.enabled = true;
    config.models.gateway = "direct";
    config.models.endpoint = "http://127.0.0.1:11434";
    config.models.catalogue = [
      {
        id: "local-chat",
        provider: "openai-compatible",
        displayName: "Local chat",
        modalities: ["text"],
        capabilities: {
          tools: true,
          reasoningSummary: false,
          cachedUsage: false,
          structuredOutput: true,
        },
        contextWindow: 32_768,
      },
    ];
    config.models.modelRevisions = { "local-chat": "model-release-r1" };

    process.env.NODE_CAPABILITY_PROTOCOL_V1 = "false";
    const legacy = await createNodeDaemon({ config });
    expect((await legacy.manifest()).features.inference).toBeUndefined();

    process.env.NODE_CAPABILITY_PROTOCOL_V1 = "true";
    const daemon = await createNodeDaemon({ config });
    const manifest = await daemon.manifest();
    expect(manifest.features.inference).toMatchObject({
      version: 1,
      invocationModes: ["stream-relay"],
      secretCustody: "node-local",
    });
    expect(manifest.features.inference?.offerings).toHaveLength(1);
    const offering = manifest.features.inference!.offerings[0]!;
    expect(offering.descriptor.capability).toBe("language.generate");
    expect(offering.descriptor.specification).toMatchObject({ tools: false, parallelTools: false, structuredOutput: false });
    expect(offering.descriptorDigest).toBe(
      canonicalDigest(offering.descriptor),
    );
    expect(JSON.stringify(offering)).not.toContain("127.0.0.1");
    expect(JSON.stringify(offering)).not.toContain("11434");
    expect(
      verifyNodeManifest(manifest, daemon.identity.publicKeyDer),
    ).toBe(true);
    const adapter = daemon.capabilityRegistry.resolve(offering.descriptor.id, offering.descriptorDigest, "stream-relay");
    await expect(adapter.stream!({ ownerId: "owner", operationId: "operation-tools", deadline: new Date(Date.now() + 30_000).toISOString(), signal: new AbortController().signal, credential: async () => null }, {
      schemaVersion: 1, operationId: "operation-tools", ownerId: "owner", capability: "language.generate", purpose: "assistant.chat", offeringId: offering.descriptor.id, offeringDigest: offering.descriptorDigest, configRevision: configRevision(config), requestDigest: `sha256:${"1".repeat(64)}`, inputArtifacts: [],
      input: { schemaVersion: 1, messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }], tools: [{ name: "search", description: "Search", inputSchema: { type: "object" } }], maximumOutputTokens: 32 },
    })[Symbol.asyncIterator]().next()).rejects.toThrow("NODE_CAPABILITY_MODEL_OPTION_UNSUPPORTED");
  });

  test("bridges embedding and reranking without publishing private routes", () => {
    const config = defaultDevZeroConfig(".data/bridge-fixture");
    config.retrieval.embeddingEndpoint =
      "http://127.0.0.1:8081/v1/embeddings";
    config.retrieval.embeddingProvider = "tei";
    config.retrieval.embeddingModel = "gte-multilingual";
    config.retrieval.embeddingRevision = "gte-release-r1";
    config.retrieval.embeddingDimensions = [768];
    config.retrieval.rerankEndpoint = "http://reranker.internal/v1/rerank";
    config.retrieval.rerankProvider = "qwen3";
    config.retrieval.rerankModel = "qwen3-reranker";
    config.retrieval.rerankRevision = "qwen3-release-r1";
    config.retrieval.rerankRuntimeRevision = "tei-runtime-r1";
    config.retrieval.rerankImageDigest = `sha256:${"8".repeat(64)}`;
    const offerings = bridgeLegacyNodeCapabilityOfferings({
      nodeId: "node-bridge",
      configRevision: `sha256:${"7".repeat(64)}`,
      config,
    });
    expect(
      offerings
        .map((entry) => entry.offering.descriptor.capability)
        .sort(),
    ).toEqual(["embedding.generate", "rerank.score"]);
    const serialized = JSON.stringify(offerings);
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("reranker.internal");
    expect(serialized).not.toContain("v1/embeddings");
  });

  test("accepts only the explicit true flag", () => {
    expect(nodeCapabilityProtocolV1Enabled({})).toBe(false);
    expect(
      nodeCapabilityProtocolV1Enabled({ NODE_CAPABILITY_PROTOCOL_V1: "true" }),
    ).toBe(true);
    expect(
      nodeCapabilityProtocolV1Enabled({ NODE_CAPABILITY_PROTOCOL_V1: "1" }),
    ).toBe(false);
  });

  test("wires a configured sidecar into a signed frozen endpoint-free manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-sidecar-manifest-"));
    roots.push(root);
    const config = defaultDevZeroConfig(root);
    config.storage.filesystemRoot = join(root, "objects");
    const secrets = new NodeSecretStore(join(root, "secrets"));
    const secretRef = await secrets.put(
      "configured-sidecar",
      "configured-sidecar-private-value",
    );
    const imageDigest = `sha256:${"a".repeat(64)}`;
    config.capabilities.sidecars = [
      nodeCapabilitySidecarConfigSchema.parse({
        id: "language-sidecar",
        descriptor: {
          schemaVersion: 1,
          connectionRevision: 4,
          pluginId: "avermate.node.sidecar",
          pluginVersion: "sidecar-plugin-r1",
          adapterRevision: "sidecar-adapter-r1",
          capability: "language.generate",
          capabilityProtocolVersion: 1,
          provider: "local-language",
          modelId: "local-language-model",
          modelRevision: "local-language-model-r1",
          dataHandling: {
            egress: "owner-node",
            providerName: null,
            region: null,
            disclosureRevision: "node-sidecar-v1",
            retentionDisclosureRevision: null,
            trainingDisclosureRevision: null,
            requiresExplicitConsent: false,
          },
          limits: {
            maxInputBytes: 1024 * 1024,
            maxOutputBytes: 1024 * 1024,
            maxBatchSize: 1,
            maxConcurrency: 1,
          },
          supportedLanguages: "unknown",
          healthCheckKind: "active-probe",
          specification: {
            inputModalities: ["text"],
            contextWindow: 4_096,
            maximumOutputTokens: 1_024,
            tools: false,
            parallelTools: false,
            structuredOutput: false,
            streaming: true,
            reasoningSummary: false,
            opaqueReasoningContinuation: false,
            cachedUsage: false,
          },
        },
        invocationModes: ["unary-relay", "stream-relay"],
        baseUrl: "http://127.0.0.1:59999/private",
        secretRef,
        runtimeRevision: "sidecar-runtime-r1",
        imageDigest,
        egressPolicyDigest: `sha256:${"b".repeat(64)}`,
        health: { timeoutMs: 100 },
      }),
    ];
    process.env.NODE_CAPABILITY_PROTOCOL_V1 = "true";
    const daemon = await createNodeDaemon({ config });
    const manifest = await daemon.manifest();
    const inference = manifest.features.inference!;
    expect(inference.offerings).toHaveLength(1);
    const advertised = inference.offerings[0]!;
    expect(advertised.descriptor.placement).toEqual({
      kind: "node",
      nodeId: daemon.identity.nodeId,
      configRevision: configRevision(config),
    });
    expect(advertised.runtime).toMatchObject({
      runtimeRevision: "sidecar-runtime-r1",
      imageDigest,
    });
    expect(verifyNodeManifest(manifest, daemon.identity.publicKeyDer)).toBe(true);
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("59999");
    expect(serialized).not.toContain(secretRef);
    expect(serialized).not.toContain("configured-sidecar-private-value");
    expect(
      await daemon.capabilitySecretCustody.snapshot(advertised.descriptor.id),
    ).toMatchObject([{ slot: "provider", status: "ready", version: 4 }]);
    expect(daemon.capabilityRegistry.health.get(advertised.descriptor.id).state)
      .toBe("degraded");
  });

  test("keeps the same normalized STT workflow for Node-local and full-self-host", () => {
    const workerProfile = {
      kind: "artifact.local-transcription@1",
      sandboxProfileId: "speech-to-text" as const,
      profileVersion: "speech-worker-profile-r1",
      imageDigest: `sha256:${"c".repeat(64)}`,
      egressPolicyDigest: `sha256:${"d".repeat(64)}`,
    };
    const configured = (profile: "node-local-ai" | "full-self-host") => {
      const config = defaultDevZeroConfig(`.data/${profile}`);
      config.profile = profile;
      config.models.enabled = true;
      config.models.gateway = "direct";
      config.models.endpoint = "http://127.0.0.1:11434";
      config.models.catalogue = [
        {
          id: LOCAL_TRANSCRIPTION_MODEL_ID,
          provider: LOCAL_TRANSCRIPTION_MODEL_PROVIDER,
          displayName: "Local transcription",
          modalities: ["audio"],
          capabilities: {
            tools: false,
            reasoningSummary: false,
            cachedUsage: false,
            structuredOutput: false,
          },
          contextWindow: "unknown",
        },
      ];
      config.models.modelRevisions = {
        [LOCAL_TRANSCRIPTION_MODEL_ID]: "whisper-model-r1",
      };
      return bridgeLegacyNodeCapabilityOfferings({
        nodeId: `node-${profile}`,
        configRevision: canonicalDigest(config),
        config,
        healthyWorkerProfiles: new Map([[workerProfile.kind, workerProfile]]),
      });
    };
    const local = configured("node-local-ai").find(
      (entry) => entry.source.kind === "worker",
    )!;
    const selfHosted = configured("full-self-host").find(
      (entry) => entry.source.kind === "worker",
    )!;
    expect(local.source).toEqual({
      kind: "worker",
      workerKind: "artifact.local-transcription",
    });
    expect(selfHosted.source).toEqual(local.source);
    expect(local.offering.descriptor.capability).toBe("speech.transcribe");
    expect(selfHosted.offering.descriptor.capability).toBe(
      "speech.transcribe",
    );
    expect(selfHosted.offering.descriptor.specification).toEqual(
      local.offering.descriptor.specification,
    );
    expect(local.offering.network.egressPolicyDigest).toBe(
      workerProfile.egressPolicyDigest,
    );
    expect(selfHosted.offering.network.egressPolicyDigest).toBe(
      workerProfile.egressPolicyDigest,
    );
  });
});
