import type {
  NodeCapabilityGrantClaims,
  SignedNodeCapabilityInvocationGrant,
  NodeJobV1,
  OwnedObjectRef,
  SignedNodeCapabilityGrant,
  UnsignedNodeJobV1,
  UnsignedNodeCapabilityInvocationGrantClaims,
} from "@avermate/agent-contracts";
import {
  nodeCapabilityGrantClaimsSchema,
  nodeJobV1Schema,
  unsignedNodeJobV1Schema,
  signedNodeCapabilityInvocationGrantSchema,
} from "@avermate/agent-contracts";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
} from "node:crypto";
import {
  protocolDigest,
  signProtocolValue,
  type ProtocolSigningIdentity,
} from "./protocol-crypto";

// RFC 8410 PKCS#8 wrapper around a raw 32-byte Ed25519 seed.
const ED25519_PKCS8_SEED_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

export class CoreNodeGrantIssuer {
  readonly identity: ProtocolSigningIdentity;
  readonly publicSigningKey: string;

  constructor(masterSecret: string) {
    if (new TextEncoder().encode(masterSecret).byteLength < 32) {
      throw new Error("NODE_GRANT_SIGNING_SECRET_TOO_SHORT");
    }
    const seed = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(masterSecret),
        Buffer.from("avermate-node-core-grants-v1"),
        Buffer.from("ed25519-seed"),
        32,
      ),
    );
    const privateKey = createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
      type: "pkcs8",
      format: "der",
    });
    this.publicSigningKey = Buffer.from(
      createPublicKey(privateKey).export({ type: "spki", format: "der" }),
    ).toString("base64url");
    const fingerprint = createHash("sha256")
      .update(Buffer.from(this.publicSigningKey, "base64url"))
      .digest("base64url")
      .slice(0, 32);
    this.identity = {
      keyId: `ed25519_core_${fingerprint}`,
      privateKey,
    };
  }

  get publicIdentity() {
    return {
      keyId: this.identity.keyId,
      publicSigningKey: this.publicSigningKey,
    };
  }

  signClaims(raw: NodeCapabilityGrantClaims): SignedNodeCapabilityGrant {
    const claims = nodeCapabilityGrantClaimsSchema.parse(raw);
    return {
      claims,
      keyId: this.identity.keyId,
      signature: signProtocolValue(this.identity, claims),
    };
  }

  signCapabilityInvocation(
    raw: UnsignedNodeCapabilityInvocationGrantClaims,
  ): SignedNodeCapabilityInvocationGrant {
    return signedNodeCapabilityInvocationGrantSchema.parse({
      claims: raw,
      keyId: this.identity.keyId,
      signature: signProtocolValue(this.identity, raw),
    });
  }

  issueOperation(input: {
    nodeId: string;
    userId: string;
    actorKind: NodeCapabilityGrantClaims["actorKind"];
    actorClientId?: string;
    operationId: string;
    operation: string;
    requestDigest: `sha256:${string}`;
    configRevision: `sha256:${string}`;
    capability: string;
    resources?: OwnedObjectRef[];
    byteLimit: number;
    tokenLimit?: number;
    costMinorLimit?: number;
    deadline: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const deadline = new Date(input.deadline);
    if (
      !Number.isFinite(deadline.getTime()) ||
      deadline.getTime() <= now.getTime() ||
      deadline.getTime() > now.getTime() + 5 * 60_000
    ) {
      throw new Error("NODE_GRANT_DEADLINE_INVALID");
    }
    return this.signClaims({
      version: 1,
      issuer: "avermate-core",
      audience: input.nodeId,
      subject: input.userId,
      nodeId: input.nodeId,
      userId: input.userId,
      actorKind: input.actorKind,
      ...(input.actorClientId
        ? { actorClientId: input.actorClientId }
        : {}),
      jobId: input.operationId,
      jti: `nodegrant_${crypto.randomUUID()}`,
      operation: input.operation,
      requestDigest: input.requestDigest,
      configRevision: input.configRevision,
      capabilities: [input.capability],
      resources: input.resources ?? [],
      limits: {
        byteLimit: input.byteLimit,
        tokenLimit: input.tokenLimit ?? 0,
        costMinorLimit: input.costMinorLimit ?? 0,
        deadline: deadline.toISOString(),
      },
      notBefore: new Date(now.getTime() - 5_000).toISOString(),
      expiresAt: deadline.toISOString(),
      issuedAt: now.toISOString(),
    });
  }

  issueJob(
    raw: UnsignedNodeJobV1,
    input: { now?: Date } = {},
  ): NodeJobV1 {
    const job = unsignedNodeJobV1Schema.parse(raw);
    const now = input.now ?? new Date();
    const deadline = new Date(job.limits.deadline);
    if (
      !Number.isFinite(deadline.getTime()) ||
      deadline.getTime() <= now.getTime() ||
      deadline.getTime() > now.getTime() + 24 * 60 * 60_000
    ) {
      throw new Error("NODE_JOB_GRANT_DEADLINE_INVALID");
    }
    const byteLimit = job.limits.inputBytes + job.limits.outputBytes;
    if (!Number.isSafeInteger(byteLimit) || byteLimit < 0) {
      throw new Error("NODE_JOB_GRANT_BYTE_LIMIT_INVALID");
    }
    const envelopeDigest = protocolDigest(job);
    const grant = this.signClaims({
      version: 1,
      issuer: "avermate-core",
      audience: job.principalRef.nodeId,
      subject: job.principalRef.userId,
      nodeId: job.principalRef.nodeId,
      userId: job.principalRef.userId,
      actorKind: job.principalRef.actorKind,
      ...(job.principalRef.actorClientId
        ? { actorClientId: job.principalRef.actorClientId }
        : {}),
      jobId: job.id,
      jti: `nodegrant_${crypto.randomUUID()}`,
      configRevision: job.policyRef as `sha256:${string}`,
      capabilities: [`jobs:${job.kind}`],
      resources:
        job.resourceRefs ?? job.inputRefs.map((artifact) => artifact.object),
      limits: {
        byteLimit,
        tokenLimit: 0,
        costMinorLimit: 0,
        deadline: deadline.toISOString(),
      },
      notBefore: new Date(now.getTime() - 5_000).toISOString(),
      expiresAt: deadline.toISOString(),
      issuedAt: now.toISOString(),
    });
    return nodeJobV1Schema.parse({ ...job, envelopeDigest, grant });
  }
}
