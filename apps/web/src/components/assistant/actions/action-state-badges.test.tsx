import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ActionCard } from "./action-card"
import { ActionStateBadges } from "./action-state-badges"
import { actionFixture } from "./action-test-fixture"

test("renders immutable execution and derived undo status as separate badges", () => {
  const html = renderToStaticMarkup(
    <ActionStateBadges
      action={actionFixture({
        status: "completed",
        undoState: "partially-compensated",
      })}
    />
  )

  expect(html).toContain('aria-label="Execution: Succeeded"')
  expect(html).toContain('data-action-state="succeeded"')
  expect(html).toContain('aria-label="Undo: Partially undone"')
  expect(html).toContain('data-undo-state="partially-compensated"')
})

test("exposes the requested compensation_failed UI state without relabelling execution", () => {
  const html = renderToStaticMarkup(
    <ActionStateBadges
      action={actionFixture({ status: "completed", undoState: "failed" })}
    />
  )

  expect(html).toContain('data-action-state="compensation_failed"')
  expect(html).toContain('aria-label="Execution: Succeeded"')
  expect(html).toContain('aria-label="Undo: Compensation failed"')
})

test("renders an inspectable action card with an affected-resource link", () => {
  const html = renderToStaticMarkup(
    <ActionCard action={actionFixture()} compact />
  )

  expect(html).toContain('data-action-id="action-1"')
  expect(html).toContain("Create a personal task")
  expect(html).toContain('aria-label="Affected resources"')
  expect(html).toContain('href="/planning/tasks/task-1/edit"')
  expect(html).toContain("One recoverable task will be added")
})

test("renders concrete confirm and reject controls for a pending approval", () => {
  const html = renderToStaticMarkup(
    <ActionCard
      compact
      action={actionFixture({
        status: "awaiting-approval",
        undoState: "not-applicable",
        approval: {
          id: "approval-1",
          actionId: "action-1",
          state: "pending",
          argumentsHash: "a".repeat(64),
          previewHash: "a".repeat(64),
          expiresAt: "2099-08-22T10:10:00.000Z",
          resolvedAt: null,
        },
      })}
      operations={{ onApprovalDecision: () => undefined }}
    />
  )

  expect(html).toContain("Approval required")
  expect(html).toContain("Confirm and continue")
  expect(html).toContain("Reject")
  expect(html).toContain("One recoverable task will be added")
})
