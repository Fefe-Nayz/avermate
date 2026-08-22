import { z } from "zod";

export const AGENT_PROTOCOL_VERSION = 1 as const;
export const MAX_AGENT_EVENT_REPLAY = 1_000;

export const stableAgentEventTypes = [
  "run.started",
  "run.finished",
  "run.failed",
  "run.cancelled",
  "step.started",
  "step.finished",
  "text.message.started",
  "text.message.delta",
  "text.message.finished",
  "tool.call.started",
  "tool.call.arguments.delta",
  "tool.call.finished",
  "tool.result",
  "state.snapshot",
  "activity.snapshot",
] as const;

export const avermateAgentEventTypes = [
  "avermate.context.snapshot",
  "avermate.usage.delta",
  "avermate.cost.snapshot",
  "avermate.approval.requested",
  "avermate.approval.resolved",
  "avermate.citation.added",
  "avermate.artifact.proposed",
  "avermate.artifact.adopted",
  "avermate.workspace.snapshot",
  "avermate.todo.snapshot",
  "avermate.capabilities.snapshot",
] as const;

export const terminalAgentEventTypes = [
  "run.finished",
  "run.failed",
  "run.cancelled",
] as const;

const knownEventTypes = new Set<string>([
  ...stableAgentEventTypes,
  ...avermateAgentEventTypes,
]);
const terminalEventTypes = new Set<string>(terminalAgentEventTypes);

export const avermateAgentEventV1Schema = z
  .looseObject({
    protocolVersion: z.literal(AGENT_PROTOCOL_VERSION),
    eventId: z.string().min(1).max(256),
    sequence: z.number().int().positive(),
    threadId: z.string().min(1).max(256),
    branchId: z.string().min(1).max(256),
    runId: z.string().min(1).max(256),
    emittedAt: z.iso.datetime({ offset: true }),
    type: z.string().min(1).max(256),
    payload: z.unknown(),
    terminal: z.boolean(),
  })
  .superRefine((event, context) => {
    const typeIsTerminal = terminalEventTypes.has(event.type);
    if (event.terminal !== typeIsTerminal) {
      context.addIssue({
        code: "custom",
        path: ["terminal"],
        message: typeIsTerminal
          ? "Terminal run events must set terminal=true"
          : "Only finished, failed or cancelled run events may be terminal",
      });
    }
  });

export type AvermateAgentEventV1 = z.infer<typeof avermateAgentEventV1Schema>;

export const storedConversationEventSchema = avermateAgentEventV1Schema.extend({
  persistedAt: z.iso.datetime({ offset: true }),
});
export type StoredConversationEvent = z.infer<
  typeof storedConversationEventSchema
>;

export function isKnownAgentEventType(type: string): boolean {
  return knownEventTypes.has(type);
}

export function assertReplayableRun(
  events: readonly AvermateAgentEventV1[],
): void {
  if (events.length === 0) return;

  const eventIds = new Set<string>();
  let previousSequence = 0;
  let terminalCount = 0;
  const { runId, threadId, branchId } = events[0]!;

  for (const event of events) {
    avermateAgentEventV1Schema.parse(event);
    if (
      event.runId !== runId ||
      event.threadId !== threadId ||
      event.branchId !== branchId
    ) {
      throw new Error("A replay batch may contain only one run and branch");
    }
    if (event.sequence <= previousSequence) {
      throw new Error("Agent event sequence must be strictly increasing");
    }
    if (eventIds.has(event.eventId)) {
      throw new Error("Agent event IDs must be replay-safe and unique");
    }
    if (event.terminal) terminalCount += 1;
    previousSequence = event.sequence;
    eventIds.add(event.eventId);
  }

  if (terminalCount > 1) {
    throw new Error("A run may contain exactly one terminal event");
  }
  if (terminalCount === 1 && !events.at(-1)?.terminal) {
    throw new Error("No events may follow a terminal event");
  }
}

const sensitiveKeyPattern =
  /(^|[-_])(authorization|cookie|password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|private[-_]?key)($|[-_])/i;

function redactUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry, seen));
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[REDACTED:CYCLE]";

  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = sensitiveKeyPattern.test(key)
      ? "[REDACTED]"
      : redactUnknown(entry, seen);
  }
  seen.delete(value);
  return output;
}

export function redactAgentEventPayload(payload: unknown): unknown {
  return redactUnknown(payload, new WeakSet<object>());
}

export function serializePersistableAgentEvent(
  event: AvermateAgentEventV1,
): string {
  return JSON.stringify(
    avermateAgentEventV1Schema.parse({
      ...event,
      payload: redactAgentEventPayload(event.payload),
    }),
  );
}
