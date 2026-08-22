import {
  assistantEventProjectionSchema,
  type AssistantEventProjection,
} from "@avermate/agent-contracts"

export type AssistantEventConnectionState =
  "connecting" | "streaming" | "polling" | "terminal" | "stopped"

export interface AssistantEventBatch {
  events: readonly AssistantEventProjection[]
  nextCursor: number
  terminal: boolean
}

export interface AssistantEventSource {
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void
  ): void
  close(): void
  onopen: ((event: Event) => unknown) | null
  onerror: ((event: Event) => unknown) | null
}

export type AssistantEventSourceFactory = (
  url: string,
  options: EventSourceInit
) => AssistantEventSource

function parseEvent(input: unknown): AssistantEventProjection {
  return assistantEventProjectionSchema.parse(input)
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timeout = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout)
        reject(signal.reason)
      },
      { once: true }
    )
  })
}

export async function consumeAssistantPolling(input: {
  runId: string
  cursor: number
  signal: AbortSignal
  poll: (input: {
    runId: string
    afterSequence: number
    limit: number
  }) => Promise<AssistantEventBatch>
  onEvent: (event: AssistantEventProjection) => void
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}): Promise<number> {
  let cursor = input.cursor
  const wait = input.wait ?? waitFor
  while (!input.signal.aborted) {
    const batch = await input.poll({
      runId: input.runId,
      afterSequence: cursor,
      limit: 250,
    })
    for (const event of batch.events) {
      if (event.sequence <= cursor) continue
      input.onEvent(parseEvent(event))
      cursor = event.sequence
    }
    cursor = Math.max(cursor, batch.nextCursor)
    if (batch.terminal) return cursor
    await wait(batch.events.length ? 25 : 350, input.signal)
  }
  return cursor
}

function defaultEventSourceFactory(
  url: string,
  options: EventSourceInit
): AssistantEventSource {
  return new EventSource(url, options)
}

/** Authenticated at-least-once SSE with durable cursor replay and oRPC polling fallback. */
export function connectAssistantRunEvents(input: {
  apiUrl: string
  runId: string
  cursor: number
  poll: (input: {
    runId: string
    afterSequence: number
    limit: number
  }) => Promise<AssistantEventBatch>
  onEvent: (event: AssistantEventProjection) => void
  onState?: (state: AssistantEventConnectionState) => void
  onError?: (error: Error) => void
  eventSourceFactory?: AssistantEventSourceFactory
  maxStreamReconnects?: number
}): () => void {
  const controller = new AbortController()
  const eventSourceFactory =
    input.eventSourceFactory ??
    (typeof EventSource === "undefined" ? null : defaultEventSourceFactory)
  let source: AssistantEventSource | null = null
  let cursor = input.cursor
  let reconnects = 0
  let terminal = false

  const emit = (event: AssistantEventProjection) => {
    if (event.runId !== input.runId || event.sequence <= cursor) return
    cursor = event.sequence
    input.onEvent(event)
    if (event.terminal) {
      terminal = true
      source?.close()
      input.onState?.("terminal")
    }
  }

  const poll = () => {
    if (controller.signal.aborted || terminal) return
    source?.close()
    source = null
    input.onState?.("polling")
    void consumeAssistantPolling({
      runId: input.runId,
      cursor,
      signal: controller.signal,
      poll: input.poll,
      onEvent: emit,
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        input.onError?.(
          error instanceof Error ? error : new Error("Assistant polling failed")
        )
      }
    })
  }

  const open = () => {
    if (!eventSourceFactory) {
      poll()
      return
    }
    input.onState?.("connecting")
    const url = new URL(
      `/api/assistant/runs/${encodeURIComponent(input.runId)}/events`,
      input.apiUrl
    )
    url.searchParams.set("cursor", String(cursor))
    const nextSource = eventSourceFactory(url.toString(), {
      withCredentials: true,
    })
    source = nextSource
    nextSource.onopen = () => input.onState?.("streaming")
    nextSource.addEventListener("assistant-event", (message) => {
      try {
        emit(parseEvent(JSON.parse(message.data)))
      } catch (error) {
        input.onError?.(
          error instanceof Error
            ? error
            : new Error("Malformed assistant stream event")
        )
      }
    })
    nextSource.onerror = () => {
      nextSource.close()
      if (controller.signal.aborted || terminal) return
      if (reconnects < (input.maxStreamReconnects ?? 2)) {
        reconnects += 1
        open()
      } else {
        poll()
      }
    }
  }

  open()
  return () => {
    controller.abort(
      new DOMException("Assistant event connection stopped", "AbortError")
    )
    source?.close()
    input.onState?.("stopped")
  }
}
