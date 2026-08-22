import type {
  SandboxCreateInput,
  SandboxHandle,
  SandboxProvider,
  SandboxRuntimeCheckpointCapabilities,
  SandboxRuntimeCheckpointCompatibilityV1,
  SandboxRuntimeCheckpointRefV1,
  SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import {
  sandboxHandleSchema,
  sandboxRuntimeCheckpointCapabilitiesSchema,
  sandboxRuntimeCheckpointCompatibilityV1Schema,
  sandboxRuntimeCheckpointRefV1Schema,
  sandboxWorkspaceSnapshotRefSchema,
} from "@avermate/agent-contracts";
import { canonicalDigest } from "./canonical-json";

function supportsRuntimeCheckpoints(provider: SandboxProvider) {
  return Boolean(
    provider.runtimeCheckpointCapabilities &&
    provider.captureRuntimeCheckpoint &&
    provider.restoreRuntimeCheckpoint &&
    provider.deleteRuntimeCheckpoint,
  );
}

function exactCompatibility(
  left: SandboxRuntimeCheckpointCompatibilityV1,
  right: SandboxRuntimeCheckpointCompatibilityV1,
) {
  return canonicalDigest(left) === canonicalDigest(right);
}

export type RuntimeCheckpointRestoreResult =
  | { path: "runtime-checkpoint"; handle: SandboxHandle }
  | {
      path: "logical-workspace";
      handle: SandboxHandle;
      reason:
        | "provider-unsupported"
        | "checkpoint-expired"
        | "checkpoint-incompatible"
        | "runtime-restore-failed";
    };

/**
 * Runtime checkpoints accelerate an exact-compatible restore only. The
 * committed logical workspace remains the portable source of truth.
 */
export class RuntimeCheckpointCoordinator {
  async capabilities(
    provider: SandboxProvider,
  ): Promise<SandboxRuntimeCheckpointCapabilities> {
    if (!supportsRuntimeCheckpoints(provider)) {
      return { available: false, reason: "provider-unsupported" };
    }
    return sandboxRuntimeCheckpointCapabilitiesSchema.parse(
      await provider.runtimeCheckpointCapabilities!(),
    );
  }

  async capture(input: {
    provider: SandboxProvider;
    handle: SandboxHandle;
    logicalWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
    logicalWorkspaceSnapshotCommitted: true;
    compatibility: SandboxRuntimeCheckpointCompatibilityV1;
    idempotencyKey: string;
    expiresAt: Date;
    now?: Date;
  }) {
    const handle = sandboxHandleSchema.parse(input.handle);
    const workspace = sandboxWorkspaceSnapshotRefSchema.parse(
      input.logicalWorkspaceSnapshot,
    );
    const compatibility = sandboxRuntimeCheckpointCompatibilityV1Schema.parse(
      input.compatibility,
    );
    const capabilities = await this.capabilities(input.provider);
    if (!capabilities.available) {
      throw new Error("SANDBOX_RUNTIME_CHECKPOINT_UNAVAILABLE");
    }
    if (
      ["disabled", "mock"].includes(input.provider.id) ||
      input.provider.id !== handle.providerId ||
      input.provider.id !== workspace.provider ||
      input.provider.id !== compatibility.provider
    ) {
      throw new Error("SANDBOX_RUNTIME_CHECKPOINT_PROVIDER_MISMATCH");
    }
    if (
      handle.profileId !== compatibility.profileId ||
      handle.profileVersion !== compatibility.profileVersion ||
      handle.image.imageDigest !== compatibility.imageDigest
    ) {
      throw new Error("SANDBOX_RUNTIME_CHECKPOINT_COMPATIBILITY_MISMATCH");
    }
    const now = input.now ?? new Date();
    const ttlSeconds = Math.ceil(
      (input.expiresAt.getTime() - now.getTime()) / 1_000,
    );
    if (ttlSeconds < 1 || ttlSeconds > capabilities.maximumTtlSeconds) {
      throw new Error("SANDBOX_RUNTIME_CHECKPOINT_TTL_INVALID");
    }
    if (
      !capabilities.architectures.includes(compatibility.architecture) ||
      !capabilities.regions.includes(compatibility.region) ||
      capabilities.runtimeKind !== compatibility.runtimeKind ||
      capabilities.runtimeVersion !== compatibility.runtimeVersion
    ) {
      throw new Error("SANDBOX_RUNTIME_CHECKPOINT_CAPABILITY_MISMATCH");
    }
    const checkpoint = sandboxRuntimeCheckpointRefV1Schema.parse(
      await input.provider.captureRuntimeCheckpoint!({
        handle,
        sourceWorkspaceSnapshot: workspace,
        compatibility,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
      }),
    );
    if (
      checkpoint.captureState !== "captured" ||
      checkpoint.adoptedObjectRefs.length !== 0 ||
      checkpoint.captureIdempotencyKey !== input.idempotencyKey ||
      !exactCompatibility(checkpoint.compatibility, compatibility) ||
      canonicalDigest(checkpoint.sourceWorkspaceSnapshot) !==
        canonicalDigest(workspace)
    ) {
      throw new Error("SANDBOX_RUNTIME_CHECKPOINT_RESPONSE_MISMATCH");
    }
    return checkpoint;
  }

  async restoreOrFallback(input: {
    provider: SandboxProvider;
    create: SandboxCreateInput;
    logicalWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
    checkpoint: SandboxRuntimeCheckpointRefV1 | null;
    expectedCompatibility: SandboxRuntimeCheckpointCompatibilityV1;
    now?: Date;
  }): Promise<RuntimeCheckpointRestoreResult> {
    const workspace = sandboxWorkspaceSnapshotRefSchema.parse(
      input.logicalWorkspaceSnapshot,
    );
    const compatibility = sandboxRuntimeCheckpointCompatibilityV1Schema.parse(
      input.expectedCompatibility,
    );
    const fallback = async (
      reason: Extract<
        RuntimeCheckpointRestoreResult,
        { path: "logical-workspace" }
      >["reason"],
    ): Promise<RuntimeCheckpointRestoreResult> => ({
      path: "logical-workspace",
      reason,
      handle: sandboxHandleSchema.parse(
        await input.provider.forkWorkspace({
          ...input.create,
          workspaceSnapshotRef: workspace,
          source: workspace,
        }),
      ),
    });
    if (!input.checkpoint || !supportsRuntimeCheckpoints(input.provider)) {
      return fallback("provider-unsupported");
    }
    const checkpoint = sandboxRuntimeCheckpointRefV1Schema.parse(
      input.checkpoint,
    );
    if (
      Date.parse(checkpoint.expiresAt) <= (input.now ?? new Date()).getTime()
    ) {
      return fallback("checkpoint-expired");
    }
    if (
      !exactCompatibility(checkpoint.compatibility, compatibility) ||
      canonicalDigest(checkpoint.sourceWorkspaceSnapshot) !==
        canonicalDigest(workspace)
    ) {
      return fallback("checkpoint-incompatible");
    }
    try {
      return {
        path: "runtime-checkpoint",
        handle: sandboxHandleSchema.parse(
          await input.provider.restoreRuntimeCheckpoint!({
            create: { ...input.create, workspaceSnapshotRef: workspace },
            checkpoint,
          }),
        ),
      };
    } catch {
      return fallback("runtime-restore-failed");
    }
  }

  async delete(input: {
    provider: SandboxProvider;
    checkpoint: SandboxRuntimeCheckpointRefV1;
  }) {
    if (!supportsRuntimeCheckpoints(input.provider)) return false;
    const checkpoint = sandboxRuntimeCheckpointRefV1Schema.parse(
      input.checkpoint,
    );
    if (checkpoint.compatibility.provider !== input.provider.id) {
      throw new Error("SANDBOX_RUNTIME_CHECKPOINT_PROVIDER_MISMATCH");
    }
    await input.provider.deleteRuntimeCheckpoint!(checkpoint);
    return true;
  }
}
