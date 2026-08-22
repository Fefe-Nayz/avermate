import type { AgentActionDto } from "@avermate/agent-contracts"

const HASH = "a".repeat(64)

export function actionFixture(
  patch: Partial<AgentActionDto> = {}
): AgentActionDto {
  return {
    contractVersion: 1,
    id: "action-1",
    batchId: null,
    userId: "user-1",
    actorKind: "embedded-agent",
    actorClientId: "assistant-client",
    threadId: "thread-1",
    branchId: "branch-1",
    runId: "run-1",
    toolCallId: "call-1",
    domainScopeKind: "academic-year",
    domainScopeId: "year-1",
    toolId: "planning.tasks.create",
    toolVersion: 1,
    effect: "create",
    risk: "medium",
    argumentsHash: HASH,
    idempotencyKey: "idem-1",
    actionSequence: 1,
    redactedInput: { title: "Revise fractions" },
    preview: { consequence: "One recoverable task will be added" },
    previewHash: HASH,
    status: "completed",
    resultSummary: { id: "task-1" },
    safeError: null,
    compensatorId: "planning.tasks.trash-created@1",
    compensationOfActionId: null,
    startedAt: "2026-08-22T10:00:00.000Z",
    completedAt: "2026-08-22T10:00:01.000Z",
    createdAt: "2026-08-22T10:00:00.000Z",
    resources: [
      {
        actionId: "action-1",
        resourceKind: "planning-task",
        resourceId: "task-1",
        operation: "create",
        beforeRevision: null,
        afterRevision: "1",
        beforeSnapshot: null,
        afterSnapshot: { title: "Revise fractions" },
        contentRefBefore: null,
        contentRefAfter: null,
      },
    ],
    approval: null,
    undoState: "eligible",
    activeCompensationActionId: null,
    compensationActionIds: [],
    undoReasonCode: null,
    ...patch,
  }
}
