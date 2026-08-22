import type {
  AvermateAgentEventV1,
  ConversationPlacement,
  ConversationRunRecord,
} from "@avermate/agent-contracts";
import { SqliteConversationStore } from "./conversation-store";

export type ScriptedRunInput = {
  ownerId: string;
  threadId: string;
  branchId: string;
  runId: string;
  placement?: ConversationPlacement;
};

type ScriptedEvent = Pick<
  AvermateAgentEventV1,
  "type" | "payload" | "terminal"
>;

const scriptedEvents: readonly ScriptedEvent[] = [
  {
    type: "run.started",
    payload: { graphSchemaVersion: "spike-v1", mode: "deterministic" },
    terminal: false,
  },
  {
    type: "text.message.started",
    payload: { messageId: "assistant-message" },
    terminal: false,
  },
  {
    type: "text.message.delta",
    payload: {
      messageId: "assistant-message",
      delta: "Je consulte les données scolaires disponibles. ",
    },
    terminal: false,
  },
  {
    type: "activity.snapshot",
    payload: { activityId: "status-1", label: "Lecture des notes", status: "running" },
    terminal: false,
  },
  {
    type: "tool.call.started",
    payload: { callId: "call-1", toolName: "grades.list" },
    terminal: false,
  },
  {
    type: "tool.call.arguments.delta",
    payload: { callId: "call-1", delta: "{}" },
    terminal: false,
  },
  {
    type: "tool.call.finished",
    payload: { callId: "call-1" },
    terminal: false,
  },
  {
    type: "tool.result",
    payload: { callId: "call-1", status: "success", summary: "3 notes lues" },
    terminal: false,
  },
  {
    type: "avermate.citation.added",
    payload: {
      citationId: "citation-1",
      label: "Notes — période courante",
      sourceRef: "academic:grades:current-period",
    },
    terminal: false,
  },
  {
    type: "avermate.usage.delta",
    payload: {
      inputTokens: 24,
      outputTokens: 17,
      reasoningTokens: "unknown",
      cachedReadTokens: "unknown",
      cachedWriteTokens: "unknown",
    },
    terminal: false,
  },
  {
    type: "text.message.delta",
    payload: {
      messageId: "assistant-message",
      delta: "La projection est reconstruite depuis les événements persistés.",
    },
    terminal: false,
  },
  {
    type: "text.message.finished",
    payload: { messageId: "assistant-message" },
    terminal: false,
  },
  {
    type: "run.finished",
    payload: { finishReason: "stop" },
    terminal: true,
  },
] as const;

export class ScriptedAgentRunService {
  readonly #running = new Map<string, Promise<void>>();

  constructor(
    readonly store: SqliteConversationStore,
    readonly eventDelayMs = 35,
  ) {}

  start(input: ScriptedRunInput): ConversationRunRecord {
    const run = this.store.ensureRun({
      ...input,
      placement: input.placement ?? { kind: "core" },
    });
    if (run.lastSequence > 0 || this.#running.has(run.runId)) return run;

    const execution = this.#execute(input).finally(() => {
      this.#running.delete(input.runId);
    });
    this.#running.set(input.runId, execution);
    return run;
  }

  async completed(runId: string): Promise<void> {
    await this.#running.get(runId);
  }

  async #execute(input: ScriptedRunInput): Promise<void> {
    let previousSequence = 0;
    try {
      for (const [index, scripted] of scriptedEvents.entries()) {
        if (this.eventDelayMs > 0) {
          await Bun.sleep(this.eventDelayMs);
        }
        const sequence = index + 1;
        await this.store.appendEvent({
          event: {
            protocolVersion: 1,
            eventId: `${input.runId}:${sequence}`,
            sequence,
            threadId: input.threadId,
            branchId: input.branchId,
            runId: input.runId,
            emittedAt: new Date().toISOString(),
            ...scripted,
          },
          expectedPreviousSequence: previousSequence,
        });
        previousSequence = sequence;
      }
    } catch (error) {
      const run = this.store.getRunForOwner(input.ownerId, input.runId);
      if (run && !run.terminalEventId) {
        await this.store.appendEvent({
          event: {
            protocolVersion: 1,
            eventId: `${input.runId}:${run.lastSequence + 1}:failed`,
            sequence: run.lastSequence + 1,
            threadId: input.threadId,
            branchId: input.branchId,
            runId: input.runId,
            emittedAt: new Date().toISOString(),
            type: "run.failed",
            payload: { code: "scripted_run_failed" },
            terminal: true,
          },
          expectedPreviousSequence: run.lastSequence,
        });
      }
      throw error;
    }
  }
}

export { scriptedEvents };
