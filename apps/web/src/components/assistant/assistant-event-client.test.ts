import { describe, expect, test } from "bun:test"
import type { AssistantEventProjection } from "@avermate/agent-contracts"
import {
  connectAssistantRunEvents,
  consumeAssistantPolling,
  type AssistantEventSource,
} from "./assistant-event-client"

function event(sequence: number, terminal = false): AssistantEventProjection {
  const timestamp = new Date(sequence * 1_000).toISOString()
  return {
    protocolVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    threadId: "thread-1",
    branchId: "branch-1",
    runId: "run-1",
    emittedAt: timestamp,
    persistedAt: timestamp,
    type: terminal ? "run.finished" : "text.message.delta",
    payload: terminal ? {} : { delta: String(sequence) },
    terminal,
  }
}

describe("production assistant event client", () => {
  test("polls from the last durable sequence and deduplicates replay", async () => {
    const received: number[] = []
    let calls = 0
    const cursor = await consumeAssistantPolling({
      runId: "run-1",
      cursor: 1,
      signal: new AbortController().signal,
      wait: async () => {},
      poll: async () => {
        calls += 1
        return calls === 1
          ? { events: [event(1), event(2)], nextCursor: 2, terminal: false }
          : { events: [event(3, true)], nextCursor: 3, terminal: true }
      },
      onEvent: (item) => received.push(item.sequence),
    })
    expect(cursor).toBe(3)
    expect(received).toEqual([2, 3])
  })

  test("reconnects SSE with the committed cursor", () => {
    const sources: FakeEventSource[] = []
    const urls: string[] = []
    const received: number[] = []
    const stop = connectAssistantRunEvents({
      apiUrl: "http://localhost:5000",
      runId: "run-1",
      cursor: 0,
      maxStreamReconnects: 1,
      poll: async () => ({ events: [], nextCursor: 0, terminal: true }),
      onEvent: (item) => received.push(item.sequence),
      eventSourceFactory(url) {
        urls.push(url)
        const source = new FakeEventSource()
        sources.push(source)
        return source
      },
    })
    sources[0]!.dispatch(event(1))
    sources[0]!.onerror?.(new Event("error"))
    expect(new URL(urls[1]!).searchParams.get("cursor")).toBe("1")
    sources[1]!.dispatch(event(2, true))
    expect(received).toEqual([1, 2])
    stop()
  })
})

class FakeEventSource implements AssistantEventSource {
  onopen: ((event: Event) => unknown) | null = null
  onerror: ((event: Event) => unknown) | null = null
  private listener: ((event: MessageEvent<string>) => void) | null = null

  addEventListener(
    _type: string,
    listener: (event: MessageEvent<string>) => void
  ) {
    this.listener = listener
  }

  close() {}

  dispatch(payload: AssistantEventProjection) {
    this.listener?.({ data: JSON.stringify(payload) } as MessageEvent<string>)
  }
}
