import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import type {
  NodeCapabilityOffering,
  NodeCapabilityManifestV2,
  NodeControlFrame,
  SignedNodeCapabilityGrant,
} from "@avermate/agent-contracts";
import {
  nodeCapabilityRequestDigestPayload,
  nodeCapabilityRequestV1Schema,
} from "@avermate/agent-contracts";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeCredentialVault } from "./node-credential-vault";
import { CoreNodeRegistry, coreNodeFingerprint } from "./node-registry";
import {
  CoreNodeRelay,
  coreNodeOperationRequestDigest,
  type CoreRelaySocket,
  type DispatchNodeOperationInput,
} from "./node-relay";
import { SqlRelayOperationJournal } from "./node-relay-repository";
import {
  protocolDigest,
  signProtocolValue,
  verifyProtocolValue,
  type ProtocolSigningIdentity,
} from "./protocol-crypto";
import { CoreNodeGrantIssuer } from "./core-grant-issuer";

let client: Client;
let registry: CoreNodeRegistry;
let relay: CoreNodeRelay;
let credential: string;
let manifest: NodeCapabilityManifestV2;
let nodeSigner: ProtocolSigningIdentity;
let inferenceOffering: NodeCapabilityOffering;
let now: Date;
let nodeId: string;
const databasePath = join(
  tmpdir(),
  `avermate-node-relay-${crypto.randomUUID()}.db`,
);

class TestSocket implements CoreRelaySocket {
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];

  send(payload: string) {
    this.sent.push(payload);
  }

  close(code?: number, reason?: string) {
    this.closes.push({ code, reason });
  }

  frames() {
    return this.sent.map((body) => JSON.parse(body) as NodeControlFrame);
  }
}

beforeAll(async () => {
  client = createClient({ url: `file:${databasePath}` });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id text PRIMARY KEY NOT NULL);
    INSERT INTO users (id) VALUES ('user-1');
    CREATE TABLE avermate_nodes (
      id text PRIMARY KEY NOT NULL, protocolMajor integer NOT NULL,
      publicSigningKey text NOT NULL, keyId text NOT NULL UNIQUE,
      fingerprint text NOT NULL UNIQUE, state text NOT NULL,
      revokedAt integer, createdAt integer NOT NULL, updatedAt integer NOT NULL
    );
    CREATE TABLE node_pairing_attempts (
      id text PRIMARY KEY NOT NULL, nodeId text NOT NULL REFERENCES avermate_nodes(id),
      codeHash text NOT NULL UNIQUE, offerJson text NOT NULL,
      registrationProofDigest text NOT NULL, manifestDigest text NOT NULL,
      state text NOT NULL, claimedUserId text REFERENCES users(id),
      confirmedCapabilitiesJson text, expiresAt integer NOT NULL,
      claimedAt integer, confirmedAt integer, consumedAt integer,
      createdAt integer NOT NULL, updatedAt integer NOT NULL
    );
    CREATE TABLE node_account_bindings (
      id text PRIMARY KEY NOT NULL, nodeId text NOT NULL REFERENCES avermate_nodes(id),
      userId text NOT NULL REFERENCES users(id), pairingAttemptId text NOT NULL REFERENCES node_pairing_attempts(id),
      state text NOT NULL, createdAt integer NOT NULL, revokedAt integer
    );
    CREATE TABLE node_credential_generations (
      id text PRIMARY KEY NOT NULL, nodeId text NOT NULL REFERENCES avermate_nodes(id),
      userId text NOT NULL REFERENCES users(id), kind text NOT NULL,
      generation integer NOT NULL, credentialHash text NOT NULL UNIQUE,
      sealedCredential text, activeFrom integer NOT NULL, expiresAt integer NOT NULL,
      overlapUntil integer, deliveredAt integer, revokedAt integer, createdAt integer NOT NULL,
      UNIQUE(nodeId, kind, generation)
    );
    CREATE TABLE node_capability_manifests (
      id text PRIMARY KEY NOT NULL, nodeId text NOT NULL REFERENCES avermate_nodes(id),
      configRevision text NOT NULL, manifestDigest text NOT NULL,
      manifestJson text NOT NULL, issuedAt integer NOT NULL, expiresAt integer NOT NULL,
      verifiedAt integer NOT NULL, createdAt integer NOT NULL,
      UNIQUE(nodeId, manifestDigest)
    );
    CREATE TABLE node_connection_epochs (
      id text PRIMARY KEY NOT NULL, nodeId text NOT NULL REFERENCES avermate_nodes(id),
      epoch integer NOT NULL, relayCredentialGeneration integer NOT NULL,
      manifestDigest text NOT NULL, state text NOT NULL, connectedAt integer NOT NULL,
      lastHeartbeatAt integer NOT NULL, disconnectedAt integer, safeCloseCode text,
      UNIQUE(nodeId, epoch)
    );
    CREATE UNIQUE INDEX node_connection_primary ON node_connection_epochs(nodeId) WHERE state = 'connected';
    CREATE TABLE node_lifecycle_events (
      id text PRIMARY KEY NOT NULL, nodeId text NOT NULL, userId text,
      eventType text NOT NULL, safeMetadataJson text NOT NULL, occurredAt integer NOT NULL
    );
    CREATE TABLE node_relay_operations (
      id text PRIMARY KEY NOT NULL, nodeId text NOT NULL REFERENCES avermate_nodes(id),
      userId text NOT NULL REFERENCES users(id), capability text NOT NULL,
      configRevision text NOT NULL, requestDigest text NOT NULL, state text NOT NULL,
      lastSequence integer NOT NULL, acknowledgedSequence integer NOT NULL,
      deadline integer NOT NULL, createdAt integer NOT NULL, updatedAt integer NOT NULL
    );
  `);
  now = new Date("2026-08-22T12:00:00.000Z");
  const nodeKeys = generateKeyPairSync("ed25519");
  const publicSigningKey = Buffer.from(
    nodeKeys.publicKey.export({ type: "spki", format: "der" }),
  ).toString("base64url");
  nodeId = `node_${crypto.randomUUID()}`;
  nodeSigner = { keyId: `ed25519_${crypto.randomUUID()}`, privateKey: nodeKeys.privateKey };
  const inferenceDescriptor = {
    schemaVersion: 1 as const,
    id: "node-offering-rerank-relay",
    connectionId: "node-internal-rerank",
    connectionRevision: 1,
    pluginId: "node.fixture.rerank",
    pluginVersion: "1",
    adapterRevision: "fixture-v1",
    capabilityProtocolVersion: 1 as const,
    provider: "node-fixture",
    modelId: "rerank-fixture",
    modelRevision: "weights-1",
    placement: {
      kind: "node" as const,
      nodeId,
      configRevision: `sha256:${"a".repeat(64)}` as const,
    },
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
  inferenceOffering = {
    descriptor: inferenceDescriptor,
    descriptorDigest: protocolDigest(inferenceDescriptor),
    runtime: {
      implementation: "fixture",
      runtimeRevision: "runtime-1",
      imageDigest: null,
      modelRevision: inferenceDescriptor.modelRevision,
    },
    network: { egressPolicyDigest: `sha256:${"b".repeat(64)}` },
  };
  const unsignedManifest = {
    protocol: "avermate-node/2" as const,
    nodeId,
    build: "relay-test@sha256:fixture",
    configRevision: `sha256:${"a".repeat(64)}` as const,
    features: {
      conversations: { version: 1 as const, search: true, maxBytes: 1_000_000 },
      jobs: {
        version: 1 as const,
        kinds: ["specialist.opencode@1"],
        maxConcurrent: 2,
      },
      inference: {
        version: 1 as const,
        offerings: [inferenceOffering],
        invocationModes: ["unary-relay" as const, "stream-relay" as const],
        maxConcurrent: 2,
        secretCustody: "node-local" as const,
      },
    },
    limits: {
      maxConcurrentJobs: 2,
      maxControlFrameBytes: 256 * 1024,
      maxStreamFrameBytes: 64 * 1024,
      maxBufferedStreamBytes: 2 * 1024 * 1024,
      storageQuotaBytes: 1_000_000,
      storageUsedBytes: 0,
    },
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    keyId: nodeSigner.keyId,
  };
  manifest = {
    ...unsignedManifest,
    signature: signProtocolValue(nodeSigner, unsignedManifest),
  };
  const vault = new NodeCredentialVault("relay-test-master-secret-".repeat(2));
  credential = vault.generate();
  const timestamp = Math.floor(now.getTime() / 1_000);
  await client.batch(
    [
      {
        sql: `INSERT INTO avermate_nodes VALUES (?, 2, ?, ?, ?, 'offline', NULL, ?, ?)`,
        args: [
          nodeId,
          publicSigningKey,
          nodeSigner.keyId,
          coreNodeFingerprint(publicSigningKey),
          timestamp,
          timestamp,
        ],
      },
      {
        sql: `INSERT INTO node_pairing_attempts
          (id, nodeId, codeHash, offerJson, registrationProofDigest,
           manifestDigest, state, claimedUserId, confirmedCapabilitiesJson,
           expiresAt, createdAt, updatedAt)
          VALUES ('pair-1', ?, 'sha256:code', '{}', 'sha256:proof',
            'sha256:manifest', 'consumed', 'user-1', '["conversations","jobs","inference"]', ?, ?, ?)`,
        args: [nodeId, timestamp + 3_600, timestamp, timestamp],
      },
      {
        sql: `INSERT INTO node_account_bindings
          VALUES ('binding-1', ?, 'user-1', 'pair-1', 'active', ?, NULL)`,
        args: [nodeId, timestamp],
      },
      {
        sql: `INSERT INTO node_credential_generations
          (id, nodeId, userId, kind, generation, credentialHash,
           sealedCredential, activeFrom, expiresAt, createdAt)
          VALUES ('credential-1', ?, 'user-1', 'relay', 1, ?, NULL, ?, ?, ?)`,
        args: [
          nodeId,
          vault.hash(credential),
          timestamp,
          timestamp + 3_600,
          timestamp,
        ],
      },
    ],
    "write",
  );
  registry = new CoreNodeRegistry({ client, vault, clock: () => now });
  relay = new CoreNodeRelay({
    registry,
    journal: new SqlRelayOperationJournal(client),
    heartbeatIntervalMs: 1_000,
    offlineGraceMs: 4_000,
    clock: () => now,
  });
});

afterAll(async () => {
  await relay.shutdown();
  client.close();
});

function operationInput(
  operationId: string,
  payload: unknown,
): DispatchNodeOperationInput {
  const base = {
    userId: "user-1",
    nodeId,
    capability: "conversations" as const,
    capabilityVersion: 1,
    operationId,
    operation: "conversation.replay",
    payload,
    configRevision: manifest.configRevision,
    deadline: new Date(now.getTime() + 30_000).toISOString(),
  };
  const requestDigest = coreNodeOperationRequestDigest(base);
  const grant: SignedNodeCapabilityGrant = {
    claims: {
      version: 1,
      issuer: "core-test",
      audience: nodeId,
      subject: "user-1",
      nodeId,
      userId: "user-1",
      actorKind: "system",
      jobId: operationId,
      jti: `grant_${operationId}`,
      operation: base.operation,
      requestDigest,
      configRevision: manifest.configRevision,
      capabilities: [`node:conversations:${base.operation}`],
      resources: [],
      limits: {
        byteLimit: 1_000_000,
        tokenLimit: 10_000,
        costMinorLimit: 1_000,
        deadline: base.deadline,
      },
      notBefore: new Date(now.getTime() - 1_000).toISOString(),
      expiresAt: base.deadline,
      issuedAt: now.toISOString(),
    },
    keyId: "core-test-key",
    signature: "A".repeat(64),
  };
  return { ...base, grant };
}

describe("CoreNodeRelay", () => {
  const socket = new TestSocket();
  let connection: ReturnType<CoreNodeRelay["acceptAuthenticatedConnection"]>;
  let epoch = 0;

  test("authenticates, negotiates a durable epoch and acknowledges heartbeat", async () => {
    const authenticated = await relay.authenticate(`Bearer ${credential}`);
    connection = relay.acceptAuthenticatedConnection(authenticated, socket);
    await connection.receive(
      JSON.stringify({
        type: "hello",
        frameId: "frame-hello",
        manifest,
      }),
    );
    const ready = socket.frames().find((frame) => frame.type === "relay-ready");
    expect(ready?.type).toBe("relay-ready");
    if (!ready || ready.type !== "relay-ready") throw new Error("missing ready");
    epoch = ready.connectionEpoch;
    expect(relay.online(nodeId)).toBe(true);
    await connection.receive(
      JSON.stringify({
        type: "heartbeat",
        frameId: "frame-heartbeat",
        nodeId,
        connectionEpoch: epoch,
        sentAt: now.toISOString(),
      }),
    );
    expect(socket.frames().at(-1)?.type).toBe("heartbeat-ack");
  });

  test("streams ordered bounded results and journals acknowledgements", async () => {
    const operation = await relay.dispatchOperation(
      operationInput("operation-stream", { afterSequence: 0 }),
    );
    await connection.receive(
      JSON.stringify({
        type: "operation-result",
        frameId: "frame-result-1",
        nodeId,
        connectionEpoch: epoch,
        operationId: "operation-stream",
        sequence: 1,
        ok: true,
        payload: { sequence: 1 },
        retryable: false,
        terminal: false,
      }),
    );
    await connection.receive(
      JSON.stringify({
        type: "operation-result",
        frameId: "frame-result-2",
        nodeId,
        connectionEpoch: epoch,
        operationId: "operation-stream",
        sequence: 2,
        ok: true,
        payload: { sequence: 2 },
        retryable: false,
        terminal: true,
      }),
    );
    const received: unknown[] = [];
    for await (const value of operation) received.push(value);
    expect(received).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    const row = (
      await client.execute(
        "SELECT state, lastSequence, acknowledgedSequence FROM node_relay_operations WHERE id = 'operation-stream'",
      )
    ).rows[0];
    expect(row).toMatchObject({
      state: "completed",
      lastSequence: 2,
      acknowledgedSequence: 2,
    });
  });

  test("rejects a grant not bound to the exact request", async () => {
    const input = operationInput("operation-forged", { value: "original" });
    input.payload = { value: "changed" };
    await expect(relay.dispatchOperation(input)).rejects.toThrow(
      "NODE_OPERATION_GRANT_BINDING_INVALID",
    );
  });

  test("relays a signed offering-scoped Node capability request and verifies its bindings", async () => {
    const placeholder = nodeCapabilityRequestV1Schema.parse({
      schemaVersion: 1,
      operationId: "operation-capability-v1",
      ownerId: "user-1",
      capability: "rerank.score",
      purpose: "search.query-rerank",
      offeringId: inferenceOffering.descriptor.id,
      offeringDigest: inferenceOffering.descriptorDigest,
      configRevision: manifest.configRevision,
      requestDigest: `sha256:${"0".repeat(64)}`,
      inputArtifacts: [],
      input: {
        schemaVersion: 1,
        query: "query",
        candidates: [{ id: "candidate-1", text: "candidate" }],
        topK: 1,
      },
    });
    const request = nodeCapabilityRequestV1Schema.parse({
      ...placeholder,
      requestDigest: protocolDigest(
        nodeCapabilityRequestDigestPayload(placeholder),
      ),
    });
    const deadline = new Date(now.getTime() + 30_000).toISOString();
    const issuer = new CoreNodeGrantIssuer("relay-capability-secret-".repeat(2));
    const grant = issuer.signCapabilityInvocation({
      schemaVersion: 1,
      issuer: "avermate-core",
      audience: nodeId,
      subject: "user-1",
      ownerId: "user-1",
      nodeId,
      operationId: request.operationId,
      offeringId: request.offeringId,
      offeringDigest: request.offeringDigest,
      configRevision: request.configRevision,
      requestDigest: request.requestDigest,
      inputArtifacts: [],
      limits: {
        cpuMillis: 30_000,
        memoryBytes: 512 * 1024 * 1024,
        inputBytes: 1_000_000,
        outputBytes: 1_000_000,
        tokenLimit: 10_000,
        costMinorLimit: 1_000,
        deadline,
      },
      egressPolicyDigest: inferenceOffering.network.egressPolicyDigest,
      notBefore: now.toISOString(),
      expiresAt: deadline,
      issuedAt: now.toISOString(),
      jti: "node-capability-grant-1",
    });
    const pending = relay.requestCapability({
      userId: "user-1",
      nodeId,
      request,
      grant,
    });
    let dispatched: Extract<NodeControlFrame, { type: "operation-request" }> | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = socket.frames().find(
        (frame) =>
          frame.type === "operation-request" &&
          frame.operationId === request.operationId,
      );
      if (candidate?.type === "operation-request") {
        dispatched = candidate;
        break;
      }
      await Bun.sleep(5);
    }
    expect(dispatched).toMatchObject({
      capability: "inference",
      operation: "capability.invoke",
      configRevision: manifest.configRevision,
      payload: { ownerId: "user-1", input: request },
    });
    expect(
      verifyProtocolValue(
        issuer.publicSigningKey,
        grant.claims,
        grant.signature,
      ),
    ).toBe(true);

    const usage = {
      version: 1 as const,
      items: [{ unit: "candidate" as const, quantity: "1", source: "measured" as const }],
      cost: {
        amountMinor: null,
        currency: null,
        authoritative: false,
        pricingSnapshotId: null,
      },
    };
    const result = {
      schemaVersion: 1 as const,
      scores: [{ id: "candidate-1", score: 0.9, rank: 0 }],
      usage,
      providerMetadata: null,
    };
    const outputArtifacts: [] = [];
    const payload = {
      schemaVersion: 1 as const,
      operationId: request.operationId,
      offeringId: request.offeringId,
      requestDigest: request.requestDigest,
      outputDigest: protocolDigest({ result, outputArtifacts }),
      result,
      outputArtifacts,
      usage,
      providerRequestId: "node-request-1",
    };
    await connection.receive(
      JSON.stringify({
        type: "operation-result",
        frameId: "frame-capability-result",
        nodeId,
        connectionEpoch: epoch,
        operationId: request.operationId,
        sequence: 1,
        ok: true,
        payload,
        retryable: false,
        terminal: false,
      }),
    );
    await connection.receive(
      JSON.stringify({
        type: "operation-result",
        frameId: "frame-capability-terminal",
        nodeId,
        connectionEpoch: epoch,
        operationId: request.operationId,
        sequence: 2,
        ok: true,
        retryable: false,
        terminal: true,
      }),
    );
    expect(await pending).toEqual(payload);
  });

  test("offers a manifest-fenced job and acknowledges only its consumed completion", async () => {
    const deadline = new Date(now.getTime() + 30_000).toISOString();
    const artifact = {
      object: {
        ownerId: "user-1",
        namespace: "specialist-inputs",
        key: "manifest.json",
      },
      digest: `sha256:${"b".repeat(64)}` as const,
      byteSize: 128,
      mimeType: "application/json",
    };
    const terminalPromise = relay.dispatchJob({
      userId: "user-1",
      nodeId,
      job: {
        id: "node-job-1",
        principalRef: {
          userId: "user-1",
          nodeId,
          actorKind: "system",
        },
        kind: "specialist.opencode",
        capabilityVersion: 1,
        inputRefs: [artifact],
        policyRef: manifest.configRevision,
        limits: {
          cpuMillis: 10_000,
          memoryBytes: 512 * 1024 * 1024,
          inputBytes: 1_024,
          outputBytes: 1_024,
          deadline,
        },
        idempotencyKey: "artifact-stage-1",
        envelopeDigest: `sha256:${"c".repeat(64)}`,
        grant: {
          claims: {
            version: 1,
            issuer: "avermate-core",
            audience: nodeId,
            subject: "user-1",
            nodeId,
            userId: "user-1",
            actorKind: "system",
            jobId: "node-job-1",
            jti: "node-job-grant-1",
            configRevision: manifest.configRevision,
            capabilities: ["jobs:specialist.opencode"],
            resources: [artifact.object],
            limits: {
              byteLimit: 2_048,
              tokenLimit: 0,
              costMinorLimit: 0,
              deadline,
            },
            notBefore: new Date(now.getTime() - 1_000).toISOString(),
            expiresAt: deadline,
            issuedAt: now.toISOString(),
          },
          keyId: "core-test-key",
          signature: "A".repeat(64),
        },
      },
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (socket.frames().at(-1)?.type === "job-offer") break;
      await Bun.sleep(5);
    }
    expect(socket.frames().at(-1)?.type).toBe("job-offer");
    await connection.receive(
      JSON.stringify({
        type: "job-event",
        frameId: "frame-job-offered",
        nodeId,
        connectionEpoch: epoch,
        event: {
          jobId: "node-job-1",
          sequence: 1,
          eventId: "job-event-1",
          stage: "offered",
          emittedAt: now.toISOString(),
          terminal: false,
        },
      }),
    );
    await connection.receive(
      JSON.stringify({
        type: "job-event",
        frameId: "frame-job-completed",
        nodeId,
        connectionEpoch: epoch,
        event: {
          jobId: "node-job-1",
          sequence: 2,
          eventId: "job-event-2",
          stage: "completed",
          emittedAt: now.toISOString(),
          terminal: true,
          resultManifest: [artifact],
        },
      }),
    );
    expect((await terminalPromise).stage).toBe("completed");
    expect(socket.frames().at(-1)).toMatchObject({
      type: "job-ack",
      jobId: "node-job-1",
      sequence: 2,
    });
  });

  test("fences the old primary when a newer connection epoch wins", async () => {
    const nextSocket = new TestSocket();
    const authenticated = await relay.authenticate(`Bearer ${credential}`);
    const nextConnection = relay.acceptAuthenticatedConnection(
      authenticated,
      nextSocket,
    );
    await nextConnection.receive(
      JSON.stringify({
        type: "hello",
        frameId: "frame-reconnect",
        manifest,
      }),
    );
    const nextReady = nextSocket
      .frames()
      .find((frame) => frame.type === "relay-ready");
    expect(nextReady?.type === "relay-ready" && nextReady.connectionEpoch).toBe(
      epoch + 1,
    );
    expect(socket.closes.at(-1)).toMatchObject({
      code: 4002,
      reason: "REPLACED_BY_NEW_EPOCH",
    });
    expect(relay.inspect(nodeId)?.connectionEpoch).toBe(epoch + 1);
  });
});
