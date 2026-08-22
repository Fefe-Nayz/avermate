import { describe, expect, test } from "bun:test";
import {
  SANDBOX_BASELINE_CHECK_IDS,
  type SandboxBaselineEvidence,
  type SandboxHandle,
} from "@avermate/agent-contracts";
import { enableSandboxProfile } from "../sandbox/profiles";
import type { SnapshotLedgerRecord } from "../sandbox/snapshot-ledger";
import type { TurnReservation } from "./core-conversation-store";
import {
  HistoricalBranchService,
  type ExistingHistoricalReservation,
  type HistoricalBranchBoundary,
  type HistoricalBranchRepository,
  type HistoricalBranchSandboxProvider,
} from "./historical-branch-service";

const imageDigest = `sha256:${"a".repeat(64)}`;
const portableManifestDigest = `sha256:${"b".repeat(64)}`;
const workspaceDigest = `sha256:${"c".repeat(64)}`;
const hostPolicyDigest = `sha256:${"d".repeat(64)}`;
const profile = enableSandboxProfile("latex", {
  version: "latex-v1",
  imageDigest,
});

const boundary: HistoricalBranchBoundary = Object.freeze({
  ownerId: "owner-a",
  threadId: "thread-a",
  sourceBranchId: "branch-source",
  messageId: "message-old",
  operation: "retry",
  role: "assistant",
  forkedFromMessageId: "message-input",
  cutoffMessageId: "message-old",
  workspaceCopySupported: true,
});

const snapshot: SnapshotLedgerRecord = Object.freeze({
  id: "snapshot-committed",
  ownerId: boundary.ownerId,
  threadId: boundary.threadId,
  branchId: boundary.sourceBranchId,
  sequence: 4,
  requestId: "snapshot-request",
  conversationCheckpointRef: "checkpoint-committed",
  parentWorkspaceSnapshotRef: null,
  imageTemplateRef: profile.image,
  executionProfileId: profile.id,
  executionProfileVersion: profile.version,
  status: "committed",
  workspaceSnapshotRef: {
    provider: "mock" as const,
    digest: workspaceDigest,
    format: "tar+zstd-v1",
  },
  sandboxRuntimeCheckpointRef: null,
  trustedObjectRef: "object:workspace-snapshot",
  portableManifestDigest,
  byteSize: 4_096,
  fileCount: 8,
  failure: null,
  createdAt: "2026-08-22T10:00:00.000Z",
  updatedAt: "2026-08-22T10:01:00.000Z",
  committedAt: "2026-08-22T10:01:00.000Z",
  failedAt: null,
});

class FakeRepository implements HistoricalBranchRepository {
  latest: SnapshotLedgerRecord | null = snapshot;
  selected: SnapshotLedgerRecord | null = snapshot;
  existing: ExistingHistoricalReservation | null = null;
  boundaryReads = 0;
  snapshotReads = 0;

  async resolveBoundary() {
    this.boundaryReads += 1;
    return boundary;
  }

  async latestCommittedSnapshot() {
    this.snapshotReads += 1;
    return this.latest;
  }

  async committedSnapshotById() {
    this.snapshotReads += 1;
    return this.selected;
  }

  async existingReservation() {
    return this.existing;
  }
}

function passingEvidence(): SandboxBaselineEvidence {
  return {
    baselineVersion: 1,
    providerId: "mock",
    profileId: profile.id,
    profileVersion: profile.version,
    isolationClass: "mock",
    runtimeKind: "mock",
    runtimeVersion: "1",
    probeVersion: "1",
    imageDigest,
    hostPolicyDigest,
    evidenceNonce: "evidence-1",
    checkedAt: "2026-08-22T10:00:00.000Z",
    expiresAt: "2026-08-22T12:00:00.000Z",
    checks: Object.fromEntries(
      SANDBOX_BASELINE_CHECK_IDS.map((id) => [
        id,
        { status: "pass", observed: "denied as expected" },
      ]),
    ) as SandboxBaselineEvidence["checks"],
  };
}

function runtimeFixture() {
  const forkInputs: Array<
    Parameters<HistoricalBranchSandboxProvider["forkWorkspace"]>[0]
  > = [];
  const destroyed: SandboxHandle[] = [];
  const provider: HistoricalBranchSandboxProvider = {
    id: "mock",
    preflight: async () => ({ ok: true, evidence: passingEvidence() }),
    forkWorkspace: async (input) => {
      forkInputs.push(input);
      return {
        providerId: "mock",
        sandboxId: `sandbox-${forkInputs.length}`,
        ownerId: input.ownerId,
        threadId: input.threadId,
        branchId: input.branchId,
        profileId: input.profile.id,
        profileVersion: input.profile.version,
        image: input.profile.image,
        evidenceNonce: "evidence-1",
        expiresAt: input.expiresAt.toISOString(),
      };
    },
    destroy: async (handle) => {
      destroyed.push(handle);
    },
  };
  return {
    provider,
    forkInputs,
    destroyed,
    runtime: {
      provider,
      profiles: [profile],
      hostPolicyDigest,
      maxEvidenceAgeMs: 5 * 60_000,
    },
  };
}

function reservation(branchId: string, idempotent = false): TurnReservation {
  return {
    threadId: boundary.threadId,
    branchId,
    userMessageId: "message-new-input",
    runId: "run-new",
    reservedOutputMessageId: "message-new-output",
    idempotent,
  };
}

describe("historical workspace branching", () => {
  test("conversation-only validates the exact source path without resolving snapshots or providers", async () => {
    const repository = new FakeRepository();
    let runtimeResolutions = 0;
    const service = new HistoricalBranchService(repository, () => {
      runtimeResolutions += 1;
      return runtimeFixture().runtime;
    });

    await expect(
      service.assertConversationOnly({
        ownerId: boundary.ownerId,
        sourceBranchId: boundary.sourceBranchId,
        messageId: boundary.messageId,
        operation: boundary.operation,
      }),
    ).resolves.toEqual(boundary);
    expect(repository.boundaryReads).toBe(1);
    expect(repository.snapshotReads).toBe(0);
    expect(runtimeResolutions).toBe(0);
  });

  test("reports an incompatible latest committed snapshot without falling back or forking", async () => {
    const repository = new FakeRepository();
    repository.latest = Object.freeze({
      ...snapshot,
      workspaceSnapshotRef: {
        ...snapshot.workspaceSnapshotRef!,
        provider: "e2b" as const,
      },
    });
    const fixture = runtimeFixture();
    const service = new HistoricalBranchService(
      repository,
      () => fixture.runtime,
      () => new Date("2026-08-22T10:02:00.000Z"),
    );

    const preview = await service.preview({
      ownerId: boundary.ownerId,
      sourceBranchId: boundary.sourceBranchId,
      messageId: boundary.messageId,
      operation: boundary.operation,
    });
    expect(preview.workspaceCopy).toMatchObject({
      available: false,
      reason: "snapshot-incompatible",
      snapshot: { id: snapshot.id, provider: "e2b" },
    });
    expect(fixture.forkInputs).toHaveLength(0);
  });

  test("forks the exact committed snapshot into a distinct branch and replays idempotently", async () => {
    const repository = new FakeRepository();
    const fixture = runtimeFixture();
    const service = new HistoricalBranchService(
      repository,
      () => fixture.runtime,
      () => new Date("2026-08-22T10:02:00.000Z"),
    );
    const sourceBefore = structuredClone(snapshot.workspaceSnapshotRef);
    const createCalls: Array<{
      destinationBranchId: string;
      workspaceSnapshotRef: string;
    }> = [];
    const createDestination = async (input: {
      destinationBranchId: string;
      workspaceSnapshotRef: string;
    }) => {
      createCalls.push(input);
      const created = reservation(input.destinationBranchId);
      repository.existing = {
        reservation: { ...created, idempotent: true },
        workspaceSnapshotRef: input.workspaceSnapshotRef,
        forkedFromMessageId: boundary.forkedFromMessageId,
      };
      return created;
    };
    const request = {
      ownerId: boundary.ownerId,
      sourceBranchId: boundary.sourceBranchId,
      messageId: boundary.messageId,
      operation: boundary.operation,
      clientRequestId: "copy-request-1",
      snapshotId: snapshot.id,
      expectedPortableManifestDigest: portableManifestDigest,
      createDestination,
    } as const;

    const first = await service.branchWithWorkspaceCopy(request);
    const replay = await service.branchWithWorkspaceCopy(request);

    expect(fixture.forkInputs).toHaveLength(1);
    expect(fixture.forkInputs[0]).toMatchObject({
      ownerId: boundary.ownerId,
      threadId: boundary.threadId,
      source: snapshot.workspaceSnapshotRef,
    });
    expect(fixture.forkInputs[0]!.branchId).not.toBe(boundary.sourceBranchId);
    expect(createCalls).toEqual([
      {
        destinationBranchId: first.reservation.branchId,
        workspaceSnapshotRef: snapshot.id,
      },
    ]);
    expect(first.historicalBranch.reused).toBe(false);
    expect(replay.historicalBranch).toMatchObject({
      reused: true,
      destinationBranchId: first.reservation.branchId,
      sandboxId: null,
    });
    expect(snapshot.workspaceSnapshotRef).toEqual(sourceBefore);
    expect(fixture.destroyed).toHaveLength(0);
  });

  test("rejects unowned, pending, or stale-confirmation snapshots before any workspace side effect", async () => {
    const repository = new FakeRepository();
    repository.selected = null;
    const fixture = runtimeFixture();
    let destinationCalls = 0;
    const service = new HistoricalBranchService(
      repository,
      () => fixture.runtime,
    );
    const baseRequest = {
      ownerId: boundary.ownerId,
      sourceBranchId: boundary.sourceBranchId,
      messageId: boundary.messageId,
      operation: boundary.operation,
      clientRequestId: "copy-request-invalid",
      snapshotId: "pending-or-foreign-snapshot",
      expectedPortableManifestDigest: portableManifestDigest,
      createDestination: async () => {
        destinationCalls += 1;
        return reservation("should-not-exist");
      },
    } as const;

    await expect(service.branchWithWorkspaceCopy(baseRequest)).rejects.toEqual(
      expect.objectContaining({
        code: "snapshot_unavailable",
      }),
    );
    repository.selected = snapshot;
    await expect(
      service.branchWithWorkspaceCopy({
        ...baseRequest,
        snapshotId: snapshot.id,
        expectedPortableManifestDigest: `sha256:${"f".repeat(64)}`,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "divergent_replay",
      }),
    );
    expect(fixture.forkInputs).toHaveLength(0);
    expect(destinationCalls).toBe(0);
  });

  test("destroys only the new workspace when conversation reservation fails", async () => {
    const repository = new FakeRepository();
    const fixture = runtimeFixture();
    const service = new HistoricalBranchService(
      repository,
      () => fixture.runtime,
    );

    await expect(
      service.branchWithWorkspaceCopy({
        ownerId: boundary.ownerId,
        sourceBranchId: boundary.sourceBranchId,
        messageId: boundary.messageId,
        operation: boundary.operation,
        clientRequestId: "copy-request-fails",
        snapshotId: snapshot.id,
        expectedPortableManifestDigest: portableManifestDigest,
        createDestination: async () => {
          throw new Error("conversation reservation failed");
        },
      }),
    ).rejects.toThrow("conversation reservation failed");
    expect(fixture.forkInputs).toHaveLength(1);
    expect(fixture.destroyed).toHaveLength(1);
    expect(fixture.destroyed[0]!.branchId).toBe(
      fixture.forkInputs[0]!.branchId,
    );
    expect(fixture.destroyed[0]!.branchId).not.toBe(boundary.sourceBranchId);
  });
});
