import { describe, expect, test } from "bun:test";
import type {
  SandboxCreateInput,
  SandboxHandle,
  SandboxProvider,
  SandboxRuntimeCheckpointRefV1,
  SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import { RuntimeCheckpointCoordinator } from "./runtime-checkpoint";

const imageDigest = `sha256:${"a".repeat(64)}` as const;
const logical: SandboxWorkspaceSnapshotRef = {
  provider: "opensandbox",
  digest: `sha256:${"b".repeat(64)}`,
  format: "avermate-portable-workspace-v1",
};
const compatibility = {
  provider: "opensandbox" as const,
  region: "local",
  architecture: "amd64" as const,
  runtimeKind: "docker-runc",
  runtimeVersion: "29.1.2",
  imageDigest,
  profileId: "latex" as const,
  profileVersion: "reviewed-v1",
};
const handle: SandboxHandle = {
  providerId: "opensandbox",
  sandboxId: "sandbox-fixture",
  ownerId: "owner-fixture",
  threadId: "thread-fixture",
  branchId: "branch-fixture",
  profileId: "latex",
  profileVersion: "reviewed-v1",
  image: { profileVersion: "reviewed-v1", imageDigest },
  evidenceNonce: "evidence-fixture",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function checkpoint(expiresAt: Date): SandboxRuntimeCheckpointRefV1 {
  return {
    version: 1,
    checkpoint: {
      provider: "opensandbox",
      opaqueRef: "native-snapshot-fixture",
      portable: false,
    },
    compatibility,
    sourceWorkspaceSnapshot: logical,
    captureState: "captured",
    adoptedObjectRefs: [],
    capturedAt: new Date(0).toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

function provider(input: { restoreFails?: boolean } = {}) {
  const calls = { nativeRestore: 0, logicalFork: 0 };
  const value = {
    id: "opensandbox",
    async runtimeCheckpointCapabilities() {
      return {
        available: true as const,
        provider: "opensandbox" as const,
        regions: ["local"],
        architectures: ["amd64" as const],
        runtimeKind: "docker-runc",
        runtimeVersion: "29.1.2",
        maximumTtlSeconds: 86_400,
      };
    },
    async captureRuntimeCheckpoint() {
      return checkpoint(new Date(Date.now() + 60_000));
    },
    async restoreRuntimeCheckpoint() {
      calls.nativeRestore += 1;
      if (input.restoreFails) throw new Error("native checkpoint unavailable");
      return handle;
    },
    async deleteRuntimeCheckpoint() {},
    async forkWorkspace() {
      calls.logicalFork += 1;
      return handle;
    },
  } as unknown as SandboxProvider;
  return { value, calls };
}

const create = {} as SandboxCreateInput;

describe("runtime checkpoint coordinator", () => {
  test("falls back to the committed logical snapshot when native restore fails", async () => {
    const fixture = provider({ restoreFails: true });
    const restored = await new RuntimeCheckpointCoordinator().restoreOrFallback({
      provider: fixture.value,
      create,
      logicalWorkspaceSnapshot: logical,
      checkpoint: checkpoint(new Date(Date.now() + 60_000)),
      expectedCompatibility: compatibility,
    });

    expect(restored.path).toBe("logical-workspace");
    expect(restored).toMatchObject({ reason: "runtime-restore-failed" });
    expect(fixture.calls).toEqual({ nativeRestore: 1, logicalFork: 1 });
  });

  test("never attempts an expired native checkpoint and restores logical state", async () => {
    const fixture = provider();
    const restored = await new RuntimeCheckpointCoordinator().restoreOrFallback({
      provider: fixture.value,
      create,
      logicalWorkspaceSnapshot: logical,
      checkpoint: checkpoint(new Date(1_000)),
      expectedCompatibility: compatibility,
      now: new Date(2_000),
    });

    expect(restored.path).toBe("logical-workspace");
    expect(restored).toMatchObject({ reason: "checkpoint-expired" });
    expect(fixture.calls).toEqual({ nativeRestore: 0, logicalFork: 1 });
  });
});
