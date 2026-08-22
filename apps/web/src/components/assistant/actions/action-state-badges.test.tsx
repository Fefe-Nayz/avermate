import { expect, test } from "bun:test"
import {
  actionStatePresentation,
  resourceHref,
  undoStatePresentation,
} from "./action-model"
import { actionFixture } from "./action-test-fixture"

async function source(fileName: string) {
  return Bun.file(new URL(fileName, import.meta.url)).text()
}

test("keeps immutable execution and derived undo status separate", () => {
  const action = actionFixture({
    status: "completed",
    undoState: "partially-compensated",
  })
  expect(actionStatePresentation(action)).toMatchObject({
    state: "succeeded",
    label: "Succeeded",
  })
  expect(undoStatePresentation(action)).toMatchObject({
    label: "Partially undone",
    attention: true,
  })
})

test("exposes compensation failure without relabelling execution", () => {
  const action = actionFixture({ status: "completed", undoState: "failed" })
  expect(actionStatePresentation(action)).toMatchObject({
    state: "compensation_failed",
    label: "Succeeded",
  })
  expect(undoStatePresentation(action).label).toBe("Compensation failed")
})

test("keeps inspectable resources and localized action controls", async () => {
  const [card, approval, badges] = await Promise.all([
    source("./action-card.tsx"),
    source("./action-approval.tsx"),
    source("./action-state-badges.tsx"),
  ])

  expect(resourceHref(actionFixture().resources[0]!)).toBe(
    "/planning/tasks/task-1/edit"
  )
  expect(card).toContain("data-action-id={action.id}")
  expect(card).toContain('t("Affected resources")')
  expect(card).toContain('t("Preview undo")')
  expect(approval).toContain('t("Approval required")')
  expect(approval).toContain('t("Confirm and continue")')
  expect(approval).toContain('t("Reject")')
  expect(badges).toContain('t("Execution: {state}"')
  expect(badges).toContain('t("Undo: {state}"')
})
