import {
  nodeCapabilityGrantClaimsSchema,
  nodeCapabilityManifestV2Schema,
  nodeJobV1Schema,
  unsignedNodeCapabilityManifestV2Schema,
  unsignedNodeJobV1Schema,
  type NodeCapabilityGrantClaims,
  type NodeCapabilityManifestV2,
  type NodeCapabilityFeatures,
  type NodeJobV1,
  type SignedNodeCapabilityGrant,
  type UnsignedNodeCapabilityManifestV2,
  type UnsignedNodeJobV1,
} from "@avermate/agent-contracts";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalDigest, canonicalJson, sha256Digest } from "./canonical-json";
import type { NodeConfig } from "./config";
import { configRevision } from "./config";
import {
  safeSecretEqual,
  signCanonical,
  verifyCanonical,
  type NodeIdentity,
} from "./identity";

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function randomPairingCode() {
  const bytes = randomBytes(8);
  const characters = Array.from(bytes, (byte) => PAIRING_ALPHABET[byte % 32]);
  return `${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
}

function base32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += PAIRING_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += PAIRING_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function identityFingerprint(publicKeyDer: string) {
  const digest = Buffer.from(
    sha256Digest(Buffer.from(publicKeyDer, "base64url")).slice(7),
    "hex",
  );
  return base32(digest).slice(0, 32);
}

export function signNodeManifest(
  identity: NodeIdentity,
  input: Omit<UnsignedNodeCapabilityManifestV2, "nodeId" | "keyId">,
): NodeCapabilityManifestV2 {
  const unsigned = unsignedNodeCapabilityManifestV2Schema.parse({
    ...input,
    nodeId: identity.nodeId,
    keyId: identity.keyId,
  });
  return nodeCapabilityManifestV2Schema.parse({
    ...unsigned,
    signature: signCanonical(identity, unsigned),
  });
}

export function verifyNodeManifest(
  manifest: NodeCapabilityManifestV2,
  publicKeyDer: string,
  now = Date.now(),
) {
  const parsed = nodeCapabilityManifestV2Schema.parse(manifest);
  const { signature, ...unsigned } = parsed;
  if (Date.parse(parsed.issuedAt) > now + 30_000) return false;
  if (Date.parse(parsed.expiresAt) <= now) return false;
  return verifyCanonical(publicKeyDer, unsigned, signature);
}

export function buildManifest(input: {
  identity: NodeIdentity;
  config: NodeConfig;
  features: NodeCapabilityFeatures;
  storageUsedBytes: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return signNodeManifest(input.identity, {
    protocol: "avermate-node/2",
    build: process.env.AVERMATE_NODE_BUILD ?? "development",
    configRevision: configRevision(input.config),
    features: input.features,
    limits: {
      maxConcurrentJobs: input.config.profile === "dev-zero" ? 2 : 4,
      maxControlFrameBytes: 256 * 1024,
      maxStreamFrameBytes: 64 * 1024,
      maxBufferedStreamBytes: 2 * 1024 * 1024,
      storageQuotaBytes: input.config.storage.quotaBytes,
      storageUsedBytes: input.storageUsedBytes,
    },
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  });
}

type PendingPairing = {
  attemptId: string;
  code: string;
  expiresAt: number;
  consumed: boolean;
};

export class PairingManager {
  readonly #identity: NodeIdentity;
  readonly #pending = new Map<string, PendingPairing>();

  constructor(identity: NodeIdentity) {
    this.#identity = identity;
  }

  create(ttlMs = 5 * 60_000, now = Date.now()) {
    const code = randomPairingCode();
    const attemptId = `pair_${crypto.randomUUID()}`;
    const pending: PendingPairing = {
      attemptId,
      code,
      expiresAt: now + ttlMs,
      consumed: false,
    };
    this.#pending.set(attemptId, pending);
    return {
      code,
      offer: {
        protocol: "avermate-node/2" as const,
        pairingAttemptId: attemptId,
        nodeId: this.#identity.nodeId,
        publicSigningKey: this.#identity.publicKeyDer,
        keyId: this.#identity.keyId,
        fingerprint: identityFingerprint(this.#identity.publicKeyDer),
        codeHash: sha256Digest(code),
        expiresAt: new Date(pending.expiresAt).toISOString(),
      },
    };
  }

  consume(input: {
    pairingAttemptId: string;
    code: string;
    userId: string;
    expectedFingerprint: string;
    now?: number;
  }) {
    const pending = this.#pending.get(input.pairingAttemptId);
    if (!pending || pending.consumed) throw new Error("PAIRING_CODE_REPLAYED");
    if (pending.expiresAt <= (input.now ?? Date.now())) {
      pending.consumed = true;
      throw new Error("PAIRING_CODE_EXPIRED");
    }
    if (!safeSecretEqual(pending.code, input.code)) {
      throw new Error("PAIRING_CODE_INVALID");
    }
    const fingerprint = identityFingerprint(this.#identity.publicKeyDer);
    if (!safeSecretEqual(fingerprint, input.expectedFingerprint)) {
      throw new Error("PAIRING_FINGERPRINT_MISMATCH");
    }
    pending.consumed = true;
    const pairedAt = new Date(input.now ?? Date.now());
    return {
      binding: {
        pairingAttemptId: pending.attemptId,
        nodeId: this.#identity.nodeId,
        userId: input.userId,
        protocolMajor: 2 as const,
        publicSigningKey: this.#identity.publicKeyDer,
        fingerprint,
        credentialId: `nodecred_${crypto.randomUUID()}`,
        credentialExpiresAt: new Date(
          pairedAt.getTime() + 30 * 24 * 60 * 60_000,
        ).toISOString(),
        pairedAt: pairedAt.toISOString(),
      },
      // Internal channel material. Callers must seal it immediately and must
      // never return it from the configurator/browser API.
      channelCredential: randomToken(48),
    };
  }
}

export function signCapabilityGrant(
  issuerIdentity: NodeIdentity,
  claims: NodeCapabilityGrantClaims,
): SignedNodeCapabilityGrant {
  const parsed = nodeCapabilityGrantClaimsSchema.parse(claims);
  return {
    claims: parsed,
    keyId: issuerIdentity.keyId,
    signature: signCanonical(issuerIdentity, parsed),
  };
}

export function unsignedNodeJob(job: NodeJobV1): UnsignedNodeJobV1 {
  return unsignedNodeJobV1Schema.parse({
    id: job.id,
    principalRef: job.principalRef,
    kind: job.kind,
    capabilityVersion: job.capabilityVersion,
    inputRefs: job.inputRefs,
    policyRef: job.policyRef,
    limits: job.limits,
    idempotencyKey: job.idempotencyKey,
  });
}

export function nodeJobEnvelopeDigest(job: UnsignedNodeJobV1) {
  return canonicalDigest(unsignedNodeJobV1Schema.parse(job));
}

export function verifyJobGrant(input: {
  job: NodeJobV1;
  issuerPublicKeyDer: string;
  expectedAudience: string;
  requiredCapability?: string;
  now?: number;
}) {
  const job = nodeJobV1Schema.parse(input.job);
  const now = input.now ?? Date.now();
  const unsigned = unsignedNodeJob(job);
  if (nodeJobEnvelopeDigest(unsigned) !== job.envelopeDigest) {
    throw new Error("JOB_ENVELOPE_DIGEST_MISMATCH");
  }
  const { claims, signature } = job.grant;
  if (!verifyCanonical(input.issuerPublicKeyDer, claims, signature)) {
    throw new Error("GRANT_SIGNATURE_INVALID");
  }
  if (Date.parse(claims.notBefore) > now)
    throw new Error("GRANT_NOT_YET_VALID");
  if (Date.parse(claims.expiresAt) <= now) throw new Error("GRANT_EXPIRED");
  if (
    claims.audience !== input.expectedAudience ||
    claims.nodeId !== job.principalRef.nodeId
  ) {
    throw new Error("GRANT_WRONG_AUDIENCE");
  }
  if (
    claims.jobId !== job.id ||
    claims.userId !== job.principalRef.userId ||
    claims.subject !== job.principalRef.userId ||
    claims.actorKind !== job.principalRef.actorKind ||
    claims.actorClientId !== job.principalRef.actorClientId
  ) {
    throw new Error("GRANT_PRINCIPAL_MISMATCH");
  }
  const requiredCapability = input.requiredCapability ?? `jobs:${job.kind}`;
  if (!claims.capabilities.includes(requiredCapability)) {
    throw new Error("GRANT_CAPABILITY_MISMATCH");
  }
  if (
    claims.limits.byteLimit < job.limits.inputBytes + job.limits.outputBytes ||
    Date.parse(claims.limits.deadline) < Date.parse(job.limits.deadline)
  ) {
    throw new Error("GRANT_LIMIT_MISMATCH");
  }
  const grantedRefs = claims.resources
    .map((resource) => canonicalJson(resource))
    .sort();
  const inputRefs = job.inputRefs
    .map((artifact) => canonicalJson(artifact.object))
    .sort();
  if (canonicalJson(grantedRefs) !== canonicalJson(inputRefs)) {
    throw new Error("GRANT_RESOURCE_MISMATCH");
  }
  return claims;
}

type ReplayJournal = Record<
  string,
  { fingerprint: string; expiresAt: string; firstAcceptedAt: string }
>;

export class GrantReplayLedger {
  readonly #path: string;
  #journal: ReplayJournal | null = null;

  constructor(path: string) {
    this.#path = path;
  }

  async #load() {
    if (this.#journal) return this.#journal;
    try {
      this.#journal = JSON.parse(
        await readFile(this.#path, "utf8"),
      ) as ReplayJournal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#journal = {};
    }
    return this.#journal;
  }

  async #persist(journal: ReplayJournal) {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(journal)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, this.#path);
  }

  async accept(
    claims: NodeCapabilityGrantClaims,
    envelopeDigest: string,
    now = Date.now(),
  ) {
    const journal = await this.#load();
    for (const [jti, record] of Object.entries(journal)) {
      if (Date.parse(record.expiresAt) <= now) delete journal[jti];
    }
    const principal = canonicalDigest({
      nodeId: claims.nodeId,
      userId: claims.userId,
      actorKind: claims.actorKind,
      actorClientId: claims.actorClientId ?? null,
    });
    const fingerprint = canonicalDigest({ principal, envelopeDigest });
    const previous = journal[claims.jti];
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error("GRANT_JTI_REPLAY_MISMATCH");
      return { replayed: true };
    }
    journal[claims.jti] = {
      fingerprint,
      expiresAt: claims.expiresAt,
      firstAcceptedAt: new Date(now).toISOString(),
    };
    await this.#persist(journal);
    return { replayed: false };
  }
}
