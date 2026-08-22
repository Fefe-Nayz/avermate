import { describe, expect, test } from "bun:test"
import type { AvermateAgentEventV1 } from "@avermate/agent-contracts"
import {
  emptyAssistantSpikeProjection,
  projectAssistantEvent,
  projectAssistantEvents,
} from "./projection"

function event(
  sequence: number,
  type: string,
  payload: unknown,
  terminal = false
): AvermateAgentEventV1 {
  return {
    protocolVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    threadId: "thread-1",
    branchId: "branch-1",
    runId: "run-1",
    emittedAt: new Date(sequence * 1_000).toISOString(),
    type,
    payload,
    terminal,
  }
}

const run = [
  event(1, "run.started", {}),
  event(2, "text.message.started", { messageId: "message-1" }),
  event(3, "text.message.delta", { messageId: "message-1", delta: "Bonjour " }),
  event(4, "tool.call.started", { callId: "call-1", toolName: "grades.list" }),
  event(5, "tool.call.arguments.delta", { callId: "call-1", delta: "{}" }),
  event(6, "tool.call.finished", { callId: "call-1" }),
  event(7, "tool.result", {
    callId: "call-1",
    status: "success",
    summary: "3 notes",
  }),
  event(8, "avermate.experimental.future", { ignored: true }),
  event(9, "text.message.delta", {
    messageId: "message-1",
    delta: "Avermate.",
  }),
  event(10, "text.message.finished", { messageId: "message-1" }),
  event(11, "run.finished", { finishReason: "stop" }, true),
] as const

describe("assistant event projection", () => {
  test("reconnects after an interruption without duplicated visible content", () => {
    const interrupted = projectAssistantEvents(
      emptyAssistantSpikeProjection(),
      run.slice(0, 5)
    )
    const replayed = projectAssistantEvents(interrupted, [
      run[4]!,
      ...run.slice(5),
    ])

    expect(replayed.markdown).toBe("Bonjour Avermate.")
    expect(replayed.toolCalls).toHaveLength(1)
    expect(replayed.toolCalls[0]?.status).toBe("succeeded")
    expect(replayed.cursor).toBe(11)
    expect(replayed.terminalStatus).toBe("finished")
    expect(replayed.ignoredEventTypes).toEqual(["avermate.experimental.future"])
  })

  test("refresh reconstruction produces the same terminal projection", () => {
    const first = projectAssistantEvents(emptyAssistantSpikeProjection(), run)
    const refreshed = projectAssistantEvents(
      emptyAssistantSpikeProjection(),
      run
    )
    expect(refreshed).toEqual(first)
  })

  test("fails closed on gaps, cross-run events and post-terminal writes", () => {
    const started = projectAssistantEvent(
      emptyAssistantSpikeProjection(),
      run[0]
    )
    expect(() => projectAssistantEvent(started, run[2])).toThrow("sequence gap")
    expect(() =>
      projectAssistantEvent(started, {
        ...run[1],
        runId: "another-run",
      })
    ).toThrow("only one run")

    const terminal = projectAssistantEvents(
      emptyAssistantSpikeProjection(),
      run
    )
    expect(() =>
      projectAssistantEvent(terminal, {
        ...event(12, "state.snapshot", {}),
      })
    ).toThrow("terminal")
  })
})
