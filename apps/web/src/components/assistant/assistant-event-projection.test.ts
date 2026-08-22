import { describe, expect, test } from "bun:test"
import type {
  AssistantEventProjection,
  AssistantRun,
  AssistantThread,
} from "@avermate/agent-contracts"
import { applyAssistantEvent } from "./assistant-event-projection"
import type { AssistantThreadDetail } from "./assistant-types"
import { assistantRunExecutionFixture } from "./assistant-test-fixtures"

const now = "2026-08-22T12:00:00.000Z"

function detail(): AssistantThreadDetail {
  const thread: AssistantThread = {
    id: "thread-1",
    userId: "user-1",
    title: "Thread",
    activeBranchId: "branch-1",
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
  const run: AssistantRun = {
    ...assistantRunExecutionFixture,
    id: "run-1",
    threadId: thread.id,
    branchId: "branch-1",
    inputMessageId: "user-message",
    outputMessageId: null,
    reservedOutputMessageId: "assistant-message",
    parentRunId: null,
    runtimeId: "readonly",
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
  }
  return {
    thread,
    activeBranchId: "branch",
    branches: [],
    messages: [],
    activePathMessageIds: [],
    runs: [run],
    attachments: [],
    citations: [],
    manifests: [],
    usage: [],
    activeRunProjections: [],
  }
}

function event(
  sequence: number,
  type: string,
  payload: unknown
): AssistantEventProjection {
  return {
    protocolVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    threadId: "thread-1",
    branchId: "branch-1",
    runId: "run-1",
    emittedAt: now,
    persistedAt: now,
    type,
    payload,
    terminal: type.startsWith("run.") && type !== "run.started",
  }
}

describe("assistant committed-event projection", () => {
  test("streams deltas once and preserves sequence monotonicity", () => {
    const first = applyAssistantEvent(
      detail(),
      event(1, "text.message.delta", { delta: "Bon" })
    )
    const second = applyAssistantEvent(
      first,
      event(2, "text.message.delta", { delta: "jour" })
    )
    const duplicate = applyAssistantEvent(
      second,
      event(2, "text.message.delta", { delta: "!" })
    )
    expect(second.activeRunProjections[0]?.parts[0]).toMatchObject({
      markdown: "Bonjour",
    })
    expect(duplicate).toBe(second)
  })

  test("marks terminal state while waiting for canonical refetch", () => {
    const failed = applyAssistantEvent(
      detail(),
      event(1, "run.failed", { code: "provider_error", message: "Unavailable" })
    )
    expect(failed.runs[0]?.status).toBe("failed")
    expect(failed.activeRunProjections[0]?.parts[0]).toMatchObject({
      type: "safe-error",
      code: "provider_error",
    })
  })
})
