import {
  avermateAgentEventV1Schema,
  type AvermateAgentEventV1,
} from "@avermate/agent-contracts"

export type AgentEventBatch = {
  events: readonly AvermateAgentEventV1[]
  nextCursor: number
  terminal: boolean
}

export type AgentEventConnectionState =
  "connecting" | "streaming" | "polling" | "terminal" | "stopped"

export type AgentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export type AgentEventSource = {
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void
  ): void
  close(): void
  onopen: ((event: Event) => unknown) | null
  onerror: ((event: Event) => unknown) | null
}

export type AgentEventSourceFactory = (
  url: string,
  options: EventSourceInit
) => AgentEventSource

function parseEvent(input: unknown): AvermateAgentEventV1 {
  return avermateAgentEventV1Schema.parse(input)
}

export async function startScriptedAgentRun(input: {
  apiUrl: string
  threadId: string
  branchId: string
  runId: string
  signal?: AbortSignal
  fetcher?: AgentFetch
}): Promise<{ runId: string; threadId: string; branchId: string }> {
  const fetcher = input.fetcher ?? fetch
  const response = await fetcher(
    `${input.apiUrl}/api/agent-spike/scripted-runs`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: input.threadId,
        branchId: input.branchId,
        runId: input.runId,
      }),
      signal: input.signal,
    }
  )
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Authentication required for the development assistant spike"
        : `Unable to start the development run (${response.status})`
    )
  }
  const body = (await response.json()) as {
    run?: { runId?: unknown; threadId?: unknown; branchId?: unknown }
  }
  if (
    typeof body.run?.runId !== "string" ||
    typeof body.run.threadId !== "string" ||
    typeof body.run.branchId !== "string"
  ) {
    throw new Error("The development run response is malformed")
  }
  return {
    runId: body.run.runId,
    threadId: body.run.threadId,
    branchId: body.run.branchId,
  }
}

export async function pollAgentEventBatch(input: {
  apiUrl: string
  runId: string
  cursor: number
  signal?: AbortSignal
  fetcher?: AgentFetch
}): Promise<AgentEventBatch> {
  const fetcher = input.fetcher ?? fetch
  const url = new URL(
    `/api/agent-spike/runs/${encodeURIComponent(input.runId)}/events/poll`,
    input.apiUrl
  )
  url.searchParams.set("cursor", String(input.cursor))
  const response = await fetcher(url, {
    credentials: "include",
    cache: "no-store",
    signal: input.signal,
  })
  if (!response.ok)
    throw new Error(`Agent event polling failed (${response.status})`)

  const body = (await response.json()) as {
    events?: unknown
    nextCursor?: unknown
    terminal?: unknown
  }
  if (
    !Array.isArray(body.events) ||
    typeof body.nextCursor !== "number" ||
    !Number.isSafeInteger(body.nextCursor) ||
    typeof body.terminal !== "boolean"
  ) {
    throw new Error("The agent polling response is malformed")
  }
  return {
    events: body.events.map(parseEvent),
    nextCursor: body.nextCursor,
    terminal: body.terminal,
  }
}

export async function consumeAgentPolling(input: {
  apiUrl: string
  runId: string
  cursor: number
  signal: AbortSignal
  onEvent: (event: AvermateAgentEventV1) => void
  fetcher?: AgentFetch
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}): Promise<number> {
  let cursor = input.cursor
  const wait = input.wait ?? waitFor
  while (!input.signal.aborted) {
    const batch = await pollAgentEventBatch({
      ...input,
      cursor,
    })
    for (const event of batch.events) input.onEvent(event)
    cursor = batch.nextCursor
    if (batch.terminal) return cursor
    await wait(batch.events.length > 0 ? 25 : 350, input.signal)
  }
  return cursor
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timeout = window.setTimeout(resolve, milliseconds)
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout)
        reject(signal.reason)
      },
      { once: true }
    )
  })
}

function defaultEventSourceFactory(
  url: string,
  options: EventSourceInit
): AgentEventSource {
  return new EventSource(url, options)
}

/**
 * Connect an at-least-once SSE projection. A failed stream is reopened from
 * its last durable sequence, then degrades to the cursor polling endpoint.
 */
export function connectAgentEvents(input: {
  apiUrl: string
  runId: string
  cursor: number
  onEvent: (event: AvermateAgentEventV1) => void
  onState?: (state: AgentEventConnectionState) => void
  onError?: (error: Error) => void
  eventSourceFactory?: AgentEventSourceFactory
  fetcher?: AgentFetch
  maxStreamReconnects?: number
}): () => void {
  const controller = new AbortController()
  const eventSourceFactory =
    input.eventSourceFactory ??
    (typeof EventSource === "undefined" ? null : defaultEventSourceFactory)
  let source: AgentEventSource | null = null
  let cursor = input.cursor
  let reconnects = 0
  let terminal = false

  const emit = (event: AvermateAgentEventV1) => {
    cursor = Math.max(cursor, event.sequence)
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
    void consumeAgentPolling({
      apiUrl: input.apiUrl,
      runId: input.runId,
      cursor,
      signal: controller.signal,
      onEvent: emit,
      fetcher: input.fetcher,
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        input.onError?.(
          error instanceof Error ? error : new Error("Agent polling failed")
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
      `/api/agent-spike/runs/${encodeURIComponent(input.runId)}/events`,
      input.apiUrl
    )
    url.searchParams.set("cursor", String(cursor))
    const nextSource = eventSourceFactory(url.toString(), {
      withCredentials: true,
    })
    source = nextSource
    nextSource.onopen = () => input.onState?.("streaming")
    nextSource.addEventListener("agent-event", (message) => {
      try {
        emit(parseEvent(JSON.parse(message.data)))
      } catch (error) {
        input.onError?.(
          error instanceof Error
            ? error
            : new Error("Malformed agent stream event")
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
      new DOMException("Agent event connection stopped", "AbortError")
    )
    source?.close()
    input.onState?.("stopped")
  }
}
