import { Database } from "bun:sqlite";
import {
  avermateAgentEventV1Schema,
  conversationRunRecordSchema,
  nodeRelayCursorSchema,
  replayConversationEventsSchema,
  serializePersistableAgentEvent,
  storedConversationEventSchema,
  type AppendConversationEvent,
  type ConversationPlacement,
  type ConversationRunRecord,
  type ConversationStore,
  type GetConversationRun,
  type NodeRelayCursor,
  type ReplayConversationEvents,
  type StoredConversationEvent,
} from "@avermate/agent-contracts";

type RunRow = {
  owner_id: string;
  thread_id: string;
  branch_id: string;
  run_id: string;
  placement_kind: "core" | "node";
  node_id: string | null;
  status: ConversationRunRecord["status"];
  last_sequence: number;
  terminal_event_id: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  event_json: string;
  persisted_at: string;
};

type RunIdentity = {
  ownerId: string;
  threadId: string;
  branchId: string;
  runId: string;
  placement: ConversationPlacement;
};

function mapRun(row: RunRow): ConversationRunRecord {
  return conversationRunRecordSchema.parse({
    ownerId: row.owner_id,
    threadId: row.thread_id,
    branchId: row.branch_id,
    runId: row.run_id,
    placement:
      row.placement_kind === "node"
        ? { kind: "node", nodeId: row.node_id }
        : { kind: "core" },
    status: row.status,
    lastSequence: row.last_sequence,
    terminalEventId: row.terminal_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function statusAfterEvent(
  type: string,
  current: ConversationRunRecord["status"],
): ConversationRunRecord["status"] {
  switch (type) {
    case "run.started":
      return "running";
    case "avermate.approval.requested":
      return "awaiting-approval";
    case "avermate.approval.resolved":
      return "running";
    case "run.finished":
      return "finished";
    case "run.failed":
      return "failed";
    case "run.cancelled":
      return "cancelled";
    default:
      return current;
  }
}

export class SqliteConversationStore implements ConversationStore {
  readonly database: Database;
  readonly #ownsDatabase: boolean;
  readonly #listeners = new Map<string, Set<() => void>>();

  constructor(database: Database | string) {
    this.#ownsDatabase = typeof database === "string";
    this.database =
      typeof database === "string" ? new Database(database, { create: true }) : database;
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_spike_runs (
        owner_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        run_id TEXT PRIMARY KEY NOT NULL,
        placement_kind TEXT NOT NULL CHECK (placement_kind IN ('core', 'node')),
        node_id TEXT,
        status TEXT NOT NULL,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        terminal_event_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (placement_kind = 'core' AND node_id IS NULL) OR
          (placement_kind = 'node' AND node_id IS NOT NULL)
        )
      );
      CREATE TABLE IF NOT EXISTS agent_spike_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES agent_spike_runs(run_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        persisted_at TEXT NOT NULL,
        UNIQUE (run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS agent_spike_events_replay_idx
        ON agent_spike_events(run_id, sequence);
    `);
  }

  ensureRun(input: RunIdentity): ConversationRunRecord {
    const now = new Date().toISOString();
    this.database
      .query(
        `INSERT INTO agent_spike_runs (
          owner_id, thread_id, branch_id, run_id, placement_kind, node_id,
          status, last_sequence, terminal_event_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, NULL, ?, ?)
        ON CONFLICT(run_id) DO NOTHING`,
      )
      .run(
        input.ownerId,
        input.threadId,
        input.branchId,
        input.runId,
        input.placement.kind,
        input.placement.kind === "node" ? input.placement.nodeId : null,
        now,
        now,
      );

    const row = this.database
      .query("SELECT * FROM agent_spike_runs WHERE run_id = ?")
      .get(input.runId) as RunRow | null;
    if (!row) throw new Error("Conversation run creation failed");
    const run = mapRun(row);
    if (
      run.ownerId !== input.ownerId ||
      run.threadId !== input.threadId ||
      run.branchId !== input.branchId ||
      JSON.stringify(run.placement) !== JSON.stringify(input.placement)
    ) {
      throw new Error("Run ID is already bound to another conversation");
    }
    return run;
  }

  async appendEvent(
    input: AppendConversationEvent,
  ): Promise<StoredConversationEvent> {
    const event = avermateAgentEventV1Schema.parse(input.event);
    const persistedAt = new Date().toISOString();
    const eventJson = serializePersistableAgentEvent(event);
    let stored: StoredConversationEvent | null = null;

    const append = this.database.transaction(() => {
      const row = this.database
        .query("SELECT * FROM agent_spike_runs WHERE run_id = ?")
        .get(event.runId) as RunRow | null;
      if (!row) throw new Error("Conversation run does not exist");
      const run = mapRun(row);
      if (
        run.threadId !== event.threadId ||
        run.branchId !== event.branchId
      ) {
        throw new Error("Event does not belong to the run's conversation branch");
      }
      if (run.terminalEventId) {
        throw new Error("Cannot append after a terminal event");
      }
      if (run.lastSequence !== input.expectedPreviousSequence) {
        throw new Error(
          `Agent event sequence conflict: expected ${run.lastSequence}, received ${input.expectedPreviousSequence}`,
        );
      }
      if (event.sequence !== run.lastSequence + 1) {
        throw new Error("Agent event sequence must increase by exactly one");
      }

      this.database
        .query(
          `INSERT INTO agent_spike_events (
            event_id, run_id, sequence, event_json, persisted_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(event.eventId, event.runId, event.sequence, eventJson, persistedAt);

      const nextStatus = statusAfterEvent(event.type, run.status);
      this.database
        .query(
          `UPDATE agent_spike_runs
           SET status = ?, last_sequence = ?, terminal_event_id = ?, updated_at = ?
           WHERE run_id = ?`,
        )
        .run(
          nextStatus,
          event.sequence,
          event.terminal ? event.eventId : null,
          persistedAt,
          event.runId,
        );

      stored = storedConversationEventSchema.parse({
        ...JSON.parse(eventJson),
        persistedAt,
      });
    });

    append.immediate();
    this.#notify(event.runId);
    if (!stored) throw new Error("Conversation event append did not commit");
    return stored;
  }

  async *replayEvents(
    input: ReplayConversationEvents,
  ): AsyncIterable<StoredConversationEvent> {
    const replay = replayConversationEventsSchema.parse(input);
    const run = await this.getRun(replay);
    if (!run) return;

    const rows = this.database
      .query(
        `SELECT event_json, persisted_at
         FROM agent_spike_events
         WHERE run_id = ? AND sequence > ?
         ORDER BY sequence ASC
         LIMIT ?`,
      )
      .all(replay.runId, replay.afterSequence, replay.limit) as EventRow[];
    for (const row of rows) {
      yield storedConversationEventSchema.parse({
        ...JSON.parse(row.event_json),
        persistedAt: row.persisted_at,
      });
    }
  }

  async getRun(
    input: GetConversationRun,
  ): Promise<ConversationRunRecord | null> {
    const row = this.database
      .query(
        `SELECT * FROM agent_spike_runs
         WHERE owner_id = ? AND thread_id = ? AND branch_id = ? AND run_id = ?`,
      )
      .get(input.ownerId, input.threadId, input.branchId, input.runId) as
      | RunRow
      | null;
    return row ? mapRun(row) : null;
  }

  getRunForOwner(ownerId: string, runId: string): ConversationRunRecord | null {
    const row = this.database
      .query(
        "SELECT * FROM agent_spike_runs WHERE owner_id = ? AND run_id = ?",
      )
      .get(ownerId, runId) as RunRow | null;
    return row ? mapRun(row) : null;
  }

  async waitForChange(
    runId: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<"changed" | "timeout"> {
    if (options.signal?.aborted) throw options.signal.reason;
    const timeoutMs = options.timeoutMs ?? 15_000;

    return new Promise((resolve, reject) => {
      const listeners = this.#listeners.get(runId) ?? new Set<() => void>();
      this.#listeners.set(runId, listeners);
      let settled = false;

      const cleanup = () => {
        listeners.delete(onChange);
        if (listeners.size === 0) this.#listeners.delete(runId);
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const finish = (value: "changed" | "timeout") => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const onChange = () => finish("changed");
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const timeout = setTimeout(() => finish("timeout"), timeoutMs);

      listeners.add(onChange);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  close(): void {
    if (this.#ownsDatabase) this.database.close();
  }

  #notify(runId: string): void {
    for (const listener of this.#listeners.get(runId) ?? []) listener();
  }
}

export class NodeRelayRegistry {
  readonly #cursors = new Map<string, NodeRelayCursor>();

  acknowledge(input: NodeRelayCursor): NodeRelayCursor {
    const cursor = nodeRelayCursorSchema.parse(input);
    const key = `${cursor.ownerId}:${cursor.runId}`;
    const previous = this.#cursors.get(key);
    if (
      previous &&
      cursor.acknowledgedSequence < previous.acknowledgedSequence
    ) {
      throw new Error("Node relay acknowledgement cannot move backwards");
    }
    this.#cursors.set(key, cursor);
    return cursor;
  }

  list(): NodeRelayCursor[] {
    return [...this.#cursors.values()].map((cursor) => ({ ...cursor }));
  }
}

export class PlacementUnavailableError extends Error {
  constructor() {
    super("Conversation placement is unavailable");
    this.name = "PlacementUnavailableError";
  }
}

export async function* relayNodeConversationEvents(input: {
  store: ConversationStore;
  replay: ReplayConversationEvents;
  nodeAvailable: boolean;
  registry: NodeRelayRegistry;
  nodeId: string;
}): AsyncIterable<StoredConversationEvent> {
  if (!input.nodeAvailable) throw new PlacementUnavailableError();

  for await (const event of input.store.replayEvents(input.replay)) {
    input.registry.acknowledge({
      ownerId: input.replay.ownerId,
      threadId: input.replay.threadId,
      branchId: input.replay.branchId,
      runId: input.replay.runId,
      nodeId: input.nodeId,
      acknowledgedSequence: event.sequence,
      terminal: event.terminal,
      updatedAt: new Date().toISOString(),
    });
    yield event;
  }
}
