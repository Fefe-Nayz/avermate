import { describe, expect, test } from "bun:test";
import type {
  NodeArtifactRef,
  NodeCapabilityJobManifestV1,
} from "@avermate/agent-contracts";
import { canonicalDigest } from "../canonical-json";
import type { NodeJobHandler } from "../job-dispatcher";
import { createNodeCapabilityOffering } from "./manifest";
import { LegacyArtifactWorkerCapabilityAdapter } from "./worker-adapter";

const revision = `sha256:${"1".repeat(64)}`;
const artifactDigest = `sha256:${"2".repeat(64)}`;

function artifact(
  key: string,
  mimeType: string,
  byteSize = 16,
): NodeArtifactRef {
  return {
    object: { ownerId: "owner-worker", namespace: "capability-inputs", key },
    digest: artifactDigest,
    byteSize,
    mimeType,
  };
}

function ocrOffering() {
  return createNodeCapabilityOffering({
    descriptor: {
      schemaVersion: 1,
      connectionId: "node-worker-connection",
      connectionRevision: 1,
      pluginId: "avermate.node.legacy-worker",
      pluginVersion: "1",
      adapterRevision: "worker-v1",
      capability: "document.ocr",
      capabilityProtocolVersion: 1,
      provider: "node-local-ocr",
      modelId: "local-ocr-model",
      modelRevision: "local-ocr-model-r1",
      placement: {
        kind: "node",
        nodeId: "node-worker",
        configRevision: revision,
      },
      dataHandling: {
        egress: "none",
        providerName: null,
        region: null,
        disclosureRevision: "node-local-v1",
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
      healthCheckKind: "node-attested",
      specification: {
        inputMimeTypes: ["application/pdf"],
        nativePdf: false,
        scannedPdf: true,
        images: false,
        handwriting: false,
        layout: true,
        tables: false,
        formulas: false,
        embeddedImages: false,
        boundingBoxes: "none",
        confidence: false,
        maxPages: 300,
        maxBytes: 1024 * 1024,
      },
    },
    runtime: {
      implementation: "artifact.local-ocr",
      runtimeRevision: "ocr-runtime-r1",
      imageDigest: `sha256:${"3".repeat(64)}`,
      modelRevision: "local-ocr-model-r1",
    },
    egressPolicyDigest: `sha256:${"4".repeat(64)}`,
  });
}

function jobManifest(inputs: NodeArtifactRef[]): NodeCapabilityJobManifestV1 {
  const requestJson = { legacyWorkerManifest: true };
  return {
    schemaVersion: 1,
    operationId: "operation-worker",
    ownerId: "owner-worker",
    capability: "document.ocr",
    purpose: "materials.ocr",
    offeringId: ocrOffering().descriptor.id,
    offeringDigest: ocrOffering().descriptorDigest,
    configRevision: revision,
    inputs,
    requestJson,
    requestDigest: canonicalDigest(requestJson),
    limits: {
      cpuMillis: 30_000,
      memoryBytes: 512 * 1024 * 1024,
      inputBytes: 1024 * 1024,
      outputBytes: 1024 * 1024,
      tokenLimit: 1,
      costMinorLimit: 1,
      deadline: new Date(Date.now() + 30_000).toISOString(),
    },
    egressPolicyDigest: `sha256:${"4".repeat(64)}`,
  };
}

describe("LegacyArtifactWorkerCapabilityAdapter", () => {
  test("keeps one legacy manifest entry while granting all exact resources", async () => {
    const manifestRef = artifact("worker-manifest.json", "application/json");
    const mediaRef = artifact("source.pdf", "application/pdf", 1_024);
    const outputRef: NodeArtifactRef = {
      object: {
        ownerId: "owner-worker",
        namespace: "artifact-worker-results",
        key: "ocr-result.json",
      },
      digest: `sha256:${"5".repeat(64)}`,
      byteSize: 128,
      mimeType: "application/json",
    };
    const handler: NodeJobHandler = {
      kind: "artifact.local-ocr",
      capabilityVersion: 1,
      requiredCapability: "jobs:artifact.local-ocr",
      async execute(context) {
        expect(context.job.inputRefs).toEqual([manifestRef]);
        expect(context.job.resourceRefs).toEqual([
          manifestRef.object,
          mediaRef.object,
        ]);
        expect(context.grantedResources).toEqual([
          manifestRef.object,
          mediaRef.object,
        ]);
        return [outputRef];
      },
    };
    const adapter = new LegacyArtifactWorkerCapabilityAdapter({
      offering: ocrOffering(),
      handler,
      nodeId: "node-worker",
    });
    const result = await adapter.artifactJob(
      {
        ownerId: "owner-worker",
        operationId: "operation-worker",
        deadline: new Date(Date.now() + 30_000).toISOString(),
        signal: new AbortController().signal,
        credential: async () => null,
      },
      jobManifest([manifestRef, mediaRef]),
    );
    expect(result.outputArtifacts).toEqual([outputRef]);
  });

  test("rejects a job without exactly one legacy JSON entry manifest", async () => {
    const handler: NodeJobHandler = {
      kind: "artifact.local-ocr",
      capabilityVersion: 1,
      requiredCapability: "jobs:artifact.local-ocr",
      execute: async () => [],
    };
    const adapter = new LegacyArtifactWorkerCapabilityAdapter({
      offering: ocrOffering(),
      handler,
      nodeId: "node-worker",
    });
    await expect(
      adapter.artifactJob(
        {
          ownerId: "owner-worker",
          operationId: "operation-worker",
          deadline: new Date(Date.now() + 30_000).toISOString(),
          signal: new AbortController().signal,
          credential: async () => null,
        },
        jobManifest([artifact("source.pdf", "application/pdf")]),
      ),
    ).rejects.toThrow("NODE_CAPABILITY_WORKER_MANIFEST_REQUIRED");
  });
});
