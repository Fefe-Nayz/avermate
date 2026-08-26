"use client"

import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  useMessagePartText,
} from "@assistant-ui/react"
import { Braces, Cable, CircleStop, Play, RotateCcw } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DocumentMarkdown } from "@/components/documents/document-markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { env } from "@/lib/env"
import {
  connectAgentEvents,
  startScriptedAgentRun,
  type AgentEventConnectionState,
} from "./agent-event-client"
import {
  createSpikeExternalStoreAdapter,
  projectionToExternalMessages,
} from "./external-store-adapter"
import {
  emptyAssistantSpikeProjection,
  projectAssistantEvent,
  type AssistantSpikeProjection,
} from "./projection"

const STORAGE_KEY = "avermate:agent-spike:run-v1"

type StoredRun = { runId: string; threadId: string; branchId: string }

function readStoredRun(): StoredRun | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null"
    ) as Partial<StoredRun> | null
    return typeof value?.runId === "string" &&
      typeof value.threadId === "string" &&
      typeof value.branchId === "string"
      ? {
          runId: value.runId,
          threadId: value.threadId,
          branchId: value.branchId,
        }
      : null
  } catch {
    return null
  }
}

function MarkdownMessagePart() {
  const part = useMessagePartText()
  return (
    <DocumentMarkdown
      markdown={part.text}
      ariaLabel="Scripted assistant response"
      className="min-w-0"
    />
  )
}

function ProjectedAssistantMessage() {
  return (
    <article className="rounded-2xl border bg-card p-5 shadow-xs">
      <MessagePrimitive.Parts components={{ Text: MarkdownMessagePart }} />
    </article>
  )
}

function ExternalStoreProjection({
  projection,
  onBranchChange,
}: {
  projection: AssistantSpikeProjection
  onBranchChange: (headId: string | null) => void
}) {
  const messages = useMemo(
    () => projectionToExternalMessages(projection),
    [projection]
  )
  const adapter = useMemo(
    () =>
      createSpikeExternalStoreAdapter({
        messages,
        running: projection.running,
        // assistant-ui may optimistically calculate a visible path, but
        // Avermate remains authoritative and supplies the next projection.
        onVisibleMessagesChange: () => {},
        onBranchChange: ({ headId }) => onBranchChange(headId),
      }),
    [messages, onBranchChange, projection.running]
  )
  const runtime = useExternalStoreRuntime(adapter)
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <ThreadPrimitive.Messages
            components={{ Message: ProjectedAssistantMessage }}
          />
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}

export function AssistantSpikeClient() {
  const [projection, setProjection] = useState(emptyAssistantSpikeProjection)
  const [connection, setConnection] =
    useState<AgentEventConnectionState>("stopped")
  const [error, setError] = useState<string | null>(null)
  const [selectedHead, setSelectedHead] = useState<string | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const connect = useCallback((run: StoredRun, cursor = 0) => {
    stopRef.current?.()
    setError(null)
    stopRef.current = connectAgentEvents({
      apiUrl: env.apiUrl,
      runId: run.runId,
      cursor,
      onState: setConnection,
      onError: (cause) => setError(cause.message),
      onEvent: (event) => {
        setProjection((current) => {
          try {
            return projectAssistantEvent(current, event)
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "The event projection failed"
            )
            return current
          }
        })
      },
    })
  }, [])

  useEffect(() => {
    const stored = readStoredRun()
    let reconnectTimer: number | undefined
    if (stored) {
      // Rebuild from the canonical event log; localStorage holds only routing
      // identifiers, never a second conversation history.
      reconnectTimer = window.setTimeout(() => connect(stored, 0), 0)
    }
    return () => {
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      stopRef.current?.()
    }
  }, [connect])

  const start = async () => {
    stopRef.current?.()
    setProjection(emptyAssistantSpikeProjection())
    setError(null)
    setConnection("connecting")
    const suffix = crypto.randomUUID()
    try {
      const run = await startScriptedAgentRun({
        apiUrl: env.apiUrl,
        threadId: `spike-thread-${suffix}`,
        branchId: `spike-branch-${suffix}`,
        runId: `spike-run-${suffix}`,
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(run))
      connect(run, 0)
    } catch (cause) {
      setConnection("stopped")
      setError(cause instanceof Error ? cause.message : "Unable to start run")
    }
  }

  const reconnect = () => {
    const stored = readStoredRun()
    if (!stored) return
    connect(stored, projection.cursor)
  }

  const stop = () => {
    stopRef.current?.()
    stopRef.current = null
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Plan 026 · development only</Badge>
          <Badge variant={projection.terminalStatus ? "secondary" : "outline"}>
            {connection}
          </Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Durable assistant projection
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          assistant-ui projects Avermate&apos;s persisted event log. It does not
          own messages, branches, tools, or provider credentials.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void start()}>
          <Play data-icon="inline-start" />
          Start scripted run
        </Button>
        <Button
          variant="outline"
          onClick={reconnect}
          disabled={!projection.runId || Boolean(projection.terminalStatus)}
        >
          <RotateCcw data-icon="inline-start" />
          Reconnect from cursor
        </Button>
        <Button
          variant="ghost"
          onClick={stop}
          disabled={connection === "stopped"}
        >
          <CircleStop data-icon="inline-start" />
          Stop network
        </Button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-h-48 min-w-0">
          <ExternalStoreProjection
            projection={projection}
            onBranchChange={setSelectedHead}
          />
          {!projection.messageId && !projection.markdown ? (
            <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed text-sm text-muted-foreground">
              Start the deterministic run to test streaming and replay.
            </div>
          ) : null}
        </div>

        <aside className="space-y-4 rounded-2xl border bg-muted/20 p-4 text-sm">
          <div>
            <div className="flex items-center gap-2 font-medium">
              <Cable className="size-4" /> Durable cursor
            </div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              {projection.runId ?? "no run"} · {projection.cursor}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 font-medium">
              <Braces className="size-4" /> Server-owned branch
            </div>
            <div className="mt-1 font-mono text-xs break-all text-muted-foreground">
              {projection.branchId ?? "no branch"}
            </div>
            {selectedHead ? (
              <div className="mt-1 text-xs">Requested head: {selectedHead}</div>
            ) : null}
          </div>
          {projection.activity ? (
            <div>
              <div className="font-medium">Activity</div>
              <div className="text-muted-foreground">
                {projection.activity.label} · {projection.activity.status}
              </div>
            </div>
          ) : null}
          {projection.toolCalls.map((call) => (
            <div
              key={call.callId}
              className="rounded-lg border bg-background p-3"
            >
              <div className="font-mono text-xs font-medium">
                {call.toolName}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {call.status} · {call.argumentsText || "no arguments"}
              </div>
              {call.result !== null ? (
                <div className="mt-1 text-xs">{String(call.result)}</div>
              ) : null}
            </div>
          ))}
          {projection.citations.map((citation) => (
            <div key={citation.citationId}>
              <div className="font-medium">{citation.label}</div>
              <div className="text-xs break-all text-muted-foreground">
                {citation.sourceRef}
              </div>
            </div>
          ))}
          {projection.usage ? (
            <div className="text-xs text-muted-foreground">
              Usage: {projection.usage.inputTokens} in /{" "}
              {projection.usage.outputTokens} out · cache{" "}
              {projection.usage.cachedReadTokens}
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  )
}
