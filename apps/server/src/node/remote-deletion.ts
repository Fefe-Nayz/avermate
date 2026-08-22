import {
  nodeDeletionManifestSchema,
  nodeDeletionReceiptSchema,
  unsignedNodeDeletionManifestSchema,
  type NodeArtifactRef,
  type NodeDeletionManifest,
  type NodeDeletionReceipt,
  type OwnedObjectRef,
  type RemoteDeletionState,
} from "@avermate/agent-contracts";
import {
  protocolDigest,
  signProtocolValue,
  verifyProtocolValue,
  type ProtocolSigningIdentity,
} from "./protocol-crypto";

export type RemoteDeletionRecord = {
  manifest: NodeDeletionManifest;
  state: RemoteDeletionState;
  receipt?: NodeDeletionReceipt;
  acceptedReceiptDigest?: `sha256:${string}`;
  safeOperatorInstruction?: string;
};

/** Implement this over the Core database; tombstone creation must commit before issue. */
export interface RemoteDeletionRepository {
  createTombstone(record: RemoteDeletionRecord): Promise<void>;
  loadByManifestDigest(digest: string): Promise<RemoteDeletionRecord | null>;
  isTombstoned(ref: OwnedObjectRef): Promise<boolean>;
  markVerified(
    manifestDigest: string,
    receipt: NodeDeletionReceipt,
    receiptDigest: `sha256:${string}`,
  ): Promise<void>;
  markState(
    manifestDigest: string,
    state: Exclude<RemoteDeletionState, "verified_deleted">,
    safeOperatorInstruction?: string,
  ): Promise<void>;
  /** Includes pending and revoked-unreachable deletion-only reconnect commands. */
  pendingForNode(
    nodeId: string,
    limit: number,
  ): AsyncIterable<RemoteDeletionRecord>;
}

export function createSignedDeletionManifest(input: {
  issuer: ProtocolSigningIdentity;
  nodeId: string;
  userId: string;
  refs: NodeArtifactRef[];
  ttlMs?: number;
  now?: number;
  nonce?: string;
}) {
  const now = input.now ?? Date.now();
  const unsigned = unsignedNodeDeletionManifestSchema.parse({
    version: 1,
    nodeId: input.nodeId,
    userId: input.userId,
    nonce: input.nonce ?? `delete_${crypto.randomUUID()}`,
    refs: input.refs,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (input.ttlMs ?? 15 * 60_000)).toISOString(),
  });
  const digest = protocolDigest(unsigned);
  const signed = { ...unsigned, digest, keyId: input.issuer.keyId };
  return nodeDeletionManifestSchema.parse({
    ...signed,
    signature: signProtocolValue(input.issuer, signed),
  });
}

export function verifyRemoteDeletionReceipt(input: {
  manifest: NodeDeletionManifest;
  receipt: NodeDeletionReceipt;
  expectedNodeId: string;
  expectedNodeKeyId: string;
  nodePublicKeyDer: string;
  now?: number;
}) {
  const manifest = nodeDeletionManifestSchema.parse(input.manifest);
  const receipt = nodeDeletionReceiptSchema.parse(input.receipt);
  if (
    receipt.nodeId !== input.expectedNodeId ||
    receipt.nodeId !== manifest.nodeId
  ) {
    throw new Error("DELETION_RECEIPT_WRONG_NODE");
  }
  if (receipt.keyId !== input.expectedNodeKeyId) {
    throw new Error("DELETION_RECEIPT_WRONG_KEY");
  }
  if (
    receipt.nonce !== manifest.nonce ||
    receipt.manifestDigest !== manifest.digest
  ) {
    throw new Error("DELETION_RECEIPT_MANIFEST_MISMATCH");
  }
  if (receipt.deletedCount !== manifest.refs.length) {
    throw new Error("DELETION_RECEIPT_COUNT_MISMATCH");
  }
  const verifiedAt = Date.parse(receipt.verifiedAt);
  if (
    verifiedAt < Date.parse(manifest.issuedAt) ||
    verifiedAt > (input.now ?? Date.now()) + 30_000
  ) {
    throw new Error("DELETION_RECEIPT_TIMESTAMP_INVALID");
  }
  const { signature, keyId: _keyId, ...unsigned } = receipt;
  if (!verifyProtocolValue(input.nodePublicKeyDer, unsigned, signature)) {
    throw new Error("DELETION_RECEIPT_SIGNATURE_INVALID");
  }
  return receipt;
}

export class RemoteDeletionCoordinator {
  readonly #repository: RemoteDeletionRepository;
  readonly #issuer: ProtocolSigningIdentity;

  constructor(input: {
    repository: RemoteDeletionRepository;
    issuer: ProtocolSigningIdentity;
  }) {
    this.#repository = input.repository;
    this.#issuer = input.issuer;
  }

  async issue(input: {
    nodeId: string;
    userId: string;
    refs: NodeArtifactRef[];
    now?: number;
    ttlMs?: number;
    nonce?: string;
  }) {
    const manifest = createSignedDeletionManifest({
      ...input,
      issuer: this.#issuer,
    });
    await this.#repository.createTombstone({
      manifest,
      state: "pending_remote_deletion",
    });
    return manifest;
  }

  async assertRoutable(ref: OwnedObjectRef) {
    if (await this.#repository.isTombstoned(ref)) {
      throw new Error("RESOURCE_TOMBSTONED");
    }
  }

  async acceptReceipt(input: {
    receipt: NodeDeletionReceipt;
    expectedNodeId: string;
    expectedNodeKeyId: string;
    nodePublicKeyDer: string;
    now?: number;
  }) {
    const record = await this.#repository.loadByManifestDigest(
      input.receipt.manifestDigest,
    );
    if (!record) throw new Error("DELETION_MANIFEST_NOT_FOUND");
    if (record.acceptedReceiptDigest || record.state === "verified_deleted") {
      throw new Error("DELETION_RECEIPT_REPLAYED");
    }
    const receipt = verifyRemoteDeletionReceipt({
      ...input,
      manifest: record.manifest,
    });
    const receiptDigest = protocolDigest(receipt);
    await this.#repository.markVerified(
      record.manifest.digest,
      receipt,
      receiptDigest,
    );
    return { state: "verified_deleted" as const, receiptDigest };
  }

  async markRevokedUnreachable(manifestDigest: string) {
    const record = await this.#repository.loadByManifestDigest(manifestDigest);
    if (!record) throw new Error("DELETION_MANIFEST_NOT_FOUND");
    if (record.state === "verified_deleted") {
      throw new Error("DELETION_ALREADY_VERIFIED");
    }
    await this.#repository.markState(
      manifestDigest,
      "revoked_unreachable",
      "Reconnect the original node identity or verify deletion on its storage manually.",
    );
  }

  async markUserActionRequired(
    manifestDigest: string,
    safeOperatorInstruction: string,
  ) {
    if (!safeOperatorInstruction || safeOperatorInstruction.length > 1_024) {
      throw new Error("DELETION_OPERATOR_INSTRUCTION_INVALID");
    }
    const record = await this.#repository.loadByManifestDigest(manifestDigest);
    if (!record) throw new Error("DELETION_MANIFEST_NOT_FOUND");
    if (record.state === "verified_deleted") {
      throw new Error("DELETION_ALREADY_VERIFIED");
    }
    await this.#repository.markState(
      manifestDigest,
      "user_action_required",
      safeOperatorInstruction,
    );
  }

  pendingDeletionOnlyReconnect(nodeId: string, limit = 100) {
    return this.#repository.pendingForNode(nodeId, limit);
  }
}
