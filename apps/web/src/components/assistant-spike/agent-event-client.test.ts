import { describe, expect, test } from "bun:test"
import type { AvermateAgentEventV1 } from "@avermate/agent-contracts"
import {
  connectAgentEvents,
  consumeAgentPolling,
  type AgentFetch,
  type AgentEventSource,
} from "./agent-event-client"

function event(sequence: number, terminal = false): AvermateAgentEventV1 {
  return {
    protocolVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    threadId: "thread-1",
    branchId: "branch-1",
    runId: "run-1",
    emittedAt: new Date(sequence * 1_000).toISOString(),
    type: terminal ? "run.finished" : "text.message.delta",
    payload: terminal
      ? {}
      : { messageId: "message-1", delta: String(sequence) },
    terminal,
  }
}

describe("assistant event client", () => {
  test("polling fallback reaches the terminal cursor", async () => {
    const received: number[] = []
    let request = 0
    const fetcher: AgentFetch = async () => {
      request += 1
      const events = request === 1 ? [event(1)] : [event(2, true)]
      return Response.json({
        events,
        nextCursor: events[0]!.sequence,
        terminal: request === 2,
      })
    }
    const cursor = await consumeAgentPolling({
      apiUrl: "http://localhost:5000",
      runId: "run-1",
      cursor: 0,
      signal: new AbortController().signal,
      fetcher,
      wait: async () => {},
      onEvent: (item) => received.push(item.sequence),
    })

    expect(cursor).toBe(2)
    expect(received).toEqual([1, 2])
  })

  test("reopens SSE from the last cursor before falling back", () => {
    const urls: string[] = []
    const sources: FakeEventSource[] = []
    const received: number[] = []
    const stop = connectAgentEvents({
      apiUrl: "http://localhost:5000",
      runId: "run-1",
      cursor: 0,
      maxStreamReconnects: 1,
      onEvent: (item) => received.push(item.sequence),
      eventSourceFactory(url) {
        urls.push(url)
        const source = new FakeEventSource()
        sources.push(source)
        return source
      },
    })

    sources[0]!.dispatch("agent-event", event(1))
    sources[0]!.onerror?.(new Event("error"))
    expect(new URL(urls[1]!).searchParams.get("cursor")).toBe("1")
    sources[1]!.dispatch("agent-event", event(2, true))
    expect(received).toEqual([1, 2])
    expect(sources[1]!.closed).toBe(true)
    stop()
  })
})

class FakeEventSource implements AgentEventSource {
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>()
  onopen: ((event: Event) => unknown) | null = null
  onerror: ((event: Event) => unknown) | null = null
  closed = false

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void
  ) {
    this.listeners.set(type, listener)
  }

  close() {
    this.closed = true
  }

  dispatch(type: string, payload: AvermateAgentEventV1) {
    this.listeners.get(type)?.({
      data: JSON.stringify(payload),
    } as MessageEvent<string>)
  }
}
