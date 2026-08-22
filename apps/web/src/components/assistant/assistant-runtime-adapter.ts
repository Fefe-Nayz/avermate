import type {
  AssistantAttachment,
  AssistantBranch,
  AssistantMessage,
  AssistantPartV1,
  AssistantRun,
  AssistantThread,
  AssistantThreadDetail,
} from "@avermate/agent-contracts"
import type {
  AppendMessage,
  ExternalStoreAdapter,
  ThreadMessageLike,
} from "@assistant-ui/react"

export interface AssistantCanonicalSnapshot {
  thread: AssistantThread
  branches: readonly AssistantBranch[]
  messages: readonly AssistantMessage[]
  activePathMessageIds: readonly string[]
  runs: readonly AssistantRun[]
  attachments: readonly AssistantAttachment[]
  activeRunProjections?: AssistantThreadDetail["activeRunProjections"]
}

export interface AssistantExternalMessage {
  message: AssistantMessage
  attachments: readonly AssistantAttachment[]
}

export interface AssistantTurnIntent {
  parentMessageId: string | null
  markdown: string
}

export interface AssistantEditIntent extends AssistantTurnIntent {
  sourceMessageId: string
}

export interface AssistantRuntimeActions {
  send: (intent: AssistantTurnIntent) => Promise<void>
  edit: (intent: AssistantEditIntent) => Promise<void>
  retry: (messageId: string) => Promise<void>
  cancel: () => Promise<void>
  refetch: () => Promise<void>
  switchBranch: (headMessageId: string | null) => void
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

type AssistantUiPart = Exclude<ThreadMessageLike["content"], string>[number]

function jsonValue(value: unknown): JsonValue {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue
  } catch {
    return "[unserializable]"
  }
}

function jsonObject(value: unknown): { readonly [key: string]: JsonValue } {
  const normalized = jsonValue(value)
  return normalized !== null &&
    typeof normalized === "object" &&
    !Array.isArray(normalized)
    ? (normalized as { readonly [key: string]: JsonValue })
    : { value: normalized }
}

function toExternalPart(part: AssistantPartV1): AssistantUiPart[] {
  if (part.type === "text") {
    return [{ type: "text", text: part.markdown }]
  }

  if (part.type === "tool") {
    return [
      {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolId,
        args: jsonObject(part.safeInput),
        result: jsonValue(part.safeResult),
        isError: part.state === "failed",
      },
    ]
  }

  return [
    {
      type: `data-assistant-${part.type}`,
      data: jsonValue(part),
    },
  ]
}

function assistantStatus(
  message: AssistantMessage
): ThreadMessageLike["status"] {
  if (message.role !== "assistant" && message.role !== "tool") return undefined
  if (message.status === "pending" || message.status === "streaming") {
    return { type: "running" }
  }
  if (message.status === "complete") {
    return { type: "complete", reason: "stop" }
  }
  return {
    type: "incomplete",
    reason: message.status === "cancelled" ? "cancelled" : "error",
  }
}

export function convertAssistantMessage(
  external: AssistantExternalMessage
): ThreadMessageLike {
  const { message, attachments } = external
  const role = message.role === "tool" ? "assistant" : message.role
  const content = message.parts.flatMap(toExternalPart)
  const projectedAttachments =
    role === "user"
      ? attachments.map((attachment) => ({
          id: attachment.id,
          type: (attachment.kind === "file" ? "file" : "document") as
            "file" | "document",
          name: attachment.label,
          status: { type: "complete" as const },
          content: [
            {
              type: "data-assistant-reference" as const,
              data: jsonValue({
                kind: attachment.kind,
                referenceId: attachment.referenceId,
                snapshotVersion: attachment.snapshotVersion,
              }),
            },
          ],
        }))
      : undefined

  return {
    id: message.id,
    role,
    content,
    createdAt: new Date(message.createdAt),
    status: assistantStatus(message),
    attachments: projectedAttachments,
    metadata: {
      custom: {
        authorship: message.authorship,
        createdByRunId: message.createdByRunId,
        parentMessageId: message.parentMessageId,
        replacesMessageId: message.replacesMessageId,
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          kind: attachment.kind,
          label: attachment.label,
          referenceId: attachment.referenceId,
          snapshotVersion: attachment.snapshotVersion,
        })),
      },
    },
  }
}

function derivePath(snapshot: AssistantCanonicalSnapshot): string[] {
  if (snapshot.activePathMessageIds.length > 0) {
    return [...snapshot.activePathMessageIds]
  }

  const activeBranch = snapshot.branches.find(
    (branch) => branch.id === snapshot.thread.activeBranchId
  )
  const byId = new Map(
    snapshot.messages.map((message) => [message.id, message] as const)
  )
  const reversed: string[] = []
  const seen = new Set<string>()
  let cursor = activeBranch?.headMessageId ?? null
  while (cursor) {
    if (seen.has(cursor)) throw new Error("Assistant message DAG is cyclic")
    const message = byId.get(cursor)
    if (!message)
      throw new Error("Assistant branch references a missing message")
    seen.add(cursor)
    reversed.push(cursor)
    cursor = message.parentMessageId
  }
  return reversed.reverse()
}

export function projectAssistantPath(
  snapshot: AssistantCanonicalSnapshot
): readonly AssistantExternalMessage[] {
  const byId = new Map(
    snapshot.messages.map((message) => [message.id, message] as const)
  )
  const attachmentsByMessage = new Map<string, AssistantAttachment[]>()
  for (const attachment of snapshot.attachments) {
    const current = attachmentsByMessage.get(attachment.messageId) ?? []
    current.push(attachment)
    attachmentsByMessage.set(attachment.messageId, current)
  }

  const seen = new Set<string>()
  const path = derivePath(snapshot).map((messageId) => {
    if (seen.has(messageId)) throw new Error("Assistant path contains a cycle")
    seen.add(messageId)
    const message = byId.get(messageId)
    if (!message) throw new Error("Assistant path references a missing message")
    if (message.threadId !== snapshot.thread.id) {
      throw new Error("Assistant path crosses thread ownership")
    }
    return {
      message,
      attachments: attachmentsByMessage.get(message.id) ?? [],
    }
  })
  const pathIds = new Set(path.map((entry) => entry.message.id))
  const activeBranchId = snapshot.thread.activeBranchId
  const runById = new Map(snapshot.runs.map((run) => [run.id, run] as const))
  for (const projection of snapshot.activeRunProjections ?? []) {
    const run = runById.get(projection.runId)
    if (
      !run ||
      run.branchId !== activeBranchId ||
      !pathIds.has(run.inputMessageId) ||
      pathIds.has(projection.outputMessageId)
    ) {
      continue
    }
    path.push({
      message: {
        id: projection.outputMessageId,
        threadId: snapshot.thread.id,
        parentMessageId: run.inputMessageId,
        role: "assistant",
        authorship: "model",
        status:
          projection.status === "cancelled"
            ? "cancelled"
            : projection.status === "failed"
              ? "failed"
              : "streaming",
        partsVersion: 1,
        parts: [...projection.parts],
        createdByRunId: run.id,
        replacesMessageId: null,
        createdAt: run.createdAt,
      },
      attachments: [],
    })
    pathIds.add(projection.outputMessageId)
  }
  return path
}

export function appendMessageMarkdown(message: AppendMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim()
}

export function createAvermateAssistantRuntimeAdapter(input: {
  snapshot: AssistantCanonicalSnapshot
  actions: AssistantRuntimeActions
}): ExternalStoreAdapter<AssistantExternalMessage> {
  const messages = projectAssistantPath(input.snapshot)
  const running = input.snapshot.runs.some((run) =>
    ["reserved", "running", "waiting-for-user"].includes(run.status)
  )

  return {
    messages,
    convertMessage: convertAssistantMessage,
    isRunning: running,
    isLoading: false,
    onNew: async (message) => {
      await input.actions.send({
        parentMessageId: message.parentId,
        markdown: appendMessageMarkdown(message),
      })
    },
    onEdit: async (message) => {
      if (!message.sourceId) throw new Error("Edited messages need a source ID")
      await input.actions.edit({
        parentMessageId: message.parentId,
        sourceMessageId: message.sourceId,
        markdown: appendMessageMarkdown(message),
      })
    },
    onReload: async (parentMessageId) => {
      const target = [...messages]
        .reverse()
        .find(
          ({ message }) =>
            message.role === "assistant" &&
            message.parentMessageId === parentMessageId
        )
      if (!target) throw new Error("Retryable assistant message not found")
      await input.actions.retry(target.message.id)
    },
    onCancel: input.actions.cancel,
    onRefetchThread: input.actions.refetch,
    setMessages: () => {
      // assistant-ui may compute an optimistic visible path. The following
      // server projection is authoritative and replaces it after every write.
    },
    unstable_onBranchChange: ({ headId }) => input.actions.switchBranch(headId),
    unstable_capabilities: { copy: true },
  }
}
