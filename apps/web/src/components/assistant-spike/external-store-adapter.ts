import type {
  ExternalStoreAdapter,
  ThreadMessageLike,
} from "@assistant-ui/react"
import type { AssistantSpikeProjection } from "./projection"

export type SpikeExternalMessage = {
  id: string
  markdown: string
  status: "running" | "finished" | "failed" | "cancelled"
}

export function projectionToExternalMessages(
  projection: AssistantSpikeProjection
): readonly SpikeExternalMessage[] {
  if (!projection.messageId && projection.markdown.length === 0) return []
  return [
    {
      id: projection.messageId ?? `assistant-${projection.runId ?? "pending"}`,
      markdown: projection.markdown,
      status: projection.terminalStatus ?? "running",
    },
  ]
}

export function convertSpikeMessage(
  message: SpikeExternalMessage
): ThreadMessageLike {
  const status: ThreadMessageLike["status"] =
    message.status === "running"
      ? { type: "running" }
      : message.status === "finished"
        ? { type: "complete", reason: "stop" }
        : {
            type: "incomplete",
            reason: message.status === "cancelled" ? "cancelled" : "error",
          }
  return {
    id: message.id,
    role: "assistant",
    content: [{ type: "text", text: message.markdown }],
    status,
  }
}

/**
 * assistant-ui receives a projection and delegates every branch mutation back
 * to Avermate. It never becomes the canonical message or branch store.
 */
export function createSpikeExternalStoreAdapter(input: {
  messages: readonly SpikeExternalMessage[]
  running: boolean
  onVisibleMessagesChange?: (messages: readonly SpikeExternalMessage[]) => void
  onBranchChange?: (input: {
    headId: string | null
    visibleMessageIds: readonly string[]
  }) => void
}): ExternalStoreAdapter<SpikeExternalMessage> {
  return {
    messages: input.messages,
    convertMessage: convertSpikeMessage,
    isRunning: input.running,
    isDisabled: true,
    onNew: async () => {},
    onEdit: async () => {},
    setMessages: (messages) => input.onVisibleMessagesChange?.(messages),
    unstable_onBranchChange: (branch) => input.onBranchChange?.(branch),
  }
}
