import { describe, expect, test } from "bun:test";
import { EventSchemas, EventType } from "@ag-ui/core";
import type { AvermateAgentEventV1 } from "@avermate/agent-contracts";
import {
  AguiAdapterError,
  fromAguiEvent,
  fromAguiReplay,
  toAguiEvent,
  toAguiReplay,
} from "./agui-adapter";

function event(
  sequence: number,
  type: string,
  payload: unknown,
  terminal = false,
): AvermateAgentEventV1 {
  return {
    protocolVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    threadId: "thread-1",
    branchId: "branch-1",
    runId: "run-1",
    emittedAt: `2026-08-22T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    type,
    payload,
    terminal,
  };
}

const replay = [
  event(1, "run.started", { graphSchemaVersion: "spike-v1" }),
  event(2, "text.message.started", { messageId: "message-1" }),
  event(3, "text.message.delta", {
    messageId: "message-1",
    delta: "Je consulte les notes.",
  }),
  event(4, "activity.snapshot", {
    activityId: "status-1",
    label: "Lecture des notes",
    status: "running",
  }),
  event(5, "tool.call.started", {
    callId: "call-1",
    toolName: "grades.list",
    parentMessageId: "message-1",
  }),
  event(6, "tool.call.arguments.delta", {
    callId: "call-1",
    delta: "{}",
  }),
  event(7, "tool.call.finished", { callId: "call-1" }),
  event(8, "tool.result", {
    callId: "call-1",
    status: "success",
    summary: "3 notes lues",
  }),
  event(9, "avermate.citation.added", {
    citationId: "citation-1",
    label: "Notes — période courante",
    sourceRef: "academic:grades:current-period",
  }),
  event(10, "avermate.usage.delta", {
    inputTokens: 24,
    outputTokens: 17,
    reasoningTokens: "unknown",
    cachedReadTokens: "unknown",
    cachedWriteTokens: "unknown",
  }),
  event(11, "text.message.finished", { messageId: "message-1" }),
  event(12, "run.finished", { finishReason: "stop" }, true),
] as const;

describe("AG-UI adapter", () => {
  test("maps the stable lifecycle, text, tool, status and terminal events to real AG-UI types", () => {
    const projected = toAguiReplay(replay);

    expect(projected.map((item) => item.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.ACTIVITY_SNAPSHOT,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.CUSTOM,
      EventType.CUSTOM,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    for (const item of projected) {
      expect(EventSchemas.safeParse(item).success).toBe(true);
    }
    expect(projected[3]).toEqual(
      expect.objectContaining({
        activityType: "avermate.status",
        content: { label: "Lecture des notes", status: "running" },
      }),
    );
    expect(projected[8]).toEqual(
      expect.objectContaining({
        name: "avermate.citation.added",
        value: replay[8].payload,
      }),
    );
    expect(projected[9]).toEqual(
      expect.objectContaining({
        name: "avermate.usage.delta",
        value: replay[9].payload,
      }),
    );
  });

  test("survives an AG-UI JSON round trip without losing replay identity", () => {
    const projected = toAguiReplay(replay);
    const wire = JSON.parse(JSON.stringify(projected));
    const restored = fromAguiReplay(wire);

    expect(restored).toEqual([...replay]);
    expect(restored.map((item) => item.eventId)).toEqual(
      replay.map((item) => item.eventId),
    );
    expect(restored.map((item) => item.sequence)).toEqual(
      replay.map((item) => item.sequence),
    );
    expect(toAguiReplay(restored)).toEqual(projected);
  });

  test("keeps unknown additive Avermate extensions namespaced and replayable", () => {
    const source = event(1, "avermate.future.safe-extension", {
      additive: true,
    });
    const projected = toAguiEvent(source);

    expect(projected).toEqual(
      expect.objectContaining({
        type: EventType.CUSTOM,
        name: "avermate.future.safe-extension",
        value: { additive: true },
      }),
    );
    expect(fromAguiEvent(JSON.parse(JSON.stringify(projected)))).toEqual(
      source,
    );
  });

  test("redacts secrets before putting the canonical envelope on AG-UI", () => {
    const projected = toAguiEvent(
      event(1, "avermate.context.snapshot", {
        nested: {
          apiKey: "synthetic-secret-value",
          safe: "visible",
        },
      }),
    );
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain("synthetic-secret-value");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("visible");
  });

  test("fails closed for malformed, unnamespaced or tampered events", () => {
    expect(() =>
      toAguiEvent({ ...event(1, "run.started", {}), protocolVersion: 2 }),
    ).toThrow(AguiAdapterError);
    expect(() =>
      toAguiEvent(event(1, "text.message.delta", { delta: "missing id" })),
    ).toThrow("Malformed payload");
    expect(() => toAguiEvent(event(1, "provider.private.event", {}))).toThrow(
      "Unknown unnamespaced",
    );

    const projected = toAguiEvent(
      event(1, "text.message.delta", {
        messageId: "message-1",
        delta: "safe",
      }),
    );
    expect(() => fromAguiEvent({ ...projected, delta: "tampered" })).toThrow(
      "does not match",
    );
    expect(() =>
      toAguiReplay([
        event(2, "run.started", {}),
        event(1, "run.finished", {}, true),
      ]),
    ).toThrow("strictly increasing");
  });

  test("never accepts raw chain-of-thought fields or AG-UI reasoning events", () => {
    expect(() =>
      toAguiEvent(
        event(1, "avermate.context.snapshot", {
          chainOfThought: "private reasoning",
        }),
      ),
    ).toThrow("Private chain-of-thought");

    const projected = toAguiEvent(
      event(1, "avermate.todo.snapshot", { items: [] }),
    );
    expect(() =>
      fromAguiEvent({
        ...projected,
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: "reasoning-1",
        delta: "private reasoning",
      }),
    ).toThrow("Raw AG-UI reasoning");
  });
});
