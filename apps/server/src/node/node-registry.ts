import type { Client, Transaction } from "@libsql/client";
import type {
  NodeCapabilityId,
  NodeCapabilityManifestV2,
  NodeCredentialDelivery,
  NodeCredentialDeliveryProof,
  NodePairingRegistration,
} from "@avermate/agent-contracts";
import {
  nodeCapabilityIdSchema,
  nodeCapabilityManifestV2Schema,
  nodeCredentialDeliveryProofSchema,
  nodeCredentialDeliverySchema,
  nodePairingCodeSchema,
  nodePairingRegistrationSchema,
  unsignedNodeCredentialDeliveryProofSchema,
  unsignedNodePairingRegistrationProofSchema,
} from "@avermate/agent-contracts";
import { createHash, randomBytes } from "node:crypto";
import { newId } from "../lib/id";
import {
  protocolDigest,
  verifyProtocolValue,
} from "./protocol-crypto";
import { NodeCredentialVault } from "./node-credential-vault";

type Executor = Pick<Client, "execute"> | Pick<Transaction, "execute">;
type Row = Record<string, unknown>;

const FINGERPRINT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function iso(value: unknown) {
  return new Date(Number(value) * 1_000).toISOString();
}

function string(value: unknown, code = "NODE_REGISTRY_ROW_INVALID") {
  if (typeof value !== "string") throw new Error(code);
  return value;
}

function number(value: unknown, code = "NODE_REGISTRY_ROW_INVALID") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(code);
  return parsed;
}

function json<T>(value: unknown): T {
  return JSON.parse(string(value)) as T;
}

function rawSha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

function base32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += FINGERPRINT_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += FINGERPRINT_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function coreNodeFingerprint(publicKeyDer: string) {
  return base32(
    createHash("sha256")
      .update(Buffer.from(publicKeyDer, "base64url"))
      .digest(),
  ).slice(0, 32);
}

function verifyManifest(
  manifest: NodeCapabilityManifestV2,
  publicKeyDer: string,
  now: number,
) {
  const parsed = nodeCapabilityManifestV2Schema.parse(manifest);
  const { signature, ...unsigned } = parsed;
  if (
    Date.parse(parsed.issuedAt) > now + 30_000 ||
    Date.parse(parsed.expiresAt) <= now ||
    !verifyProtocolValue(publicKeyDer, unsigned, signature)
  ) {
    throw new Error("NODE_MANIFEST_SIGNATURE_INVALID");
  }
  return parsed;
}

async function lifecycle(
  executor: Executor,
  input: {
    nodeId: string;
    userId?: string | null;
    eventType: string;
    safeMetadata?: Record<string, string | number | boolean | null>;
    now: Date;
  },
) {
  await executor.execute({
    sql: `INSERT INTO node_lifecycle_events
      (id, nodeId, userId, eventType, safeMetadataJson, occurredAt)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      newId("nlife"),
      input.nodeId,
      input.userId ?? null,
      input.eventType,
      JSON.stringify(input.safeMetadata ?? {}),
      seconds(input.now),
    ],
  });
}

function advertisedCapabilities(manifest: NodeCapabilityManifestV2) {
  const capabilities: NodeCapabilityId[] = [];
  const mapping: Array<[keyof typeof manifest.features, NodeCapabilityId]> = [
    ["storage", "storage"],
    ["conversations", "conversations"],
    ["retrieval", "retrieval"],
    ["models", "models"],
    ["jobs", "jobs"],
    ["sandbox", "sandbox"],
    ["renderers", "renderers"],
    ["schoolConnectors", "school-connectors"],
  ];
  for (const [feature, capability] of mapping) {
    if (manifest.features[feature] !== undefined) capabilities.push(capability);
  }
  return capabilities;
}

function credentialContext(input: {
  nodeId: string;
  kind: "relay" | "capability";
  generation: number;
}) {
  return `${input.nodeId}:${input.kind}:${input.generation}`;
}

export type NodeStatus = {
  nodeId: string;
  state: string;
  fingerprint: string;
  protocolMajor: number;
  configRevision: string | null;
  capabilities: NodeCapabilityId[];
  online: boolean;
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
};

export type AuthenticatedNodeCredential = {
  credentialId: string;
  nodeId: string;
  userId: string;
  kind: "relay" | "capability";
  generation: number;
  expiresAt: string;
};

export type NodeConnectionState = {
  nodeId: string;
  userId: string;
  connectionEpoch: number;
  credentialGeneration: number;
  configRevision: string;
  manifest: NodeCapabilityManifestV2;
  confirmedCapabilities: NodeCapabilityId[];
};

export class CoreNodeRegistry {
  readonly #client: Client;
  readonly #vault: NodeCredentialVault;
  readonly #clock: () => Date;
  readonly #grantSigningKey?: {
    keyId: string;
    publicSigningKey: string;
  };

  constructor(input: {
    client: Client;
    vault: NodeCredentialVault;
    grantSigningKey?: { keyId: string; publicSigningKey: string };
    clock?: () => Date;
  }) {
    this.#client = input.client;
    this.#vault = input.vault;
    this.#grantSigningKey = input.grantSigningKey;
    this.#clock = input.clock ?? (() => new Date());
  }

  async registerPairing(
    raw: NodePairingRegistration,
    now = this.#clock(),
  ) {
    const registration = nodePairingRegistrationSchema.parse(raw);
    const { offer, proof } = registration;
    const manifest = verifyManifest(
      registration.manifest,
      offer.publicSigningKey,
      now.getTime(),
    );
    if (
      offer.nodeId !== manifest.nodeId ||
      offer.keyId !== manifest.keyId ||
      offer.fingerprint !== coreNodeFingerprint(offer.publicSigningKey) ||
      Date.parse(offer.expiresAt) <= now.getTime()
    ) {
      throw new Error("NODE_PAIRING_OFFER_BINDING_INVALID");
    }
    const offerDigest = protocolDigest(offer);
    const manifestDigest = protocolDigest(manifest);
    const { signature, ...unsignedProof } = proof;
    unsignedNodePairingRegistrationProofSchema.parse(unsignedProof);
    if (
      proof.nodeId !== offer.nodeId ||
      proof.keyId !== offer.keyId ||
      proof.pairingAttemptId !== offer.pairingAttemptId ||
      proof.offerDigest !== offerDigest ||
      proof.manifestDigest !== manifestDigest ||
      Math.abs(Date.parse(proof.issuedAt) - now.getTime()) > 30_000 ||
      !verifyProtocolValue(offer.publicSigningKey, unsignedProof, signature)
    ) {
      throw new Error("NODE_PAIRING_REGISTRATION_PROOF_INVALID");
    }
    const proofDigest = protocolDigest(proof);
    const transaction = await this.#client.transaction("write");
    try {
      const replay = await transaction.execute({
        sql: `SELECT registrationProofDigest FROM node_pairing_attempts
          WHERE id = ? LIMIT 1`,
        args: [offer.pairingAttemptId],
      });
      if (replay.rows[0]) {
        if (string(replay.rows[0].registrationProofDigest) !== proofDigest) {
          throw new Error("NODE_PAIRING_ATTEMPT_COLLISION");
        }
        await transaction.commit();
        return { pairingAttemptId: offer.pairingAttemptId, replayed: true };
      }
      const existing = await transaction.execute({
        sql: "SELECT * FROM avermate_nodes WHERE id = ? LIMIT 1",
        args: [offer.nodeId],
      });
      const node = existing.rows[0] as Row | undefined;
      if (
        node &&
        (string(node.publicSigningKey) !== offer.publicSigningKey ||
          string(node.keyId) !== offer.keyId ||
          string(node.fingerprint) !== offer.fingerprint)
      ) {
        throw new Error("NODE_IDENTITY_COLLISION");
      }
      if (node && string(node.state) === "revoked") {
        throw new Error("NODE_IDENTITY_REVOKED");
      }
      if (!node) {
        await transaction.execute({
          sql: `INSERT INTO avermate_nodes
            (id, protocolMajor, publicSigningKey, keyId, fingerprint, state,
             revokedAt, createdAt, updatedAt)
            VALUES (?, 2, ?, ?, ?, 'pairing', NULL, ?, ?)`,
          args: [
            offer.nodeId,
            offer.publicSigningKey,
            offer.keyId,
            offer.fingerprint,
            seconds(now),
            seconds(now),
          ],
        });
      }
      await transaction.execute({
        sql: `INSERT INTO node_pairing_attempts
          (id, nodeId, codeHash, offerJson, registrationProofDigest,
           manifestDigest, state, expiresAt, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, 'offered', ?, ?, ?)`,
        args: [
          offer.pairingAttemptId,
          offer.nodeId,
          offer.codeHash,
          JSON.stringify(offer),
          proofDigest,
          manifestDigest,
          seconds(new Date(offer.expiresAt)),
          seconds(now),
          seconds(now),
        ],
      });
      await transaction.execute({
        sql: `INSERT INTO node_capability_manifests
          (id, nodeId, configRevision, manifestDigest, manifestJson, issuedAt,
           expiresAt, verifiedAt, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          newId("nman"),
          offer.nodeId,
          manifest.configRevision,
          manifestDigest,
          JSON.stringify(manifest),
          seconds(new Date(manifest.issuedAt)),
          seconds(new Date(manifest.expiresAt)),
          seconds(now),
          seconds(now),
        ],
      });
      await transaction.execute({
        sql: `INSERT INTO node_proof_nonces
          (nodeId, nonce, action, issuedAt, acceptedAt)
          VALUES (?, ?, 'pairing-register', ?, ?)`,
        args: [
          offer.nodeId,
          proof.nonce,
          seconds(new Date(proof.issuedAt)),
          seconds(now),
        ],
      });
      await lifecycle(transaction, {
        nodeId: offer.nodeId,
        eventType: "pairing-offered",
        safeMetadata: {
          pairingAttemptId: offer.pairingAttemptId,
          manifestDigest,
        },
        now,
      });
      await transaction.commit();
      return { pairingAttemptId: offer.pairingAttemptId, replayed: false };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async claimPairing(input: { userId: string; code: string }, now = this.#clock()) {
    const code = nodePairingCodeSchema.parse(input.code);
    const codeHash = rawSha256(code);
    const transaction = await this.#client.transaction("write");
    try {
      const result = await transaction.execute({
        sql: `SELECT p.*, n.fingerprint, m.manifestJson
          FROM node_pairing_attempts p
          JOIN avermate_nodes n ON n.id = p.nodeId
          JOIN node_capability_manifests m
            ON m.nodeId = p.nodeId AND m.manifestDigest = p.manifestDigest
          WHERE p.codeHash = ? LIMIT 1`,
        args: [codeHash],
      });
      const row = result.rows[0] as Row | undefined;
      if (!row) throw new Error("NODE_PAIRING_CODE_INVALID");
      if (number(row.expiresAt) <= seconds(now)) {
        await transaction.execute({
          sql: `UPDATE node_pairing_attempts SET state = 'expired', updatedAt = ?
            WHERE id = ? AND state = 'offered'`,
          args: [seconds(now), string(row.id)],
        });
        throw new Error("NODE_PAIRING_CODE_EXPIRED");
      }
      if (string(row.state) !== "offered") {
        throw new Error("NODE_PAIRING_CODE_REPLAYED");
      }
      const claimed = await transaction.execute({
        sql: `UPDATE node_pairing_attempts
          SET state = 'claimed', claimedUserId = ?, claimedAt = ?, updatedAt = ?
          WHERE id = ? AND state = 'offered'`,
        args: [input.userId, seconds(now), seconds(now), string(row.id)],
      });
      if (claimed.rowsAffected !== 1) throw new Error("NODE_PAIRING_CODE_REPLAYED");
      await lifecycle(transaction, {
        nodeId: string(row.nodeId),
        userId: input.userId,
        eventType: "pairing-claimed",
        safeMetadata: { pairingAttemptId: string(row.id) },
        now,
      });
      await transaction.commit();
      const manifest = nodeCapabilityManifestV2Schema.parse(
        json(row.manifestJson),
      );
      return {
        pairingAttemptId: string(row.id),
        nodeId: string(row.nodeId),
        fingerprint: string(row.fingerprint),
        expiresAt: iso(row.expiresAt),
        protocolMajor: 2 as const,
        build: manifest.build,
        configRevision: manifest.configRevision,
        capabilities: advertisedCapabilities(manifest),
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async confirmPairing(
    input: {
      userId: string;
      pairingAttemptId: string;
      fingerprint: string;
      capabilities: NodeCapabilityId[];
    },
    now = this.#clock(),
  ) {
    const requested = [...new Set(input.capabilities.map((capability) =>
      nodeCapabilityIdSchema.parse(capability),
    ))].sort();
    if (requested.length === 0) {
      throw new Error("NODE_PAIRING_CAPABILITY_CONFIRMATION_REQUIRED");
    }
    const transaction = await this.#client.transaction("write");
    try {
      const result = await transaction.execute({
        sql: `SELECT p.*, n.fingerprint, n.state AS nodeState, m.manifestJson
          FROM node_pairing_attempts p
          JOIN avermate_nodes n ON n.id = p.nodeId
          JOIN node_capability_manifests m
            ON m.nodeId = p.nodeId AND m.manifestDigest = p.manifestDigest
          WHERE p.id = ? LIMIT 1`,
        args: [input.pairingAttemptId],
      });
      const row = result.rows[0] as Row | undefined;
      if (!row) throw new Error("NODE_PAIRING_ATTEMPT_NOT_FOUND");
      if (
        string(row.state) !== "claimed" ||
        string(row.claimedUserId) !== input.userId
      ) {
        throw new Error("NODE_PAIRING_ACCOUNT_MISMATCH");
      }
      if (number(row.expiresAt) <= seconds(now)) {
        throw new Error("NODE_PAIRING_CODE_EXPIRED");
      }
      if (string(row.fingerprint) !== input.fingerprint) {
        throw new Error("NODE_PAIRING_FINGERPRINT_MISMATCH");
      }
      const manifest = nodeCapabilityManifestV2Schema.parse(
        json(row.manifestJson),
      );
      const advertised = advertisedCapabilities(manifest);
      if (requested.some((capability) => !advertised.includes(capability))) {
        throw new Error("NODE_PAIRING_CAPABILITY_NOT_ADVERTISED");
      }
      await transaction.execute({
        sql: `INSERT INTO node_account_bindings
          (id, nodeId, userId, pairingAttemptId, state, createdAt)
          VALUES (?, ?, ?, ?, 'active', ?)`,
        args: [
          newId("nbind"),
          string(row.nodeId),
          input.userId,
          input.pairingAttemptId,
          seconds(now),
        ],
      });
      const credentials = await this.#insertCredentialPair(transaction, {
        nodeId: string(row.nodeId),
        userId: input.userId,
        generation: 1,
        now,
      });
      await transaction.execute({
        sql: `UPDATE node_pairing_attempts SET state = 'credentials-ready',
          confirmedCapabilitiesJson = ?, confirmedAt = ?, updatedAt = ?
          WHERE id = ? AND state = 'claimed'`,
        args: [
          JSON.stringify(requested),
          seconds(now),
          seconds(now),
          input.pairingAttemptId,
        ],
      });
      await lifecycle(transaction, {
        nodeId: string(row.nodeId),
        userId: input.userId,
        eventType: "pairing-confirmed",
        safeMetadata: {
          pairingAttemptId: input.pairingAttemptId,
          relayGeneration: credentials.relay.generation,
          capabilityGeneration: credentials.capability.generation,
        },
        now,
      });
      await transaction.commit();
      return {
        nodeId: string(row.nodeId),
        fingerprint: string(row.fingerprint),
        capabilities: requested,
        credentialExpiresAt: credentials.relay.expiresAt,
        credentialsReady: true,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async deliverCredentials(
    rawProof: NodeCredentialDeliveryProof,
    now = this.#clock(),
  ): Promise<NodeCredentialDelivery> {
    const proof = nodeCredentialDeliveryProofSchema.parse(rawProof);
    if (proof.action !== "deliver") throw new Error("NODE_DELIVERY_ACTION_INVALID");
    await this.#verifyNodeProof(proof, now);
    const transaction = await this.#client.transaction("write");
    try {
      await this.#acceptProofNonce(transaction, proof, now);
      const binding = await transaction.execute({
        sql: `SELECT b.userId, n.state FROM node_account_bindings b
          JOIN avermate_nodes n ON n.id = b.nodeId
          WHERE b.nodeId = ? AND b.state = 'active' LIMIT 1`,
        args: [proof.nodeId],
      });
      const bound = binding.rows[0] as Row | undefined;
      if (!bound || string(bound.state) === "revoked") {
        throw new Error("NODE_BINDING_NOT_ACTIVE");
      }
      if (proof.pairingAttemptId) {
        const pairing = await transaction.execute({
          sql: `SELECT claimedUserId, state FROM node_pairing_attempts
            WHERE id = ? AND nodeId = ? LIMIT 1`,
          args: [proof.pairingAttemptId, proof.nodeId],
        });
        const row = pairing.rows[0] as Row | undefined;
        if (
          !row ||
          string(row.claimedUserId) !== string(bound.userId) ||
          !["credentials-ready", "consumed"].includes(string(row.state))
        ) {
          throw new Error("NODE_DELIVERY_PAIRING_MISMATCH");
        }
      }
      const result = await transaction.execute({
        sql: `SELECT * FROM node_credential_generations
          WHERE nodeId = ? AND userId = ? AND revokedAt IS NULL
            AND expiresAt > ? AND sealedCredential IS NOT NULL
          ORDER BY generation ASC, kind ASC LIMIT 8`,
        args: [proof.nodeId, string(bound.userId), seconds(now)],
      });
      if (result.rows.length === 0) {
        throw new Error("NODE_CREDENTIAL_DELIVERY_EMPTY");
      }
      const credentials = result.rows.map((candidate) => {
        const row = candidate as Row;
        const kind = string(row.kind) as "relay" | "capability";
        const generation = number(row.generation);
        const credential = this.#vault.open(
          string(row.sealedCredential),
          credentialContext({ nodeId: proof.nodeId, kind, generation }),
        );
        return {
          id: string(row.id),
          kind,
          generation,
          credential,
          activeFrom: iso(row.activeFrom),
          expiresAt: iso(row.expiresAt),
          overlapUntil:
            row.overlapUntil === null ? null : iso(row.overlapUntil),
        };
      });
      await transaction.execute({
        sql: `UPDATE node_credential_generations SET deliveredAt = ?
          WHERE nodeId = ? AND sealedCredential IS NOT NULL AND revokedAt IS NULL`,
        args: [seconds(now), proof.nodeId],
      });
      await lifecycle(transaction, {
        nodeId: proof.nodeId,
        userId: string(bound.userId),
        eventType: "credentials-delivered",
        safeMetadata: { count: credentials.length },
        now,
      });
      await transaction.commit();
      return nodeCredentialDeliverySchema.parse({
        nodeId: proof.nodeId,
        ...(this.#grantSigningKey
          ? { coreGrantSigningKey: this.#grantSigningKey }
          : {}),
        credentials,
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async acknowledgeCredentials(
    rawProof: NodeCredentialDeliveryProof,
    now = this.#clock(),
  ) {
    const proof = nodeCredentialDeliveryProofSchema.parse(rawProof);
    if (proof.action !== "ack" || proof.credentialIds.length === 0) {
      throw new Error("NODE_DELIVERY_ACK_INVALID");
    }
    await this.#verifyNodeProof(proof, now);
    const transaction = await this.#client.transaction("write");
    try {
      await this.#acceptProofNonce(transaction, proof, now);
      const placeholders = proof.credentialIds.map(() => "?").join(",");
      const result = await transaction.execute({
        sql: `UPDATE node_credential_generations SET sealedCredential = NULL
          WHERE nodeId = ? AND deliveredAt IS NOT NULL AND id IN (${placeholders})`,
        args: [proof.nodeId, ...proof.credentialIds],
      });
      if (Number(result.rowsAffected) !== proof.credentialIds.length) {
        throw new Error("NODE_DELIVERY_ACK_MISMATCH");
      }
      if (proof.pairingAttemptId) {
        await transaction.execute({
          sql: `UPDATE node_pairing_attempts SET state = 'consumed', consumedAt = ?,
            updatedAt = ? WHERE id = ? AND nodeId = ?
            AND state = 'credentials-ready'`,
          args: [
            seconds(now),
            seconds(now),
            proof.pairingAttemptId,
            proof.nodeId,
          ],
        });
      }
      await transaction.execute({
        sql: `UPDATE avermate_nodes SET state = 'offline', updatedAt = ?
          WHERE id = ? AND state <> 'revoked'`,
        args: [seconds(now), proof.nodeId],
      });
      await lifecycle(transaction, {
        nodeId: proof.nodeId,
        eventType: "credentials-acknowledged",
        safeMetadata: { count: proof.credentialIds.length },
        now,
      });
      await transaction.commit();
      return { acknowledged: proof.credentialIds.length };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async authenticateCredential(
    kind: "relay" | "capability",
    credential: string,
    now = this.#clock(),
  ): Promise<AuthenticatedNodeCredential> {
    const hash = this.#vault.hash(credential);
    const result = await this.#client.execute({
      sql: `SELECT c.*, n.state AS nodeState, b.state AS bindingState
        FROM node_credential_generations c
        JOIN avermate_nodes n ON n.id = c.nodeId
        JOIN node_account_bindings b
          ON b.nodeId = c.nodeId AND b.userId = c.userId
        WHERE c.kind = ? AND c.credentialHash = ? AND c.activeFrom <= ?
          AND c.expiresAt > ? AND c.revokedAt IS NULL
          AND (c.overlapUntil IS NULL OR c.overlapUntil > ?)
          AND n.state <> 'revoked' AND b.state = 'active'
        LIMIT 1`,
      args: [kind, hash, seconds(now), seconds(now), seconds(now)],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row || !this.#vault.matches(credential, string(row.credentialHash))) {
      throw new Error("NODE_CREDENTIAL_INVALID");
    }
    return {
      credentialId: string(row.id),
      nodeId: string(row.nodeId),
      userId: string(row.userId),
      kind,
      generation: number(row.generation),
      expiresAt: iso(row.expiresAt),
    };
  }

  /**
   * Installs a signed, fresh manifest and creates the next durable connection
   * epoch. The transaction fences any older primary before the replacement can
   * become routable, so two relay processes cannot both remain authoritative.
   */
  async beginConnection(
    input: {
      credential: AuthenticatedNodeCredential;
      manifest: NodeCapabilityManifestV2;
    },
    now = this.#clock(),
  ): Promise<NodeConnectionState> {
    if (input.credential.kind !== "relay") {
      throw new Error("NODE_RELAY_CREDENTIAL_REQUIRED");
    }
    if (input.credential.nodeId !== input.manifest.nodeId) {
      throw new Error("NODE_RELAY_IDENTITY_MISMATCH");
    }
    const transaction = await this.#client.transaction("write");
    try {
      const identityResult = await transaction.execute({
        sql: `SELECT n.publicSigningKey, n.state, b.userId,
            p.confirmedCapabilitiesJson
          FROM avermate_nodes n
          JOIN node_account_bindings b
            ON b.nodeId = n.id AND b.state = 'active'
          JOIN node_pairing_attempts p ON p.id = b.pairingAttemptId
          WHERE n.id = ? AND b.userId = ? LIMIT 1`,
        args: [input.credential.nodeId, input.credential.userId],
      });
      const identity = identityResult.rows[0] as Row | undefined;
      if (!identity || string(identity.state) === "revoked") {
        throw new Error("NODE_BINDING_NOT_ACTIVE");
      }
      const manifest = verifyManifest(
        input.manifest,
        string(identity.publicSigningKey),
        now.getTime(),
      );
      const confirmedCapabilities = (
        identity.confirmedCapabilitiesJson === null
          ? []
          : json<unknown[]>(identity.confirmedCapabilitiesJson)
      ).map((capability) => nodeCapabilityIdSchema.parse(capability));
      const manifestDigest = protocolDigest(manifest);
      await transaction.execute({
        sql: `INSERT INTO node_capability_manifests
          (id, nodeId, configRevision, manifestDigest, manifestJson, issuedAt,
           expiresAt, verifiedAt, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(nodeId, manifestDigest) DO UPDATE SET
            verifiedAt = excluded.verifiedAt`,
        args: [
          newId("nman"),
          manifest.nodeId,
          manifest.configRevision,
          manifestDigest,
          JSON.stringify(manifest),
          seconds(new Date(manifest.issuedAt)),
          seconds(new Date(manifest.expiresAt)),
          seconds(now),
          seconds(now),
        ],
      });
      const previous = await transaction.execute({
        sql: `UPDATE node_connection_epochs SET state = 'fenced',
          disconnectedAt = ?, safeCloseCode = 'REPLACED_BY_NEW_EPOCH'
          WHERE nodeId = ? AND state = 'connected'`,
        args: [seconds(now), manifest.nodeId],
      });
      const epochResult = await transaction.execute({
        sql: `SELECT COALESCE(MAX(epoch), 0) AS epoch
          FROM node_connection_epochs WHERE nodeId = ?`,
        args: [manifest.nodeId],
      });
      const connectionEpoch = number(epochResult.rows[0]?.epoch) + 1;
      await transaction.execute({
        sql: `INSERT INTO node_connection_epochs
          (id, nodeId, epoch, relayCredentialGeneration, manifestDigest,
           state, connectedAt, lastHeartbeatAt)
          VALUES (?, ?, ?, ?, ?, 'connected', ?, ?)`,
        args: [
          newId("nepoch"),
          manifest.nodeId,
          connectionEpoch,
          input.credential.generation,
          manifestDigest,
          seconds(now),
          seconds(now),
        ],
      });
      await transaction.execute({
        sql: `UPDATE avermate_nodes SET state = 'active', updatedAt = ?
          WHERE id = ? AND state <> 'revoked'`,
        args: [seconds(now), manifest.nodeId],
      });
      await lifecycle(transaction, {
        nodeId: manifest.nodeId,
        userId: input.credential.userId,
        eventType: "relay-connected",
        safeMetadata: {
          connectionEpoch,
          credentialGeneration: input.credential.generation,
          configRevision: manifest.configRevision,
          replacedPrimary: Number(previous.rowsAffected) > 0,
        },
        now,
      });
      await transaction.commit();
      return {
        nodeId: manifest.nodeId,
        userId: input.credential.userId,
        connectionEpoch,
        credentialGeneration: input.credential.generation,
        configRevision: manifest.configRevision,
        manifest,
        confirmedCapabilities: [...new Set(confirmedCapabilities)].sort(),
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async heartbeatConnection(
    input: { nodeId: string; connectionEpoch: number },
    now = this.#clock(),
  ) {
    const result = await this.#client.execute({
      sql: `UPDATE node_connection_epochs SET lastHeartbeatAt = ?
        WHERE nodeId = ? AND epoch = ? AND state = 'connected'`,
      args: [seconds(now), input.nodeId, input.connectionEpoch],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new Error("NODE_CONNECTION_EPOCH_FENCED");
    }
    return { receivedAt: now.toISOString() };
  }

  async disconnectConnection(
    input: {
      nodeId: string;
      connectionEpoch: number;
      safeCloseCode: string;
    },
    now = this.#clock(),
  ) {
    const closeCode = /^[A-Z0-9_:-]{3,128}$/u.test(input.safeCloseCode)
      ? input.safeCloseCode
      : "NODE_RELAY_DISCONNECTED";
    const transaction = await this.#client.transaction("write");
    try {
      const result = await transaction.execute({
        sql: `UPDATE node_connection_epochs SET state = 'disconnected',
          disconnectedAt = ?, safeCloseCode = ?
          WHERE nodeId = ? AND epoch = ? AND state = 'connected'`,
        args: [
          seconds(now),
          closeCode,
          input.nodeId,
          input.connectionEpoch,
        ],
      });
      if (Number(result.rowsAffected) === 1) {
        await transaction.execute({
          sql: `UPDATE avermate_nodes SET state = 'offline', updatedAt = ?
            WHERE id = ? AND state <> 'revoked'
              AND NOT EXISTS (
                SELECT 1 FROM node_connection_epochs
                WHERE nodeId = ? AND state = 'connected'
              )`,
          args: [seconds(now), input.nodeId, input.nodeId],
        });
        await lifecycle(transaction, {
          nodeId: input.nodeId,
          eventType: "relay-disconnected",
          safeMetadata: {
            connectionEpoch: input.connectionEpoch,
            safeCloseCode: closeCode,
          },
          now,
        });
      }
      await transaction.commit();
      return { disconnected: Number(result.rowsAffected) === 1 };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async assertCapabilityReady(input: {
    nodeId: string;
    userId: string;
    capability: NodeCapabilityId;
    configRevision: string;
    connectionEpoch?: number;
  }) {
    const capability = nodeCapabilityIdSchema.parse(input.capability);
    const result = await this.#client.execute({
      sql: `SELECT p.confirmedCapabilitiesJson, m.manifestJson,
          e.epoch, e.lastHeartbeatAt
        FROM node_account_bindings b
        JOIN avermate_nodes n ON n.id = b.nodeId
        JOIN node_pairing_attempts p ON p.id = b.pairingAttemptId
        JOIN node_connection_epochs e
          ON e.nodeId = b.nodeId AND e.state = 'connected'
        JOIN node_capability_manifests m
          ON m.nodeId = b.nodeId AND m.manifestDigest = e.manifestDigest
        WHERE b.nodeId = ? AND b.userId = ? AND b.state = 'active'
          AND n.state = 'active' LIMIT 1`,
      args: [input.nodeId, input.userId],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new Error("NODE_CAPABILITY_OFFLINE");
    if (
      input.connectionEpoch !== undefined &&
      number(row.epoch) !== input.connectionEpoch
    ) {
      throw new Error("NODE_CONNECTION_EPOCH_FENCED");
    }
    const confirmed = json<unknown[]>(row.confirmedCapabilitiesJson).map(
      (candidate) => nodeCapabilityIdSchema.parse(candidate),
    );
    if (!confirmed.includes(capability)) {
      throw new Error("NODE_CAPABILITY_NOT_CONFIRMED");
    }
    const manifest = nodeCapabilityManifestV2Schema.parse(json(row.manifestJson));
    if (
      manifest.configRevision !== input.configRevision ||
      !advertisedCapabilities(manifest).includes(capability)
    ) {
      throw new Error("NODE_CAPABILITY_MANIFEST_MISMATCH");
    }
    return {
      connectionEpoch: number(row.epoch),
      manifest,
      lastHeartbeatAt: iso(row.lastHeartbeatAt),
    };
  }

  async rotateCredentials(
    input: { userId: string; nodeId: string; overlapSeconds?: number },
    now = this.#clock(),
  ) {
    const overlapSeconds = input.overlapSeconds ?? 300;
    if (overlapSeconds < 30 || overlapSeconds > 3_600) {
      throw new Error("NODE_CREDENTIAL_OVERLAP_INVALID");
    }
    const transaction = await this.#client.transaction("write");
    try {
      await this.#assertBinding(transaction, input.nodeId, input.userId);
      const generationResult = await transaction.execute({
        sql: `SELECT COALESCE(MAX(generation), 0) AS generation
          FROM node_credential_generations WHERE nodeId = ?`,
        args: [input.nodeId],
      });
      const generation = number(generationResult.rows[0]?.generation) + 1;
      await transaction.execute({
        sql: `UPDATE node_credential_generations SET overlapUntil = ?
          WHERE nodeId = ? AND revokedAt IS NULL AND expiresAt > ?
            AND overlapUntil IS NULL`,
        args: [
          seconds(new Date(now.getTime() + overlapSeconds * 1_000)),
          input.nodeId,
          seconds(now),
        ],
      });
      const credentials = await this.#insertCredentialPair(transaction, {
        nodeId: input.nodeId,
        userId: input.userId,
        generation,
        now,
      });
      await lifecycle(transaction, {
        ...input,
        eventType: "credentials-rotated",
        safeMetadata: { generation, overlapSeconds },
        now,
      });
      await transaction.commit();
      return {
        nodeId: input.nodeId,
        generation,
        expiresAt: credentials.relay.expiresAt,
        deliveryPending: true,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async revokeNode(
    input: { userId: string; nodeId: string; reason: string },
    now = this.#clock(),
  ) {
    if (!/^[A-Z0-9_:-]{3,128}$/u.test(input.reason)) {
      throw new Error("NODE_REVOCATION_REASON_INVALID");
    }
    const transaction = await this.#client.transaction("write");
    try {
      await this.#assertBinding(transaction, input.nodeId, input.userId);
      await transaction.execute({
        sql: `UPDATE node_account_bindings SET state = 'revoked', revokedAt = ?
          WHERE nodeId = ? AND userId = ? AND state = 'active'`,
        args: [seconds(now), input.nodeId, input.userId],
      });
      await transaction.execute({
        sql: `UPDATE node_credential_generations SET revokedAt = ?,
          sealedCredential = NULL WHERE nodeId = ? AND revokedAt IS NULL`,
        args: [seconds(now), input.nodeId],
      });
      await transaction.execute({
        sql: `UPDATE node_connection_epochs SET state = 'fenced',
          disconnectedAt = ?, safeCloseCode = ?
          WHERE nodeId = ? AND state = 'connected'`,
        args: [seconds(now), input.reason, input.nodeId],
      });
      await transaction.execute({
        sql: `UPDATE avermate_nodes SET state = 'revoked', revokedAt = ?,
          updatedAt = ? WHERE id = ?`,
        args: [seconds(now), seconds(now), input.nodeId],
      });
      await lifecycle(transaction, {
        nodeId: input.nodeId,
        userId: input.userId,
        eventType: "node-revoked",
        safeMetadata: { reason: input.reason },
        now,
      });
      await transaction.commit();
      return { nodeId: input.nodeId, revoked: true };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async listNodes(userId: string, now = this.#clock()): Promise<NodeStatus[]> {
    const result = await this.#client.execute({
      sql: `SELECT n.*, m.manifestJson, m.configRevision,
          e.lastHeartbeatAt, e.state AS connectionState,
          p.confirmedCapabilitiesJson
        FROM node_account_bindings b
        JOIN avermate_nodes n ON n.id = b.nodeId
        JOIN node_pairing_attempts p ON p.id = b.pairingAttemptId
        LEFT JOIN node_capability_manifests m ON m.id = (
          SELECT m2.id FROM node_capability_manifests m2
          WHERE m2.nodeId = n.id ORDER BY m2.verifiedAt DESC LIMIT 1
        )
        LEFT JOIN node_connection_epochs e ON e.id = (
          SELECT e2.id FROM node_connection_epochs e2
          WHERE e2.nodeId = n.id ORDER BY e2.epoch DESC LIMIT 1
        )
        WHERE b.userId = ? AND b.state IN ('active', 'revoked')
        ORDER BY n.createdAt ASC`,
      args: [userId],
    });
    return result.rows.map((candidate) => {
      const row = candidate as Row;
      const manifest = row.manifestJson
        ? nodeCapabilityManifestV2Schema.parse(json(row.manifestJson))
        : null;
      const confirmed = row.confirmedCapabilitiesJson
        ? json<unknown[]>(row.confirmedCapabilitiesJson).map((capability) =>
            nodeCapabilityIdSchema.parse(capability),
          )
        : [];
      const heartbeat =
        row.lastHeartbeatAt === null ? null : number(row.lastHeartbeatAt);
      return {
        nodeId: string(row.id),
        state: string(row.state),
        fingerprint: string(row.fingerprint),
        protocolMajor: number(row.protocolMajor),
        configRevision:
          row.configRevision === null ? null : string(row.configRevision),
        capabilities: manifest
          ? advertisedCapabilities(manifest).filter((capability) =>
              confirmed.includes(capability),
            )
          : [],
        online:
          row.connectionState === "connected" &&
          heartbeat !== null &&
          heartbeat > seconds(now) - 90,
        lastHeartbeatAt: heartbeat === null ? null : iso(heartbeat),
        revokedAt: row.revokedAt === null ? null : iso(row.revokedAt),
      };
    });
  }

  async appendPlacement(input: {
    userId: string;
    capability: NodeCapabilityId;
    placementKind: "core" | "node" | "managed" | "byok";
    nodeId?: string;
    providerId: string;
    durableData: boolean;
    consequences: {
      durableLocation: string;
      providerVisibility: string;
      offlineBehavior: string;
      costBehavior: string;
      migrationRequired: boolean;
    };
    migrationState: "not-required" | "planned" | "running" | "verified" | "failed";
  }, now = this.#clock()) {
    const capability = nodeCapabilityIdSchema.parse(input.capability);
    if ((input.placementKind === "node") !== Boolean(input.nodeId)) {
      throw new Error("NODE_PLACEMENT_NODE_BINDING_INVALID");
    }
    const transaction = await this.#client.transaction("write");
    try {
      if (input.nodeId) {
        await this.#assertBinding(transaction, input.nodeId, input.userId);
      }
      const latest = await transaction.execute({
        sql: `SELECT COALESCE(MAX(revision), 0) AS revision
          FROM node_capability_placement_revisions
          WHERE userId = ? AND capability = ?`,
        args: [input.userId, capability],
      });
      const revision = number(latest.rows[0]?.revision) + 1;
      const id = newId("nplace");
      await transaction.execute({
        sql: `INSERT INTO node_capability_placement_revisions
          (id, userId, capability, revision, placementKind, nodeId,
           providerId, durableData, consequencesJson, migrationState, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.userId,
          capability,
          revision,
          input.placementKind,
          input.nodeId ?? null,
          input.providerId,
          input.durableData ? 1 : 0,
          JSON.stringify(input.consequences),
          input.migrationState,
          seconds(now),
        ],
      });
      if (input.nodeId) {
        await lifecycle(transaction, {
          nodeId: input.nodeId,
          userId: input.userId,
          eventType: "placement-revised",
          safeMetadata: { capability, revision },
          now,
        });
      }
      await transaction.commit();
      return { ...input, id, capability, revision };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async currentPlacements(userId: string) {
    const result = await this.#client.execute({
      sql: `SELECT p.* FROM node_capability_placement_revisions p
        WHERE p.userId = ? AND p.revision = (
          SELECT MAX(p2.revision) FROM node_capability_placement_revisions p2
          WHERE p2.userId = p.userId AND p2.capability = p.capability
        ) ORDER BY p.capability ASC`,
      args: [userId],
    });
    return result.rows.map((candidate) => {
      const row = candidate as Row;
      return {
        id: string(row.id),
        capability: nodeCapabilityIdSchema.parse(row.capability),
        revision: number(row.revision),
        placementKind: string(row.placementKind),
        nodeId: row.nodeId === null ? null : string(row.nodeId),
        providerId: string(row.providerId),
        durableData: Boolean(row.durableData),
        consequences: json(row.consequencesJson),
        migrationState: string(row.migrationState),
        createdAt: iso(row.createdAt),
      };
    });
  }

  async #insertCredentialPair(
    executor: Executor,
    input: { nodeId: string; userId: string; generation: number; now: Date },
  ) {
    const expiresAt = new Date(input.now.getTime() + 30 * 24 * 60 * 60_000);
    const insert = async (kind: "relay" | "capability") => {
      const id = newId("ncred");
      const credential = this.#vault.generate();
      await executor.execute({
        sql: `INSERT INTO node_credential_generations
          (id, nodeId, userId, kind, generation, credentialHash,
           sealedCredential, activeFrom, expiresAt, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.nodeId,
          input.userId,
          kind,
          input.generation,
          this.#vault.hash(credential),
          this.#vault.seal(
            credential,
            credentialContext({
              nodeId: input.nodeId,
              kind,
              generation: input.generation,
            }),
          ),
          seconds(input.now),
          seconds(expiresAt),
          seconds(input.now),
        ],
      });
      return {
        id,
        kind,
        generation: input.generation,
        expiresAt: expiresAt.toISOString(),
      };
    };
    return { relay: await insert("relay"), capability: await insert("capability") };
  }

  async #verifyNodeProof(proof: NodeCredentialDeliveryProof, now: Date) {
    if (Math.abs(Date.parse(proof.issuedAt) - now.getTime()) > 30_000) {
      throw new Error("NODE_DELIVERY_PROOF_STALE");
    }
    const result = await this.#client.execute({
      sql: "SELECT publicSigningKey, keyId, state FROM avermate_nodes WHERE id = ? LIMIT 1",
      args: [proof.nodeId],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row || string(row.state) === "revoked") {
      throw new Error("NODE_IDENTITY_NOT_ACTIVE");
    }
    const { signature, ...unsigned } = proof;
    unsignedNodeCredentialDeliveryProofSchema.parse(unsigned);
    if (!verifyProtocolValue(string(row.publicSigningKey), unsigned, signature)) {
      throw new Error("NODE_DELIVERY_PROOF_INVALID");
    }
  }

  async #acceptProofNonce(
    executor: Executor,
    proof: NodeCredentialDeliveryProof,
    now: Date,
  ) {
    try {
      await executor.execute({
        sql: `INSERT INTO node_proof_nonces
          (nodeId, nonce, action, issuedAt, acceptedAt) VALUES (?, ?, ?, ?, ?)`,
        args: [
          proof.nodeId,
          proof.nonce,
          `credential-${proof.action}`,
          seconds(new Date(proof.issuedAt)),
          seconds(now),
        ],
      });
    } catch {
      throw new Error("NODE_DELIVERY_PROOF_REPLAYED");
    }
  }

  async #assertBinding(executor: Executor, nodeId: string, userId: string) {
    const result = await executor.execute({
      sql: `SELECT 1 AS present FROM node_account_bindings b
        JOIN avermate_nodes n ON n.id = b.nodeId
        WHERE b.nodeId = ? AND b.userId = ? AND b.state = 'active'
          AND n.state <> 'revoked' LIMIT 1`,
      args: [nodeId, userId],
    });
    if (!result.rows[0]) throw new Error("NODE_BINDING_NOT_ACTIVE");
  }
}

export function randomNodeProofNonce() {
  return `nonce_${randomBytes(24).toString("base64url")}`;
}
