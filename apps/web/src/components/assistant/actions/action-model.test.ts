import { describe, expect, test } from "bun:test"
import type {
  AgentActionBatchCompensationResult,
  AgentActionPreview,
} from "@avermate/agent-contracts"
import {
  actionActivityFilterCount,
  buildActionActivityFilter,
  EMPTY_ACTION_ACTIVITY_FILTER,
} from "./action-activity-model"
import {
  actionStatePresentation,
  actionUiState,
  approvalExpiryState,
  resourceHref,
  summarizeCompensationResult,
  summarizeUndoPreview,
  undoStatePresentation,
} from "./action-model"
import { actionFixture } from "./action-test-fixture"

const HASH = "a".repeat(64)

describe("action UI state", () => {
  test.each([
    ["reserved", "pending"],
    ["awaiting-approval", "pending"],
    ["executing", "executing"],
    ["completed", "succeeded"],
    ["failed", "failed"],
    ["rejected", "failed"],
    ["expired", "failed"],
    ["inspect-required", "failed"],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(
      actionUiState(
        actionFixture({
          status,
          undoState: status === "completed" ? "eligible" : "not-applicable",
        })
      )
    ).toBe(expected)
  })

  test("shows undo outcomes without mutating the completed execution label", () => {
    const undone = actionFixture({ undoState: "compensated" })
    expect(actionUiState(undone)).toBe("undone")
    expect(actionStatePresentation(undone).label).toBe("Succeeded")
    expect(undoStatePresentation(undone).label).toBe("Undone")

    const failed = actionFixture({ undoState: "failed" })
    expect(actionUiState(failed)).toBe("compensation_failed")
    expect(actionStatePresentation(failed).label).toBe("Succeeded")
    expect(undoStatePresentation(failed).label).toBe("Compensation failed")
  })

  test("keeps partial compensation explicit and separate from execution", () => {
    const action = actionFixture({ undoState: "partially-compensated" })
    expect(actionUiState(action)).toBe("succeeded")
    expect(undoStatePresentation(action)).toEqual({
      label: "Partially undone",
      variant: "destructive",
      attention: true,
    })
  })
})

test("approval expiry exposes a deterministic countdown and terminal state", () => {
  expect(
    approvalExpiryState(
      "2026-08-22T10:02:05.000Z",
      new Date("2026-08-22T10:00:00.000Z")
    )
  ).toEqual({
    expired: false,
    remainingSeconds: 125,
    label: "Expires in 2m 05s",
  })
  expect(
    approvalExpiryState(
      "2026-08-22T10:00:00.000Z",
      new Date("2026-08-22T10:00:01.000Z")
    ).expired
  ).toBe(true)
})

test("undo preview reports dependency expansion and expected partial work", () => {
  const preview: AgentActionPreview = {
    actionIds: ["a", "b", "c", "d"],
    reverseTopologicalOrder: ["d", "c", "b", "a"],
    dependencyFenceVersion: 9,
    previewHash: HASH,
    eligible: ["a", "b"],
    conflicted: ["c"],
    nonUndoable: [],
    blocked: ["d"],
  }
  expect(summarizeUndoPreview(preview, ["a"])).toEqual({
    requestedCount: 1,
    totalCount: 4,
    expandedDependencyCount: 3,
    eligibleCount: 2,
    conflictedCount: 1,
    blockedCount: 1,
    nonUndoableCount: 0,
    canExecute: true,
    partialExpected: true,
  })
})

test("partial compensation keeps completed inverses and identifies repairs", () => {
  const result: AgentActionBatchCompensationResult = {
    complete: false,
    partial: true,
    outcomes: [
      {
        sourceActionId: "a",
        compensationActionId: "undo-a",
        state: "compensated",
        reasonCode: null,
      },
      {
        sourceActionId: "b",
        compensationActionId: null,
        state: "conflicted",
        reasonCode: "resource-revision-changed",
      },
      {
        sourceActionId: "c",
        compensationActionId: null,
        state: "blocked",
        reasonCode: "uncompensated-dependant",
      },
    ],
  }
  expect(summarizeCompensationResult(result)).toMatchObject({
    kind: "partial",
    compensatedCount: 1,
    conflictedCount: 1,
    blockedCount: 1,
    unresolvedActionIds: ["b", "c"],
  })
})

test("activity filters omit empty values and retain precise resource filters", () => {
  const draft = {
    ...EMPTY_ACTION_ACTIVITY_FILTER,
    toolId: " planning.tasks.create ",
    resourceKind: "planning-task",
    undoState: "eligible" as const,
  }
  expect(actionActivityFilterCount(draft)).toBe(3)
  expect(buildActionActivityFilter(draft)).toMatchObject({
    limit: 50,
    toolId: "planning.tasks.create",
    resourceKind: "planning-task",
    undoState: "eligible",
  })
})

test("affected owned resources link to their canonical Web screen", () => {
  expect(resourceHref(actionFixture().resources[0]!)).toBe(
    "/planning/tasks/task-1/edit"
  )
})
