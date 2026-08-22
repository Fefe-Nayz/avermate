import { EventSchemas, EventType, type AGUIEvent } from "@ag-ui/core";
import {
  assertReplayableRun,
  avermateAgentEventV1Schema,
  serializePersistableAgentEvent,
  type AvermateAgentEventV1,
} from "@avermate/agent-contracts";
import { z } from "zod";

/**
 * AG-UI custom events owned by Avermate always retain their persisted
 * `avermate.*` name. Consumers may ignore an unknown name in this namespace,
 * but must not reinterpret an unknown, unnamespaced protocol event.
 */
export const AVERMATE_AGUI_CUSTOM_EVENT_NAMESPACE = "avermate." as const;

/**
 * Every AG-UI projection carries the already-redacted canonical v1 event in
 * this passthrough field. AG-UI remains a presentation protocol: event IDs and
 * cursors still belong to Avermate, and a JSON round trip cannot lose replay
 * identity. This field is never populated from an unvalidated provider event.
 */
export const AVERMATE_AGUI_ENVELOPE_FIELD = "avermateEnvelope" as const;

export type AvermateAguiEvent = AGUIEvent & {
  [AVERMATE_AGUI_ENVELOPE_FIELD]: AvermateAgentEventV1;
};

export class AguiAdapterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AguiAdapterError";
  }
}

const boundedIdSchema = z.string().min(1).max(256);
const boundedTextSchema = z.string().max(100_000);

const runPayloadSchema = z.looseObject({
  parentRunId: boundedIdSchema.optional(),
});
const runErrorPayloadSchema = z.looseObject({
  code: z.string().min(1).max(256).optional(),
  message: z.string().min(1).max(2_000).optional(),
});
const stepPayloadSchema = z.looseObject({ stepName: boundedIdSchema });
const textStartPayloadSchema = z.looseObject({
  messageId: boundedIdSchema,
  role: z.enum(["developer", "system", "assistant", "user"]).optional(),
  name: boundedIdSchema.optional(),
});
const textDeltaPayloadSchema = z.looseObject({
  messageId: boundedIdSchema,
  delta: boundedTextSchema,
});
const textEndPayloadSchema = z.looseObject({ messageId: boundedIdSchema });
const toolStartPayloadSchema = z.looseObject({
  callId: boundedIdSchema,
  toolName: boundedIdSchema,
  parentMessageId: boundedIdSchema.optional(),
});
const toolArgsPayloadSchema = z.looseObject({
  callId: boundedIdSchema,
  delta: boundedTextSchema,
});
const toolEndPayloadSchema = z.looseObject({ callId: boundedIdSchema });
const toolResultPayloadSchema = z
  .looseObject({
    callId: boundedIdSchema,
    messageId: boundedIdSchema.optional(),
    content: boundedTextSchema.optional(),
    summary: boundedTextSchema.optional(),
  })
  .refine(
    (payload) => payload.content !== undefined || payload.summary !== undefined,
    {
      message: "Tool results require string content or a string summary",
    },
  );
const statePayloadSchema = z.looseObject({ snapshot: z.unknown() });
const activityPayloadSchema = z.looseObject({
  activityId: boundedIdSchema,
  activityType: boundedIdSchema.optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  replace: z.boolean().optional(),
  label: z.string().max(2_000).optional(),
  status: z.string().max(256).optional(),
});

const privateReasoningKeyPattern =
  /^(chain[-_]?of[-_]?thought|raw[-_]?reasoning|hidden[-_]?reasoning|private[-_]?reasoning|thinking[-_]?trace)$/i;

const forbiddenAguiReasoningTypes = new Set<EventType>([
  EventType.THINKING_START,
  EventType.THINKING_END,
  EventType.THINKING_TEXT_MESSAGE_START,
  EventType.THINKING_TEXT_MESSAGE_CONTENT,
  EventType.THINKING_TEXT_MESSAGE_END,
  EventType.REASONING_START,
  EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT,
  EventType.REASONING_MESSAGE_END,
  EventType.REASONING_MESSAGE_CHUNK,
  EventType.REASONING_END,
  EventType.REASONING_ENCRYPTED_VALUE,
]);

function assertNoPrivateReasoning(
  value: unknown,
  seen = new WeakSet<object>(),
): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) assertNoPrivateReasoning(entry, seen);
  } else {
    for (const [key, entry] of Object.entries(value)) {
      if (privateReasoningKeyPattern.test(key)) {
        throw new AguiAdapterError(
          "Private chain-of-thought fields cannot cross the AG-UI boundary",
        );
      }
      assertNoPrivateReasoning(entry, seen);
    }
  }
  seen.delete(value);
}

function parsePayload<T extends z.ZodType>(
  schema: T,
  event: AvermateAgentEventV1,
): z.output<T> {
  const result = schema.safeParse(event.payload);
  if (!result.success) {
    throw new AguiAdapterError(
      `Malformed payload for Avermate event ${event.type}`,
      { cause: result.error },
    );
  }
  return result.data;
}

function redactAndValidateEvent(input: unknown): AvermateAgentEventV1 {
  const parsed = avermateAgentEventV1Schema.safeParse(input);
  if (!parsed.success) {
    throw new AguiAdapterError("Malformed Avermate agent event", {
      cause: parsed.error,
    });
  }

  // The persistence serializer is the shared redaction boundary. Project only
  // the parsed JSON result so secrets cannot survive in the AG-UI metadata.
  const redacted = avermateAgentEventV1Schema.parse(
    JSON.parse(serializePersistableAgentEvent(parsed.data)),
  );
  assertNoPrivateReasoning(redacted.payload);
  return redacted;
}

function timestampOf(event: AvermateAgentEventV1): number {
  const timestamp = Date.parse(event.emittedAt);
  if (!Number.isFinite(timestamp)) {
    throw new AguiAdapterError("Avermate event timestamp is invalid");
  }
  return timestamp;
}

function projectCanonicalEvent(event: AvermateAgentEventV1): AGUIEvent {
  const timestamp = timestampOf(event);
  let projected: unknown;

  switch (event.type) {
    case "run.started": {
      const payload = parsePayload(runPayloadSchema, event);
      projected = {
        type: EventType.RUN_STARTED,
        timestamp,
        threadId: event.threadId,
        runId: event.runId,
        ...(payload.parentRunId ? { parentRunId: payload.parentRunId } : {}),
      };
      break;
    }
    case "run.finished":
      parsePayload(runPayloadSchema, event);
      projected = {
        type: EventType.RUN_FINISHED,
        timestamp,
        threadId: event.threadId,
        runId: event.runId,
        outcome: { type: "success" },
      };
      break;
    case "run.failed": {
      const payload = parsePayload(runErrorPayloadSchema, event);
      projected = {
        type: EventType.RUN_ERROR,
        timestamp,
        message: payload.message ?? "Agent run failed",
        code: payload.code ?? "avermate_run_failed",
      };
      break;
    }
    case "run.cancelled": {
      const payload = parsePayload(runErrorPayloadSchema, event);
      projected = {
        type: EventType.RUN_ERROR,
        timestamp,
        message: payload.message ?? "Agent run cancelled",
        code: "avermate_run_cancelled",
      };
      break;
    }
    case "step.started": {
      const payload = parsePayload(stepPayloadSchema, event);
      projected = {
        type: EventType.STEP_STARTED,
        timestamp,
        stepName: payload.stepName,
      };
      break;
    }
    case "step.finished": {
      const payload = parsePayload(stepPayloadSchema, event);
      projected = {
        type: EventType.STEP_FINISHED,
        timestamp,
        stepName: payload.stepName,
      };
      break;
    }
    case "text.message.started": {
      const payload = parsePayload(textStartPayloadSchema, event);
      projected = {
        type: EventType.TEXT_MESSAGE_START,
        timestamp,
        messageId: payload.messageId,
        role: payload.role ?? "assistant",
        ...(payload.name ? { name: payload.name } : {}),
      };
      break;
    }
    case "text.message.delta": {
      const payload = parsePayload(textDeltaPayloadSchema, event);
      projected = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        timestamp,
        messageId: payload.messageId,
        delta: payload.delta,
      };
      break;
    }
    case "text.message.finished": {
      const payload = parsePayload(textEndPayloadSchema, event);
      projected = {
        type: EventType.TEXT_MESSAGE_END,
        timestamp,
        messageId: payload.messageId,
      };
      break;
    }
    case "tool.call.started": {
      const payload = parsePayload(toolStartPayloadSchema, event);
      projected = {
        type: EventType.TOOL_CALL_START,
        timestamp,
        toolCallId: payload.callId,
        toolCallName: payload.toolName,
        ...(payload.parentMessageId
          ? { parentMessageId: payload.parentMessageId }
          : {}),
      };
      break;
    }
    case "tool.call.arguments.delta": {
      const payload = parsePayload(toolArgsPayloadSchema, event);
      projected = {
        type: EventType.TOOL_CALL_ARGS,
        timestamp,
        toolCallId: payload.callId,
        delta: payload.delta,
      };
      break;
    }
    case "tool.call.finished": {
      const payload = parsePayload(toolEndPayloadSchema, event);
      projected = {
        type: EventType.TOOL_CALL_END,
        timestamp,
        toolCallId: payload.callId,
      };
      break;
    }
    case "tool.result": {
      const payload = parsePayload(toolResultPayloadSchema, event);
      projected = {
        type: EventType.TOOL_CALL_RESULT,
        timestamp,
        messageId: payload.messageId ?? `${event.eventId}:tool-result`,
        toolCallId: payload.callId,
        content: payload.content ?? payload.summary!,
        role: "tool",
      };
      break;
    }
    case "state.snapshot": {
      const payload = parsePayload(statePayloadSchema, event);
      projected = {
        type: EventType.STATE_SNAPSHOT,
        timestamp,
        snapshot: payload.snapshot,
      };
      break;
    }
    case "activity.snapshot": {
      const payload = parsePayload(activityPayloadSchema, event);
      projected = {
        type: EventType.ACTIVITY_SNAPSHOT,
        timestamp,
        messageId: payload.activityId,
        activityType: payload.activityType ?? "avermate.status",
        content:
          payload.content ??
          Object.fromEntries(
            Object.entries({
              label: payload.label,
              status: payload.status,
            }).filter(([, value]) => value !== undefined),
          ),
        replace: payload.replace ?? true,
      };
      break;
    }
    default:
      if (!event.type.startsWith(AVERMATE_AGUI_CUSTOM_EVENT_NAMESPACE)) {
        throw new AguiAdapterError(
          `Unknown unnamespaced Avermate event type: ${event.type}`,
        );
      }
      projected = {
        type: EventType.CUSTOM,
        timestamp,
        name: event.type,
        value: event.payload,
      };
  }

  const result = EventSchemas.safeParse(projected);
  if (!result.success) {
    throw new AguiAdapterError(
      `Avermate event ${event.type} did not produce a valid AG-UI event`,
      { cause: result.error },
    );
  }
  return result.data;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutEnvelope(event: AGUIEvent | AvermateAguiEvent): unknown {
  const copy = { ...event } as Record<string, unknown>;
  delete copy[AVERMATE_AGUI_ENVELOPE_FIELD];
  return copy;
}

export function toAguiEvent(input: unknown): AvermateAguiEvent {
  const canonical = redactAndValidateEvent(input);
  const projected = projectCanonicalEvent(canonical);
  return {
    ...projected,
    [AVERMATE_AGUI_ENVELOPE_FIELD]: canonical,
  } as AvermateAguiEvent;
}

/**
 * Restores the canonical event only when the AG-UI projection and its Avermate
 * envelope agree exactly. Provider-originated AG-UI events therefore cannot
 * smuggle a canonical event or a replay cursor through this adapter.
 */
export function fromAguiEvent(input: unknown): AvermateAgentEventV1 {
  const parsed = EventSchemas.safeParse(input);
  if (!parsed.success) {
    throw new AguiAdapterError("Malformed AG-UI event", {
      cause: parsed.error,
    });
  }
  if (forbiddenAguiReasoningTypes.has(parsed.data.type)) {
    throw new AguiAdapterError(
      "Raw AG-UI reasoning events cannot cross the Avermate boundary",
    );
  }
  assertNoPrivateReasoning(input);

  if (input === null || typeof input !== "object") {
    throw new AguiAdapterError("AG-UI event has no Avermate envelope");
  }
  const envelope = (input as Record<string, unknown>)[
    AVERMATE_AGUI_ENVELOPE_FIELD
  ];
  const canonical = redactAndValidateEvent(envelope);
  const expected = projectCanonicalEvent(canonical);
  if (stableJson(withoutEnvelope(parsed.data)) !== stableJson(expected)) {
    throw new AguiAdapterError(
      "AG-UI projection does not match its Avermate envelope",
    );
  }
  return canonical;
}

export function toAguiReplay(inputs: readonly unknown[]): AvermateAguiEvent[] {
  const canonical = inputs.map(redactAndValidateEvent);
  assertReplayableRun(canonical);
  return canonical.map((event) => ({
    ...projectCanonicalEvent(event),
    [AVERMATE_AGUI_ENVELOPE_FIELD]: event,
  })) as AvermateAguiEvent[];
}

export function fromAguiReplay(
  inputs: readonly unknown[],
): AvermateAgentEventV1[] {
  const canonical = inputs.map(fromAguiEvent);
  assertReplayableRun(canonical);
  return canonical;
}
