import { db } from "../db";
import type {
  NodeArtifactRef,
  NodeCapabilityFeatures,
  NodeJobExecutionProfile,
  NodeJobEvent,
  NodeJobLimits,
  OwnedObjectRef,
  SandboxCreateInput,
  SandboxHandle,
  SandboxProviderId,
  SandboxRuntimeCheckpointCompatibilityV1,
  SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import { env } from "../lib/env";
import { NodeCredentialVault } from "./node-credential-vault";
import { CoreNodeRegistry } from "./node-registry";
import { CoreNodeRelay } from "./node-relay";
import { SqlRelayOperationJournal } from "./node-relay-repository";
import { CoreNodeGrantIssuer } from "./core-grant-issuer";
import {
  createRelayNodeProviderFetcher,
  RelayNodeProviderTransport,
  type NodeProviderFetcher,
} from "./relay-provider-transport";
import { RelayNodeObjectStorageProvider } from "./relay-node-object-storage-provider";
import { PairedNodeRerankProvider } from "./paired-node-rerank-provider";
import { createHash } from "node:crypto";
import {
  storageBackendEnabled,
  storageDriver,
  type ManagedStorageProvider,
} from "../lib/storage-backend";
import { ManagedAdoptionStorageProvider } from "./managed-adoption-storage-provider";
import { CoreObjectAdoptionRepository } from "./sql-object-adoption-repository";
import {
  TwoPhaseObjectAdopter,
  type ObjectAdoptionIntent,
} from "./two-phase-object-adopter";
import { CoreNodeRuntimeCheckpointRepository } from "./sql-runtime-checkpoint-repository";
import { coreWorkspaceSnapshotLedger } from "../sandbox/sql-snapshot-ledger";
import { NodeSandboxProvider } from "./node-provider-adapters";
import { PairedNodeRuntimeCheckpointLifecycle } from "./runtime-checkpoint-lifecycle";
import { CoreRemoteDeletionRepository } from "./sql-remote-deletion-repository";
import { RemoteDeletionCoordinator } from "./remote-deletion";
import { nodePlacementMigrationReady } from "./readiness";

export const MAX_NODE_ARTIFACT_ADOPTION_BYTES = 32 * 1024 * 1024;

let nodeConversationReconciler: ((nodeId: string) => Promise<unknown>) | null =
  null;

export function registerNodeConversationReconciler(
  reconcile: (nodeId: string) => Promise<unknown>,
) {
  nodeConversationReconciler = reconcile;
}

const adoptionExtensionByMime: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    ".pptx",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/tab-separated-values": ".tsv",
  "text/html": ".html",
};

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function bytesStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function nodeArtifactAbortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("NODE_ARTIFACT_READ_ABORTED");
}

function nextNodeArtifactChunk<T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal?.aborted) {
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
    return Promise.reject(nodeArtifactAbortReason(signal));
  }
  const operation = iterator.next();
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(nodeArtifactAbortReason(signal));
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function coreAdoptionComponents(managedProvider: ManagedStorageProvider) {
  const provider = new ManagedAdoptionStorageProvider(managedProvider);
  const repository = new CoreObjectAdoptionRepository(db.$client, {
    managedProvider,
  });
  return {
    provider,
    repository,
    adopter: new TwoPhaseObjectAdopter({ provider, repository }),
  };
}

function adoptionIntent(input: {
  ownerId: string;
  adoptionId: string;
  idempotencyKey: string;
  artifact: NodeArtifactRef;
  providerId: string;
}): ObjectAdoptionIntent {
  const extension = adoptionExtensionByMime[input.artifact.mimeType];
  if (!extension) throw new Error("NODE_ARTIFACT_ADOPTION_MIME_DENIED");
  return {
    adoptionId: input.adoptionId,
    providerId: input.providerId,
    ref: {
      ownerId: input.ownerId,
      namespace: "document-artifact",
      key: `node-adoptions/v1/${stableHash(input.ownerId).slice(0, 32)}/${stableHash(
        `${input.adoptionId}\0${input.artifact.digest}`,
      ).slice(0, 48)}${extension}`,
    },
    byteSize: input.artifact.byteSize,
    mimeType: input.artifact.mimeType,
    expectedDigest: input.artifact.digest,
    idempotencyKey: input.idempotencyKey,
  };
}

function assertAdoptionReplay(
  existing: NonNullable<
    Awaited<ReturnType<CoreObjectAdoptionRepository["load"]>>
  >,
  intent: ObjectAdoptionIntent,
) {
  if (
    existing.providerId !== intent.providerId ||
    existing.ref.ownerId !== intent.ref.ownerId ||
    existing.ref.namespace !== intent.ref.namespace ||
    existing.ref.key !== intent.ref.key ||
    existing.byteSize !== intent.byteSize ||
    existing.mimeType !== intent.mimeType ||
    existing.expectedDigest !== intent.expectedDigest ||
    existing.idempotencyKey !== intent.idempotencyKey
  ) {
    throw new Error("ADOPTION_IDEMPOTENCY_PAYLOAD_MISMATCH");
  }
}

/**
 * Canonical production adoption path for immutable Node results. Bytes are
 * loaded lazily, so a crash after DB adoption but before graph publication
 * retries without downloading or duplicating the object.
 */
export async function adoptPairedNodeArtifact(input: {
  ownerId: string;
  adoptionId: string;
  idempotencyKey: string;
  artifact: NodeArtifactRef;
  loadBytes(): Promise<Uint8Array>;
}) {
  if (input.artifact.object.ownerId !== input.ownerId) {
    throw new Error("NODE_ARTIFACT_OWNER_MISMATCH");
  }
  if (!storageBackendEnabled()) throw new Error("CORE_STORAGE_NOT_CONFIGURED");
  const managedProvider = storageDriver();
  const components = coreAdoptionComponents(managedProvider);
  const intent = adoptionIntent({
    ...input,
    providerId: components.provider.id,
  });
  const existing = await components.repository.load(input.adoptionId);
  if (existing) {
    assertAdoptionReplay(existing, intent);
    if (existing.state === "needs_operator") {
      throw new Error(
        `ADOPTION_NEEDS_OPERATOR:${existing.safeErrorCode ?? "UNKNOWN"}`,
      );
    }
    if (existing.state === "adopted") {
      if (!existing.canonicalRecordId) {
        throw new Error("ADOPTION_CANONICAL_LEDGER_INCOMPLETE");
      }
      return {
        fileId: existing.canonicalRecordId,
        replayed: true,
        record: existing,
      };
    }
  }
  const bytes = await input.loadBytes();
  if (
    bytes.byteLength !== input.artifact.byteSize ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
      input.artifact.digest
  ) {
    throw new Error("NODE_ARTIFACT_ADOPTION_BYTES_MISMATCH");
  }
  const uploaded = await components.adopter.upload({
    ...intent,
    body: bytesStream(bytes),
  });
  if (!uploaded.record.canonicalRecordId) {
    throw new Error("ADOPTION_CANONICAL_LEDGER_INCOMPLETE");
  }
  return {
    fileId: uploaded.record.canonicalRecordId,
    replayed: uploaded.replayed,
    record: uploaded.record,
  };
}

/** Reconcile durable provider commits left by a process interruption. */
export async function reconcileCoreObjectAdoptions(limit = 250) {
  if (!storageBackendEnabled()) return [];
  return coreAdoptionComponents(storageDriver()).adopter.reconcile(limit);
}

export const coreNodeGrantIssuer = new CoreNodeGrantIssuer(
  env.NODE_GRANT_SIGNING_SECRET ??
    env.NODE_CREDENTIAL_MASTER_SECRET ??
    env.BETTER_AUTH_SECRET,
);

export const nodeCredentialVault = new NodeCredentialVault(
  env.NODE_CREDENTIAL_MASTER_SECRET ?? env.BETTER_AUTH_SECRET,
);

export const coreNodeRegistry = new CoreNodeRegistry({
  client: db.$client,
  vault: nodeCredentialVault,
  grantSigningKey: coreNodeGrantIssuer.publicIdentity,
});

export const coreRemoteDeletionRepository = new CoreRemoteDeletionRepository(
  db.$client,
);

export const coreRemoteDeletionCoordinator = new RemoteDeletionCoordinator({
  repository: coreRemoteDeletionRepository,
  issuer: coreNodeGrantIssuer.identity,
});

export const coreNodeRelay = new CoreNodeRelay({
  registry: coreNodeRegistry,
  journal: new SqlRelayOperationJournal(db.$client),
  hooks: {
    async onConnected({ nodeId }) {
      await Promise.allSettled([
        retryPendingNodeDeletions(nodeId),
        reconcileNodeRuntimeCheckpoints(),
        reconcileCoreObjectAdoptions(),
        nodeConversationReconciler?.(nodeId),
      ]);
    },
  },
});

export const relayNodeProviderTransport = new RelayNodeProviderTransport({
  relay: coreNodeRelay,
  issuer: coreNodeGrantIssuer,
});

export const coreNodeRuntimeCheckpoints =
  new CoreNodeRuntimeCheckpointRepository(db.$client);

export const pairedNodeRuntimeCheckpointLifecycle =
  new PairedNodeRuntimeCheckpointLifecycle(
    coreNodeRuntimeCheckpoints,
    coreWorkspaceSnapshotLedger,
  );

function assertPairedSandboxState(ownerId: string, nodeId: string) {
  const state = coreNodeRelay.inspect(nodeId);
  if (!state || state.userId !== ownerId || !state.features.sandbox) {
    throw new Error("NODE_SANDBOX_CAPABILITY_OFFLINE");
  }
  return state;
}

/**
 * Capture and durably attach a provider-native accelerator to an already
 * committed logical workspace snapshot. The conversation checkpoint is never
 * read or written by this lifecycle.
 */
export async function capturePairedNodeRuntimeCheckpoint(input: {
  checkpointId: string;
  ownerId: string;
  nodeId: string;
  workspaceSnapshotId: string;
  providerId: SandboxProviderId;
  handle: SandboxHandle;
  sourceWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
  compatibility: SandboxRuntimeCheckpointCompatibilityV1;
  expiresAt: Date;
}) {
  assertPairedSandboxState(input.ownerId, input.nodeId);
  const replay = await coreNodeRuntimeCheckpoints.loadOwned({
    id: input.checkpointId,
    ownerId: input.ownerId,
    nodeId: input.nodeId,
  });
  if (replay?.state === "adopted") return replay;
  if (replay?.state === "captured") {
    return adoptCapturedRuntimeCheckpoint(replay);
  }
  if (replay) throw new Error("NODE_RUNTIME_CHECKPOINT_STATE_CONFLICT");

  const checkpoint =
    await relayNodeProviderTransport.captureSandboxRuntimeCheckpoint({
      nodeId: input.nodeId,
      ownerId: input.ownerId,
      providerId: input.providerId,
      handle: input.handle,
      sourceWorkspaceSnapshot: input.sourceWorkspaceSnapshot,
      compatibility: input.compatibility,
      idempotencyKey: input.checkpointId,
      expiresAt: input.expiresAt.toISOString(),
    });
  const captured = await coreNodeRuntimeCheckpoints.recordCaptured({
    id: input.checkpointId,
    ownerId: input.ownerId,
    nodeId: input.nodeId,
    workspaceSnapshotId: input.workspaceSnapshotId,
    checkpoint,
  });
  try {
    return await adoptCapturedRuntimeCheckpoint(captured);
  } catch (error) {
    const safeErrorCode =
      error instanceof Error && /^[A-Z0-9_:-]{3,128}$/u.test(error.message)
        ? error.message
        : "NODE_RUNTIME_CHECKPOINT_ADOPTION_FAILED";
    await coreNodeRuntimeCheckpoints
      .markFailed({
        id: captured.id,
        ownerId: captured.ownerId,
        nodeId: captured.nodeId,
        safeErrorCode,
      })
      .catch(() => undefined);
    try {
      await relayNodeProviderTransport.deleteSandboxRuntimeCheckpoint({
        nodeId: captured.nodeId,
        ownerId: captured.ownerId,
        providerId: captured.checkpoint.checkpoint.provider,
        checkpoint: captured.checkpoint,
      });
      await coreNodeRuntimeCheckpoints.markDeleted({
        id: captured.id,
        ownerId: captured.ownerId,
        nodeId: captured.nodeId,
      });
    } catch {
      // The durable failed row remains GC-visible and retryable on reconnect.
    }
    throw error;
  }
}

async function adoptCapturedRuntimeCheckpoint(
  captured: Awaited<
    ReturnType<CoreNodeRuntimeCheckpointRepository["recordCaptured"]>
  >,
) {
  if (Date.parse(captured.checkpoint.expiresAt) <= Date.now()) {
    throw new Error("NODE_RUNTIME_CHECKPOINT_EXPIRED");
  }
  await coreWorkspaceSnapshotLedger.attachRuntimeCheckpoint({
    recordId: captured.workspaceSnapshotId,
    runtimeCheckpointRef: captured.checkpoint.checkpoint,
    imageDigest: captured.checkpoint.compatibility.imageDigest,
    executionProfileVersion: captured.checkpoint.compatibility.profileVersion,
  });
  return coreNodeRuntimeCheckpoints.markAdopted({
    id: captured.id,
    ownerId: captured.ownerId,
    nodeId: captured.nodeId,
    adoptedObjectRefs: captured.checkpoint.adoptedObjectRefs,
  });
}

export async function restorePairedNodeRuntimeCheckpoint(input: {
  checkpointId: string;
  ownerId: string;
  nodeId: string;
  providerId: SandboxProviderId;
  create: SandboxCreateInput;
}) {
  assertPairedSandboxState(input.ownerId, input.nodeId);
  const stored = await coreNodeRuntimeCheckpoints.loadOwned({
    id: input.checkpointId,
    ownerId: input.ownerId,
    nodeId: input.nodeId,
  });
  if (!stored || stored.state !== "adopted") {
    throw new Error("NODE_RUNTIME_CHECKPOINT_NOT_RESTORABLE");
  }
  if (Date.parse(stored.checkpoint.expiresAt) <= Date.now()) {
    await deletePairedNodeRuntimeCheckpoint({
      checkpointId: stored.id,
      ownerId: stored.ownerId,
      nodeId: stored.nodeId,
    }).catch(() => undefined);
    throw new Error("NODE_RUNTIME_CHECKPOINT_EXPIRED");
  }
  return relayNodeProviderTransport.restoreSandboxRuntimeCheckpoint({
    nodeId: stored.nodeId,
    ownerId: stored.ownerId,
    providerId: input.providerId,
    create: input.create,
    checkpoint: stored.checkpoint,
  });
}

export async function deletePairedNodeRuntimeCheckpoint(input: {
  checkpointId: string;
  ownerId: string;
  nodeId: string;
}) {
  const stored = await coreNodeRuntimeCheckpoints.loadOwned({
    id: input.checkpointId,
    ownerId: input.ownerId,
    nodeId: input.nodeId,
  });
  if (!stored || stored.state === "deleted") return stored;
  assertPairedSandboxState(input.ownerId, input.nodeId);
  await relayNodeProviderTransport.deleteSandboxRuntimeCheckpoint({
    nodeId: stored.nodeId,
    ownerId: stored.ownerId,
    providerId: stored.checkpoint.checkpoint.provider,
    checkpoint: stored.checkpoint,
  });
  return coreNodeRuntimeCheckpoints.markDeleted({
    id: stored.id,
    ownerId: stored.ownerId,
    nodeId: stored.nodeId,
  });
}

/** Crash/expiry reconciliation entrypoint used at startup and Node reconnect. */
export async function reconcileNodeRuntimeCheckpoints(limit = 100) {
  const outcomes: Array<{ id: string; outcome: string }> = [];
  for (const captured of await coreNodeRuntimeCheckpoints.captured(limit)) {
    try {
      await adoptCapturedRuntimeCheckpoint(captured);
      outcomes.push({ id: captured.id, outcome: "adopted" });
    } catch {
      outcomes.push({ id: captured.id, outcome: "pending" });
    }
  }
  for (const expired of await coreNodeRuntimeCheckpoints.expired(
    new Date(),
    limit,
  )) {
    try {
      await deletePairedNodeRuntimeCheckpoint({
        checkpointId: expired.id,
        ownerId: expired.ownerId,
        nodeId: expired.nodeId,
      });
      outcomes.push({ id: expired.id, outcome: "deleted" });
    } catch {
      outcomes.push({ id: expired.id, outcome: "delete-pending" });
    }
  }
  return outcomes;
}

async function pairedNodeDeletionIdentity(ownerId: string, nodeId: string) {
  const result = await db.$client.execute({
    sql: `SELECT node.publicSigningKey, node.keyId, node.state
      FROM avermate_nodes node
      JOIN node_account_bindings binding ON binding.nodeId = node.id
      WHERE node.id = ? AND binding.userId = ? AND binding.state = 'active'
      LIMIT 1`,
    args: [nodeId, ownerId],
  });
  const row = result.rows[0];
  if (!row) throw new Error("NODE_BINDING_NOT_ACTIVE");
  return {
    publicSigningKey: String(row.publicSigningKey),
    keyId: String(row.keyId),
    state: String(row.state),
  };
}

async function deliverRemoteDeletion(
  record: NonNullable<
    Awaited<ReturnType<CoreRemoteDeletionRepository["loadByManifestDigest"]>>
  >,
) {
  if (record.state === "verified_deleted") return record;
  const identity = await pairedNodeDeletionIdentity(
    record.manifest.userId,
    record.manifest.nodeId,
  );
  if (identity.state === "revoked") {
    await coreRemoteDeletionCoordinator.markRevokedUnreachable(
      record.manifest.digest,
    );
    return coreRemoteDeletionRepository.loadByManifestDigest(
      record.manifest.digest,
    );
  }
  try {
    const receipt =
      await relayNodeProviderTransport.executeNodeDeletionManifest({
        nodeId: record.manifest.nodeId,
        ownerId: record.manifest.userId,
        manifest: record.manifest,
      });
    await coreRemoteDeletionCoordinator.acceptReceipt({
      receipt,
      expectedNodeId: record.manifest.nodeId,
      expectedNodeKeyId: identity.keyId,
      nodePublicKeyDer: identity.publicSigningKey,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "NODE_CAPABILITY_OFFLINE",
        "NODE_CAPABILITY_DEADLINE_EXCEEDED",
        "NODE_OPERATION_DEADLINE_EXPIRED",
      ].includes(error.message)
    ) {
      return record;
    }
    throw error;
  }
  return coreRemoteDeletionRepository.loadByManifestDigest(
    record.manifest.digest,
  );
}

/**
 * Tombstone first, then deliver a signed exact-ref deletion command. Offline
 * delivery remains durable and is retried by the relay reconnect hook.
 */
export async function deletePairedNodeArtifacts(input: {
  ownerId: string;
  nodeId: string;
  artifacts: readonly NodeArtifactRef[];
}) {
  await pairedNodeDeletionIdentity(input.ownerId, input.nodeId);
  const results = [];
  for (const artifact of input.artifacts) {
    if (artifact.object.ownerId !== input.ownerId) {
      throw new Error("NODE_ARTIFACT_OWNER_MISMATCH");
    }
    let current = await coreRemoteDeletionRepository.loadByRef(artifact.object);
    if (
      current &&
      !current.manifest.refs.some(
        (candidate) =>
          candidate.digest === artifact.digest &&
          candidate.byteSize === artifact.byteSize &&
          candidate.mimeType === artifact.mimeType,
      )
    ) {
      throw new Error("NODE_DELETION_TOMBSTONE_ARTIFACT_MISMATCH");
    }
    if (
      current &&
      current.state !== "verified_deleted" &&
      Date.parse(current.manifest.expiresAt) <= Date.now()
    ) {
      await coreRemoteDeletionCoordinator.markUserActionRequired(
        current.manifest.digest,
        "The signed deletion command expired and was superseded by a fresh command.",
      );
      current = null;
    }
    if (!current) {
      const manifest = await coreRemoteDeletionCoordinator.issue({
        nodeId: input.nodeId,
        userId: input.ownerId,
        refs: [artifact],
        ttlMs: 7 * 24 * 60 * 60_000,
      });
      current = await coreRemoteDeletionRepository.loadByManifestDigest(
        manifest.digest,
      );
    }
    if (!current) throw new Error("DELETION_MANIFEST_NOT_FOUND");
    results.push(await deliverRemoteDeletion(current));
  }
  return results;
}

export async function retryPendingNodeDeletions(nodeId: string, limit = 100) {
  const outcomes = [];
  for await (const pending of coreRemoteDeletionCoordinator.pendingDeletionOnlyReconnect(
    nodeId,
    limit,
  )) {
    let deliverable = pending;
    if (Date.parse(pending.manifest.expiresAt) <= Date.now()) {
      await coreRemoteDeletionCoordinator.markUserActionRequired(
        pending.manifest.digest,
        "The signed deletion command expired and was superseded by a fresh command.",
      );
      const replacement = await coreRemoteDeletionCoordinator.issue({
        nodeId: pending.manifest.nodeId,
        userId: pending.manifest.userId,
        refs: pending.manifest.refs,
        ttlMs: 7 * 24 * 60 * 60_000,
      });
      const loaded = await coreRemoteDeletionRepository.loadByManifestDigest(
        replacement.digest,
      );
      if (!loaded) throw new Error("DELETION_MANIFEST_NOT_FOUND");
      deliverable = loaded;
    }
    outcomes.push(await deliverRemoteDeletion(deliverable));
  }
  return outcomes;
}

/** Retry one exact owner-bound deletion from the user/operator surface. */
export async function retryPairedNodeDeletion(input: {
  ownerId: string;
  manifestDigest: string;
}) {
  let record = await coreRemoteDeletionRepository.loadByManifestDigest(
    input.manifestDigest,
  );
  if (!record || record.manifest.userId !== input.ownerId) {
    throw new Error("DELETION_MANIFEST_NOT_FOUND");
  }
  if (record.state === "verified_deleted") return record;
  if (Date.parse(record.manifest.expiresAt) <= Date.now()) {
    await coreRemoteDeletionCoordinator.markUserActionRequired(
      record.manifest.digest,
      "The signed deletion command expired and was superseded by a fresh command.",
    );
    const replacement = await coreRemoteDeletionCoordinator.issue({
      nodeId: record.manifest.nodeId,
      userId: input.ownerId,
      refs: record.manifest.refs,
      ttlMs: 7 * 24 * 60 * 60_000,
    });
    record = await coreRemoteDeletionRepository.loadByManifestDigest(
      replacement.digest,
    );
    if (!record) throw new Error("DELETION_MANIFEST_NOT_FOUND");
  }
  return deliverRemoteDeletion(record);
}

export async function resolveOnlinePairedNode(
  ownerId: string,
  capability:
    "conversations" | "retrieval" | "models" | "sandbox" | "jobs" | "storage",
) {
  const nodes = await coreNodeRegistry.listNodes(ownerId);
  for (const candidate of nodes) {
    if (!candidate.online || !candidate.capabilities.includes(capability)) {
      continue;
    }
    const state = coreNodeRelay.inspect(candidate.nodeId);
    if (state?.userId === ownerId && state.features[capability]) return state;
  }
  return null;
}

export async function createPairedNodeSandboxProvider(input: {
  ownerId: string;
  providerId: SandboxProviderId;
  nodeId?: string;
}) {
  const state = input.nodeId
    ? coreNodeRelay.inspect(input.nodeId)
    : await resolveOnlinePairedNode(input.ownerId, "sandbox");
  if (!state || state.userId !== input.ownerId || !state.features.sandbox) {
    throw new Error("NODE_SANDBOX_CAPABILITY_OFFLINE");
  }
  return new NodeSandboxProvider(
    state.nodeId,
    input.ownerId,
    input.providerId,
    relayNodeProviderTransport,
  );
}

export async function selectedPairedNodeSandboxProvider(input: {
  ownerId: string;
  providerId: SandboxProviderId;
}) {
  const placement = (
    await coreNodeRegistry.currentPlacements(input.ownerId)
  ).find((candidate) => candidate.capability === "sandbox");
  if (
    !placement ||
    placement.placementKind !== "node" ||
    !placement.nodeId ||
    !nodePlacementMigrationReady("sandbox", placement.migrationState)
  ) {
    return null;
  }
  return createPairedNodeSandboxProvider({
    ...input,
    nodeId: placement.nodeId,
  });
}

export function pairedNodeRuntimeCheckpointId(input: {
  ownerId: string;
  nodeId: string;
  workspaceSnapshotId: string;
}) {
  return `nrck_${stableHash(
    `${input.ownerId}\0${input.nodeId}\0${input.workspaceSnapshotId}`,
  ).slice(0, 48)}`;
}

export async function createPairedNodeObjectStorageProvider(input: {
  ownerId: string;
  nodeId?: string;
}) {
  const state = input.nodeId
    ? coreNodeRelay.inspect(input.nodeId)
    : await resolveOnlinePairedNode(input.ownerId, "storage");
  if (!state || state.userId !== input.ownerId || !state.features.storage) {
    throw new Error("NODE_STORAGE_CAPABILITY_OFFLINE");
  }
  const provider = new RelayNodeObjectStorageProvider(
    state.nodeId,
    input.ownerId,
    relayNodeProviderTransport,
  );
  const capabilities = await provider.capabilities();
  if (!capabilities.range || !capabilities.multipart) {
    throw new Error("NODE_STORAGE_CAPABILITY_INCOMPLETE");
  }
  return provider;
}

export async function selectedNodeObjectStorageProvider(ownerId: string) {
  const placement = (await coreNodeRegistry.currentPlacements(ownerId)).find(
    (candidate) => candidate.capability === "storage",
  );
  if (
    !placement ||
    placement.placementKind !== "node" ||
    !placement.nodeId ||
    !nodePlacementMigrationReady("storage", placement.migrationState)
  ) {
    return null;
  }
  return createPairedNodeObjectStorageProvider({
    ownerId,
    nodeId: placement.nodeId,
  });
}

export function nodeIdFromStorageProvider(providerId: string) {
  const match = /^node:(node_[A-Za-z0-9_-]+):relay-storage-v1$/u.exec(
    providerId,
  );
  return match?.[1] ?? null;
}

export async function createPairedNodeProviderFetcher(input: {
  ownerId: string;
  purpose: "embedding" | "rerank";
  nodeId?: string;
}): Promise<NodeProviderFetcher> {
  const state = input.nodeId
    ? coreNodeRelay.inspect(input.nodeId)
    : await resolveOnlinePairedNode(input.ownerId, "retrieval");
  if (!state || state.userId !== input.ownerId || !state.features.retrieval) {
    throw new Error("NODE_RETRIEVAL_CAPABILITY_OFFLINE");
  }
  return createRelayNodeProviderFetcher({
    transport: relayNodeProviderTransport,
    nodeId: state.nodeId,
    ownerId: input.ownerId,
    purpose: input.purpose,
  });
}

export async function createPairedNodeRerankProvider(input: {
  ownerId: string;
  nodeId?: string;
  baseUrl: string;
  provider: "tei" | "qwen3";
  model: string;
  modelRevision: string;
  runtimeRevision: string;
  imageDigest: string;
}) {
  return new PairedNodeRerankProvider({
    fetch: await createPairedNodeProviderFetcher({
      ownerId: input.ownerId,
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      purpose: "rerank",
    }),
    baseUrl: input.baseUrl,
    provider: input.provider,
    model: input.model,
    modelRevision: input.modelRevision,
    runtimeRevision: input.runtimeRevision,
    imageDigest: input.imageDigest,
  });
}

export async function dispatchPairedNodeJob(input: {
  ownerId: string;
  nodeId?: string;
  jobId: string;
  kind: string;
  capabilityVersion?: number;
  inputRefs: readonly NodeArtifactRef[];
  resourceRefs?: readonly OwnedObjectRef[];
  limits: NodeJobLimits;
  idempotencyKey: string;
  /** Selection-time fences rechecked against the live signed relay state. */
  expectedConfigRevision?: string;
  expectedExecutionProfile?: NodeJobExecutionProfile;
  expectedModel?: {
    id: string;
    provider: string;
    modality: "text" | "image" | "audio" | "video" | "embedding";
    revision: string;
  };
  actorKind?: "embedded-agent" | "mcp" | "system" | "user";
  actorClientId?: string;
  signal?: AbortSignal;
  /** Return an observed failed terminal so a caller can advance generation. */
  allowTerminalFailure?: boolean;
  onEvent?: (event: NodeJobEvent) => Promise<void> | void;
}) {
  const state = input.nodeId
    ? coreNodeRelay.inspect(input.nodeId)
    : await resolveOnlinePairedNode(input.ownerId, "jobs");
  if (!state || state.userId !== input.ownerId || !state.features.jobs) {
    throw new Error("NODE_JOB_CAPABILITY_OFFLINE");
  }
  const capabilityVersion = input.capabilityVersion ?? 1;
  if (
    !state.features.jobs.kinds.includes(`${input.kind}@${capabilityVersion}`)
  ) {
    throw new Error("NODE_JOB_KIND_NOT_ADVERTISED");
  }
  assertNodeJobDispatchAttestation({
    state: {
      configRevision: state.configRevision,
      features: state.features,
    },
    kind: input.kind,
    capabilityVersion,
    expectedConfigRevision: input.expectedConfigRevision,
    expectedExecutionProfile: input.expectedExecutionProfile,
    expectedModel: input.expectedModel,
  });
  const job = coreNodeGrantIssuer.issueJob({
    id: input.jobId,
    principalRef: {
      userId: input.ownerId,
      nodeId: state.nodeId,
      actorKind: input.actorKind ?? "system",
      ...(input.actorClientId ? { actorClientId: input.actorClientId } : {}),
    },
    kind: input.kind,
    capabilityVersion,
    ...(input.expectedExecutionProfile
      ? { executionProfile: input.expectedExecutionProfile }
      : {}),
    inputRefs: [...input.inputRefs],
    resourceRefs: [
      ...(input.resourceRefs ??
        input.inputRefs.map((artifact) => artifact.object)),
    ],
    policyRef: state.configRevision,
    limits: input.limits,
    idempotencyKey: input.idempotencyKey,
  });
  const terminal = await coreNodeRelay.dispatchJob({
    userId: input.ownerId,
    nodeId: state.nodeId,
    job,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  });
  if (terminal.stage === "failed" && input.allowTerminalFailure) {
    return {
      nodeId: state.nodeId,
      configRevision: state.configRevision,
      job,
      terminal,
      resultManifest: [] as NodeArtifactRef[],
    };
  }
  if (terminal.stage !== "completed" || !terminal.resultManifest) {
    throw new Error(
      terminal.safeErrorCode ??
        (terminal.stage === "cancelled"
          ? "NODE_JOB_CANCELLED"
          : "NODE_JOB_FAILED"),
    );
  }
  return {
    nodeId: state.nodeId,
    configRevision: state.configRevision,
    job,
    terminal,
    resultManifest: terminal.resultManifest,
  };
}

export function assertNodeJobDispatchAttestation(input: {
  state: { configRevision: string; features: NodeCapabilityFeatures };
  kind: string;
  capabilityVersion: number;
  expectedConfigRevision?: string;
  expectedExecutionProfile?: NodeJobExecutionProfile;
  expectedModel?: {
    id: string;
    provider: string;
    modality: "text" | "image" | "audio" | "video" | "embedding";
    revision: string;
  };
}) {
  if (
    input.expectedConfigRevision !== undefined &&
    input.state.configRevision !== input.expectedConfigRevision
  ) {
    throw new Error("NODE_JOB_ATTESTATION_CONFIG_DRIFT");
  }
  if (input.expectedExecutionProfile) {
    const exactKind = `${input.kind}@${input.capabilityVersion}`;
    const candidates =
      input.state.features.jobs?.executionProfiles?.filter(
        (profile) => profile.kind === exactKind,
      ) ?? [];
    const current = candidates.length === 1 ? candidates[0] : undefined;
    const expected = input.expectedExecutionProfile;
    if (
      !current ||
      current.kind !== expected.kind ||
      current.sandboxProfileId !== expected.sandboxProfileId ||
      current.profileVersion !== expected.profileVersion ||
      current.imageDigest !== expected.imageDigest ||
      current.egressPolicyDigest !== expected.egressPolicyDigest
    ) {
      throw new Error("NODE_JOB_ATTESTATION_PROFILE_DRIFT");
    }
  }
  if (input.expectedModel) {
    const candidates =
      input.state.features.models?.models.filter(
        (model) => model.id === input.expectedModel!.id,
      ) ?? [];
    const current = candidates.length === 1 ? candidates[0] : undefined;
    const revision =
      input.state.features.models?.revisions?.[input.expectedModel.id];
    if (
      !current ||
      current.provider !== input.expectedModel.provider ||
      current.modalities.length !== 1 ||
      current.modalities[0] !== input.expectedModel.modality ||
      current.contextWindow !== "unknown" ||
      Object.values(current.capabilities).some(Boolean) ||
      revision !== input.expectedModel.revision
    ) {
      throw new Error("NODE_JOB_ATTESTATION_MODEL_DRIFT");
    }
  }
}

/**
 * Pull one immutable reviewed result over the signed owner-bound storage lane.
 * Core recomputes every byte invariant before the caller may persist it.
 */
export async function readPairedNodeArtifact(input: {
  ownerId: string;
  nodeId: string;
  artifact: NodeArtifactRef;
  maxBytes: number;
  signal?: AbortSignal;
}) {
  if (input.signal?.aborted) throw nodeArtifactAbortReason(input.signal);
  if (
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes <= 0 ||
    input.maxBytes > MAX_NODE_ARTIFACT_ADOPTION_BYTES
  ) {
    throw new Error("NODE_ARTIFACT_ADOPTION_LIMIT_INVALID");
  }
  if (input.artifact.object.ownerId !== input.ownerId) {
    throw new Error("NODE_ARTIFACT_OWNER_MISMATCH");
  }
  if (input.artifact.byteSize > input.maxBytes) {
    throw new Error("NODE_ARTIFACT_ADOPTION_LIMIT_EXCEEDED");
  }
  const state = coreNodeRelay.inspect(input.nodeId);
  if (
    !state ||
    state.userId !== input.ownerId ||
    !state.features.storage ||
    !state.features.jobs
  ) {
    throw new Error("NODE_ARTIFACT_SOURCE_OFFLINE");
  }
  const metadata = await relayNodeProviderTransport.statNodeObject({
    nodeId: input.nodeId,
    ownerId: input.ownerId,
    ref: input.artifact.object,
    signal: input.signal,
  });
  if (!metadata) throw new Error("NODE_ARTIFACT_NOT_FOUND");
  if (
    metadata.digest !== input.artifact.digest ||
    metadata.byteSize !== input.artifact.byteSize ||
    metadata.mimeType !== input.artifact.mimeType
  ) {
    throw new Error("NODE_ARTIFACT_METADATA_MISMATCH");
  }
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let total = 0;
  const iterator = relayNodeProviderTransport
    .readNodeObject({
      nodeId: input.nodeId,
      ownerId: input.ownerId,
      ref: input.artifact.object,
      maxBytes: input.maxBytes,
      signal: input.signal,
    })
    [Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await nextNodeArtifactChunk(iterator, input.signal);
      if (next.done) break;
      const chunk = next.value;
      total += chunk.byteLength;
      if (total > input.maxBytes || total > input.artifact.byteSize) {
        throw new Error("NODE_ARTIFACT_ADOPTION_LIMIT_EXCEEDED");
      }
      hash.update(chunk);
      chunks.push(chunk);
    }
  } finally {
    if (input.signal?.aborted) {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    }
  }
  const observedDigest = `sha256:${hash.digest("hex")}`;
  if (total !== input.artifact.byteSize) {
    throw new Error("NODE_ARTIFACT_STREAM_TRUNCATED");
  }
  if (observedDigest !== input.artifact.digest) {
    throw new Error("NODE_ARTIFACT_DIGEST_MISMATCH");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Object.freeze({ metadata, bytes });
}
