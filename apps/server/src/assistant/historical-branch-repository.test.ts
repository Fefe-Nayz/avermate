import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { createCorpusTestDatabase } from "../search/test-helpers";
import { CoreSqlSnapshotLedger } from "../sandbox/sql-snapshot-ledger";
import {
  CoreConversationCheckpointStore,
  InMemoryCheckpointBlobStore,
} from "./checkpoint-store";
import { CoreConversationStore } from "./core-conversation-store";
import { CoreHistoricalBranchRepository } from "./historical-branch-service";

let client: Client;
let conversations: CoreConversationStore;
let checkpoints: CoreConversationCheckpointStore;
let snapshots: CoreSqlSnapshotLedger;
let repository: CoreHistoricalBranchRepository;
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

const imageDigest = `sha256:${"a".repeat(64)}`;
const workspaceDigest = `sha256:${"b".repeat(64)}`;
const portableManifestDigest = `sha256:${"c".repeat(64)}`;

function usage() {
  return {
    providerKey: "mock",
    modelKey: "mock-readonly",
    inputTokens: 1,
    outputTokens: 1,
    reasoningTokens: null,
    cachedReadTokens: null,
    cachedWriteTokens: null,
    estimatedCost: "0",
    currency: "EUR",
  };
}

beforeAll(async () => {
  client = await createCorpusTestDatabase();
  conversations = new CoreConversationStore(client);
  checkpoints = new CoreConversationCheckpointStore(
    client,
    new InMemoryCheckpointBlobStore(),
  );
  snapshots = new CoreSqlSnapshotLedger(client);
  repository = new CoreHistoricalBranchRepository(client);
}, databaseHookTimeout);

afterAll(() => client.close(), databaseHookTimeout);

async function committedHistoricalRun(ownerId: string, suffix: string) {
  const created = await conversations.createThread({
    ownerId,
    title: `Historical ${suffix}`,
  });
  const run = await conversations.reserveTurn({
    ownerId,
    threadId: created.thread.id,
    branchId: created.branch.id,
    expectedHeadMessageId: null,
    clientRequestId: `initial-${suffix}`,
    markdown: "Original question",
    modelKey: "mock-readonly",
  });
  await conversations.startRun(ownerId, run.runId);
  const event = await conversations.appendRunEvent({
    ownerId,
    runId: run.runId,
    type: "avermate.status",
    payload: { phase: "workspace-snapshotted" },
  });
  const checkpoint = await checkpoints.append({
    ownerId,
    threadId: created.thread.id,
    branchId: created.branch.id,
    runId: run.runId,
    inputMessageId: run.userMessageId,
    outputMessageId: null,
    appendKey: `historical-${suffix}`,
    afterEventSequence: event.sequence,
    runtimeId: "avermate-readonly",
    runtimeVersion: "1",
    graphSchemaVersion: 1,
    state: new TextEncoder().encode('{"phase":"workspace"}'),
  });
  await conversations.bindConversationCheckpoint({
    ownerId,
    runId: run.runId,
    checkpointId: checkpoint.id,
  });
  const pending = await snapshots.requestCapture({
    ownerId,
    threadId: created.thread.id,
    branchId: created.branch.id,
    sequence: 1,
    requestId: `snapshot-${suffix}`,
    conversationCheckpointRef: checkpoint.id,
    imageTemplateRef: {
      imageDigest,
      profileVersion: "latex-v1",
    },
    executionProfileId: "latex",
    executionProfileVersion: "latex-v1",
  });
  const workspaceSnapshotRef = {
    provider: "mock" as const,
    digest: workspaceDigest,
    format: "tar+zstd-v1",
  };
  await snapshots.recordProviderCapture({
    recordId: pending.id,
    workspaceSnapshotRef,
  });
  await snapshots.recordAdoptionCandidate({
    recordId: pending.id,
    workspaceSnapshotRef,
    trustedObjectRef: `object:${suffix}`,
    portableManifestDigest,
    byteSize: 100,
    fileCount: 2,
  });
  const committed = await snapshots.commitAdoption({
    recordId: pending.id,
    workspaceSnapshotRef,
    trustedObjectRef: `object:${suffix}`,
  });
  await conversations.finalizeRun({
    ownerId,
    runId: run.runId,
    expectedInputHeadId: run.userMessageId,
    outputMessageId: run.reservedOutputMessageId,
    finalParts: [
      { type: "text", id: `answer-${suffix}`, markdown: "Original answer" },
    ],
    citations: [],
    usage: usage(),
    terminal: "complete",
    siblingPolicy: "create-explicit-sibling-on-head-conflict",
  });
  return { created, run, checkpoint, committed };
}

describe("core historical branch ownership", () => {
  test("selects only a committed snapshot on the exact owned branch and message prefix", async () => {
    const seeded = await committedHistoricalRun("corpus-user-a", "owner-a");
    const boundary = await repository.resolveBoundary({
      ownerId: "corpus-user-a",
      sourceBranchId: seeded.created.branch.id,
      messageId: seeded.run.reservedOutputMessageId,
      operation: "retry",
    });
    expect(await repository.latestCommittedSnapshot(boundary)).toMatchObject({
      id: seeded.committed.id,
      ownerId: "corpus-user-a",
      branchId: seeded.created.branch.id,
      status: "committed",
    });

    const pending = await snapshots.requestCapture({
      ownerId: "corpus-user-a",
      threadId: seeded.created.thread.id,
      branchId: seeded.created.branch.id,
      sequence: 2,
      requestId: "snapshot-pending-owner-a",
      conversationCheckpointRef: seeded.checkpoint.id,
      imageTemplateRef: {
        imageDigest,
        profileVersion: "latex-v1",
      },
      executionProfileId: "latex",
      executionProfileVersion: "latex-v1",
    });
    expect(
      await repository.committedSnapshotById(boundary, pending.id),
    ).toBeNull();

    const foreign = await committedHistoricalRun("corpus-user-b", "owner-b");
    expect(
      await repository.committedSnapshotById(boundary, foreign.committed.id),
    ).toBeNull();
    await expect(
      repository.resolveBoundary({
        ownerId: "corpus-user-b",
        sourceBranchId: seeded.created.branch.id,
        messageId: seeded.run.reservedOutputMessageId,
        operation: "retry",
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    const editedBoundary = await repository.resolveBoundary({
      ownerId: "corpus-user-a",
      sourceBranchId: seeded.created.branch.id,
      messageId: seeded.run.userMessageId,
      operation: "edit",
    });
    expect(editedBoundary.cutoffMessageId).toBeNull();
    expect(await repository.latestCommittedSnapshot(editedBoundary)).toBeNull();
  });

  test("links the copied snapshot to one destination run idempotently without moving the source head", async () => {
    const seeded = await committedHistoricalRun(
      "corpus-user-a",
      "idempotent-copy",
    );
    const sourceBefore = await client.execute({
      sql: "SELECT headMessageId FROM assistant_branches WHERE id = ?",
      args: [seeded.created.branch.id],
    });
    const request = {
      ownerId: "corpus-user-a",
      messageId: seeded.run.reservedOutputMessageId,
      clientRequestId: "historical-copy-idempotent",
      destinationBranchId: "branch-copy-idempotent",
      workspaceSnapshotRef: seeded.committed.id,
    };
    const first = await conversations.reserveRetry(request);
    const replay = await conversations.reserveRetry(request);
    expect(replay).toEqual({ ...first, idempotent: true });
    const destination = await client.execute({
      sql: `SELECT workspaceSnapshotRef, branchId FROM assistant_runs
        WHERE id = ? AND userId = ?`,
      args: [first.runId, "corpus-user-a"],
    });
    expect(destination.rows[0]).toMatchObject({
      workspaceSnapshotRef: seeded.committed.id,
      branchId: first.branchId,
    });
    const sourceAfter = await client.execute({
      sql: "SELECT headMessageId FROM assistant_branches WHERE id = ?",
      args: [seeded.created.branch.id],
    });
    expect(sourceAfter.rows[0]?.headMessageId).toBe(
      sourceBefore.rows[0]?.headMessageId,
    );
    await expect(
      conversations.reserveRetry({
        ...request,
        workspaceSnapshotRef: null,
      }),
    ).rejects.toMatchObject({ code: "divergent_replay" });

    await expect(
      repository.resolveBoundary({
        ownerId: "corpus-user-a",
        sourceBranchId: first.branchId,
        messageId: seeded.run.reservedOutputMessageId,
        operation: "retry",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
