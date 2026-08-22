import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { createCorpusTestDatabase } from "../search/test-helpers";
import {
  CoreConversationStore,
  type TurnReservation,
} from "./core-conversation-store";
import {
  CoreConversationCheckpointStore,
  InMemoryCheckpointBlobStore,
  type CheckpointCrashPhase,
} from "./checkpoint-store";

let sharedClient: Client;
let setupOrdinal = 0;
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;
beforeAll(async () => {
  sharedClient = await createCorpusTestDatabase();
}, databaseHookTimeout);
afterAll(() => sharedClient.close(), databaseHookTimeout);

async function setup() {
  const client = sharedClient;
  setupOrdinal += 1;
  const conversations = new CoreConversationStore(client);
  const created = await conversations.createThread({
    ownerId: "corpus-user-a",
    title: "Checkpoint",
  });
  const run = await conversations.reserveTurn({
    ownerId: "corpus-user-a",
    threadId: created.thread.id,
    branchId: created.branch.id,
    expectedHeadMessageId: null,
    clientRequestId: `checkpoint-run-${setupOrdinal}`,
    markdown: "State",
    modelKey: "mock-readonly",
  });
  await conversations.startRun("corpus-user-a", run.runId);
  await conversations.appendRunEvent({
    ownerId: "corpus-user-a",
    runId: run.runId,
    type: "avermate.status",
    payload: { label: "checkpoint boundary" },
  });
  return { client, created, run };
}

function input(
  created: Awaited<ReturnType<CoreConversationStore["createThread"]>>,
  run: TurnReservation,
) {
  return {
    ownerId: "corpus-user-a",
    threadId: created.thread.id,
    branchId: created.branch.id,
    runId: run.runId,
    inputMessageId: run.userMessageId,
    appendKey: `checkpoint-append-${run.runId}`,
    afterEventSequence: 1,
    runtimeId: "avermate-readonly",
    runtimeVersion: "1",
    graphSchemaVersion: 1,
    state: new TextEncoder().encode('{"phase":"running"}'),
  };
}

describe("CoreConversationCheckpointStore crash recovery", () => {
  test("only exposes a digest-verified committed checkpoint", async () => {
    const { client, created, run } = await setup();
    const blobs = new InMemoryCheckpointBlobStore();
    const store = new CoreConversationCheckpointStore(client, blobs);
    const committed = await store.append(input(created, run));
    expect(committed.status).toBe("committed");
    expect(
      new TextDecoder().decode(
        await store.readState({
          ownerId: "corpus-user-a",
          checkpointId: committed.id,
        }),
      ),
    ).toBe('{"phase":"running"}');
    const replay = await store.append(input(created, run));
    expect(replay.id).toBe(committed.id);
    await expect(
      store.get({ ownerId: "corpus-user-b", checkpointId: committed.id }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  for (const phase of [
    "after-upload",
    "after-promotion",
    "after-adoption",
  ] as const satisfies readonly CheckpointCrashPhase[]) {
    test(`reconciles idempotently after crash ${phase}`, async () => {
      const { client, created, run } = await setup();
      const blobs = new InMemoryCheckpointBlobStore();
      let crashed = false;
      const crashing = new CoreConversationCheckpointStore(
        client,
        blobs,
        (observed) => {
          if (!crashed && observed === phase) {
            crashed = true;
            throw new Error(`crash:${phase}`);
          }
        },
      );
      await expect(crashing.append(input(created, run))).rejects.toThrow(
        `crash:${phase}`,
      );
      const recovery = new CoreConversationCheckpointStore(client, blobs);
      const result = await recovery.reconcileStaging({ olderThanSeconds: 0 });
      if (phase === "after-adoption") {
        expect(result.committed).toHaveLength(0);
      } else {
        expect(result.committed).toHaveLength(1);
      }
      const row = (
        await client.execute({
          sql: `SELECT id FROM assistant_conversation_checkpoints LIMIT 1`,
        })
      ).rows[0]!;
      expect(
        await recovery.get({
          ownerId: "corpus-user-a",
          checkpointId: String(row.id),
        }),
      ).toMatchObject({ status: "committed" });
    });
  }

  test("never adopts a corrupted promoted object", async () => {
    const { client, created, run } = await setup();
    const blobs = new InMemoryCheckpointBlobStore();
    let crashed = false;
    const crashing = new CoreConversationCheckpointStore(
      client,
      blobs,
      (phase) => {
        if (!crashed && phase === "after-promotion") {
          crashed = true;
          throw new Error("crash");
        }
      },
    );
    await expect(crashing.append(input(created, run))).rejects.toThrow("crash");
    const final = [...blobs.objects.keys()].find((key) =>
      key.includes("/sha256/"),
    )!;
    blobs.objects.set(final, new TextEncoder().encode("tampered"));
    const recovery = new CoreConversationCheckpointStore(client, blobs);
    const result = await recovery.reconcileStaging({ olderThanSeconds: 0 });
    expect(result.failed).toHaveLength(1);
    const visible = await client.execute({
      sql: `SELECT id FROM assistant_conversation_checkpoints
        WHERE runId = ? AND status = 'committed'`,
      args: [run.runId],
    });
    expect(visible.rows).toHaveLength(0);
  });

  test("rejects a checkpoint whose owner, branch, or event boundary is mixed", async () => {
    const { client, created, run } = await setup();
    const blobs = new InMemoryCheckpointBlobStore();
    const store = new CoreConversationCheckpointStore(client, blobs);
    await expect(
      store.append({
        ...input(created, run),
        ownerId: "corpus-user-b",
        appendKey: `wrong-owner-${run.runId}`,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      store.append({
        ...input(created, run),
        branchId: "branch-from-another-thread",
        appendKey: `wrong-branch-${run.runId}`,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      store.append({
        ...input(created, run),
        afterEventSequence: 999,
        appendKey: `wrong-sequence-${run.runId}`,
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(blobs.objects.size).toBe(0);
  });

  test("does not delete a content-addressed blob while another checkpoint references it", async () => {
    const first = await setup();
    const second = await setup();
    const blobs = new InMemoryCheckpointBlobStore();
    const store = new CoreConversationCheckpointStore(first.client, blobs);
    const firstCheckpoint = await store.append(input(first.created, first.run));
    const secondCheckpoint = await store.append(
      input(second.created, second.run),
    );
    expect(firstCheckpoint.stateBlobRef).toBe(secondCheckpoint.stateBlobRef);

    const old = Math.floor(Date.now() / 1_000) - 10_000;
    await first.client.execute({
      sql: `UPDATE assistant_threads SET deletedAt = ? WHERE id = ?`,
      args: [old, first.created.thread.id],
    });
    await store.markGarbage({
      ownerId: "corpus-user-a",
      olderThan: new Date(Date.now() + 1_000),
    });
    await store.sweepGarbage({ graceSeconds: 0 });

    expect(blobs.objects.has(secondCheckpoint.stateBlobRef!)).toBe(true);
    expect(
      await store.readState({
        ownerId: "corpus-user-a",
        checkpointId: secondCheckpoint.id,
      }),
    ).toEqual(new TextEncoder().encode('{"phase":"running"}'));
  });
});
