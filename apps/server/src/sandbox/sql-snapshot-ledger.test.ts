import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { createCorpusTestDatabase } from "../search/test-helpers";
import { CoreConversationStore } from "../assistant/core-conversation-store";
import { newId } from "../lib/id";
import { CoreSqlSnapshotLedger } from "./sql-snapshot-ledger";

let client: Client;
let conversation: CoreConversationStore;
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

beforeAll(async () => {
  client = await createCorpusTestDatabase();
  conversation = new CoreConversationStore(client);
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS workspace_snapshots (
      id text PRIMARY KEY NOT NULL,
      userId text NOT NULL,
      threadId text NOT NULL,
      branchId text NOT NULL,
      sequence integer NOT NULL,
      requestId text NOT NULL,
      conversationCheckpointRef text NOT NULL,
      parentWorkspaceSnapshotRefJson text,
      imageTemplateRefJson text NOT NULL,
      imageDigest text NOT NULL,
      executionProfileId text NOT NULL,
      executionProfileVersion text NOT NULL,
      state text DEFAULT 'pending' NOT NULL,
      workspaceSnapshotRefJson text,
      sandboxRuntimeCheckpointRefJson text,
      trustedObjectRef text,
      portableManifestDigest text,
      byteSize integer,
      fileCount integer,
      capturedProviderRefJson text,
      capturedTrustedObjectRef text,
      capturedManifestDigest text,
      capturedByteSize integer,
      capturedFileCount integer,
      safeError text,
      createdAt integer NOT NULL,
      updatedAt integer NOT NULL,
      committedAt integer,
      failedAt integer
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_snapshots_user_request_unique
      ON workspace_snapshots (userId, requestId);
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_snapshots_branch_sequence_unique
      ON workspace_snapshots (userId, branchId, sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_snapshots_branch_checkpoint_committed_unique
      ON workspace_snapshots (userId, branchId, conversationCheckpointRef)
      WHERE state = 'committed';
    CREATE TABLE IF NOT EXISTS workspace_snapshot_outbox (
      id text PRIMARY KEY NOT NULL,
      workspaceSnapshotId text NOT NULL,
      kind text NOT NULL,
      state text DEFAULT 'pending' NOT NULL,
      attempt integer DEFAULT 0 NOT NULL,
      availableAt integer NOT NULL,
      leaseOwner text,
      leaseExpiresAt integer,
      payloadDigest text NOT NULL,
      safeError text,
      createdAt integer NOT NULL,
      updatedAt integer NOT NULL,
      completedAt integer,
      FOREIGN KEY (workspaceSnapshotId) REFERENCES workspace_snapshots(id)
        ON UPDATE CASCADE ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_snapshot_outbox_record_kind_unique
      ON workspace_snapshot_outbox (workspaceSnapshotId, kind);
  `);
}, databaseHookTimeout);

afterAll(() => client.close(), databaseHookTimeout);

async function committedBoundary() {
  const created = await conversation.createThread({
    ownerId: "corpus-user-a",
    title: "Durable workspace",
  });
  const reserved = await conversation.reserveTurn({
    ownerId: "corpus-user-a",
    threadId: created.thread.id,
    branchId: created.branch.id,
    expectedHeadMessageId: null,
    clientRequestId: newId("snapshot-turn"),
    markdown: "Prépare le document",
    modelKey: "mock-readonly",
  });
  const checkpointId = newId("ackp");
  const now = Math.floor(Date.now() / 1_000);
  await client.execute({
    sql: `INSERT INTO assistant_conversation_checkpoints
      (id, userId, threadId, branchId, runId, inputMessageId,
       parentCheckpointId, appendKey, afterEventSequence, runtimeId,
       runtimeVersion, graphSchemaVersion, stateDigest, stateByteLength,
       temporaryBlobRef, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 'fixture', '1', 1, ?, 1, ?,
        'staging', ?)`,
    args: [
      checkpointId,
      "corpus-user-a",
      created.thread.id,
      created.branch.id,
      reserved.runId,
      reserved.userMessageId,
      newId("append"),
      "f".repeat(64),
      `private/fixture/staging/${checkpointId}`,
      now,
    ],
  });
  await client.execute({
    sql: `UPDATE assistant_conversation_checkpoints
      SET status = 'committed', temporaryBlobRef = NULL, stateBlobRef = ?,
        committedAt = ? WHERE id = ?`,
    args: [`private/fixture/${checkpointId}`, now, checkpointId],
  });
  return {
    ownerId: "corpus-user-a",
    threadId: created.thread.id,
    branchId: created.branch.id,
    sequence: 1,
    requestId: newId("capture"),
    conversationCheckpointRef: checkpointId,
    imageTemplateRef: {
      imageDigest: `sha256:${"d".repeat(64)}`,
      profileVersion: "latex-v1",
    },
    executionProfileId: "latex" as const,
    executionProfileVersion: "latex-v1",
  };
}

describe("CoreSqlSnapshotLedger", () => {
  test("survives service recreation and exposes only a committed adoption", async () => {
    const base = await committedBoundary();
    const firstProcess = new CoreSqlSnapshotLedger(client);
    const pending = await firstProcess.requestCapture(base);
    expect((await firstProcess.requestCapture(base)).id).toBe(pending.id);
    expect(await firstProcess.getRestorable(base)).toBeNull();

    const captureLease = await firstProcess.leaseOutbox({
      workerId: "capture-worker",
      limit: 1,
      leaseMs: 1_000,
    });
    expect(captureLease[0]?.kind).toBe("capture");
    const snapshot = {
      provider: "mock" as const,
      digest: `sha256:${"a".repeat(64)}`,
      format: "tar+zstd-v1",
    };
    await firstProcess.recordProviderCapture({
      recordId: pending.id,
      workspaceSnapshotRef: snapshot,
    });

    const afterRestart = new CoreSqlSnapshotLedger(client);
    expect(await afterRestart.getRestorable(base)).toBeNull();
    await afterRestart.recordAdoptionCandidate({
      recordId: pending.id,
      workspaceSnapshotRef: snapshot,
      trustedObjectRef: "object:workspace-fixture",
      portableManifestDigest: `sha256:${"e".repeat(64)}`,
      byteSize: 2_048,
      fileCount: 4,
    });
    const committed = await afterRestart.commitAdoption({
      recordId: pending.id,
      workspaceSnapshotRef: snapshot,
      trustedObjectRef: "object:workspace-fixture",
    });
    expect(committed.status).toBe("committed");
    expect(await afterRestart.getRestorable(base)).toEqual(committed);
    expect(
      await afterRestart.getLatestCompatible({
        ownerId: base.ownerId,
        threadId: base.threadId,
        branchId: base.branchId,
        executionProfileId: base.executionProfileId,
        executionProfileVersion: base.executionProfileVersion,
        imageDigest: base.imageTemplateRef.imageDigest,
      }),
    ).toEqual(committed);
    const terminalLeases = await afterRestart.leaseOutbox({
      workerId: "publisher",
      limit: 10,
      leaseMs: 1_000,
    });
    const publish = terminalLeases.find(
      (lease) => lease.record.id === pending.id && lease.kind === "publish",
    );
    expect(publish).toBeDefined();
    await afterRestart.completeOutbox({
      outboxId: publish!.outboxId,
      workerId: "publisher",
    });
  });

  test("fails closed for a foreign checkpoint and resumes expired capture work", async () => {
    const base = await committedBoundary();
    const ledger = new CoreSqlSnapshotLedger(client);
    await expect(
      ledger.requestCapture({ ...base, ownerId: "corpus-user-b" }),
    ).rejects.toThrow("does not belong");

    const startedAt = new Date("2026-08-22T10:00:00.000Z");
    const pending = await ledger.requestCapture({ ...base, now: startedAt });
    const lostLeases = await ledger.leaseOutbox({
      workerId: "lost-worker",
      limit: 10,
      leaseMs: 1_000,
      now: startedAt,
    });
    expect(
      lostLeases.some(
        (lease) =>
          lease.record.id === pending.id && lease.kind === "capture",
      ),
    ).toBe(true);
    const actions = await ledger.reconcile({
      pendingOlderThanMs: 1_000,
      now: new Date("2026-08-22T11:00:00.000Z"),
    });
    expect(actions).toContainEqual({
      recordId: pending.id,
      action: "retry-capture",
    });
    const recovered = await ledger.leaseOutbox({
      workerId: "recovery-worker",
      limit: 10,
      leaseMs: 1_000,
      now: new Date("2026-08-22T11:00:01.000Z"),
    });
    expect(
      recovered.some(
        (lease) => lease.record.id === pending.id && lease.kind === "capture",
      ),
    ).toBe(true);
  });
});
