import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SqliteConversationStore } from "./conversation-store";
import { ScriptedAgentRunService, scriptedEvents } from "./scripted-run";

describe("ScriptedAgentRunService", () => {
  test("persists the complete deterministic run and resumes from a cursor", async () => {
    const store = new SqliteConversationStore(new Database(":memory:"));
    const service = new ScriptedAgentRunService(store, 0);
    service.start({
      ownerId: "owner-1",
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
    });
    await service.completed("run-1");

    const all = [];
    for await (const item of store.replayEvents({
      ownerId: "owner-1",
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
      afterSequence: 0,
      limit: 100,
    })) {
      all.push(item);
    }
    expect(all).toHaveLength(scriptedEvents.length);
    expect(all.at(-1)).toEqual(
      expect.objectContaining({ type: "run.finished", terminal: true }),
    );

    const resumed = [];
    for await (const item of store.replayEvents({
      ownerId: "owner-1",
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
      afterSequence: 7,
      limit: 100,
    })) {
      resumed.push(item);
    }
    expect(resumed.map((item) => item.sequence)).toEqual(
      all.slice(7).map((item) => item.sequence),
    );
    expect(new Set(all.map((item) => item.eventId)).size).toBe(all.length);
  });

  test("does not execute a replayed start twice", async () => {
    const store = new SqliteConversationStore(new Database(":memory:"));
    const service = new ScriptedAgentRunService(store, 0);
    const input = {
      ownerId: "owner-1",
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
    };
    service.start(input);
    await service.completed("run-1");
    service.start(input);

    const run = store.getRunForOwner("owner-1", "run-1");
    expect(run?.lastSequence).toBe(scriptedEvents.length);
  });
});
