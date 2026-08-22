import {
  avermateAgentEventV1Schema,
  isKnownAgentEventType,
  type AvermateAgentEventV1,
} from "@avermate/agent-contracts"

export type SpikeTerminalStatus = "finished" | "failed" | "cancelled"

export type SpikeToolCall = {
  callId: string
  toolName: string
  argumentsText: string
  result: unknown
  status: "running" | "finished" | "succeeded" | "failed"
}

export type SpikeCitation = {
  citationId: string
  label: string
  sourceRef: string
}

export type SpikeUsageValue = number | "unknown"

export type SpikeUsage = {
  inputTokens: SpikeUsageValue
  outputTokens: SpikeUsageValue
  reasoningTokens: SpikeUsageValue
  cachedReadTokens: SpikeUsageValue
  cachedWriteTokens: SpikeUsageValue
}

export type AssistantSpikeProjection = {
  protocolVersion: 1
  threadId: string | null
  branchId: string | null
  runId: string | null
  cursor: number
  seenEventIds: readonly string[]
  messageId: string | null
  markdown: string
  messageFinished: boolean
  running: boolean
  terminalStatus: SpikeTerminalStatus | null
  activity: { label: string; status: string } | null
  toolCalls: readonly SpikeToolCall[]
  citations: readonly SpikeCitation[]
  usage: SpikeUsage | null
  ignoredEventTypes: readonly string[]
}

export function emptyAssistantSpikeProjection(): AssistantSpikeProjection {
  return {
    protocolVersion: 1,
    threadId: null,
    branchId: null,
    runId: null,
    cursor: 0,
    seenEventIds: [],
    messageId: null,
    markdown: "",
    messageFinished: false,
    running: false,
    terminalStatus: null,
    activity: null,
    toolCalls: [],
    citations: [],
    usage: null,
    ignoredEventTypes: [],
  }
}

function objectPayload(event: AvermateAgentEventV1): Record<string, unknown> {
  if (!event.payload || typeof event.payload !== "object") return {}
  return event.payload as Record<string, unknown>
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === "string" ? value : ""
}

function usageField(
  payload: Record<string, unknown>,
  key: keyof SpikeUsage
): SpikeUsageValue {
  const value = payload[key]
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : "unknown"
}

function assertSameRun(
  projection: AssistantSpikeProjection,
  event: AvermateAgentEventV1
) {
  if (
    projection.runId !== null &&
    (projection.runId !== event.runId ||
      projection.threadId !== event.threadId ||
      projection.branchId !== event.branchId)
  ) {
    throw new Error("An assistant projection may contain only one run")
  }
}

function updateToolCall(
  calls: readonly SpikeToolCall[],
  callId: string,
  update: (current: SpikeToolCall | undefined) => SpikeToolCall
) {
  const index = calls.findIndex((call) => call.callId === callId)
  if (index < 0) return [...calls, update(undefined)]
  const next = [...calls]
  next[index] = update(next[index])
  return next
}

/**
 * Project one durable event into UI state.
 *
 * Duplicate delivery is ignored by event id, while a missing sequence fails
 * closed. That distinction is what lets reconnect be at-least-once without
 * silently drawing a partial answer.
 */
export function projectAssistantEvent(
  current: AssistantSpikeProjection,
  input: unknown
): AssistantSpikeProjection {
  const event = avermateAgentEventV1Schema.parse(input)
  if (current.seenEventIds.includes(event.eventId)) return current
  if (current.terminalStatus) {
    throw new Error("No assistant event may follow a terminal event")
  }

  assertSameRun(current, event)
  if (event.sequence !== current.cursor + 1) {
    throw new Error(
      `Assistant event sequence gap: expected ${current.cursor + 1}, received ${event.sequence}`
    )
  }

  const payload = objectPayload(event)
  const next: AssistantSpikeProjection = {
    ...current,
    threadId: event.threadId,
    branchId: event.branchId,
    runId: event.runId,
    cursor: event.sequence,
    seenEventIds: [...current.seenEventIds, event.eventId],
  }

  if (!isKnownAgentEventType(event.type)) {
    return {
      ...next,
      ignoredEventTypes: next.ignoredEventTypes.includes(event.type)
        ? next.ignoredEventTypes
        : [...next.ignoredEventTypes, event.type],
    }
  }

  switch (event.type) {
    case "run.started":
      return { ...next, running: true }
    case "text.message.started":
      return {
        ...next,
        messageId: stringField(payload, "messageId") || next.messageId,
      }
    case "text.message.delta":
      return {
        ...next,
        messageId: stringField(payload, "messageId") || next.messageId,
        markdown: next.markdown + stringField(payload, "delta"),
      }
    case "text.message.finished":
      return { ...next, messageFinished: true }
    case "activity.snapshot":
      return {
        ...next,
        activity: {
          label: stringField(payload, "label"),
          status: stringField(payload, "status"),
        },
      }
    case "tool.call.started": {
      const callId = stringField(payload, "callId")
      if (!callId) return next
      return {
        ...next,
        toolCalls: updateToolCall(next.toolCalls, callId, () => ({
          callId,
          toolName: stringField(payload, "toolName") || "unknown",
          argumentsText: "",
          result: null,
          status: "running",
        })),
      }
    }
    case "tool.call.arguments.delta": {
      const callId = stringField(payload, "callId")
      if (!callId) return next
      return {
        ...next,
        toolCalls: updateToolCall(next.toolCalls, callId, (call) => ({
          callId,
          toolName: call?.toolName ?? "unknown",
          argumentsText:
            (call?.argumentsText ?? "") + stringField(payload, "delta"),
          result: call?.result ?? null,
          status: call?.status ?? "running",
        })),
      }
    }
    case "tool.call.finished": {
      const callId = stringField(payload, "callId")
      if (!callId) return next
      return {
        ...next,
        toolCalls: updateToolCall(next.toolCalls, callId, (call) => ({
          callId,
          toolName: call?.toolName ?? "unknown",
          argumentsText: call?.argumentsText ?? "",
          result: call?.result ?? null,
          status: "finished",
        })),
      }
    }
    case "tool.result": {
      const callId = stringField(payload, "callId")
      if (!callId) return next
      const failed = payload.status === "failed" || payload.status === "error"
      return {
        ...next,
        toolCalls: updateToolCall(next.toolCalls, callId, (call) => ({
          callId,
          toolName: call?.toolName ?? "unknown",
          argumentsText: call?.argumentsText ?? "",
          result: payload.summary ?? payload.result ?? null,
          status: failed ? "failed" : "succeeded",
        })),
      }
    }
    case "avermate.citation.added": {
      const citationId = stringField(payload, "citationId")
      if (
        !citationId ||
        next.citations.some((item) => item.citationId === citationId)
      ) {
        return next
      }
      return {
        ...next,
        citations: [
          ...next.citations,
          {
            citationId,
            label: stringField(payload, "label"),
            sourceRef: stringField(payload, "sourceRef"),
          },
        ],
      }
    }
    case "avermate.usage.delta":
      return {
        ...next,
        usage: {
          inputTokens: usageField(payload, "inputTokens"),
          outputTokens: usageField(payload, "outputTokens"),
          reasoningTokens: usageField(payload, "reasoningTokens"),
          cachedReadTokens: usageField(payload, "cachedReadTokens"),
          cachedWriteTokens: usageField(payload, "cachedWriteTokens"),
        },
      }
    case "run.finished":
      return { ...next, running: false, terminalStatus: "finished" }
    case "run.failed":
      return { ...next, running: false, terminalStatus: "failed" }
    case "run.cancelled":
      return { ...next, running: false, terminalStatus: "cancelled" }
    default:
      return next
  }
}

export function projectAssistantEvents(
  initial: AssistantSpikeProjection,
  events: readonly unknown[]
): AssistantSpikeProjection {
  return events.reduce(projectAssistantEvent, initial)
}
