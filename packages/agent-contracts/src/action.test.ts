import { describe, expect, test } from "bun:test";
import {
  agentActionDtoSchema,
  agentActionPreviewSchema,
  agentActionTaskCreateRequestSchema,
} from "./action";

describe("agent action contracts", () => {
  test("keeps task action inputs bounded and authority-free", () => {
    expect(
      agentActionTaskCreateRequestSchema.parse({
        yearId: "year-a",
        title: "Réviser le chapitre 3",
        idempotencyKey: "request-a",
      }),
    ).toMatchObject({
      notes: null,
      localNote: null,
      startsAt: null,
      subjectId: null,
    });
    expect(() =>
      agentActionTaskCreateRequestSchema.parse({
        yearId: "year-a",
        title: "Injected",
        idempotencyKey: "request-b",
        approvalMode: "auto-reversible",
      }),
    ).toThrow();
  });

  test("requires a frozen dependency fence and canonical hash in undo previews", () => {
    expect(() =>
      agentActionPreviewSchema.parse({
        actionIds: ["action-a"],
        reverseTopologicalOrder: ["action-a"],
        dependencyFenceVersion: 0,
        previewHash: "not-a-hash",
        eligible: ["action-a"],
        conflicted: [],
        nonUndoable: [],
        blocked: [],
      }),
    ).toThrow();
  });

  test("does not allow lifecycle status to masquerade as undo state", () => {
    const base = {
      contractVersion: 1,
      id: "action-a",
      batchId: null,
      userId: "user-a",
      actorKind: "embedded-agent",
      actorClientId: null,
      threadId: null,
      branchId: null,
      runId: null,
      toolCallId: null,
      domainScopeKind: null,
      domainScopeId: null,
      toolId: "planning.tasks.create",
      toolVersion: 1,
      effect: "create",
      risk: "medium",
      argumentsHash: "a".repeat(64),
      idempotencyKey: "request-a",
      actionSequence: 1,
      redactedInput: {},
      preview: {},
      previewHash: "b".repeat(64),
      status: "completed",
      resultSummary: null,
      safeError: null,
      compensatorId: "planning.tasks.trash-created@1",
      compensationOfActionId: null,
      startedAt: null,
      completedAt: "2026-08-22T10:00:00.000Z",
      createdAt: "2026-08-22T09:59:00.000Z",
      resources: [],
      approval: null,
      undoState: "eligible",
      activeCompensationActionId: null,
      compensationActionIds: [],
      undoReasonCode: null,
    } as const;
    expect(agentActionDtoSchema.parse(base).status).toBe("completed");
    expect(() =>
      agentActionDtoSchema.parse({
        ...base,
        status: "compensated",
      }),
    ).toThrow();
  });
});
