import { afterEach, describe, expect, test } from "bun:test";
import {
  emptyCapabilityUsage,
  nodeCapabilityOfferingSchema,
  nodeArtifactWorkerRequestV1Schema,
  type CapabilityArtifactRef,
  type CapabilityAttemptContext,
  type NodeCapabilityEventV1,
  type NodeCapabilityOffering,
  type NodeCapabilityRequestV1,
  type NodeCapabilityResultV1,
  type NodeCapabilityTransport,
  type ProviderConnectionPublicSnapshot,
  type ProviderPluginManifest,
  type SignedNodeCapabilityInvocationGrant,
} from "@avermate/agent-contracts";
import { CoreNodeGrantIssuer } from "../../node/core-grant-issuer";
import { verifyProtocolValue } from "../../node/protocol-crypto";
import { capabilityDigest } from "../values";
import { createCoreNodeProviderPlugin } from "./node";
import type { CoreNodeArtifactBridge } from "./node";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemObjectStorageProvider } from "../../../../node/src/filesystem-storage";
import { NodeCapabilityHttpSidecarAdapter } from "../../../../node/src/capabilities/sidecar-client";
import { NodeSidecarArtifactIo } from "../../../../node/src/capabilities/sidecar-artifacts";
import { NodeCapabilityExecutor } from "../../../../node/src/capabilities/executor";
import { NodeCapabilityRegistry } from "../../../../node/src/capabilities/registry";
import { NodeCapabilitySecretCustody } from "../../../../node/src/capabilities/secret-store";
import { NodeSecretStore } from "../../../../node/src/secret-store";
import { LegacyArtifactWorkerCapabilityAdapter } from "../../../../node/src/capabilities/worker-adapter";
import { CapabilityExecutionError } from "../errors";

const configRevision = `sha256:${"a".repeat(64)}` as const;
const egressPolicyDigest = `sha256:${"b".repeat(64)}` as const;
const now = new Date("2026-08-28T12:00:00.000Z");

const manifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "avermate.node",
  version: "1.0.0",
  displayName: "Avermate Node",
  executionTrust: "node-reviewed",
  capabilities: ["rerank.score"],
  connectionSchemaVersion: 1,
  configurationFields: [],
  secretSlots: [],
};

const connection: ProviderConnectionPublicSnapshot = {
  schemaVersion: 1,
  id: "connection-node-1",
  ownerKind: "user",
  ownerId: "owner-1",
  pluginId: manifest.id,
  pluginVersion: manifest.version,
  displayName: "My Node",
  placement: { kind: "node", nodeId: "node-1", configRevision },
  configVersion: 1,
  config: { nodeId: "node-1", configRevision },
  configDigest: capabilityDigest({ nodeId: "node-1", configRevision }),
  status: "ready",
  revision: 4,
  lastValidatedAt: now.toISOString(),
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  deletedAt: null,
};

function advertisedOffering(): NodeCapabilityOffering {
  const descriptor = {
    schemaVersion: 1 as const,
    id: "node-offering-rerank-1",
    connectionId: "node-internal-connection",
    connectionRevision: 1,
    pluginId: "node.sidecar.cohere",
    pluginVersion: "1",
    adapterRevision: "sidecar-rerank-v1",
    capabilityProtocolVersion: 1 as const,
    provider: "node-local-reranker",
    modelId: "rerank-local-v1",
    modelRevision: "weights-sha-1",
    placement: { kind: "node" as const, nodeId: "node-1", configRevision },
    dataHandling: {
      egress: "none" as const,
      providerName: null,
      region: null,
      disclosureRevision: "node-local-v1",
      retentionDisclosureRevision: null,
      trainingDisclosureRevision: null,
      requiresExplicitConsent: false,
    },
    limits: {
      maxInputBytes: 1_000_000,
      maxOutputBytes: 1_000_000,
      maxBatchSize: 100,
      maxConcurrency: 2,
    },
    supportedLanguages: "unknown" as const,
    healthCheckKind: "node-attested" as const,
    capability: "rerank.score" as const,
    specification: {
      modalities: ["text" as const],
      maxCandidates: 100,
      maxTokensPerCandidate: 8_192,
      languages: "multilingual" as const,
      scoreSemantics: "relative" as const,
    },
  };
  return nodeCapabilityOfferingSchema.parse({
    descriptor,
    descriptorDigest: capabilityDigest(descriptor),
    runtime: {
      implementation: "fixture-rerank",
      runtimeRevision: "runtime-1",
      imageDigest: null,
      modelRevision: descriptor.modelRevision,
    },
    network: { egressPolicyDigest },
  });
}

class FixtureTransport implements NodeCapabilityTransport {
  last:
    | {
        grant: SignedNodeCapabilityInvocationGrant;
        request: NodeCapabilityRequestV1;
      }
    | undefined;

  constructor(readonly offering: NodeCapabilityOffering) {}

  async online() {
    return true;
  }

  async listCapabilityOfferings() {
    return [this.offering];
  }

  async invokeCapability(input: {
    grant: SignedNodeCapabilityInvocationGrant;
    request: NodeCapabilityRequestV1;
  }): Promise<NodeCapabilityResultV1> {
    this.last = input;
    const usage = {
      version: 1 as const,
      items: [{ unit: "candidate" as const, quantity: "2", source: "measured" as const }],
      cost: {
        amountMinor: null,
        currency: null,
        authoritative: false,
        pricingSnapshotId: null,
      },
    };
    const result = {
      schemaVersion: 1 as const,
      scores: [
        { id: "candidate-2", score: 0.9, rank: 0 },
        { id: "candidate-1", score: 0.3, rank: 1 },
      ],
      usage,
      providerMetadata: { runtime: "fixture" },
    };
    const outputArtifacts: NodeCapabilityResultV1["outputArtifacts"] = [];
    return {
      schemaVersion: 1,
      operationId: input.request.operationId,
      offeringId: input.request.offeringId,
      requestDigest: input.request.requestDigest,
      outputDigest: capabilityDigest({ result, outputArtifacts }),
      result,
      outputArtifacts,
      usage,
      providerRequestId: "node-provider-request-1",
    };
  }

  async *streamCapability(): AsyncIterable<NodeCapabilityEventV1> {
    throw new Error("not used");
  }
}

describe("Core Node provider plugin", () => {
  test("discovers a normalized immutable offering and invokes it with a signed bound grant", async () => {
    const advertised = advertisedOffering();
    const transport = new FixtureTransport(advertised);
    const issuer = new CoreNodeGrantIssuer("node-plugin-test-secret-".repeat(2));
    const plugin = createCoreNodeProviderPlugin(manifest, {
      transport,
      signGrant: (claims) => issuer.signCapabilityInvocation(claims),
      now: () => now,
    });
    const [offering] = await plugin.discoverOfferings(
      {
        ownerId: connection.ownerId,
        signal: new AbortController().signal,
        credential: async () => null,
        now,
      },
      connection,
    );
    expect(offering).toMatchObject({
      connectionId: connection.id,
      connectionRevision: connection.revision,
      pluginId: "avermate.node",
      pluginVersion: "1.0.0",
      placement: { kind: "node", nodeId: "node-1", configRevision },
      capability: "rerank.score",
    });
    expect(offering?.id).toStartWith("capoff_");

    const adapter = await plugin.createAdapter(
      {
        ownerId: connection.ownerId,
        signal: new AbortController().signal,
        credential: async () => null,
        connection,
      },
      offering!,
    );
    if (!("invoke" in adapter)) throw new Error("expected unary Node adapter");
    let authorizations = 0;
    const context: CapabilityAttemptContext = {
      ownerId: connection.ownerId,
      operationId: "operation-node-1",
      attemptId: "attempt-node-1",
      attemptNumber: 1,
      purpose: "search.query-rerank",
      offering: offering!,
      routePlanDigest: capabilityDigest({ route: 1 }),
      deadline: new Date(now.getTime() + 60_000),
      signal: new AbortController().signal,
      async authorize() {
        authorizations += 1;
      },
      async credential() {
        return null;
      },
      async emit() {},
    };
    const result = await adapter.invoke(context, {
      schemaVersion: 1,
      query: "most relevant",
      candidates: [
        { id: "candidate-1", text: "first" },
        { id: "candidate-2", text: "second" },
      ],
      topK: 2,
    });

    expect(authorizations).toBe(1);
    expect(result.providerMetadata).toMatchObject({
      runtime: "fixture",
      providerRequestId: "node-provider-request-1",
    });
    expect(transport.last?.request).toMatchObject({
      ownerId: connection.ownerId,
      offeringId: advertised.descriptor.id,
      offeringDigest: advertised.descriptorDigest,
      configRevision,
    });
    expect(transport.last?.request.requestDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(transport.last?.grant.claims).toMatchObject({
      ownerId: connection.ownerId,
      nodeId: "node-1",
      operationId: context.operationId,
      offeringId: advertised.descriptor.id,
      offeringDigest: advertised.descriptorDigest,
      configRevision,
      requestDigest: transport.last?.request.requestDigest,
      egressPolicyDigest,
    });
    expect(transport.last?.grant.keyId).toBe(issuer.identity.keyId);
    expect(
      verifyProtocolValue(
        issuer.publicSigningKey,
        transport.last!.grant.claims,
        transport.last!.grant.signature,
      ),
    ).toBe(true);
  });

  test("fails discovery closed on descriptor or config revision drift", async () => {
    const advertised = advertisedOffering();
    const drifted = {
      ...advertised,
      descriptorDigest: `sha256:${"c".repeat(64)}` as const,
    };
    const plugin = createCoreNodeProviderPlugin(manifest, {
      transport: new FixtureTransport(drifted),
      signGrant: () => {
        throw new Error("not used");
      },
      now: () => now,
    });
    await expect(
      plugin.discoverOfferings(
        {
          ownerId: connection.ownerId,
          signal: new AbortController().signal,
          credential: async () => null,
          now,
        },
        connection,
      ),
    ).rejects.toThrow("NODE_CAPABILITY_OFFERING_BINDING_INVALID");
  });
});

const artifactRoots: string[] = [];
afterEach(async () => {
  for (const root of artifactRoots.splice(0)) await rm(root, { recursive: true, force: true });
});
const bytesDigest = (bytes: Uint8Array): `sha256:${string}` => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const byteStream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });

function ocrOffering(worker = false) {
  const existing = advertisedOffering();
  const descriptor = {
    ...existing.descriptor,
    capability: "document.ocr",
    id: "node-ocr-fixture",
    modelId: worker ? "tesseract-ocr" : "sidecar-ocr",
    modelRevision: "fixture-model-revision-1",
    specification: {
      inputMimeTypes: ["application/pdf"], nativePdf: true, scannedPdf: true,
      images: true, handwriting: false, layout: true, tables: false,
      formulas: false, embeddedImages: !worker, boundingBoxes: "none",
      confidence: false, maxPages: 20, maxBytes: 1_000_000,
    },
  };
  return nodeCapabilityOfferingSchema.parse({
    ...existing, descriptor, descriptorDigest: capabilityDigest(descriptor),
    runtime: { ...existing.runtime, implementation: worker ? "artifact.local-ocr" : "node-sidecar:fixture", modelRevision: descriptor.modelRevision },
  });
}

async function artifactFixture(options: { worker?: boolean; corrupt?: "input" | "output" | "mime"; adoptionFailure?: boolean; transportFailure?: boolean; cleanupFailure?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "avermate-core-node-artifacts-"));
  artifactRoots.push(root);
  const storage = new FilesystemObjectStorageProvider({ root: join(root, "storage"), maxObjectBytes: 2_000_000, quotaBytes: 8_000_000 });
  await storage.initialize();
  const sourceBytes = new TextEncoder().encode("%PDF-1.7\nnonempty private document\n%%EOF");
  const source: CapabilityArtifactRef = { object: { ownerId: connection.ownerId, namespace: "files", key: "core-logical-file-id-not-node-storage-key" }, digest: bytesDigest(sourceBytes), byteSize: sourceBytes.length, mimeType: "application/pdf" };
  const advertised = ocrOffering(options.worker);
  const puts: CapabilityArtifactRef[] = [];
  const deletes: CapabilityArtifactRef[] = [];
  const adopted: CapabilityArtifactRef[] = [];
  const adoptionKeys: string[] = [];
  let byteReads = 0;
  let calls = 0;
  const bridge: CoreNodeArtifactBridge = {
    async readCore(input) {
      byteReads += 1;
      expect(input.ownerId).toBe(connection.ownerId);
      expect(input.artifact).toEqual(source);
      return options.corrupt === "input" ? new Uint8Array(sourceBytes.length) : sourceBytes;
    },
    async putNode(input) {
      expect(input.nodeId).toBe("node-1");
      expect(input.artifact.object.namespace).toBe("capability-inputs");
      puts.push(input.artifact);
      const result = await storage.put({ ref: input.artifact.object, body: byteStream(input.bytes), byteSize: input.artifact.byteSize, mimeType: input.artifact.mimeType, expectedDigest: input.artifact.digest, idempotencyKey: input.idempotencyKey });
      return { artifact: { object: result.ref, digest: result.digest, byteSize: result.byteSize, mimeType: result.mimeType }, replayed: result.replayed };
    },
    async readNode(input) {
      expect(input.nodeId).toBe("node-1");
      const metadata = await storage.stat({ ref: input.artifact.object });
      expect(metadata?.mimeType).toBe(input.artifact.mimeType);
      const bytes = new Uint8Array(await new Response(await storage.get({ ref: input.artifact.object })).arrayBuffer());
      return bytes;
    },
    async adoptCore(input) {
      if (options.adoptionFailure) throw new Error("simulated durable adoption outage");
      expect(String(bytesDigest(input.bytes))).toBe(input.artifact.digest);
      const ref = { ...input.artifact, object: { ownerId: input.ownerId, namespace: "files", key: "adopted-logical-core-file" } };
      adoptionKeys.push(input.idempotencyKey);
      adopted.push(ref);
      return ref;
    },
    async deleteNode(input) {
      deletes.push(input.artifact);
      if (options.cleanupFailure) throw new Error("cleanup unavailable");
      await storage.delete({ ref: input.artifact.object, expectedDigest: input.artifact.digest as `sha256:${string}`, idempotencyKey: input.idempotencyKey });
    },
  };
  const issuer = new CoreNodeGrantIssuer("capability-artifact-fixture-secret-".repeat(2));
  const registry = new NodeCapabilityRegistry({ nodeId: "node-1", configRevision: () => configRevision, secrets: new NodeCapabilitySecretCustody(new NodeSecretStore(join(root, "secrets"))) });
  if (options.worker) {
    registry.register(new LegacyArtifactWorkerCapabilityAdapter({ offering: advertised, nodeId: "node-1", handler: {
      kind: "artifact.local-ocr", capabilityVersion: 1, requiredCapability: "jobs:artifact.local-ocr",
      async execute(context) {
        calls += 1;
        const entry = context.job.inputRefs[0]!;
        const worker = nodeArtifactWorkerRequestV1Schema.parse(await new Response(await storage.get({ ref: entry.object })).json());
        const media = worker.inputs[0]!.artifact;
        expect(new Uint8Array(await new Response(await storage.get({ ref: media.object })).arrayBuffer())).toEqual(sourceBytes);
        expect(context.grantedResources).toContainEqual(media.object);
        const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, worker: "local-ocr.v1", sourceDigest: source.digest, modelId: "tesseract-ocr", modelRevision: advertised.runtime.modelRevision, engine: "tesseract+poppler", networkAccess: false, pageCount: 1, pages: [{ providerIndex: 0, markdown: "Private OCR text", width: 100, height: 200 }] }));
        const artifact = { object: { ownerId: connection.ownerId, namespace: "artifact-worker-results", key: `${createHash("sha256").update(context.job.id).digest("hex")}/result` }, digest: bytesDigest(bytes), byteSize: bytes.length, mimeType: "application/json" };
        await storage.put({ ref: artifact.object, body: byteStream(bytes), byteSize: bytes.length, mimeType: artifact.mimeType, expectedDigest: artifact.digest, idempotencyKey: "worker-output" });
        return [artifact];
      },
    } }));
  } else {
    registry.register(new NodeCapabilityHttpSidecarAdapter({ offering: advertised, invocationModes: ["unary-relay"], baseUrl: "http://127.0.0.1:9488", artifacts: new NodeSidecarArtifactIo(storage), fetch: async (_url, init) => {
      calls += 1;
      const wire = JSON.parse(String(init?.body));
      expect(wire.artifactProtocol).toBe("inline-base64-v1");
      expect(Buffer.from(wire.artifacts[0].bytesBase64, "base64")).toEqual(Buffer.from(sourceBytes));
      expect(wire.request.input.source).toEqual(wire.artifacts[0].artifact);
      expect(wire.request.input.source.object.key).not.toBe(source.object.key);
      const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4e0AAAAASUVORK5CYII=", "base64");
      const artifact = { object: { ownerId: connection.ownerId, namespace: "sidecar-local", key: "image-1" }, digest: bytesDigest(bytes), byteSize: bytes.length, mimeType: options.corrupt === "mime" ? "text/plain" : "image/png" };
      const usage = emptyCapabilityUsage();
      const result = { schemaVersion: 1, pages: [{ page: 1, markdown: "private", plainText: "private", blocks: [{ id: "image-1", kind: "image", text: null, bbox: null, confidence: null, assetRef: artifact }] }], pageCount: 1, language: "en", usage, providerMetadata: {} };
      const outputArtifacts = [artifact];
      return Response.json({ artifactProtocol: "inline-base64-v1", result: { schemaVersion: 1, operationId: wire.request.operationId, offeringId: wire.request.offeringId, requestDigest: wire.request.requestDigest, outputDigest: capabilityDigest({ result, outputArtifacts }), result, outputArtifacts, usage, providerRequestId: "sidecar-request-1" }, artifacts: [{ artifact, bytesBase64: (options.corrupt === "output" ? Buffer.alloc(bytes.length) : bytes).toString("base64") }] });
    } }));
  }
  const executor = new NodeCapabilityExecutor({ nodeId: "node-1", configRevision: () => configRevision, registry, issuerPublicKeyDer: issuer.publicSigningKey, issuerKeyId: issuer.identity.keyId, verifyArtifact: async (artifact) => {
    const metadata = await storage.stat({ ref: artifact.object });
    if (!metadata || metadata.digest !== artifact.digest || metadata.byteSize !== artifact.byteSize || metadata.mimeType !== artifact.mimeType) throw new Error("fixture metadata mismatch");
  } });
  let dispatched: Parameters<NodeCapabilityTransport["invokeCapability"]>[0] | undefined;
  const transport: NodeCapabilityTransport = {
    online: async () => true,
    listCapabilityOfferings: async () => [advertised],
    async invokeCapability(input) {
      dispatched = input;
      if (options.transportFailure) throw new Error("NODE_CHANNEL_CLOSED");
      return executor.invoke(input);
    },
    artifactJobCapability: async (input) => executor.artifactJob(input),
    async *streamCapability() { throw new Error("not used"); },
  };
  const plugin = createCoreNodeProviderPlugin({ ...manifest, capabilities: ["document.ocr"] }, { transport, signGrant: (claims) => issuer.signCapabilityInvocation(claims), now: () => new Date(), artifacts: bridge });
  const [offering] = await plugin.discoverOfferings({ ownerId: connection.ownerId, signal: new AbortController().signal, credential: async () => null, now: new Date() }, connection);
  const adapter = await plugin.createAdapter({ ownerId: connection.ownerId, signal: new AbortController().signal, credential: async () => null, connection }, offering!);
  if (!("invoke" in adapter)) throw new Error("expected unary adapter");
  let authorizations = 0;
  const context: CapabilityAttemptContext = { ownerId: connection.ownerId, operationId: "operation-artifact-fixture", attemptId: "attempt-artifact-fixture", attemptNumber: 1, purpose: "materials.ocr", offering: offering!, routePlanDigest: capabilityDigest({ fixture: 1 }), deadline: new Date(Date.now() + 60_000), signal: new AbortController().signal, async authorize() { authorizations += 1; }, credential: async () => null, emit: async () => {} };
  const request = { schemaVersion: 1 as const, source, mimeType: source.mimeType, requestedFeatures: { markdown: true, blocks: true, tables: false, formulas: false, images: !options.worker }, maximumPages: 20 };
  return { run: () => adapter.invoke(context, request), context, source, sourceBytes, storage, puts, deletes, adopted, adoptionKeys, get calls() { return calls; }, get byteReads() { return byteReads; }, get authorizations() { return authorizations; }, get dispatched() { return dispatched; } };
}

describe("Core↔Node artifact byte integration", () => {
  test("stages logical Core files to the exact Node, sidecar reads bytes, adopts nested output refs, and cleans scoped artifacts", async () => {
    const fixture = await artifactFixture();
    const result = await fixture.run();
    expect(fixture.authorizations).toBe(3);
    expect(fixture.calls).toBe(1);
    expect(fixture.adopted).toHaveLength(1);
    expect(JSON.stringify(result)).toContain("adopted-logical-core-file");
    expect(JSON.stringify(result)).not.toContain("capability-outputs");
    expect(fixture.dispatched?.grant.claims.inputArtifacts).toEqual(fixture.puts);
    expect(fixture.deletes).toHaveLength(2);
    for (const artifact of fixture.deletes) expect(await fixture.storage.stat({ ref: artifact.object })).toBeNull();
  });

  test("stages a digest-bound worker manifest and real source bytes, then normalizes the worker output JSON", async () => {
    const fixture = await artifactFixture({ worker: true });
    const result = await fixture.run();
    expect(fixture.calls).toBe(1);
    expect(fixture.puts).toHaveLength(2);
    expect(fixture.puts.filter((artifact) => artifact.mimeType === "application/json")).toHaveLength(1);
    expect(result).toMatchObject({ pageCount: 1, pages: [{ page: 1, plainText: "Private OCR text" }] });
    expect(fixture.deletes).toHaveLength(3);
  });

  test("rejects corrupt Core source bytes before staging or invoking the Node", async () => {
    const fixture = await artifactFixture({ corrupt: "input" });
    await expect(fixture.run()).rejects.toThrow("NODE_CAPABILITY_CORE_ARTIFACT_MISMATCH");
    expect(fixture.puts).toHaveLength(0);
    expect(fixture.calls).toBe(0);
  });

  test("rejects foreign Core refs before byte access and rechecks consent before output adoption", async () => {
    const foreign = await artifactFixture();
    foreign.source.object.ownerId = "other-owner";
    await expect(foreign.run()).rejects.toThrow("NODE_CAPABILITY_ARTIFACT_OWNER_MISMATCH");
    expect(foreign.byteReads).toBe(0);
    const revoked = await artifactFixture();
    let fences = 0;
    revoked.context.authorize = async () => { if (++fences === 3) throw new Error("CONSENT_REVOKED"); };
    await expect(revoked.run()).rejects.toThrow("CONSENT_REVOKED");
    expect(revoked.adopted).toHaveLength(0);
    expect(revoked.deletes.every((artifact) => artifact.object.namespace === "capability-inputs")).toBe(true);
  });

  test("rejects corrupt sidecar output bytes and never adopts them", async () => {
    const fixture = await artifactFixture({ corrupt: "output" });
    await expect(fixture.run()).rejects.toBeInstanceOf(CapabilityExecutionError);
    expect(fixture.adopted).toHaveLength(0);
  });

  test("rejects a sidecar artifact whose bytes do not match its declared MIME", async () => {
    const fixture = await artifactFixture({ corrupt: "mime" });
    await expect(fixture.run()).rejects.toThrow("NODE_CAPABILITY_OUTPUT_ARTIFACT_MIME_MISMATCH");
    expect(fixture.adopted).toHaveLength(0);
  });

  test("repeated exact operations stage the same refs and use the same adoption idempotency key", async () => {
    const fixture = await artifactFixture();
    const first = await fixture.run();
    const second = await fixture.run();
    expect(second).toEqual(first);
    expect(fixture.puts[1]).toEqual(fixture.puts[0]);
    expect(fixture.adoptionKeys[1]).toBe(fixture.adoptionKeys[0]);
  });

  test("denies staging before authorization and marks lost dispatch outcomes ambiguous while retaining exact replay inputs", async () => {
    const denied = await artifactFixture();
    denied.context.authorize = async () => { throw new Error("CONSENT_REQUIRED"); };
    await expect(denied.run()).rejects.toThrow("CONSENT_REQUIRED");
    expect(denied.byteReads).toBe(0);
    const uncertain = await artifactFixture({ transportFailure: true });
    try { await uncertain.run(); throw new Error("expected failure"); } catch (error) {
      expect(error).toBeInstanceOf(CapabilityExecutionError);
      expect((error as CapabilityExecutionError).capabilityError).toMatchObject({ ambiguous: true, retryable: false });
    }
    expect(uncertain.deletes).toHaveLength(0);
    expect(await uncertain.storage.stat({ ref: uncertain.puts[0]!.object })).not.toBeNull();
  });

  test("keeps verified output after adoption fails, but cleanup failure cannot turn an adopted result into failure", async () => {
    const unavailable = await artifactFixture({ adoptionFailure: true });
    await expect(unavailable.run()).rejects.toThrow("simulated durable adoption outage");
    expect(unavailable.deletes.every((ref) => ref.object.namespace === "capability-inputs")).toBe(true);
    const cleanup = await artifactFixture({ cleanupFailure: true });
    await expect(cleanup.run()).resolves.toBeDefined();
    expect(cleanup.adopted).toHaveLength(1);
  });
});
