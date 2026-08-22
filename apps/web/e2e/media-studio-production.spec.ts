import { expect, test } from "@playwright/test"
import {
  assertBasicAccessibility,
  loadProductionFixture,
  MAIN_EMAIL,
  signIn,
} from "./helpers"

test.describe.configure({ timeout: 120_000 })

test("monitors, inspects, previews, exports and revises a versioned Studio artifact", async ({
  page,
}) => {
  const fixture = await loadProductionFixture()
  await signIn(page, MAIN_EMAIL, "/materials/studio")

  await expect(
    page.getByRole("heading", { name: "Execution capabilities", level: 2 })
  ).toBeVisible()
  await expect(page.getByRole("tab", { name: "Workflows" })).toBeVisible()
  await expect(page.getByText("Completed").first()).toBeVisible()
  await expect(page.getByText("Overall progress")).toBeVisible()
  await expect(page.getByText("100 %").first()).toBeVisible()

  await page.getByRole("tab", { name: "Artifacts" }).click()
  await page.getByRole("button", { name: /E2E Revisioned Study Guide/ }).click()
  await expect(page.getByText("Revision 2").first()).toBeVisible()
  await expect(page.getByText("Revision 1").first()).toBeVisible()
  await page.getByRole("button", { name: "Manifest and provenance" }).click()
  await expect(page.getByText(/fixture\.pdf\.v2/)).toBeVisible()
  await expect(
    page.getByText(fixture.retrieval.sourceVersionId, { exact: false }).first()
  ).toBeVisible()

  await page.getByRole("button", { name: "Preview" }).click()
  const preview = page.getByTitle("Preview of E2E Revisioned Study Guide")
  await expect(preview).toBeVisible()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download" }).click()
  expect((await download).suggestedFilename()).toMatch(
    /^E2E-Revisioned-Study-Guide-r2\.pdf$/
  )
  await page.getByRole("button", { name: "Close" }).first().click()

  await page.getByRole("button", { name: "Revise" }).click()
  await expect(page.getByText("Revise from an existing output")).toBeVisible()
  const planResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/mediaStudio/planArtifact" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Plan workflow" }).click()
  expect((await planResponse).ok()).toBe(true)
  await expect(page.getByText("Workflow planned")).toBeVisible()
  await expect(page.getByText("placement_unavailable")).toBeVisible()
  await expect(
    page.getByText("Required execution placement is unavailable").first()
  ).toBeVisible()
  await assertBasicAccessibility(page)
})
