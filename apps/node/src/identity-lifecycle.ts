import { rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { NodeConfig } from "./config";
import { loadOrCreateNodeIdentity } from "./identity";
import { createNodeBackup, verifyNodeBackup } from "./lifecycle";
import { identityFingerprint } from "./protocol";

/**
 * Rotate the Node's long-lived Ed25519 identity only after two human-visible
 * confirmations and a verified encrypted backup. The old private key is not
 * retained in plaintext; recovery uses the encrypted backup. A new identity
 * deliberately requires a fresh Core pairing and never inherits another
 * node's placement or deletion authority.
 */
export async function rotateNodeIdentity(input: {
  config: NodeConfig;
  configPath: string;
  confirmNodeId: string;
  confirmFingerprint: string;
  backupPath: string;
  backupKey: Uint8Array;
  now?: Date;
}) {
  const identityPath = resolve(
    input.config.dataDir,
    "secrets",
    "identity.json",
  );
  const current = await loadOrCreateNodeIdentity(identityPath);
  const fingerprint = identityFingerprint(current.publicKeyDer);
  if (
    input.confirmNodeId !== current.nodeId ||
    input.confirmFingerprint.toUpperCase() !== fingerprint
  ) {
    throw new Error("IDENTITY_ROTATION_CONFIRMATION_MISMATCH");
  }
  const backup = await createNodeBackup({
    config: input.config,
    configPath: input.configPath,
    outputPath: input.backupPath,
    key: input.backupKey,
  });
  await verifyNodeBackup({
    archivePath: backup.outputPath,
    key: input.backupKey,
  });

  const temporaryOldIdentity = `${identityPath}.rotation-${crypto.randomUUID()}`;
  await rename(identityPath, temporaryOldIdentity);
  try {
    const next = await loadOrCreateNodeIdentity(identityPath);
    if (next.nodeId === current.nodeId || next.keyId === current.keyId) {
      throw new Error("IDENTITY_ROTATION_DID_NOT_CHANGE_KEY");
    }
    await rm(temporaryOldIdentity, { force: true });
    return Object.freeze({
      rotated: true as const,
      previousNodeId: current.nodeId,
      previousFingerprint: fingerprint,
      nodeId: next.nodeId,
      fingerprint: identityFingerprint(next.publicKeyDer),
      rotatedAt: (input.now ?? new Date()).toISOString(),
      backupPath: backup.outputPath,
      backupDigest: backup.archiveDigest,
      restartRequired: true as const,
      coreRepairRequired: true as const,
      nextStep:
        "Revoke or retire the previous Core binding, restart the Node, then complete a new fingerprint-confirmed pairing.",
    });
  } catch (error) {
    await rm(identityPath, { force: true }).catch(() => undefined);
    await rename(temporaryOldIdentity, identityPath).catch(() => undefined);
    throw error;
  }
}
