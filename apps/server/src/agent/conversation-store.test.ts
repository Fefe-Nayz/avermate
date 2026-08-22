import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { AvermateAgentEventV1 } from "@avermate/agent-contracts";
import {
  NodeRelayRegistry,
  PlacementUnavailableError,
  SqliteConversationStore,
  relayNodeConversationEvents,
} from "./conversation-store";

const event = (
  sequence: number,
  type: string,
  terminal = false,
): AvermateAgentEventV1 => ({
  protocolVersion: 1,
  eventId: `event-${sequence}`,
  sequence,
  threadId: "thread-1",
  branchId: "branch-1",
  runId: "run-1",
  emittedAt: new Date().toISOString(),
  type,
  payload: { api_key: "synthetic secret fixture", visible: sequence },
  terminal,
});

function createStore(placement: { kind: "core" } | { kind: "node"; nodeId: string }) {
  const database = new Database(":memory:");
  const store = new SqliteConversationStore(database);
  store.ensureRun({
    ownerId: "owner-1",
    threadId: "thread-1",
    branchId: "branch-1",
    runId: "run-1",
    placement,
  });
  return store;
}

const replay = {
  ownerId: "owner-1",
  threadId: "thread-1",
  branchId: "branch-1",
  runId: "run-1",
  afterSequence: 0,
  limit: 100,
};

describe("SqliteConversationStore", () => {
  test("commits and redacts before waking subscribers", async () => {
    const store = createStore({ kind: "core" });
    const changed = store.waitForChange("run-1", { timeoutMs: 1_000 });
    await store.appendEvent({
      event: event(1, "run.started"),
      expectedPreviousSequence: 0,
    });
    expect(await changed).toBe("changed");

    const stored = [];
    for await (const item of store.replayEvents(replay)) stored.push(item);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.payload).toEqual({
      api_key: "[REDACTED]",
      visible: 1,
    });
    expect((await store.getRun(replay))?.lastSequence).toBe(1);
  });

  test("rejects duplicates, gaps and writes after the terminal event", async () => {
    const store = createStore({ kind: "core" });
    await store.appendEvent({
      event: event(1, "run.started"),
      expectedPreviousSequence: 0,
    });
    await expect(
      store.appendEvent({
        event: { ...event(2, "text.message.delta"), sequence: 3 },
        expectedPreviousSequence: 1,
      }),
    ).rejects.toThrow("exactly one");
    await expect(
      store.appendEvent({
        event: event(2, "text.message.delta"),
        expectedPreviousSequence: 0,
      }),
    ).rejects.toThrow("sequence conflict");
    await store.appendEvent({
      event: event(2, "run.finished", true),
      expectedPreviousSequence: 1,
    });
    await expect(
      store.appendEvent({
        event: event(3, "text.message.delta"),
        expectedPreviousSequence: 2,
      }),
    ).rejects.toThrow("terminal");
  });

  test("keeps node payloads only in the node store and fails explicitly offline", async () => {
    const nodeStore = createStore({ kind: "node", nodeId: "node-1" });
    await nodeStore.appendEvent({
      event: event(1, "run.started"),
      expectedPreviousSequence: 0,
    });
    const registry = new NodeRelayRegistry();
    const relayed = [];
    for await (const item of relayNodeConversationEvents({
      store: nodeStore,
      replay,
      nodeAvailable: true,
      registry,
      nodeId: "node-1",
    })) {
      relayed.push(item);
    }
    expect(relayed).toHaveLength(1);
    expect(registry.list()).toEqual([
      expect.objectContaining({ acknowledgedSequence: 1, terminal: false }),
    ]);
    expect(JSON.stringify(registry.list())).not.toContain("payload");

    const offline = relayNodeConversationEvents({
      store: nodeStore,
      replay,
      nodeAvailable: false,
      registry,
      nodeId: "node-1",
    });
    await expect(offline[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
      PlacementUnavailableError,
    );
  });
});
