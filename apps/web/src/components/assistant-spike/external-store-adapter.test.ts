import { describe, expect, test } from "bun:test"
import {
  convertSpikeMessage,
  createSpikeExternalStoreAdapter,
  projectionToExternalMessages,
} from "./external-store-adapter"
import { emptyAssistantSpikeProjection } from "./projection"

describe("assistant-ui external store adapter", () => {
  test("projects Avermate messages without taking ownership", () => {
    const projection = {
      ...emptyAssistantSpikeProjection(),
      runId: "run-1",
      messageId: "message-1",
      markdown: "# Résultat",
      running: true,
    }
    const messages = projectionToExternalMessages(projection)
    expect(messages).toEqual([
      {
        id: "message-1",
        markdown: "# Résultat",
        status: "running",
      },
    ])
    expect(convertSpikeMessage(messages[0]!).content).toEqual([
      { type: "text", text: "# Résultat" },
    ])
  })

  test("delegates branch and visible-path changes to the canonical store", () => {
    const branches: unknown[] = []
    const paths: unknown[] = []
    const adapter = createSpikeExternalStoreAdapter({
      messages: [],
      running: false,
      onBranchChange: (branch) => branches.push(branch),
      onVisibleMessagesChange: (messages) => paths.push(messages),
    })

    adapter.unstable_onBranchChange?.({
      headId: "message-2",
      visibleMessageIds: ["message-1", "message-2"],
    })
    adapter.setMessages?.([])
    expect(branches).toEqual([
      {
        headId: "message-2",
        visibleMessageIds: ["message-1", "message-2"],
      },
    ])
    expect(paths).toEqual([[]])
  })
})
