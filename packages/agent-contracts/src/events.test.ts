import { describe, expect, test } from "bun:test";
import {
  assertReplayableRun,
  avermateAgentEventV1Schema,
  isKnownAgentEventType,
  serializePersistableAgentEvent,
  type AvermateAgentEventV1,
} from "./events";

const event = (
  sequence: number,
  type: string,
  terminal = false,
  payload: unknown = {},
): AvermateAgentEventV1 => ({
  protocolVersion: 1,
  eventId: `event-${sequence}`,
  sequence,
  threadId: "thread-1",
  branchId: "branch-1",
  runId: "run-1",
  emittedAt: "2026-08-22T00:00:00.000Z",
  type,
  payload,
  terminal,
});

describe("Avermate agent event v1", () => {
  test("accepts additive fields and rejects an unknown major version", () => {
    expect(
      avermateAgentEventV1Schema.parse({
        ...event(1, "run.started"),
        additiveFutureField: true,
      }).additiveFutureField,
    ).toBe(true);
    expect(() =>
      avermateAgentEventV1Schema.parse({
        ...event(1, "run.started"),
        protocolVersion: 2,
      }),
    ).toThrow();
  });

  test("enforces ordered replay and one final terminal event", () => {
    const replay = [
      event(1, "run.started"),
      event(2, "text.message.delta", false, { delta: "Bonjour" }),
      event(3, "run.finished", true),
    ];
    expect(() => assertReplayableRun(replay)).not.toThrow();
    expect(() => assertReplayableRun([replay[1]!, replay[0]!])).toThrow(
      "strictly increasing",
    );
    expect(() =>
      assertReplayableRun([
        ...replay,
        { ...event(4, "run.cancelled", true), eventId: "cancelled" },
      ]),
    ).toThrow("exactly one terminal");
    expect(() =>
      assertReplayableRun([
        event(1, "run.finished", true),
        event(2, "text.message.delta"),
      ]),
    ).toThrow("follow a terminal");
  });

  test("redacts nested credentials before serialization", () => {
    const serialized = serializePersistableAgentEvent(
      event(1, "tool.result", false, {
        result: { ok: true },
        authorization: "sensitive fixture",
        nested: {
          refresh_token: "another fixture",
          harmlessTokenCount: 42,
        },
      }),
    );
    expect(serialized).not.toContain("sensitive fixture");
    expect(serialized).not.toContain("another fixture");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("harmlessTokenCount");
  });

  test("identifies known events while permitting unknown additive events", () => {
    expect(isKnownAgentEventType("avermate.citation.added")).toBe(true);
    expect(isKnownAgentEventType("vendor.future.event")).toBe(false);
    expect(() =>
      avermateAgentEventV1Schema.parse(event(1, "vendor.future.event")),
    ).not.toThrow();
  });
});
