import {
  sandboxHandleSchema,
  sandboxRuntimeCheckpointCompatibilityV1Schema,
  sandboxRuntimeCheckpointRefV1Schema,
  sandboxWorkspaceSnapshotRefSchema,
  type SandboxCreateInput,
  type SandboxHandle,
  type SandboxRuntimeCheckpointCompatibilityV1,
  type SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import type { SnapshotLedger } from "../sandbox/snapshot-ledger";
import { canonicalJson } from "../search/values";
import { NodeCapabilityUnavailableError } from "./fail-closed-adapters";
import type { NodeSandboxProvider } from "./node-provider-adapters";
import type {
  CoreNodeRuntimeCheckpointRepository,
  NodeRuntimeCheckpointRecord,
} from "./sql-runtime-checkpoint-repository";

type CheckpointRepository = Pick<
  CoreNodeRuntimeCheckpointRepository,
  | "loadOwned"
  | "loadForWorkspaceOwned"
  | "recordCaptured"
  | "markAdopted"
  | "markDeleted"
>;

type LogicalSnapshotLedger = Pick<SnapshotLedger, "attachRuntimeCheckpoint">;

export type PairedNodeRuntimeRestoreReason =
  | "checkpoint-unavailable"
  | "checkpoint-not-adopted"
  | "checkpoint-expired"
  | "checkpoint-incompatible"
  | "provider-unsupported"
  | "runtime-restore-failed";

export type PairedNodeRuntimeRestoreResult =
  | {
      readonly path: "runtime-checkpoint";
      readonly handle: SandboxHandle;
      readonly checkpointId: string;
    }
  | {
      readonly path: "logical-workspace";
      readonly handle: SandboxHandle;
      readonly reason: PairedNodeRuntimeRestoreReason;
      readonly checkpointCapture: "adopted" | "failed" | "not-requested";
    };

function exact(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertProviderBoundary(input: {
  ownerId: string;
  nodeId?: string;
  provider: NodeSandboxProvider;
}) {
  if (
    input.provider.ownerId !== input.ownerId ||
    (input.nodeId && input.provider.nodeId !== input.nodeId)
  ) {
    throw new Error("NODE_RUNTIME_CHECKPOINT_OWNER_MISMATCH");
  }
}

function unavailable(error: unknown) {
  return (
    error instanceof NodeCapabilityUnavailableError ||
    (error instanceof Error &&
      [
        "NODE_CAPABILITY_OFFLINE",
        "NODE_SANDBOX_CAPABILITY_OFFLINE",
        "NODE_SANDBOX_UNAVAILABLE",
      ].includes(error.message))
  );
}

/**
 * Owner-fenced orchestration for a Node-native runtime accelerator. The SQL
 * workspace snapshot remains the authority; the provider checkpoint is only
 * attempted after that exact logical snapshot has committed.
 */
export class PairedNodeRuntimeCheckpointLifecycle {
  constructor(
    private readonly repository: CheckpointRepository,
    private readonly snapshots: LogicalSnapshotLedger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async captureCommitted(input: {
    checkpointId: string;
    ownerId: string;
    workspaceSnapshotId: string;
    provider: NodeSandboxProvider;
    handle: SandboxHandle;
    sourceWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
    compatibility: SandboxRuntimeCheckpointCompatibilityV1;
    expiresAt: Date;
  }): Promise<NodeRuntimeCheckpointRecord> {
    assertProviderBoundary(input);
    const source = sandboxWorkspaceSnapshotRefSchema.parse(
      input.sourceWorkspaceSnapshot,
    );
    const compatibility = sandboxRuntimeCheckpointCompatibilityV1Schema.parse(
      input.compatibility,
    );
    if (
      source.provider !== input.provider.id ||
      compatibility.provider !== input.provider.id
    ) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_PROVIDER_MISMATCH");
    }

    const replay = await this.repository.loadOwned({
      id: input.checkpointId,
      ownerId: input.ownerId,
      nodeId: input.provider.nodeId,
    });
    if (replay) {
      if (replay.workspaceSnapshotId !== input.workspaceSnapshotId) {
        throw new Error("NODE_RUNTIME_CHECKPOINT_IDEMPOTENCY_MISMATCH");
      }
      if (replay.state === "adopted") return replay;
      if (replay.state === "captured") return this.adopt(replay);
      throw new Error("NODE_RUNTIME_CHECKPOINT_STATE_CONFLICT");
    }

    const capabilities = await input.provider.runtimeCheckpointCapabilities();
    if (!capabilities.available) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_UNAVAILABLE");
    }
    const ttlSeconds = Math.ceil(
      (input.expiresAt.getTime() - this.clock().getTime()) / 1_000,
    );
    if (
      ttlSeconds < 1 ||
      ttlSeconds > capabilities.maximumTtlSeconds ||
      capabilities.provider !== compatibility.provider ||
      !capabilities.regions.includes(compatibility.region) ||
      !capabilities.architectures.includes(compatibility.architecture) ||
      capabilities.runtimeKind !== compatibility.runtimeKind ||
      capabilities.runtimeVersion !== compatibility.runtimeVersion
    ) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_COMPATIBILITY_MISMATCH");
    }

    const checkpoint = sandboxRuntimeCheckpointRefV1Schema.parse(
      await input.provider.captureRuntimeCheckpoint({
        handle: input.handle,
        sourceWorkspaceSnapshot: source,
        compatibility,
        idempotencyKey: input.checkpointId,
        expiresAt: input.expiresAt,
      }),
    );
    const captured = await this.repository.recordCaptured({
      id: input.checkpointId,
      ownerId: input.ownerId,
      nodeId: input.provider.nodeId,
      workspaceSnapshotId: input.workspaceSnapshotId,
      checkpoint,
    });

    // If the process dies after recordCaptured, reconciliation/replay starts
    // here and never asks the provider to create a second checkpoint.
    return this.adopt(captured);
  }

  async restoreOrFallback(input: {
    ownerId: string;
    workspaceSnapshotId: string;
    provider: NodeSandboxProvider;
    create: SandboxCreateInput;
    logicalWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
    expectedCompatibility: SandboxRuntimeCheckpointCompatibilityV1;
    capture?: {
      checkpointId: string;
      expiresAt: Date;
    };
  }): Promise<PairedNodeRuntimeRestoreResult> {
    assertProviderBoundary(input);
    if (input.create.ownerId !== input.ownerId) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_OWNER_MISMATCH");
    }
    const logical = sandboxWorkspaceSnapshotRefSchema.parse(
      input.logicalWorkspaceSnapshot,
    );
    const expected = sandboxRuntimeCheckpointCompatibilityV1Schema.parse(
      input.expectedCompatibility,
    );
    if (
      logical.provider !== input.provider.id ||
      expected.provider !== input.provider.id ||
      input.create.profile.id !== expected.profileId ||
      input.create.profile.version !== expected.profileVersion ||
      input.create.profile.image.imageDigest !== expected.imageDigest
    ) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_COMPATIBILITY_MISMATCH");
    }

    let stored = await this.repository.loadForWorkspaceOwned({
      workspaceSnapshotId: input.workspaceSnapshotId,
      ownerId: input.ownerId,
      nodeId: input.provider.nodeId,
    });

    const fallback = async (
      reason: PairedNodeRuntimeRestoreReason,
      allowCapture: boolean,
    ): Promise<PairedNodeRuntimeRestoreResult> => {
      const handle = sandboxHandleSchema.parse(
        await input.provider.forkWorkspace({
          ...input.create,
          workspaceSnapshotRef: logical,
          source: logical,
        }),
      );
      let checkpointCapture: "adopted" | "failed" | "not-requested" =
        "not-requested";
      if (allowCapture && input.capture) {
        try {
          await this.captureCommitted({
            checkpointId: input.capture.checkpointId,
            ownerId: input.ownerId,
            workspaceSnapshotId: input.workspaceSnapshotId,
            provider: input.provider,
            handle,
            sourceWorkspaceSnapshot: logical,
            compatibility: expected,
            expiresAt: input.capture.expiresAt,
          });
          checkpointCapture = "adopted";
        } catch (error) {
          if (unavailable(error)) throw error;
          checkpointCapture = "failed";
        }
      }
      return {
        path: "logical-workspace",
        handle,
        reason,
        checkpointCapture,
      };
    };

    if (!stored) return fallback("checkpoint-unavailable", true);
    if (stored.state === "captured") {
      try {
        stored = await this.adopt(stored);
      } catch {
        return fallback("checkpoint-not-adopted", true);
      }
    }
    if (stored.state !== "adopted") {
      return fallback("checkpoint-not-adopted", false);
    }
    if (Date.parse(stored.checkpoint.expiresAt) <= this.clock().getTime()) {
      await this.delete({
        checkpointId: stored.id,
        ownerId: input.ownerId,
        provider: input.provider,
      }).catch(() => undefined);
      return fallback("checkpoint-expired", false);
    }

    const capabilities = await input.provider.runtimeCheckpointCapabilities();
    if (!capabilities.available) {
      return fallback("provider-unsupported", false);
    }
    if (
      !exact(stored.checkpoint.compatibility, expected) ||
      !exact(stored.checkpoint.sourceWorkspaceSnapshot, logical) ||
      capabilities.provider !== expected.provider ||
      !capabilities.regions.includes(expected.region) ||
      !capabilities.architectures.includes(expected.architecture) ||
      capabilities.runtimeKind !== expected.runtimeKind ||
      capabilities.runtimeVersion !== expected.runtimeVersion
    ) {
      return fallback("checkpoint-incompatible", false);
    }
    try {
      return {
        path: "runtime-checkpoint",
        checkpointId: stored.id,
        handle: sandboxHandleSchema.parse(
          await input.provider.restoreRuntimeCheckpoint({
            create: { ...input.create, workspaceSnapshotRef: logical },
            checkpoint: stored.checkpoint,
          }),
        ),
      };
    } catch (error) {
      // Node placement is fail-closed: an offline/revoked Node never causes a
      // hidden Core execution. Provider checkpoint corruption alone may use
      // the logical snapshot on the same owner-bound Node.
      if (unavailable(error)) throw error;
      return fallback("runtime-restore-failed", false);
    }
  }

  async delete(input: {
    checkpointId: string;
    ownerId: string;
    provider: NodeSandboxProvider;
  }) {
    assertProviderBoundary(input);
    const stored = await this.repository.loadOwned({
      id: input.checkpointId,
      ownerId: input.ownerId,
      nodeId: input.provider.nodeId,
    });
    if (!stored || stored.state === "deleted") return stored;
    if (stored.checkpoint.compatibility.provider !== input.provider.id) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_PROVIDER_MISMATCH");
    }
    await input.provider.deleteRuntimeCheckpoint(stored.checkpoint);
    return this.repository.markDeleted({
      id: stored.id,
      ownerId: stored.ownerId,
      nodeId: stored.nodeId,
    });
  }

  private async adopt(captured: NodeRuntimeCheckpointRecord) {
    if (captured.state !== "captured") {
      throw new Error("NODE_RUNTIME_CHECKPOINT_STATE_CONFLICT");
    }
    if (Date.parse(captured.checkpoint.expiresAt) <= this.clock().getTime()) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_EXPIRED");
    }
    await this.snapshots.attachRuntimeCheckpoint({
      recordId: captured.workspaceSnapshotId,
      runtimeCheckpointRef: captured.checkpoint.checkpoint,
      imageDigest: captured.checkpoint.compatibility.imageDigest,
      executionProfileVersion: captured.checkpoint.compatibility.profileVersion,
    });
    return this.repository.markAdopted({
      id: captured.id,
      ownerId: captured.ownerId,
      nodeId: captured.nodeId,
      adoptedObjectRefs: captured.checkpoint.adoptedObjectRefs,
    });
  }
}
