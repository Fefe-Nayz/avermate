import { describe, expect, test } from "bun:test"
import type {
  AssistantMessage,
  AssistantRun,
  AssistantThread,
} from "@avermate/agent-contracts"
import type { AppendMessage } from "@assistant-ui/react"
import {
  appendMessageMarkdown,
  convertAssistantMessage,
  createAvermateAssistantRuntimeAdapter,
  projectAssistantPath,
  type AssistantCanonicalSnapshot,
} from "./assistant-runtime-adapter"
import { assistantRunExecutionFixture } from "./assistant-test-fixtures"

const now = "2026-08-22T12:00:00.000Z"

const thread: AssistantThread = {
  id: "thread-1",
  userId: "user-1",
  title: "Fractions",
  activeBranchId: "branch-main",
  projectId: null,
  placement: { kind: "core" },
  revision: 1,
  starredAt: null,
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  createdAt: now,
  updatedAt: now,
}

function message(
  id: string,
  parentMessageId: string | null,
  role: AssistantMessage["role"],
  markdown: string
): AssistantMessage {
  return {
    id,
    threadId: thread.id,
    parentMessageId,
    role,
    authorship: role === "user" ? "user" : "model",
    status: "complete",
    partsVersion: 1,
    parts: [{ type: "text", id: `${id}-part`, markdown }],
    createdByRunId: role === "assistant" ? "run-1" : null,
    replacesMessageId: null,
    createdAt: now,
  }
}

function snapshot(): AssistantCanonicalSnapshot {
  const messages = [
    message("u1", null, "user", "Explain fractions"),
    message("a1", "u1", "assistant", "A fraction is a ratio."),
    message("u2", "a1", "user", "Give me an example"),
  ]
  return {
    thread,
    branches: [
      {
        id: "branch-main",
        threadId: thread.id,
        name: "Main",
        forkedFromMessageId: null,
        headMessageId: "u2",
        createdAt: now,
        updatedAt: now,
      },
    ],
    messages,
    activePathMessageIds: [],
    runs: [],
    attachments: [],
    activeRunProjections: [],
  }
}

describe("Avermate assistant external-store adapter", () => {
  test("reconstructs the active path from the canonical branch head", () => {
    expect(
      projectAssistantPath(snapshot()).map((entry) => entry.message.id)
    ).toEqual(["u1", "a1", "u2"])
  })

  test("rejects missing and cross-thread path entries", () => {
    const missing = snapshot()
    missing.activePathMessageIds = ["missing"]
    expect(() => projectAssistantPath(missing)).toThrow("missing message")

    const base = snapshot()
    const crossed = {
      ...base,
      messages: [
        { ...base.messages[0]!, threadId: "other" },
        ...base.messages.slice(1),
      ],
    }
    crossed.activePathMessageIds = ["u1"]
    expect(() => projectAssistantPath(crossed)).toThrow("crosses thread")
  })

  test("maps the closed part registry without enabling arbitrary widgets", () => {
    const external = convertAssistantMessage({
      message: {
        ...message("a2", "u2", "assistant", "Result"),
        status: "streaming",
        parts: [
          { type: "status", id: "s1", state: "active", label: "Searching" },
          {
            type: "tool",
            id: "t1",
            toolCallId: "call-1",
            toolId: "materials.search",
            state: "complete",
            safeInput: { query: "fractions" },
            safeResult: { count: 2 },
          },
        ],
      },
      attachments: [],
    })
    expect(external.status).toEqual({ type: "running" })
    expect(external.content).toEqual([
      {
        type: "data-assistant-status",
        data: { type: "status", id: "s1", state: "active", label: "Searching" },
      },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "materials.search",
        args: { query: "fractions" },
        result: { count: 2 },
        isError: false,
      },
    ])
  })

  test("projects persisted active-run events after the canonical user head", () => {
    const current = snapshot()
    current.runs = [
      {
        ...assistantRunExecutionFixture,
        id: "run-stream",
        threadId: thread.id,
        branchId: "branch-main",
        inputMessageId: "u2",
        outputMessageId: null,
        reservedOutputMessageId: "a-stream",
        parentRunId: null,
        runtimeId: "test",
        runtimeVersion: "1",
        graphSchemaVersion: 1,
        modelKey: "mock",
        providerKey: "mock",
        modelResolvedId: null,
        status: "running",
        approvalMode: "read-only",
        providerRequestKey: null,
        providerDispatchState: "acknowledged",
        contextManifestId: null,
        conversationCheckpointRef: null,
        workspaceSnapshotRef: null,
        sandboxRuntimeCheckpointRef: null,
        domainCursorRef: null,
        safeError: null,
        errorCode: null,
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]
    current.activeRunProjections = [
      {
        runId: "run-stream",
        outputMessageId: "a-stream",
        parts: [{ type: "text", id: "stream-text", markdown: "Live" }],
        lastSequence: 3,
        status: "running",
      },
    ]
    expect(
      projectAssistantPath(current).map((entry) => entry.message.id)
    ).toEqual(["u1", "a1", "u2", "a-stream"])
  })

  test("delegates send, edit, retry and cancel to the server-owned actions", async () => {
    const calls: string[] = []
    const current = snapshot()
    current.runs = [
      {
        ...assistantRunExecutionFixture,
        id: "run-1",
        threadId: thread.id,
        branchId: "branch-main",
        inputMessageId: "u2",
        outputMessageId: null,
        reservedOutputMessageId: "a-pending",
        parentRunId: null,
        runtimeId: "test",
        runtimeVersion: "1",
        graphSchemaVersion: 1,
        modelKey: "mock",
        providerKey: "mock",
        modelResolvedId: null,
        status: "running",
        approvalMode: "read-only",
        providerRequestKey: null,
        providerDispatchState: "acknowledged",
        contextManifestId: null,
        conversationCheckpointRef: null,
        workspaceSnapshotRef: null,
        sandboxRuntimeCheckpointRef: null,
        domainCursorRef: null,
        safeError: null,
        errorCode: null,
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      } satisfies AssistantRun,
    ]
    const adapter = createAvermateAssistantRuntimeAdapter({
      snapshot: current,
      actions: {
        send: async ({ markdown }) => void calls.push(`send:${markdown}`),
        edit: async ({ sourceMessageId, markdown }) =>
          void calls.push(`edit:${sourceMessageId}:${markdown}`),
        retry: async (messageId) => void calls.push(`retry:${messageId}`),
        cancel: async () => void calls.push("cancel"),
        refetch: async () => void calls.push("refetch"),
        switchBranch: (headId) => void calls.push(`branch:${headId}`),
      },
    })
    const append = {
      role: "user",
      content: [{ type: "text", text: "  New question  " }],
      metadata: { custom: {} },
      attachments: [],
      createdAt: new Date(now),
      parentId: "u2",
      sourceId: null,
      runConfig: {},
    } as AppendMessage

    expect(adapter.isRunning).toBe(true)
    await adapter.onNew(append)
    await adapter.onEdit?.({ ...append, sourceId: "u2" })
    await adapter.onReload?.("u1", {
      parentId: "u1",
      sourceId: null,
      runConfig: {},
    })
    await adapter.onCancel?.()
    await adapter.onRefetchThread?.()
    adapter.unstable_onBranchChange?.({
      headId: "a1",
      visibleMessageIds: ["u1", "a1"],
    })
    expect(calls).toEqual([
      "send:New question",
      "edit:u2:New question",
      "retry:a1",
      "cancel",
      "refetch",
      "branch:a1",
    ])
  })

  test("joins only textual composer parts", () => {
    expect(
      appendMessageMarkdown({
        role: "user",
        content: [
          { type: "text", text: "First" },
          { type: "data", name: "reference", data: { id: "grade-1" } },
          { type: "text", text: "Second" },
        ],
        createdAt: new Date(now),
        metadata: { custom: {} },
        attachments: [],
        parentId: null,
        sourceId: null,
        runConfig: undefined,
      } as AppendMessage)
    ).toBe("First\n\nSecond")
  })
})
