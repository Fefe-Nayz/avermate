import { afterEach, describe, expect, test } from "bun:test";
import {
  emptyCapabilityUsage,
  nodeCapabilityRequestDigestPayload,
  type NodeCapabilityEventV1,
  type NodeCapabilityJobManifestV1,
  type NodeCapabilityRequestV1,
  type NodeCapabilityResultV1,
  type NodeControlFrame,
  type UnsignedNodeCapabilityInvocationGrantClaims,
} from "@avermate/agent-contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalDigest } from "../canonical-json";
import { loadOrCreateNodeIdentity } from "../identity";
import { signNodeCapabilityInvocationGrant } from "../protocol";
import { GrantReplayLedger } from "../protocol";
import { NodeOperationResultLedger } from "../operation-ledger";
import { NodeSecretStore } from "../secret-store";
import { NodeCapabilityExecutor } from "./executor";
import { NodeCapabilityV1Dispatcher } from "./dispatcher";
import { createNodeCapabilityOffering } from "./manifest";
import {
  NodeCapabilityRegistry,
  type NodeCapabilityAdapter,
  type NodeCapabilityAdapterContext,
} from "./registry";
import { NodeCapabilitySecretCustody } from "./secret-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const CONFIG_REVISION = `sha256:${"a".repeat(64)}`;
const EGRESS_DIGEST = `sha256:${"b".repeat(64)}`;

function offering(
  nodeId: string,
  imageDigest = `sha256:${"c".repeat(64)}`,
) {
  return createNodeCapabilityOffering({
    descriptor: {
      schemaVersion: 1,
      connectionId: "node-connection-fixture",
      connectionRevision: 1,
      pluginId: "fixture.node-capability",
      pluginVersion: "1",
      adapterRevision: "fixture-v1",
      capability: "language.generate",
      capabilityProtocolVersion: 1,
      provider: "fixture",
      modelId: "fixture-model",
      modelRevision: "fixture-model-r1",
      placement: { kind: "node", nodeId, configRevision: CONFIG_REVISION },
      dataHandling: {
        egress: "owner-node",
        providerName: null,
        region: null,
        disclosureRevision: "fixture-disclosure-v1",
        retentionDisclosureRevision: null,
        trainingDisclosureRevision: null,
        requiresExplicitConsent: false,
      },
      limits: {
        maxInputBytes: 1024 * 1024,
        maxOutputBytes: 1024 * 1024,
        maxBatchSize: 1,
        maxConcurrency: 2,
      },
      supportedLanguages: ["fr"],
      healthCheckKind: "node-attested",
      specification: {
        inputModalities: ["text"],
        contextWindow: 8_192,
        maximumOutputTokens: 4_096,
        tools: false,
        parallelTools: false,
        structuredOutput: false,
        streaming: true,
        reasoningSummary: false,
        opaqueReasoningContinuation: false,
        cachedUsage: false,
      },
    },
    runtime: {
      implementation: "fixture-worker",
      runtimeRevision: "fixture-runtime-r1",
      imageDigest,
      modelRevision: "fixture-model-r1",
    },
    egressPolicyDigest: EGRESS_DIGEST,
  });
}

function result(request: {
  operationId: string;
  offeringId: string;
  requestDigest: string;
}): NodeCapabilityResultV1 {
  const result = { text: "bonjour" };
  const outputArtifacts: [] = [];
  return {
    schemaVersion: 1,
    operationId: request.operationId,
    offeringId: request.offeringId,
    requestDigest: request.requestDigest,
    outputDigest: canonicalDigest({ result, outputArtifacts }),
    result,
    outputArtifacts,
    usage: emptyCapabilityUsage(),
    providerRequestId: null,
  };
}

type FixtureOffering = ReturnType<typeof offering>;

class FixtureAdapter implements NodeCapabilityAdapter {
  readonly invocationModes = [
    "unary-relay",
    "stream-relay",
    "artifact-job",
  ] as const;
  constructor(readonly offering: FixtureOffering) {}

  async invoke(
    _context: NodeCapabilityAdapterContext,
    request: NodeCapabilityRequestV1,
  ) {
    return result(request);
  }

  async *stream(
    _context: NodeCapabilityAdapterContext,
    request: NodeCapabilityRequestV1,
  ): AsyncIterable<NodeCapabilityEventV1> {
    yield {
      schemaVersion: 1,
      operationId: request.operationId,
      offeringId: request.offeringId,
      sequence: 0,
      type: "acknowledged",
      payload: null,
    };
    yield {
      schemaVersion: 1,
      operationId: request.operationId,
      offeringId: request.offeringId,
      sequence: 1,
      type: "completed",
      payload: { finishReason: "stop" },
    };
  }

  async artifactJob(
    _context: NodeCapabilityAdapterContext,
    manifest: NodeCapabilityJobManifestV1,
  ) {
    return result(manifest);
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "avermate-capability-v1-"));
  roots.push(root);
  const node = await loadOrCreateNodeIdentity(join(root, "node.json"));
  const core = await loadOrCreateNodeIdentity(join(root, "core.json"));
  const secrets = new NodeSecretStore(join(root, "secrets"));
  const custody = new NodeCapabilitySecretCustody(secrets);
  const registry = new NodeCapabilityRegistry({
    nodeId: node.nodeId,
    configRevision: () => CONFIG_REVISION,
    secrets: custody,
  });
  const advertised = offering(node.nodeId);
  registry.register(new FixtureAdapter(advertised));
  const executor = new NodeCapabilityExecutor({
    nodeId: node.nodeId,
    configRevision: () => CONFIG_REVISION,
    issuerPublicKeyDer: core.publicKeyDer,
    issuerKeyId: core.keyId,
    registry,
  });
  return { root, node, core, secrets, custody, registry, advertised, executor };
}

function requestFor(
  advertised: ReturnType<typeof offering>,
  ownerId = "owner-1",
): NodeCapabilityRequestV1 {
  const draft: NodeCapabilityRequestV1 = {
    schemaVersion: 1,
    operationId: "operation-1",
    ownerId,
    capability: "language.generate",
    purpose: "assistant.chat",
    offeringId: advertised.descriptor.id,
    offeringDigest: advertised.descriptorDigest,
    configRevision: CONFIG_REVISION,
    requestDigest: `sha256:${"0".repeat(64)}`,
    inputArtifacts: [],
    input: {
      schemaVersion: 1,
      messages: [{ role: "user", parts: [{ type: "text", text: "Bonjour" }] }],
      maximumOutputTokens: 128,
      responseFormat: "text",
    },
  };
  return {
    ...draft,
    requestDigest: canonicalDigest(nodeCapabilityRequestDigestPayload(draft)),
  };
}

function claimsFor(input: {
  nodeId: string;
  coreKeyId: string;
  request: NodeCapabilityRequestV1;
  now?: number;
}): UnsignedNodeCapabilityInvocationGrantClaims {
  const now = input.now ?? Date.now();
  const deadline = new Date(now + 30_000).toISOString();
  return {
    schemaVersion: 1,
    issuer: input.coreKeyId,
    audience: input.nodeId,
    subject: input.request.ownerId,
    ownerId: input.request.ownerId,
    nodeId: input.nodeId,
    operationId: input.request.operationId,
    offeringId: input.request.offeringId,
    offeringDigest: input.request.offeringDigest,
    configRevision: input.request.configRevision,
    requestDigest: input.request.requestDigest,
    inputArtifacts: input.request.inputArtifacts,
    limits: {
      cpuMillis: 30_000,
      memoryBytes: 512 * 1024 * 1024,
      inputBytes: 1024 * 1024,
      outputBytes: 1024 * 1024,
      tokenLimit: 10_000,
      costMinorLimit: 1_000,
      deadline,
    },
    egressPolicyDigest: EGRESS_DIGEST,
    issuedAt: new Date(now - 2_000).toISOString(),
    notBefore: new Date(now - 1_000).toISOString(),
    expiresAt: deadline,
    jti: `grant-${crypto.randomUUID()}`,
  };
}

describe("Node capability protocol v1", () => {
  test("invokes and streams one immutable signed offering", async () => {
    const value = await fixture();
    const request = requestFor(value.advertised);
    const grant = signNodeCapabilityInvocationGrant(
      value.core,
      claimsFor({
        nodeId: value.node.nodeId,
        coreKeyId: value.core.keyId,
        request,
      }),
    );
    expect(await value.executor.invoke({ grant, request })).toMatchObject({
      operationId: request.operationId,
      offeringId: request.offeringId,
      requestDigest: request.requestDigest,
      result: { text: "bonjour" },
    });
    const events = [];
    for await (const event of value.executor.stream({ grant, request })) {
      events.push(event.type);
    }
    expect(events).toEqual(["acknowledged", "completed"]);
  });

  test("dispatches and durably replays the generic relay operation", async () => {
    const value = await fixture();
    const request = requestFor(value.advertised);
    const claims = claimsFor({
      nodeId: value.node.nodeId,
      coreKeyId: value.core.keyId,
      request,
    });
    const grant = signNodeCapabilityInvocationGrant(value.core, claims);
    const published: Array<
      Extract<NodeControlFrame, { type: "operation-result" }>
    > = [];
    let terminal!: () => void;
    let completed = new Promise<void>((resolve) => (terminal = resolve));
    const dispatcher = new NodeCapabilityV1Dispatcher({
      nodeId: value.node.nodeId,
      configRevision: () => CONFIG_REVISION,
      issuerPublicKeyDer: value.core.publicKeyDer,
      issuerKeyId: value.core.keyId,
      registry: value.registry,
      executor: value.executor,
      grantReplay: new GrantReplayLedger(join(value.root, "replay.json")),
      results: new NodeOperationResultLedger({
        path: join(value.root, "results.json"),
        maximumBytes: 1024 * 1024,
      }),
      maximumConcurrent: 2,
      publish: async (frame) => {
        published.push(frame);
        if (frame.terminal) terminal();
      },
    });
    await dispatcher.initialize();
    const frame: Extract<NodeControlFrame, { type: "operation-request" }> = {
      type: "operation-request",
      frameId: "frame-capability-v1",
      nodeId: value.node.nodeId,
      connectionEpoch: 1,
      operationId: request.operationId,
      capability: "inference",
      capabilityVersion: 1,
      operation: "capability.invoke",
      configRevision: CONFIG_REVISION,
      deadline: claims.limits.deadline,
      grant,
      payload: { ownerId: request.ownerId, input: request },
    };
    expect(await dispatcher.accept(frame)).toEqual({
      accepted: true,
      replayed: false,
    });
    await completed;
    expect(published.map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(published[0]?.payload).toMatchObject({ result: { text: "bonjour" } });

    published.splice(0);
    completed = new Promise<void>((resolve) => (terminal = resolve));
    expect(await dispatcher.accept(frame)).toEqual({
      accepted: true,
      replayed: true,
    });
    await completed;
    expect(published.map((entry) => entry.sequence)).toEqual([1, 2]);
  });

  test("runs the generic artifact-job lane with the same bounded grant", async () => {
    const value = await fixture();
    const request = requestFor(value.advertised);
    const limits = claimsFor({
      nodeId: value.node.nodeId,
      coreKeyId: value.core.keyId,
      request,
    }).limits;
    const manifest: NodeCapabilityJobManifestV1 = {
      schemaVersion: 1,
      operationId: request.operationId,
      ownerId: request.ownerId,
      capability: request.capability,
      purpose: request.purpose,
      offeringId: request.offeringId,
      offeringDigest: request.offeringDigest,
      configRevision: request.configRevision,
      inputs: [],
      requestJson: request.input,
      requestDigest: canonicalDigest(request.input),
      limits,
      egressPolicyDigest: EGRESS_DIGEST,
    };
    const claims = claimsFor({
      nodeId: value.node.nodeId,
      coreKeyId: value.core.keyId,
      request: { ...request, requestDigest: manifest.requestDigest },
    });
    claims.limits = limits;
    const grant = signNodeCapabilityInvocationGrant(value.core, claims);
    expect(
      await value.executor.artifactJob({ grant, manifest }),
    ).toMatchObject({ result: { text: "bonjour" } });
  });

  test("rejects artifact-job replay drift beyond the request JSON digest", async () => {
    const value = await fixture();
    const request = requestFor(value.advertised);
    const limits = claimsFor({
      nodeId: value.node.nodeId,
      coreKeyId: value.core.keyId,
      request,
    }).limits;
    const manifest: NodeCapabilityJobManifestV1 = {
      schemaVersion: 1,
      operationId: request.operationId,
      ownerId: request.ownerId,
      capability: request.capability,
      purpose: request.purpose,
      offeringId: request.offeringId,
      offeringDigest: request.offeringDigest,
      configRevision: request.configRevision,
      inputs: [],
      requestJson: request.input,
      requestDigest: canonicalDigest(request.input),
      limits,
      egressPolicyDigest: EGRESS_DIGEST,
    };
    const claims = claimsFor({
      nodeId: value.node.nodeId,
      coreKeyId: value.core.keyId,
      request: { ...request, requestDigest: manifest.requestDigest },
    });
    claims.limits = limits;
    let terminal!: () => void;
    const completed = new Promise<void>((resolve) => (terminal = resolve));
    const dispatcher = new NodeCapabilityV1Dispatcher({
      nodeId: value.node.nodeId,
      configRevision: () => CONFIG_REVISION,
      issuerPublicKeyDer: value.core.publicKeyDer,
      issuerKeyId: value.core.keyId,
      registry: value.registry,
      executor: value.executor,
      grantReplay: new GrantReplayLedger(join(value.root, "job-replay.json")),
      results: new NodeOperationResultLedger({
        path: join(value.root, "job-results.json"),
        maximumBytes: 1024 * 1024,
      }),
      maximumConcurrent: 2,
      publish: async (frame) => {
        if (frame.terminal) terminal();
      },
    });
    await dispatcher.initialize();
    const frame: Extract<NodeControlFrame, { type: "operation-request" }> = {
      type: "operation-request",
      frameId: "frame-artifact-capability-v1",
      nodeId: value.node.nodeId,
      connectionEpoch: 1,
      operationId: manifest.operationId,
      capability: "inference",
      capabilityVersion: 1,
      operation: "capability.artifact-job",
      configRevision: CONFIG_REVISION,
      deadline: limits.deadline,
      grant: signNodeCapabilityInvocationGrant(value.core, claims),
      payload: { ownerId: manifest.ownerId, input: manifest },
    };
    expect(await dispatcher.accept(frame)).toMatchObject({ accepted: true });
    await completed;

    const changedManifest = {
      ...manifest,
      limits: { ...manifest.limits, memoryBytes: manifest.limits.memoryBytes - 1 },
    };
    const changedClaims = claimsFor({
      nodeId: value.node.nodeId,
      coreKeyId: value.core.keyId,
      request: { ...request, requestDigest: manifest.requestDigest },
    });
    changedClaims.limits = changedManifest.limits;
    await expect(
      dispatcher.accept({
        ...frame,
        frameId: "frame-artifact-capability-v1-drift",
        grant: signNodeCapabilityInvocationGrant(value.core, changedClaims),
        payload: { ownerId: manifest.ownerId, input: changedManifest },
      }),
    ).rejects.toThrow("NODE_OPERATION_ID_REPLAY_MISMATCH");
  });

  test("rejects wrong owner, Node, revision, digest, egress and expiry", async () => {
    const value = await fixture();
    const request = requestFor(value.advertised);
    const base = claimsFor({
      nodeId: value.node.nodeId,
      coreKeyId: value.core.keyId,
      request,
    });
    const cases: Array<[
      string,
      UnsignedNodeCapabilityInvocationGrantClaims,
    ]> = [
      ["owner", { ...base, ownerId: "owner-2", subject: "owner-2" }],
      ["node", { ...base, nodeId: "node-other", audience: "node-other" }],
      [
        "revision",
        { ...base, configRevision: `sha256:${"d".repeat(64)}` },
      ],
      ["digest", { ...base, offeringDigest: `sha256:${"e".repeat(64)}` }],
      ["egress", { ...base, egressPolicyDigest: `sha256:${"f".repeat(64)}` }],
      [
        "artifacts",
        {
          ...base,
          inputArtifacts: [
            {
              object: {
                ownerId: request.ownerId,
                namespace: "capability-inputs",
                key: "object-1",
              },
              digest: `sha256:${"1".repeat(64)}`,
              byteSize: 4,
              mimeType: "text/plain",
            },
          ],
        },
      ],
      [
        "expiry",
        {
          ...base,
          limits: {
            ...base.limits,
            deadline: new Date(Date.now() - 1).toISOString(),
          },
          expiresAt: new Date(Date.now() - 1).toISOString(),
        },
      ],
    ];
    for (const [_name, claims] of cases) {
      const grant = signNodeCapabilityInvocationGrant(value.core, claims);
      await expect(value.executor.invoke({ grant, request })).rejects.toThrow();
    }
    const changedInput = {
      ...request,
      input: { ...request.input as Record<string, unknown>, changed: true },
    };
    const changedInputGrant = signNodeCapabilityInvocationGrant(
      value.core,
      claimsFor({
        nodeId: value.node.nodeId,
        coreKeyId: value.core.keyId,
        request: changedInput,
      }),
    );
    await expect(
      value.executor.invoke({ grant: changedInputGrant, request: changedInput }),
    ).rejects.toThrow("NODE_CAPABILITY_REQUEST_DIGEST_MISMATCH");
  });

  test("binds offering identity to the runtime image and validates output digests", async () => {
    const value = await fixture();
    const otherImage = offering(
      value.node.nodeId,
      `sha256:${"d".repeat(64)}`,
    );
    expect(otherImage.descriptor.id).not.toBe(value.advertised.descriptor.id);
    expect(otherImage.descriptorDigest).not.toBe(
      value.advertised.descriptorDigest,
    );

    value.registry.unregister(value.advertised.descriptor.id);
    value.registry.register({
      offering: value.advertised,
      invocationModes: ["unary-relay"],
      invoke: async (_context, request) => ({
        ...result(request),
        outputDigest: `sha256:${"0".repeat(64)}`,
      }),
    });
    const request = requestFor(value.advertised);
    const grant = signNodeCapabilityInvocationGrant(
      value.core,
      claimsFor({
        nodeId: value.node.nodeId,
        coreKeyId: value.core.keyId,
        request,
      }),
    );
    await expect(value.executor.invoke({ grant, request })).rejects.toThrow(
      "NODE_CAPABILITY_RESULT_BINDING_INVALID",
    );
  });

  test("rejects endpoint/secret-shaped public offerings and keeps secrets local", async () => {
    const value = await fixture();
    await value.secrets.put("provider-api-key", "super-secret-provider-value");
    value.custody.bind({
      offeringId: value.advertised.descriptor.id,
      slot: "apiKey",
      reference: "secret:provider-api-key",
      version: 3,
    });
    expect(await value.custody.snapshot(value.advertised.descriptor.id)).toEqual([
      {
        slot: "apiKey",
        status: "ready",
        version: 3,
        hint: "…alue",
      },
    ]);
    expect(JSON.stringify(value.custody)).toBe('{"custody":"node-local"}');
    expect(JSON.stringify(value.registry.listOfferings())).not.toContain(
      "super-secret-provider-value",
    );

    const unsafe = structuredClone(value.advertised) as unknown as Record<
      string,
      unknown
    >;
    (unsafe.descriptor as Record<string, unknown>).endpoint =
      "http://127.0.0.1:9000";
    expect(() =>
      value.registry.register({
        offering: unsafe as never,
        invocationModes: ["unary-relay"],
        invoke: async (_context, request) => result(request),
      }),
    ).toThrow();

    const secretPath = structuredClone(value.advertised);
    secretPath.descriptor.id = `${secretPath.descriptor.id}-secret-path`;
    secretPath.descriptorDigest = canonicalDigest(secretPath.descriptor);
    secretPath.runtime.implementation = "file:/run/secrets/provider-key";
    expect(() =>
      value.registry.register(new FixtureAdapter(secretPath)),
    ).toThrow("NODE_CAPABILITY_OFFERING_SECRET_REFERENCE");
  });

  test("withdraws immutable offerings after their config revision becomes stale", async () => {
    const value = await fixture();
    let revision = CONFIG_REVISION;
    const registry = new NodeCapabilityRegistry({
      nodeId: value.node.nodeId,
      configRevision: () => revision,
      secrets: value.custody,
    });
    registry.register(new FixtureAdapter(value.advertised));
    expect(registry.listOfferings()).toHaveLength(1);
    expect(registry.invocationModes()).toHaveLength(3);

    revision = `sha256:${"d".repeat(64)}`;
    expect(registry.listOfferings()).toEqual([]);
    expect(registry.invocationModes()).toEqual([]);
    expect(() =>
      registry.resolve(
        value.advertised.descriptor.id,
        value.advertised.descriptorDigest,
        "unary-relay",
      ),
    ).toThrow("NODE_CAPABILITY_OFFERING_CONFIG_STALE");
  });

  test("tracks an offline offering independently and removes it explicitly", async () => {
    const value = await fixture();
    const id = value.advertised.descriptor.id;
    value.registry.health.failure(id, new Error("SIDECAR_UNAVAILABLE"));
    value.registry.health.failure(id, new Error("SIDECAR_UNAVAILABLE"));
    value.registry.health.failure(id, new Error("SIDECAR_UNAVAILABLE"));
    expect(value.registry.health.get(id)).toMatchObject({
      state: "offline",
      consecutiveFailures: 3,
      safeErrorCode: "SIDECAR_UNAVAILABLE",
    });
    expect(value.registry.listOfferings()).toHaveLength(1);
    value.registry.unregister(id);
    expect(value.registry.listOfferings()).toEqual([]);
    expect(() =>
      value.registry.resolve(
        id,
        value.advertised.descriptorDigest,
        "unary-relay",
      ),
    ).toThrow("NODE_CAPABILITY_OFFERING_NOT_FOUND");
  });

  test("enforces token limits cumulatively across streamed usage events", async () => {
    const value = await fixture();
    value.registry.unregister(value.advertised.descriptor.id);
    value.registry.register({
      offering: value.advertised,
      invocationModes: ["stream-relay"],
      async *stream(_context, request) {
        for (const [sequence, quantity] of ["6", "6"].entries()) {
          yield {
            schemaVersion: 1,
            operationId: request.operationId,
            offeringId: request.offeringId,
            sequence,
            type: "usage",
            payload: {
              version: 1,
              items: [
                { unit: "input-token", quantity, source: "provider" },
              ],
              cost: {
                amountMinor: null,
                currency: null,
                authoritative: false,
                pricingSnapshotId: null,
              },
            },
          } as const;
        }
        yield {
          schemaVersion: 1,
          operationId: request.operationId,
          offeringId: request.offeringId,
          sequence: 2,
          type: "completed",
          payload: null,
        } as const;
      },
    });
    const request = requestFor(value.advertised);
    const claims = claimsFor({
      nodeId: value.node.nodeId,
      coreKeyId: value.core.keyId,
      request,
    });
    claims.limits.tokenLimit = 10;
    const grant = signNodeCapabilityInvocationGrant(value.core, claims);

    await expect(async () => {
      for await (const _event of value.executor.stream({ grant, request })) {
        // Consume the bounded stream.
      }
    }).toThrow("NODE_CAPABILITY_TOKEN_LIMIT_EXCEEDED");
  });
});
