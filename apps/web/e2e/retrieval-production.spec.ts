import { expect, test } from "@playwright/test"
import {
  assertBasicAccessibility,
  loadProductionFixture,
  MAIN_EMAIL,
  signIn,
} from "./helpers"

test.describe.configure({ timeout: 120_000 })

test("searches the real project corpus and opens its exact PDF locator", async ({
  page,
}) => {
  const fixture = await loadProductionFixture()
  await signIn(page, MAIN_EMAIL, `/projects/${fixture.retrieval.projectId}`)
  await expect(
    page.getByText(
      "Production browser proof for lexical retrieval and locators.",
      { exact: true }
    )
  ).toBeVisible()

  await page.getByRole("tab", { name: "Recherche" }).click()
  const searchResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/projects/search" &&
      response.request().method() === "POST"
  )
  await page.getByLabel("Query").fill("taux de variation")
  expect((await searchResponse).ok()).toBe(true)

  await expect(page.getByText("Lexical search")).toBeVisible()
  await expect(
    page.getByText(/La dérivée mesure le taux de variation local/)
  ).toBeVisible()
  await expect(page.getByText("PDF · page 3 · zone exacte")).toBeVisible()

  await page.getByText(/La dérivée mesure le taux de variation local/).click()
  const exactSource = page.getByRole("link", { name: "Open exact source" })
  await expect(exactSource).toBeVisible()
  await expect(exactSource).toHaveAttribute(
    "href",
    new RegExp(`/materials.*${fixture.retrieval.materialId}.*locator=`)
  )
  const href = await exactSource.getAttribute("href")
  expect(decodeURIComponent(href ?? "")).toContain('"page":3')
  expect(decodeURIComponent(href ?? "")).toContain('"bbox"')

  await assertBasicAccessibility(page)
  await Promise.all([
    page.waitForURL(/\/materials/, { timeout: 30_000 }),
    exactSource.click(),
  ])
})
