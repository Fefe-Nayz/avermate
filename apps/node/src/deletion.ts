import {
  nodeDeletionManifestSchema,
  nodeDeletionReceiptSchema,
  unsignedNodeDeletionManifestSchema,
  unsignedNodeDeletionReceiptSchema,
  type NodeDeletionManifest,
  type NodeDeletionReceipt,
  type ObjectStorageProvider,
  type UnsignedNodeDeletionManifest,
} from "@avermate/agent-contracts";
import { canonicalDigest } from "./canonical-json";
import { signCanonical, verifyCanonical, type NodeIdentity } from "./identity";

export function signDeletionManifest(
  issuer: NodeIdentity,
  input: UnsignedNodeDeletionManifest,
): NodeDeletionManifest {
  const unsigned = unsignedNodeDeletionManifestSchema.parse(input);
  const digest = canonicalDigest(unsigned);
  const signed = { ...unsigned, digest, keyId: issuer.keyId };
  return nodeDeletionManifestSchema.parse({
    ...signed,
    signature: signCanonical(issuer, signed),
  });
}

export function verifyDeletionManifest(input: {
  manifest: NodeDeletionManifest;
  issuerPublicKeyDer: string;
  expectedNodeId: string;
  expectedIssuerKeyId?: string;
  now?: number;
}) {
  const manifest = nodeDeletionManifestSchema.parse(input.manifest);
  const { signature, ...signed } = manifest;
  const { digest, keyId, ...unsigned } = signed;
  if (manifest.nodeId !== input.expectedNodeId) {
    throw new Error("DELETION_MANIFEST_WRONG_NODE");
  }
  if (input.expectedIssuerKeyId && keyId !== input.expectedIssuerKeyId) {
    throw new Error("DELETION_MANIFEST_WRONG_KEY");
  }
  const now = input.now ?? Date.now();
  if (Date.parse(manifest.issuedAt) > now + 30_000) {
    throw new Error("DELETION_MANIFEST_NOT_YET_VALID");
  }
  if (Date.parse(manifest.expiresAt) <= now) {
    throw new Error("DELETION_MANIFEST_EXPIRED");
  }
  if (
    canonicalDigest(unsignedNodeDeletionManifestSchema.parse(unsigned)) !==
    digest
  ) {
    throw new Error("DELETION_MANIFEST_DIGEST_MISMATCH");
  }
  if (!verifyCanonical(input.issuerPublicKeyDer, signed, signature)) {
    throw new Error("DELETION_MANIFEST_SIGNATURE_INVALID");
  }
  return manifest;
}

export async function executeDeletionManifest(input: {
  manifest: NodeDeletionManifest;
  issuerPublicKeyDer: string;
  expectedIssuerKeyId?: string;
  identity: NodeIdentity;
  storage: ObjectStorageProvider;
  now?: number;
}): Promise<NodeDeletionReceipt> {
  const now = input.now ?? Date.now();
  const manifest = verifyDeletionManifest({
    manifest: input.manifest,
    issuerPublicKeyDer: input.issuerPublicKeyDer,
    expectedNodeId: input.identity.nodeId,
    expectedIssuerKeyId: input.expectedIssuerKeyId,
    now,
  });
  for (const artifact of manifest.refs) {
    if (artifact.object.ownerId !== manifest.userId) {
      throw new Error("DELETION_MANIFEST_OWNER_MISMATCH");
    }
    await input.storage.delete({
      ref: artifact.object,
      expectedDigest: artifact.digest,
      idempotencyKey: `delete:${manifest.nonce}:${artifact.object.key}`,
    });
    if (await input.storage.stat({ ref: artifact.object })) {
      throw new Error("DELETION_ABSENCE_NOT_VERIFIED");
    }
  }
  const unsigned = unsignedNodeDeletionReceiptSchema.parse({
    nodeId: input.identity.nodeId,
    nonce: manifest.nonce,
    manifestDigest: manifest.digest,
    deletedCount: manifest.refs.length,
    verifiedAt: new Date(now).toISOString(),
  });
  return nodeDeletionReceiptSchema.parse({
    ...unsigned,
    keyId: input.identity.keyId,
    signature: signCanonical(input.identity, unsigned),
  });
}

export function verifyDeletionReceipt(input: {
  receipt: NodeDeletionReceipt;
  nodePublicKeyDer: string;
  expectedNodeId: string;
  expectedNodeKeyId?: string;
  manifest: NodeDeletionManifest;
  now?: number;
}) {
  const receipt = nodeDeletionReceiptSchema.parse(input.receipt);
  const { signature, keyId, ...unsigned } = receipt;
  if (
    receipt.nodeId !== input.expectedNodeId ||
    receipt.nodeId !== input.manifest.nodeId
  ) {
    throw new Error("DELETION_RECEIPT_WRONG_NODE");
  }
  if (input.expectedNodeKeyId && keyId !== input.expectedNodeKeyId) {
    throw new Error("DELETION_RECEIPT_WRONG_KEY");
  }
  if (
    receipt.nonce !== input.manifest.nonce ||
    receipt.manifestDigest !== input.manifest.digest
  ) {
    throw new Error("DELETION_RECEIPT_MANIFEST_MISMATCH");
  }
  if (receipt.deletedCount !== input.manifest.refs.length) {
    throw new Error("DELETION_RECEIPT_COUNT_MISMATCH");
  }
  const verifiedAt = Date.parse(receipt.verifiedAt);
  const now = input.now ?? Date.now();
  if (
    verifiedAt < Date.parse(input.manifest.issuedAt) ||
    verifiedAt > now + 30_000
  ) {
    throw new Error("DELETION_RECEIPT_TIMESTAMP_INVALID");
  }
  if (!verifyCanonical(input.nodePublicKeyDer, unsigned, signature)) {
    throw new Error("DELETION_RECEIPT_SIGNATURE_INVALID");
  }
  return receipt;
}
