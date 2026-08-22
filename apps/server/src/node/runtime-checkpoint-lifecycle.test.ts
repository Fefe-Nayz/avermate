import { describe, expect, test } from "bun:test";
import {
  type NodeSandboxTransport,
  type SandboxCreateInput,
  type SandboxHandle,
  type SandboxRuntimeCheckpointRefV1,
} from "@avermate/agent-contracts";
import { enableSandboxProfile } from "../sandbox/profiles";
import { NodeSandboxProvider } from "./node-provider-adapters";
import { PairedNodeRuntimeCheckpointLifecycle } from "./runtime-checkpoint-lifecycle";
import type { NodeRuntimeCheckpointRecord } from "./sql-runtime-checkpoint-repository";

const ownerId = "runtime-owner";
const nodeId = "node_runtime_owner";
const now = new Date("2026-08-22T12:00:00.000Z");
const profile = enableSandboxProfile("opencode", {
  version: "opencode-runtime-v1",
  imageDigest: `sha256:${"a".repeat(64)}`,
});
const logical = {
  provider: "opensandbox" as const,
  digest: `sha256:${"b".repeat(64)}` as const,
  format: "avermate-portable-workspace-v1",
};
const compatibility = {
  provider: "opensandbox" as const,
  region: "local",
  architecture: "amd64" as const,
  runtimeKind: "containerd",
  runtimeVersion: "2.0.0",
  imageDigest: profile.image.imageDigest,
  profileId: profile.id,
  profileVersion: profile.version,
};

function create(branchId = "branch-destination") {
  return {
    operationId: `restore-${branchId}`,
    ownerId,
    threadId: "thread-runtime",
    branchId,
    profile,
    expectedHostPolicyDigest: `sha256:${"c".repeat(64)}`,
    maxEvidenceAgeMs: 60_000,
    now,
    expiresAt: new Date(now.getTime() + 60_000),
  };
}

function handleFor(input: SandboxCreateInput, ordinal: number): SandboxHandle {
  return {
    providerId: "opensandbox",
    sandboxId: `sandbox-runtime-${ordinal}`,
    ownerId: input.ownerId,
    threadId: input.threadId,
    branchId: input.branchId,
    profileId: input.profile.id,
    profileVersion: input.profile.version,
    image: input.profile.image,
    evidenceNonce: `runtime-evidence-${ordinal}`,
    expiresAt: input.expiresAt.toISOString(),
  };
}

class MemoryRepository {
  records = new Map<string, NodeRuntimeCheckpointRecord>();

  async loadOwned(input: { id: string; ownerId: string; nodeId?: string }) {
    const record = this.records.get(input.id) ?? null;
    if (
      record &&
      (record.ownerId !== input.ownerId ||
        (input.nodeId && record.nodeId !== input.nodeId))
    ) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_OWNER_MISMATCH");
    }
    return record;
  }

  async loadForWorkspaceOwned(input: {
    workspaceSnapshotId: string;
    ownerId: string;
    nodeId?: string;
  }) {
    const candidates = [...this.records.values()].filter(
      (record) => record.workspaceSnapshotId === input.workspaceSnapshotId,
    );
    if (
      candidates.length > 0 &&
      candidates.every(
        (record) =>
          record.ownerId !== input.ownerId ||
          (input.nodeId && record.nodeId !== input.nodeId),
      )
    ) {
      throw new Error("NODE_RUNTIME_CHECKPOINT_OWNER_MISMATCH");
    }
    return (
      candidates.find(
        (record) =>
          record.ownerId === input.ownerId &&
          (!input.nodeId || record.nodeId === input.nodeId),
      ) ?? null
    );
  }

  async recordCaptured(input: {
    id: string;
    ownerId: string;
    nodeId: string;
    workspaceSnapshotId: string;
    checkpoint: SandboxRuntimeCheckpointRefV1;
  }) {
    const existing = this.records.get(input.id);
    if (existing) return existing;
    const record: NodeRuntimeCheckpointRecord = {
      ...input,
      state: "captured",
      safeErrorCode: null,
      deletedAt: null,
    };
    this.records.set(input.id, record);
    return record;
  }

  async markAdopted(input: {
    id: string;
    ownerId: string;
    nodeId: string;
    adoptedObjectRefs?: readonly string[];
  }) {
    const current = (await this.loadOwned(input))!;
    const adopted: NodeRuntimeCheckpointRecord = {
      ...current,
      state: "adopted",
      checkpoint: {
        ...current.checkpoint,
        captureState: "adopted",
        adoptedObjectRefs: [...(input.adoptedObjectRefs ?? [])],
      },
    };
    this.records.set(input.id, adopted);
    return adopted;
  }

  async markDeleted(input: { id: string; ownerId: string; nodeId: string }) {
    const current = (await this.loadOwned(input))!;
    const deleted: NodeRuntimeCheckpointRecord = {
      ...current,
      state: "deleted",
      deletedAt: now.toISOString(),
    };
    this.records.set(input.id, deleted);
    return deleted;
  }
}

function fixture() {
  const repository = new MemoryRepository();
  let ordinal = 0;
  let online = true;
  let captures = 0;
  let restores = 0;
  let forks = 0;
  let deletes = 0;
  let failAdoption = false;
  const transport = {
    async online() {
      return online;
    },
    async forkNodeWorkspace(
      input: Parameters<NodeSandboxTransport["forkNodeWorkspace"]>[0],
    ) {
      forks += 1;
      ordinal += 1;
      return handleFor(input.create, ordinal);
    },
    async sandboxRuntimeCheckpointCapabilities() {
      return {
        available: true as const,
        provider: "opensandbox" as const,
        regions: [compatibility.region],
        architectures: [compatibility.architecture],
        runtimeKind: compatibility.runtimeKind,
        runtimeVersion: compatibility.runtimeVersion,
        maximumTtlSeconds: 24 * 60 * 60,
      };
    },
    async captureSandboxRuntimeCheckpoint(
      input: Parameters<
        NodeSandboxTransport["captureSandboxRuntimeCheckpoint"]
      >[0],
    ) {
      captures += 1;
      return {
        version: 1 as const,
        checkpoint: {
          provider: "opensandbox" as const,
          opaqueRef: `native-runtime-${captures}`,
          portable: false as const,
        },
        compatibility: input.compatibility,
        sourceWorkspaceSnapshot: input.sourceWorkspaceSnapshot,
        captureIdempotencyKey: input.idempotencyKey,
        captureState: "captured" as const,
        adoptedObjectRefs: [],
        capturedAt: now.toISOString(),
        expiresAt: input.expiresAt,
      };
    },
    async restoreSandboxRuntimeCheckpoint(
      input: Parameters<
        NodeSandboxTransport["restoreSandboxRuntimeCheckpoint"]
      >[0],
    ) {
      restores += 1;
      ordinal += 1;
      return handleFor(input.create, ordinal);
    },
    async deleteSandboxRuntimeCheckpoint() {
      deletes += 1;
    },
  } as unknown as NodeSandboxTransport;
  const provider = new NodeSandboxProvider(
    nodeId,
    ownerId,
    "opensandbox",
    transport,
  );
  const snapshots = {
    async attachRuntimeCheckpoint() {
      if (failAdoption) {
        failAdoption = false;
        throw new Error("SIMULATED_PROCESS_CRASH_AFTER_SQL_CAPTURE");
      }
      return {} as never;
    },
  };
  const lifecycle = new PairedNodeRuntimeCheckpointLifecycle(
    repository,
    snapshots,
    () => now,
  );
  return {
    repository,
    provider,
    lifecycle,
    setOnline(value: boolean) {
      online = value;
    },
    crashNextAdoption() {
      failAdoption = true;
    },
    counts() {
      return { captures, restores, forks, deletes };
    },
  };
}

describe("paired Node runtime-checkpoint lifecycle caller", () => {
  test("creates an accelerator only after logical fallback, then restores it exactly", async () => {
    const setup = fixture();
    const request = {
      ownerId,
      workspaceSnapshotId: "workspace-committed-1",
      provider: setup.provider,
      create: create(),
      logicalWorkspaceSnapshot: logical,
      expectedCompatibility: compatibility,
      capture: {
        checkpointId: "runtime-checkpoint-idempotent-1",
        expiresAt: new Date(now.getTime() + 60 * 60_000),
      },
    } as const;

    const first = await setup.lifecycle.restoreOrFallback(request);
    expect(first).toMatchObject({
      path: "logical-workspace",
      reason: "checkpoint-unavailable",
      checkpointCapture: "adopted",
    });
    const second = await setup.lifecycle.restoreOrFallback({
      ...request,
      create: create("branch-native-restore"),
    });
    expect(second).toMatchObject({
      path: "runtime-checkpoint",
      checkpointId: request.capture.checkpointId,
    });
    expect(setup.counts()).toEqual({
      captures: 1,
      restores: 1,
      forks: 1,
      deletes: 0,
    });
  });

  test("replays a crash after durable capture without recapturing remotely", async () => {
    const setup = fixture();
    const restored = await setup.provider.forkWorkspace({
      ...create(),
      source: logical,
    });
    setup.crashNextAdoption();
    const input = {
      checkpointId: "runtime-crash-replay",
      ownerId,
      workspaceSnapshotId: "workspace-committed-crash",
      provider: setup.provider,
      handle: restored,
      sourceWorkspaceSnapshot: logical,
      compatibility,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    } as const;
    await expect(setup.lifecycle.captureCommitted(input)).rejects.toThrow(
      "SIMULATED_PROCESS_CRASH",
    );
    expect(
      (
        await setup.repository.loadOwned({
          id: input.checkpointId,
          ownerId,
        })
      )?.state,
    ).toBe("captured");

    await expect(
      setup.lifecycle.captureCommitted(input),
    ).resolves.toMatchObject({ state: "adopted" });
    expect(setup.counts().captures).toBe(1);
  });

  test("fails closed across owners and while the paired Node is offline", async () => {
    const setup = fixture();
    await expect(
      setup.lifecycle.restoreOrFallback({
        ownerId: "foreign-owner",
        workspaceSnapshotId: "workspace-committed-foreign",
        provider: setup.provider,
        create: { ...create(), ownerId: "foreign-owner" },
        logicalWorkspaceSnapshot: logical,
        expectedCompatibility: compatibility,
      }),
    ).rejects.toThrow("OWNER_MISMATCH");
    expect(setup.counts().forks).toBe(0);

    setup.setOnline(false);
    await expect(
      setup.lifecycle.restoreOrFallback({
        ownerId,
        workspaceSnapshotId: "workspace-committed-offline",
        provider: setup.provider,
        create: create("branch-offline"),
        logicalWorkspaceSnapshot: logical,
        expectedCompatibility: compatibility,
        capture: {
          checkpointId: "runtime-offline",
          expiresAt: new Date(now.getTime() + 60 * 60_000),
        },
      }),
    ).rejects.toThrow("NODE_SANDBOX_UNAVAILABLE");
    expect(setup.counts()).toEqual({
      captures: 0,
      restores: 0,
      forks: 0,
      deletes: 0,
    });
  });

  test("deletes expired native state and explicitly restores the logical snapshot", async () => {
    const setup = fixture();
    const expiredCheckpoint: SandboxRuntimeCheckpointRefV1 = {
      version: 1,
      checkpoint: {
        provider: "opensandbox",
        opaqueRef: "native-expired",
        portable: false,
      },
      compatibility,
      sourceWorkspaceSnapshot: logical,
      captureState: "adopted",
      adoptedObjectRefs: [],
      capturedAt: new Date(now.getTime() - 120_000).toISOString(),
      expiresAt: new Date(now.getTime() - 60_000).toISOString(),
    };
    setup.repository.records.set("runtime-expired", {
      id: "runtime-expired",
      ownerId,
      nodeId,
      workspaceSnapshotId: "workspace-expired",
      checkpoint: expiredCheckpoint,
      state: "adopted",
      safeErrorCode: null,
      deletedAt: null,
    });

    const result = await setup.lifecycle.restoreOrFallback({
      ownerId,
      workspaceSnapshotId: "workspace-expired",
      provider: setup.provider,
      create: create("branch-expired"),
      logicalWorkspaceSnapshot: logical,
      expectedCompatibility: compatibility,
    });
    expect(result).toMatchObject({
      path: "logical-workspace",
      reason: "checkpoint-expired",
    });
    expect(setup.counts()).toEqual({
      captures: 0,
      restores: 0,
      forks: 1,
      deletes: 1,
    });
    expect(setup.repository.records.get("runtime-expired")?.state).toBe(
      "deleted",
    );
  });
});
