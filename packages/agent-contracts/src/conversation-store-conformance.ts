import type {
  ConversationPlacement,
  ConversationStore,
} from "./conversation-store";
import type { AvermateAgentEventV1 } from "./events";

export type ConversationStoreConformanceReport = {
  placement: ConversationPlacement;
  passed: readonly string[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`conversation conformance: ${message}`);
}

async function expectReject(operation: () => Promise<unknown>, code: string) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(`conversation conformance: expected ${code} rejection`);
}

/** Reusable plan-029/032 contract suite for Core and Node stores. */
export async function runConversationStoreConformance(input: {
  store: ConversationStore;
  placement: ConversationPlacement;
  ownerId?: string;
  provisionRun(identity: {
    ownerId: string;
    threadId: string;
    branchId: string;
    runId: string;
    placement: ConversationPlacement;
  }): Promise<void> | void;
  now?: Date;
}): Promise<ConversationStoreConformanceReport> {
  const suffix = crypto.randomUUID();
  const identity = {
    ownerId: input.ownerId ?? `conformance-owner-${suffix}`,
    threadId: `conformance-thread-${suffix}`,
    branchId: `conformance-branch-${suffix}`,
    runId: `conformance-run-${suffix}`,
  };
  await input.provisionRun({ ...identity, placement: input.placement });
  const created = await input.store.getRun(identity);
  assert(created !== null, "provisioned run must be readable");
  assert(
    JSON.stringify(created.placement) === JSON.stringify(input.placement),
    "run placement must be durable",
  );

  const emittedAt = (input.now ?? new Date()).toISOString();
  const started: AvermateAgentEventV1 = {
    protocolVersion: 1,
    eventId: `event-started-${suffix}`,
    sequence: 1,
    threadId: identity.threadId,
    branchId: identity.branchId,
    runId: identity.runId,
    emittedAt,
    type: "run.started",
    payload: { conformance: true },
    terminal: false,
  };
  const stored = await input.store.appendEvent({
    event: started,
    expectedPreviousSequence: 0,
  });
  assert(stored.eventId === started.eventId, "append must return exact event");
  assert(
    Number.isFinite(Date.parse(stored.persistedAt)),
    "append must return a persistence timestamp",
  );

  await expectReject(
    () =>
      input.store.appendEvent({
        event: { ...started, eventId: `event-conflict-${suffix}`, sequence: 2 },
        expectedPreviousSequence: 0,
      }),
    "sequence-conflict",
  );

  const finished: AvermateAgentEventV1 = {
    ...started,
    eventId: `event-finished-${suffix}`,
    sequence: 2,
    type: "run.finished",
    payload: { conformance: "complete" },
    terminal: true,
  };
  await input.store.appendEvent({
    event: finished,
    expectedPreviousSequence: 1,
  });
  await expectReject(
    () =>
      input.store.appendEvent({
        event: {
          ...started,
          eventId: `event-after-terminal-${suffix}`,
          sequence: 3,
        },
        expectedPreviousSequence: 2,
      }),
    "append-after-terminal",
  );

  const replayed = [];
  for await (const event of input.store.replayEvents({
    ...identity,
    afterSequence: 0,
    limit: 10,
  })) {
    replayed.push(event);
  }
  assert(replayed.length === 2, "replay must return every committed event");
  assert(
    replayed[0]?.sequence === 1 && replayed[1]?.sequence === 2,
    "replay must preserve strict sequence order",
  );

  const resumed = [];
  for await (const event of input.store.replayEvents({
    ...identity,
    afterSequence: 1,
    limit: 1,
  })) {
    resumed.push(event);
  }
  assert(
    resumed.length === 1 && resumed[0]?.eventId === finished.eventId,
    "cursor replay must be bounded and exclusive",
  );
  assert(
    (await input.store.getRun({
      ...identity,
      ownerId: `${identity.ownerId}-other`,
    })) === null,
    "cross-owner lookup must not reveal a run",
  );

  return {
    placement: input.placement,
    passed: [
      "durable-placement",
      "persistence-before-return",
      "sequence-cas",
      "terminal-fencing",
      "cursor-replay",
      "owner-isolation",
    ],
  };
}
