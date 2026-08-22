import type {
  AssistantEventProjection,
  AssistantPartV1,
  AssistantRunStatus,
} from "@avermate/agent-contracts"
import type { AssistantThreadDetail } from "./assistant-types"

function terminalStatus(
  event: AssistantEventProjection
): AssistantRunStatus | null {
  if (event.type === "run.finished") return "complete"
  if (event.type === "run.failed") return "failed"
  if (event.type === "run.cancelled") return "cancelled"
  return null
}

function payloadObject(
  event: AssistantEventProjection
): Record<string, unknown> {
  return event.payload !== null && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {}
}

/**
 * Applies a committed server event to TanStack's transient projection. The
 * immutable messages remain server-owned; terminal events trigger a refetch
 * that replaces this active projection with the finalized message.
 */
export function applyAssistantEvent(
  detail: AssistantThreadDetail,
  event: AssistantEventProjection
): AssistantThreadDetail {
  const runIndex = detail.runs.findIndex((run) => run.id === event.runId)
  if (runIndex === -1) return detail
  const run = detail.runs[runIndex]!
  if (run.threadId !== event.threadId || run.branchId !== event.branchId)
    return detail

  const projectionIndex = detail.activeRunProjections.findIndex(
    (projection) => projection.runId === event.runId
  )
  const existing =
    projectionIndex === -1
      ? {
          runId: event.runId,
          outputMessageId: run.reservedOutputMessageId,
          parts: [] as AssistantPartV1[],
          lastSequence: 0,
          status: run.status,
        }
      : detail.activeRunProjections[projectionIndex]!
  if (event.sequence <= existing.lastSequence) return detail

  let parts = [...existing.parts]
  const payload = payloadObject(event)
  if (event.type === "text.message.started") {
    parts = []
  } else if (event.type === "text.message.delta") {
    const delta = typeof payload.delta === "string" ? payload.delta : ""
    if (delta) {
      const textIndex = parts.findIndex((part) => part.type === "text")
      if (textIndex === -1) {
        parts.push({
          type: "text",
          id: `stream-${event.runId}`,
          markdown: delta,
        })
      } else {
        const current = parts[textIndex]
        if (current?.type === "text") {
          parts[textIndex] = { ...current, markdown: current.markdown + delta }
        }
      }
    }
  } else if (event.type === "avermate.context.snapshot" && parts.length === 0) {
    parts = [
      {
        type: "status",
        id: `context-${event.runId}`,
        state: "active",
        label: "Preparing cited context",
      },
    ]
  } else if (event.type === "avermate.usage.delta") {
    const token = (key: string) =>
      typeof payload[key] === "number" ? (payload[key] as number) : null
    parts = [
      ...parts.filter((part) => part.type !== "usage"),
      {
        type: "usage",
        id: `usage-${event.runId}`,
        inputTokens: token("inputTokens"),
        outputTokens: token("outputTokens"),
        reasoningTokens: token("reasoningTokens"),
        cachedReadTokens: token("cachedReadTokens"),
        cachedWriteTokens: token("cachedWriteTokens"),
        estimatedCost: null,
        currency: null,
      },
    ]
  }

  const terminal = terminalStatus(event)
  if ((terminal === "failed" || terminal === "cancelled") && !parts.length) {
    parts = [
      {
        type: "safe-error",
        id: `error-${event.runId}`,
        code:
          typeof payload.code === "string"
            ? payload.code
            : terminal === "cancelled"
              ? "cancelled"
              : "assistant_run_failed",
        message:
          typeof payload.message === "string"
            ? payload.message
            : terminal === "cancelled"
              ? "Response cancelled."
              : "The response could not be generated.",
        retryable: true,
      },
    ]
  }
  const status: AssistantRunStatus = terminal ?? "running"
  const nextProjection = {
    ...existing,
    parts,
    lastSequence: event.sequence,
    status,
  }
  const projections = [...detail.activeRunProjections]
  if (projectionIndex === -1) projections.push(nextProjection)
  else projections[projectionIndex] = nextProjection
  const runs = [...detail.runs]
  runs[runIndex] = {
    ...run,
    status,
    completedAt: terminal ? event.persistedAt : run.completedAt,
    updatedAt: event.persistedAt,
  }
  return { ...detail, runs, activeRunProjections: projections }
}
