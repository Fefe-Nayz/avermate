import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import type {
  NodeCapabilityFeatures,
  NodeCredentialDeliveryProof,
  NodePairingRegistration,
} from "@avermate/agent-contracts";
import { createHash, generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  protocolDigest,
  signProtocolValue,
  type ProtocolSigningIdentity,
} from "./protocol-crypto";
import { NodeCredentialVault } from "./node-credential-vault";
import {
  CoreNodeRegistry,
  coreNodeFingerprint,
  randomNodeProofNonce,
} from "./node-registry";

let client: Client;
let registry: CoreNodeRegistry;
let now: Date;

const databasePath = join(
  tmpdir(),
  `avermate-node-registry-${crypto.randomUUID()}.db`,
);

beforeAll(async () => {
  client = createClient({ url: `file:${databasePath}` });
  await client.execute("PRAGMA foreign_keys = ON");
  await client.executeMultiple(`
    CREATE TABLE users (id text PRIMARY KEY NOT NULL);
    INSERT INTO users (id) VALUES ('user-1'), ('user-2');
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
    CREATE UNIQUE INDEX node_binding_active ON node_account_bindings(nodeId) WHERE state = 'active';
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
    CREATE TABLE node_proof_nonces (
      nodeId text NOT NULL, nonce text NOT NULL, action text NOT NULL,
      issuedAt integer NOT NULL, acceptedAt integer NOT NULL,
      UNIQUE(nodeId, nonce)
    );
    CREATE TABLE node_capability_placement_revisions (
      id text PRIMARY KEY NOT NULL, userId text NOT NULL REFERENCES users(id),
      capability text NOT NULL, revision integer NOT NULL, placementKind text NOT NULL,
      nodeId text REFERENCES avermate_nodes(id), providerId text NOT NULL,
      durableData integer NOT NULL, consequencesJson text NOT NULL,
      migrationState text NOT NULL, createdAt integer NOT NULL,
      UNIQUE(userId, capability, revision)
    );
  `);
  now = new Date("2026-08-22T12:00:00.000Z");
  registry = new CoreNodeRegistry({
    client,
    vault: new NodeCredentialVault("registry-test-master-secret-".repeat(2)),
    clock: () => now,
  });
});

afterAll(() => {
  client.close();
});

function identity() {
  const keys = generateKeyPairSync("ed25519");
  const publicKeyDer = Buffer.from(
    keys.publicKey.export({ type: "spki", format: "der" }),
  ).toString("base64url");
  const derived = createHash("sha256")
    .update(Buffer.from(publicKeyDer, "base64url"))
    .digest("base64url")
    .slice(0, 32);
  return {
    nodeId: `node_${derived}`,
    keyId: `ed25519_${derived}`,
    publicKeyDer,
    signer: { keyId: `ed25519_${derived}`, privateKey: keys.privateKey },
  };
}

function registration(
  node: ReturnType<typeof identity>,
  input: { attemptId: string; code: string; features?: NodeCapabilityFeatures },
): NodePairingRegistration {
  const offer = {
    protocol: "avermate-node/2" as const,
    pairingAttemptId: input.attemptId,
    nodeId: node.nodeId,
    publicSigningKey: node.publicKeyDer,
    keyId: node.keyId,
    fingerprint: coreNodeFingerprint(node.publicKeyDer),
    codeHash: `sha256:${createHash("sha256").update(input.code).digest("hex")}` as const,
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  const unsignedManifest = {
    protocol: "avermate-node/2" as const,
    nodeId: node.nodeId,
    build: "test@sha256:fixture",
    configRevision: `sha256:${"a".repeat(64)}` as const,
    features: input.features ?? {
      storage: {
        version: 1 as const,
        maxObjectBytes: 1_000,
        multipart: false,
        directTransfer: false,
        encryptionModes: ["transport-tls" as const],
      },
      conversations: { version: 1 as const, search: true, maxBytes: 10_000 },
    },
    limits: {
      maxConcurrentJobs: 1,
      maxControlFrameBytes: 256 * 1024,
      maxStreamFrameBytes: 64 * 1024,
      maxBufferedStreamBytes: 2 * 1024 * 1024,
      storageQuotaBytes: 10_000,
      storageUsedBytes: 0,
    },
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    keyId: node.keyId,
  };
  const manifest = {
    ...unsignedManifest,
    signature: signProtocolValue(node.signer, unsignedManifest),
  };
  const unsignedProof = {
    protocol: "avermate-node/2" as const,
    pairingAttemptId: input.attemptId,
    nodeId: node.nodeId,
    keyId: node.keyId,
    offerDigest: protocolDigest(offer),
    manifestDigest: protocolDigest(manifest),
    nonce: randomNodeProofNonce(),
    issuedAt: now.toISOString(),
  };
  return {
    offer,
    manifest,
    proof: {
      ...unsignedProof,
      signature: signProtocolValue(node.signer, unsignedProof),
    },
  };
}

function deliveryProof(
  node: ReturnType<typeof identity>,
  input: {
    action: "deliver" | "ack";
    attemptId?: string;
    credentialIds?: string[];
  },
): NodeCredentialDeliveryProof {
  const unsigned = {
    protocol: "avermate-node/2" as const,
    action: input.action,
    nodeId: node.nodeId,
    ...(input.attemptId ? { pairingAttemptId: input.attemptId } : {}),
    credentialIds: input.credentialIds ?? [],
    nonce: randomNodeProofNonce(),
    issuedAt: now.toISOString(),
  };
  return { ...unsigned, signature: signProtocolValue(node.signer, unsigned) };
}

describe("CoreNodeRegistry pairing and credential lifecycle", () => {
  const node = identity();
  const attemptId = "pair-registry-1";
  const code = "ABCD-EFGH";
  let relayCredential = "";

  test("registers a signed offer idempotently and consumes its code once", async () => {
    const signed = registration(node, { attemptId, code });
    expect(await registry.registerPairing(signed)).toEqual({
      pairingAttemptId: attemptId,
      replayed: false,
    });
    expect(await registry.registerPairing(signed)).toEqual({
      pairingAttemptId: attemptId,
      replayed: true,
    });
    await expect(
      registry.claimPairing({ userId: "user-1", code: "WXYZ-2345" }),
    ).rejects.toThrow("NODE_PAIRING_CODE_INVALID");
    const claim = await registry.claimPairing({ userId: "user-1", code });
    expect(claim.fingerprint).toBe(coreNodeFingerprint(node.publicKeyDer));
    await expect(
      registry.claimPairing({ userId: "user-2", code }),
    ).rejects.toThrow("NODE_PAIRING_CODE_REPLAYED");
  });

  test("requires account, fingerprint and advertised capability confirmation", async () => {
    await expect(
      registry.confirmPairing({
        userId: "user-2",
        pairingAttemptId: attemptId,
        fingerprint: coreNodeFingerprint(node.publicKeyDer),
        capabilities: ["storage"],
      }),
    ).rejects.toThrow("NODE_PAIRING_ACCOUNT_MISMATCH");
    await expect(
      registry.confirmPairing({
        userId: "user-1",
        pairingAttemptId: attemptId,
        fingerprint: "A".repeat(32),
        capabilities: ["storage"],
      }),
    ).rejects.toThrow("NODE_PAIRING_FINGERPRINT_MISMATCH");
    await expect(
      registry.confirmPairing({
        userId: "user-1",
        pairingAttemptId: attemptId,
        fingerprint: coreNodeFingerprint(node.publicKeyDer),
        capabilities: ["models"],
      }),
    ).rejects.toThrow("NODE_PAIRING_CAPABILITY_NOT_ADVERTISED");
    const confirmation = await registry.confirmPairing({
      userId: "user-1",
      pairingAttemptId: attemptId,
      fingerprint: coreNodeFingerprint(node.publicKeyDer),
      capabilities: ["storage", "conversations"],
    });
    expect(confirmation.credentialsReady).toBe(true);
    expect(JSON.stringify(confirmation)).not.toContain("nc_");
  });

  test("delivers raw credentials only to a signed Node proof and clears them after ack", async () => {
    const delivered = await registry.deliverCredentials(
      deliveryProof(node, { action: "deliver", attemptId }),
    );
    expect(delivered.credentials).toHaveLength(2);
    relayCredential = delivered.credentials.find(
      (credential) => credential.kind === "relay",
    )!.credential;
    expect((await registry.listNodes("user-1"))[0]?.online).toBe(false);
    await registry.acknowledgeCredentials(
      deliveryProof(node, {
        action: "ack",
        attemptId,
        credentialIds: delivered.credentials.map((credential) => credential.id),
      }),
    );
    expect(
      (await registry.authenticateCredential("relay", relayCredential)).nodeId,
    ).toBe(node.nodeId);
    await expect(
      registry.deliverCredentials(
        deliveryProof(node, { action: "deliver", attemptId }),
      ),
    ).rejects.toThrow("NODE_CREDENTIAL_DELIVERY_EMPTY");
  });

  test("appends placement revisions, rotates with overlap, then revokes immediately", async () => {
    await registry.appendPlacement({
      userId: "user-1",
      capability: "storage",
      placementKind: "node",
      nodeId: node.nodeId,
      providerId: "node-storage-v1",
      durableData: true,
      consequences: {
        durableLocation: "paired-node",
        providerVisibility: "node-only",
        offlineBehavior: "unavailable-no-fallback",
        costBehavior: "operator-funded",
        migrationRequired: true,
      },
      migrationState: "planned",
    });
    expect((await registry.currentPlacements("user-1"))[0]?.revision).toBe(1);
    const rotated = await registry.rotateCredentials({
      userId: "user-1",
      nodeId: node.nodeId,
      overlapSeconds: 60,
    });
    expect(rotated.generation).toBe(2);
    expect(
      (await registry.authenticateCredential("relay", relayCredential)).generation,
    ).toBe(1);
    const next = await registry.deliverCredentials(
      deliveryProof(node, { action: "deliver" }),
    );
    expect(new Set(next.credentials.map((credential) => credential.generation))).toEqual(
      new Set([2]),
    );
    await registry.revokeNode({
      userId: "user-1",
      nodeId: node.nodeId,
      reason: "USER_REQUESTED",
    });
    await expect(
      registry.authenticateCredential("relay", relayCredential),
    ).rejects.toThrow("NODE_CREDENTIAL_INVALID");
  });
});
