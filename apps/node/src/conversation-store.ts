import type {
  AppendConversationEvent,
  ConversationPlacement,
  ConversationRunRecord,
  ConversationRunStatus,
  ConversationStore,
  GetConversationRun,
  ReplayConversationEvents,
  StoredConversationEvent,
  NodeConversationDagListInput,
  NodeConversationDagSnapshot,
  NodeConversationDagGetResult,
  AssistantThreadListItem,
} from "@avermate/agent-contracts";
import {
  assistantDagExportSchema,
  assistantThreadListItemSchema,
  avermateAgentEventV1Schema,
  getConversationRunSchema,
  replayConversationEventsSchema,
  serializePersistableAgentEvent,
  storedConversationEventSchema,
  nodeConversationDagListInputSchema,
  nodeConversationDagSnapshotSchema,
} from "@avermate/agent-contracts";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalDigest } from "./canonical-json";

type DurableRun = {
  record: ConversationRunRecord;
  events: StoredConversationEvent[];
};

type ConversationFile = {
  version: 2;
  runs: Record<string, DurableRun>;
  dags: Record<
    string,
    { snapshot: NodeConversationDagSnapshot; syncKeys: string[] }
  >;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function runKey(input: {
  threadId: string;
  branchId: string;
  runId: string;
}) {
  return canonicalDigest({
    threadId: input.threadId,
    branchId: input.branchId,
    runId: input.runId,
  });
}

function eventStatus(type: string, current: ConversationRunStatus) {
  switch (type) {
    case "run.started":
      return "running" as const;
    case "avermate.approval.requested":
      return "awaiting-approval" as const;
    case "avermate.approval.resolved":
      return "running" as const;
    case "run.finished":
      return "finished" as const;
    case "run.failed":
      return "failed" as const;
    case "run.cancelled":
      return "cancelled" as const;
    default:
      return current;
  }
}

async function atomicWrite(path: string, state: ConversationFile) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

/** Durable, owner-fenced conversation event store for a single Node. */
export class FilesystemConversationStore implements ConversationStore {
  readonly #path: string;
  readonly #maximumBytes: number;
  #state: ConversationFile | null = null;
  #mutex: Promise<void> = Promise.resolve();

  constructor(input: { path: string; maximumBytes: number }) {
    if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1) {
      throw new Error("NODE_CONVERSATION_QUOTA_INVALID");
    }
    this.#path = input.path;
    this.#maximumBytes = input.maximumBytes;
  }

  async initialize() {
    await this.#load();
  }

  async provisionRun(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    runId: string;
    placement: ConversationPlacement;
    now?: Date;
  }) {
    const identity = getConversationRunSchema.parse({
      ownerId: input.ownerId,
      threadId: input.threadId,
      branchId: input.branchId,
      runId: input.runId,
    });
    return this.#exclusive((state) => {
      const key = runKey(identity);
      const existing = state.runs[key];
      if (existing) {
        if (
          existing.record.ownerId !== identity.ownerId ||
          canonicalDigest(existing.record.placement) !==
            canonicalDigest(input.placement)
        ) {
          throw new Error("NODE_CONVERSATION_RUN_COLLISION");
        }
        return clone(existing.record);
      }
      const now = (input.now ?? new Date()).toISOString();
      const record: ConversationRunRecord = {
        ...identity,
        placement: input.placement,
        status: "queued",
        lastSequence: 0,
        terminalEventId: null,
        createdAt: now,
        updatedAt: now,
      };
      state.runs[key] = { record, events: [] };
      return clone(record);
    });
  }

  async appendEvent(input: AppendConversationEvent) {
    const event = avermateAgentEventV1Schema.parse(input.event);
    if (
      !Number.isSafeInteger(input.expectedPreviousSequence) ||
      input.expectedPreviousSequence < 0
    ) {
      throw new Error("NODE_CONVERSATION_SEQUENCE_INVALID");
    }
    return this.#exclusive((state) => {
      const run = state.runs[runKey(event)];
      if (!run) throw new Error("NODE_CONVERSATION_RUN_NOT_FOUND");
      const duplicate = run.events.find(
        (stored) => stored.eventId === event.eventId,
      );
      if (duplicate) {
        const { persistedAt: _persistedAt, ...previous } = duplicate;
        if (canonicalDigest(previous) !== canonicalDigest(event)) {
          throw new Error("NODE_CONVERSATION_EVENT_REPLAY_MISMATCH");
        }
        return clone(duplicate);
      }
      if (run.record.terminalEventId) {
        throw new Error("NODE_CONVERSATION_APPEND_AFTER_TERMINAL");
      }
      if (
        run.record.lastSequence !== input.expectedPreviousSequence ||
        event.sequence !== input.expectedPreviousSequence + 1
      ) {
        throw new Error("NODE_CONVERSATION_SEQUENCE_CONFLICT");
      }
      const persistedEvent = JSON.parse(
        serializePersistableAgentEvent(event),
      ) as typeof event;
      const stored = storedConversationEventSchema.parse({
        ...persistedEvent,
        persistedAt: new Date().toISOString(),
      });
      run.events.push(stored);
      run.record.status = eventStatus(event.type, run.record.status);
      run.record.lastSequence = event.sequence;
      run.record.updatedAt = stored.persistedAt;
      if (event.terminal) run.record.terminalEventId = event.eventId;
      return clone(stored);
    });
  }

  async *replayEvents(input: ReplayConversationEvents) {
    const parsed = replayConversationEventsSchema.parse(input);
    const run = await this.#ownedRun(parsed);
    if (!run) return;
    for (const event of run.events
      .filter((candidate) => candidate.sequence > parsed.afterSequence)
      .slice(0, parsed.limit)) {
      yield clone(event);
    }
  }

  async getRun(input: GetConversationRun) {
    const parsed = getConversationRunSchema.parse(input);
    const run = await this.#ownedRun(parsed);
    return run ? clone(run.record) : null;
  }

  async exportOwner(ownerId: string) {
    const state = await this.#load();
    return {
      runs: Object.values(state.runs)
        .filter((run) => run.record.ownerId === ownerId)
        .map(clone),
      dags: Object.values(state.dags)
        .filter((dag) => dag.snapshot.ownerId === ownerId)
        .map((dag) => clone(dag.snapshot)),
    };
  }

  async importDag(input: NodeConversationDagSnapshot) {
    const snapshot = nodeConversationDagSnapshotSchema.parse(input);
    if (
      snapshot.detail.thread.userId !== snapshot.ownerId ||
      snapshot.detail.thread.placement.kind !== "node"
    ) {
      throw new Error("NODE_CONVERSATION_DAG_OWNER_MISMATCH");
    }
    return this.#exclusive((state) => {
      const threadId = snapshot.detail.thread.id;
      const existing = state.dags[threadId];
      if (existing?.snapshot.ownerId !== undefined &&
          existing.snapshot.ownerId !== snapshot.ownerId) {
        throw new Error("NODE_CONVERSATION_DAG_OWNER_MISMATCH");
      }
      if (existing?.syncKeys.includes(snapshot.syncKey)) {
        return clone(existing.snapshot);
      }
      const previousMessages = new Map(
        existing?.snapshot.detail.messages.map((message) => [message.id, message]) ?? [],
      );
      const previousEvents = new Map(
        existing?.snapshot.events.map((event) => [event.eventId, event]) ?? [],
      );
      const merged = nodeConversationDagSnapshotSchema.parse({
        ...snapshot,
        detail: {
          ...snapshot.detail,
          messages: snapshot.detail.messages.map((message) =>
            message.parts.length === 0 && previousMessages.has(message.id)
              ? { ...message, parts: previousMessages.get(message.id)!.parts }
              : message,
          ),
        },
        events: snapshot.events.map((event) =>
          event.payload === null && previousEvents.has(event.eventId)
            ? { ...event, payload: previousEvents.get(event.eventId)!.payload }
            : event,
        ),
      });
      const activeRunProjections = merged.detail.runs
        .filter((run) =>
          ["reserved", "running", "waiting-for-user"].includes(run.status),
        )
        .map((run) => {
          const events = merged.events.filter((event) => event.runId === run.id);
          const markdown = events
            .filter((event) => event.type === "text.message.delta")
            .map((event) => {
              const payload = event.payload as { delta?: unknown };
              return typeof payload?.delta === "string" ? payload.delta : "";
            })
            .join("");
          return {
            runId: run.id,
            outputMessageId: run.reservedOutputMessageId,
            parts: markdown
              ? [{ type: "text" as const, id: `stream-${run.id}`, markdown }]
              : [
                  {
                    type: "status" as const,
                    id: `stream-${run.id}`,
                    state: run.status === "reserved" ? "pending" as const : "active" as const,
                    label:
                      run.status === "waiting-for-user"
                        ? "Waiting for your reply"
                        : "Responding",
                  },
                ],
            lastSequence: events.at(-1)?.sequence ?? 0,
            status: run.status,
          };
        });
      merged.detail.activeRunProjections = activeRunProjections;
      state.dags[threadId] = {
        snapshot: merged,
        syncKeys: [...(existing?.syncKeys ?? []), snapshot.syncKey].slice(-256),
      };
      return clone(merged);
    });
  }

  async listDags(
    ownerId: string,
    input: NodeConversationDagListInput,
  ): Promise<AssistantThreadListItem[]> {
    const filter = nodeConversationDagListInputSchema.parse(input);
    const query = filter.query?.trim().toLocaleLowerCase();
    const state = await this.#load();
    return Object.values(state.dags)
      .filter(({ snapshot }) => snapshot.ownerId === ownerId)
      .map(({ snapshot }) => {
        const detail = snapshot.detail;
        const matched = query
          ? detail.messages
              .flatMap((message) => message.parts)
              .find(
                (part) =>
                  part.type === "text" &&
                  part.markdown.toLocaleLowerCase().includes(query),
              )
          : null;
        if (
          (detail.thread.deletedAt && !filter.includeDeleted) ||
          (detail.thread.archivedAt && !filter.includeArchived) ||
          (filter.starredOnly && !detail.thread.starredAt) ||
          (query &&
            !detail.thread.title.toLocaleLowerCase().includes(query) &&
            !matched)
        ) {
          return null;
        }
        return assistantThreadListItemSchema.parse({
          thread: detail.thread,
          messageCount: detail.messages.length,
          lastMessageAt:
            detail.messages.at(-1)?.createdAt ?? detail.thread.createdAt,
          activeRunId:
            detail.runs.find((run) =>
              ["reserved", "running", "waiting-for-user"].includes(run.status),
            )?.id ?? null,
          matchedMessagePreview:
            matched?.type === "text" ? matched.markdown.slice(0, 500) : null,
        });
      })
      .filter((item): item is AssistantThreadListItem => item !== null)
      .sort((left, right) =>
        right.thread.updatedAt.localeCompare(left.thread.updatedAt),
      )
      .slice(0, filter.limit)
      .map(clone);
  }

  async getDag(ownerId: string, threadId: string): Promise<NodeConversationDagGetResult | null> {
    const state = await this.#load();
    const stored = state.dags[threadId];
    if (!stored || stored.snapshot.ownerId !== ownerId) return null;
    return clone({
      detail: stored.snapshot.detail,
      events: stored.snapshot.events,
    });
  }

  async exportDag(ownerId: string, threadId: string) {
    const stored = await this.getDag(ownerId, threadId);
    if (!stored) throw new Error("NODE_CONVERSATION_DAG_NOT_FOUND");
    const detail = stored.detail;
    return {
      dag: assistantDagExportSchema.parse({
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        mode: "whole-dag",
        thread: detail.thread,
        branches: detail.branches,
        messages: detail.messages,
        runs: detail.runs,
        attachments: detail.attachments,
        citations: detail.citations,
        manifests: detail.manifests,
        usage: detail.usage,
      }),
      events: stored.events,
    };
  }

  async deleteDag(ownerId: string, threadId: string) {
    return this.#exclusive((state) => {
      const stored = state.dags[threadId];
      if (!stored || stored.snapshot.ownerId !== ownerId) {
        return { threadId, deleted: false, alreadyAbsent: true };
      }
      delete state.dags[threadId];
      for (const [key, run] of Object.entries(state.runs)) {
        if (run.record.ownerId === ownerId && run.record.threadId === threadId) {
          delete state.runs[key];
        }
      }
      return { threadId, deleted: true, alreadyAbsent: false };
    });
  }

  async deleteOwner(ownerId: string) {
    return this.#exclusive((state) => {
      let deletedRuns = 0;
      let deletedEvents = 0;
      for (const [key, run] of Object.entries(state.runs)) {
        if (run.record.ownerId !== ownerId) continue;
        deletedRuns += 1;
        deletedEvents += run.events.length;
        delete state.runs[key];
      }
      for (const [threadId, dag] of Object.entries(state.dags)) {
        if (dag.snapshot.ownerId !== ownerId) continue;
        delete state.dags[threadId];
      }
      return { deletedRuns, deletedEvents };
    });
  }

  async resetForRestore() {
    this.#state = null;
    await rm(this.#path, { force: true });
  }

  async #ownedRun(input: GetConversationRun) {
    const state = await this.#load();
    const run = state.runs[runKey(input)];
    return run?.record.ownerId === input.ownerId ? clone(run) : null;
  }

  async #load() {
    if (this.#state) return this.#state;
    try {
      const state = JSON.parse(await readFile(this.#path, "utf8")) as
        | ConversationFile
        | undefined;
      if (!state || ![1, 2].includes(state.version) || !state.runs) {
        throw new Error("NODE_CONVERSATION_STORE_VERSION_UNSUPPORTED");
      }
      this.#state = {
        version: 2,
        runs: state.runs,
        dags: "dags" in state && state.dags ? state.dags : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#state = { version: 2, runs: {}, dags: {} };
    }
    return this.#state;
  }

  async #exclusive<T>(operation: (state: ConversationFile) => T | Promise<T>) {
    const previous = this.#mutex;
    let release!: () => void;
    this.#mutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const state = await this.#load();
      const result = await operation(state);
      const bytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
      if (bytes > this.#maximumBytes) {
        this.#state = null;
        throw new Error("NODE_CONVERSATION_QUOTA_EXCEEDED");
      }
      await atomicWrite(this.#path, state);
      return result;
    } finally {
      release();
    }
  }
}
