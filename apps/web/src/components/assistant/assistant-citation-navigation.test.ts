import { describe, expect, test } from "bun:test"
import type {
  AssistantBranch,
  AssistantMessage,
} from "@avermate/agent-contracts"
import {
  findBranchContainingMessage,
  parseConversationCitationTarget,
} from "./assistant-citation-navigation"

function message(id: string, parentMessageId: string | null): AssistantMessage {
  return {
    id,
    threadId: "thread-1",
    parentMessageId,
    role: "assistant",
    authorship: "model",
    status: "complete",
    partsVersion: 1,
    parts: [{ type: "text", id: `part-${id}`, markdown: id }],
    createdByRunId: null,
    replacesMessageId: null,
    createdAt: "2026-08-22T00:00:00.000Z",
  }
}

function branch(id: string, headMessageId: string): AssistantBranch {
  return {
    id,
    threadId: "thread-1",
    name: null,
    forkedFromMessageId: null,
    headMessageId,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
  }
}

describe("assistant conversation citation navigation", () => {
  test("accepts only a valid locator owned by the URL thread", () => {
    const raw = JSON.stringify({
      kind: "conversation",
      threadId: "thread-1",
      messageId: "message-2",
      partId: "part-message-2",
      startOffset: 1,
      endOffset: 4,
    })

    expect(parseConversationCitationTarget(raw, "thread-1")?.messageId).toBe(
      "message-2"
    )
    expect(parseConversationCitationTarget(raw, "thread-2")).toBeNull()
    expect(parseConversationCitationTarget("not-json", "thread-1")).toBeNull()
  })

  test("selects the closest deterministic branch containing the message", () => {
    const messages = [
      message("root", null),
      message("target", "root"),
      message("near", "target"),
      message("far-1", "target"),
      message("far-2", "far-1"),
    ]
    const branches = [
      branch("branch-far", "far-2"),
      branch("branch-near", "near"),
    ]

    expect(findBranchContainingMessage(branches, messages, "target")).toBe(
      "branch-near"
    )
    expect(
      findBranchContainingMessage(branches, messages, "missing")
    ).toBeNull()
  })
})
