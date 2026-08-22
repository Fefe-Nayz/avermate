import { expect, test } from "@playwright/test"
import {
  assertBasicAccessibility,
  gotoHydrated,
  loadProductionFixture,
  MAIN_EMAIL,
  signIn,
} from "./helpers"

test.describe.configure({ timeout: 120_000 })

test("reviews a copy, plans study, completes a sourced quiz and keeps provider fields immutable", async ({
  page,
}) => {
  const fixture = await loadProductionFixture()
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, MAIN_EMAIL, `/grades/${fixture.learning.gradeId}`)

  await expect(
    page.getByRole("heading", { name: "E2E Provider Grade", level: 1 })
  ).toBeVisible()
  await expect(page.getByText("Read-only source fields")).toBeVisible()
  await expect(
    page.getByText("Pronote E2E fixture (not a live provider)", { exact: true })
  ).toBeVisible()

  await gotoHydrated(page, `/grades/${fixture.learning.gradeId}/edit`)
  await expect(page.getByLabel("Name").first()).toBeDisabled()
  await expect(page.getByLabel("Name").first()).toHaveValue(
    "E2E Provider Grade"
  )
  await expect(page.getByLabel("Result").first()).toBeDisabled()
  await expect(page.getByLabel("Result").first()).toHaveValue("13")
  await expect(page.getByLabel("Out of").first()).toBeDisabled()
  await expect(page.getByLabel("Out of").first()).toHaveValue("20")

  await gotoHydrated(page, `/learning/copies/${fixture.learning.analysisId}`)
  await expect(page.getByText("Ready to review").first()).toBeVisible()
  await expect(page.getByLabel("Objective")).toContainText(
    "Interpréter une dérivée"
  )
  await expect(page.getByText(/6 \/ 10/)).toBeVisible()
  const reviewResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/learning/copies/review" &&
      response.request().method() === "POST"
  )
  await page
    .getByRole("button", { name: "Confirm", exact: true })
    .first()
    .click()
  expect((await reviewResponse).ok()).toBe(true)
  await expect(
    page.getByText("Evidence is saved without changing the grade.")
  ).toBeVisible()

  await gotoHydrated(page, "/learning")
  await page.getByRole("tab", { name: "Plan" }).click()
  const proposeResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/learning/plan/propose" &&
      response.request().method() === "POST"
  )
  await page
    .getByRole("button", { name: "Generate suggestions" })
    .first()
    .click()
  expect((await proposeResponse).ok()).toBe(true)
  await expect(
    page.getByText("Interpréter une dérivée comme un taux de variation")
  ).toBeVisible()
  const applyResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/learning/plan/apply" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Schedule today" }).click()
  expect((await applyResponse).ok()).toBe(true)
  await expect(page.getByRole("button", { name: "Open agenda" })).toBeVisible()

  await gotoHydrated(page, `/materials/fiches/${fixture.learning.quizId}`)
  await page.getByRole("button", { name: /Measure progress/ }).click()
  const startResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/documents/quiz/start" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Start quiz" }).click()
  expect((await startResponse).ok()).toBe(true)
  await page.getByLabel("4").check()
  const completeResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/documents/quiz/complete" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Submit answers" }).click()
  expect((await completeResponse).ok()).toBe(true)
  await expect(
    page.getByText("Reviewed question evidence was added to mastery.")
  ).toBeVisible()

  await gotoHydrated(
    page,
    `/learning/objectives/${fixture.learning.objectiveId}`
  )
  await expect(page).toHaveURL(
    new RegExp(`/learning/objectives/${fixture.learning.objectiveId}$`)
  )
  await expect(page.getByText("Mastery estimate")).toBeVisible()
  await expect(page.getByText("Teacher feedback")).toBeVisible()
  await expect(page.getByText("Quiz question")).toBeVisible()
  await assertBasicAccessibility(page)
})

test("learning evidence and provider locks remain usable at a phone viewport", async ({
  page,
}) => {
  const fixture = await loadProductionFixture()
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(
    page,
    MAIN_EMAIL,
    `/learning/objectives/${fixture.learning.objectiveId}`
  )
  await expect(
    page.getByRole("heading", {
      name: "Interpréter une dérivée comme un taux de variation",
      level: 1,
    })
  ).toBeVisible()
  await expect(
    page.getByText("Evidence and explainable calculation")
  ).toBeVisible()
  await expect(
    page.getByText(/No evidence|Teacher feedback|Reviewed paper region/).first()
  ).toBeVisible()
  await assertBasicAccessibility(page)

  await gotoHydrated(page, `/grades/${fixture.learning.gradeId}`)
  await expect(page.getByText("Read-only source fields")).toBeVisible()
  await assertBasicAccessibility(page)
})
