import {
  sourceLocatorV1Schema,
  type AssistantBranch,
  type AssistantMessage,
} from "@avermate/agent-contracts"

export type ConversationCitationTarget = Extract<
  ReturnType<typeof sourceLocatorV1Schema.parse>,
  { kind: "conversation" }
>

export function parseConversationCitationTarget(
  rawLocator: string | null,
  threadId: string | null
): ConversationCitationTarget | null {
  if (!rawLocator || !threadId) return null

  try {
    const parsed = sourceLocatorV1Schema.safeParse(JSON.parse(rawLocator))
    if (
      !parsed.success ||
      parsed.data.kind !== "conversation" ||
      parsed.data.threadId !== threadId
    ) {
      return null
    }
    return parsed.data
  } catch {
    return null
  }
}

export function findBranchContainingMessage(
  branches: readonly AssistantBranch[],
  messages: readonly AssistantMessage[],
  messageId: string
): string | null {
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  let best: { branchId: string; distance: number } | null = null

  for (const branch of branches) {
    const seen = new Set<string>()
    let cursor = branch.headMessageId
    let distance = 0

    while (cursor && !seen.has(cursor)) {
      if (cursor === messageId) {
        if (
          !best ||
          distance < best.distance ||
          (distance === best.distance &&
            branch.id.localeCompare(best.branchId) < 0)
        ) {
          best = { branchId: branch.id, distance }
        }
        break
      }
      seen.add(cursor)
      cursor = messagesById.get(cursor)?.parentMessageId ?? null
      distance += 1
    }
  }

  return best?.branchId ?? null
}

export function messageElement(messageId: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-message-id]"
  )) {
    if (element.dataset.messageId === messageId) return element
  }
  return null
}
