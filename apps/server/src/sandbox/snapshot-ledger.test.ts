import { describe, expect, test } from "bun:test";
import { InMemorySnapshotLedger } from "./snapshot-ledger";

const snapshot = {
  provider: "mock" as const,
  digest: `sha256:${"a".repeat(64)}`,
  format: "tar+zstd-v1",
};
const base = {
  ownerId: "owner",
  threadId: "thread",
  branchId: "branch",
  sequence: 1,
  requestId: "request-1",
  conversationCheckpointRef: "conversation-checkpoint:1",
  imageTemplateRef: {
    imageDigest: `sha256:${"d".repeat(64)}`,
    profileVersion: "latex-v1",
  },
  executionProfileId: "latex" as const,
  executionProfileVersion: "latex-v1",
};

describe("in-memory snapshot ledger contract", () => {
  test("commits only an authorized, adopted capture and restores committed rows", async () => {
    const ledger = new InMemorySnapshotLedger({
      verify: async (input) => input.ownerId === "owner" && input.branchId === "branch",
    });
    const pending = await ledger.requestCapture(base);
    expect((await ledger.requestCapture(base)).id).toBe(pending.id);
    expect(await ledger.getRestorable(base)).toBeNull();

    await ledger.recordProviderCapture({ recordId: pending.id, workspaceSnapshotRef: snapshot });
    await ledger.recordAdoptionCandidate({
      recordId: pending.id,
      workspaceSnapshotRef: snapshot,
      trustedObjectRef: "object:snapshot-1",
      portableManifestDigest: `sha256:${"e".repeat(64)}`,
      byteSize: 1_024,
      fileCount: 3,
    });
    const committed = await ledger.commitAdoption({
      recordId: pending.id,
      workspaceSnapshotRef: snapshot,
      trustedObjectRef: "object:snapshot-1",
    });
    expect(committed.status).toBe("committed");
    expect(committed).toMatchObject({
      portableManifestDigest: `sha256:${"e".repeat(64)}`,
      byteSize: 1_024,
      fileCount: 3,
    });
    expect(
      await ledger.getLatestCompatible({
        ownerId: base.ownerId,
        threadId: base.threadId,
        branchId: base.branchId,
        executionProfileId: base.executionProfileId,
        executionProfileVersion: base.executionProfileVersion,
        imageDigest: base.imageTemplateRef.imageDigest,
      }),
    ).toEqual(committed);
    expect(await ledger.getRestorable(base)).toEqual(committed);
    const reconciliation = await ledger.reconcile({ pendingOlderThanMs: 0 });
    expect(reconciliation).toContainEqual({
      recordId: pending.id,
      action: "retry-publish",
    });
    const publishLease = await ledger.leaseOutbox({
      workerId: "publisher",
      limit: 10,
      leaseMs: 1_000,
    });
    expect(publishLease.find((lease) => lease.kind === "publish")).toBeDefined();
    await ledger.completeOutbox({
      outboxId: publishLease.find((lease) => lease.kind === "publish")!.outboxId,
      workerId: "publisher",
    });
    const accelerated = await ledger.attachRuntimeCheckpoint({
      recordId: pending.id,
      runtimeCheckpointRef: {
        provider: "mock",
        opaqueRef: "runtime-checkpoint-1",
        portable: false,
      },
      imageDigest: base.imageTemplateRef.imageDigest,
      executionProfileVersion: base.executionProfileVersion,
    });
    expect(accelerated.sandboxRuntimeCheckpointRef).toMatchObject({
      opaqueRef: "runtime-checkpoint-1",
      portable: false,
    });
    expect(
      ledger.attachRuntimeCheckpoint({
        recordId: pending.id,
        runtimeCheckpointRef: {
          provider: "mock",
          opaqueRef: "runtime-checkpoint-incompatible",
          portable: false,
        },
        imageDigest: `sha256:${"0".repeat(64)}`,
        executionProfileVersion: base.executionProfileVersion,
      }),
    ).rejects.toThrow("incompatible");
    expect(
      ledger.commitAdoption({
        recordId: pending.id,
        workspaceSnapshotRef: { ...snapshot, digest: `sha256:${"b".repeat(64)}` },
        trustedObjectRef: "object:changed",
      }),
    ).rejects.toThrow("immutable");
  });

  test("fences branch/owner boundaries and sequence collisions", async () => {
    const ledger = new InMemorySnapshotLedger({ verify: async (input) => input.ownerId === "owner" });
    await ledger.requestCapture(base);
    expect(
      ledger.requestCapture({ ...base, requestId: "request-2" }),
    ).rejects.toThrow("branch sequence");
    expect(
      ledger.requestCapture({ ...base, ownerId: "attacker", sequence: 2 }),
    ).rejects.toThrow("does not belong");
  });

  test("reconciles capture/adoption crash windows without exposing pending rows", async () => {
    const ledger = new InMemorySnapshotLedger({ verify: async () => true });
    const created = await ledger.requestCapture({
      ...base,
      now: new Date("2026-08-22T10:00:00.000Z"),
    });
    await ledger.leaseOutbox({
      workerId: "worker",
      limit: 1,
      leaseMs: 1_000,
      now: new Date("2026-08-22T10:00:00.000Z"),
    });
    await ledger.recordProviderCapture({ recordId: created.id, workspaceSnapshotRef: snapshot });
    const actions = await ledger.reconcile({
      pendingOlderThanMs: 1_000,
      now: new Date("2026-08-22T11:00:00.000Z"),
    });
    expect(actions[0]).toMatchObject({
      recordId: created.id,
      action: "resume-adoption",
    });
    const resumed = await ledger.leaseOutbox({
      workerId: "recovery-worker",
      limit: 1,
      leaseMs: 1_000,
      now: new Date("2026-08-22T11:00:01.000Z"),
    });
    expect(resumed[0].providerCaptureRef).toEqual(snapshot);
    expect(await ledger.getRestorable(base)).toBeNull();
  });

  test("reconciles provider orphans and adoption-before-commit", async () => {
    const ledger = new InMemorySnapshotLedger({ verify: async () => true });
    const created = await ledger.requestCapture(base);
    await ledger.recordProviderCapture({ recordId: created.id, workspaceSnapshotRef: snapshot });
    await ledger.recordAdoptionCandidate({
      recordId: created.id,
      workspaceSnapshotRef: snapshot,
      trustedObjectRef: "object:pending-commit",
      portableManifestDigest: `sha256:${"e".repeat(64)}`,
      byteSize: 2_048,
      fileCount: 4,
    });
    const untracked = {
      ...snapshot,
      digest: `sha256:${"c".repeat(64)}`,
    };
    const actions = await ledger.reconcile({
      pendingOlderThanMs: 0,
      providerInventory: [snapshot, untracked],
    });
    expect(actions).toContainEqual({
      recordId: created.id,
      action: "resume-commit",
      workspaceSnapshotRef: snapshot,
    });
    expect(actions).toContainEqual({
      recordId: `untracked:${untracked.digest}`,
      action: "orphan-requires-cleanup",
      workspaceSnapshotRef: untracked,
    });
  });
});
