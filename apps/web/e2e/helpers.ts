import { expect, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export const E2E_PASSWORD = "assistant-e2e-password"
export const MAIN_EMAIL = "assistant-e2e@example.com"
export const NODE_EMAIL = "node-e2e@example.com"
export const MANAGED_CUSTOMER_EMAIL = "managed-customer-e2e@example.com"
export const MANAGED_ADMIN_EMAIL = "managed-admin-e2e@example.com"

export type ProductionFixture = {
  retrieval: {
    projectId: string
    materialId: string
    sourceVersionId: string
  }
  learning: {
    analysisId: string
    gradeId: string
    objectiveId: string
    quizId: string
  }
  node: {
    pairingCode: string
    nodeId: string
    fingerprint: string
  }
  media: {
    artifactId: string
    completedRunId: string
  }
}

export async function loadProductionFixture(): Promise<ProductionFixture> {
  const root = process.env.AVERMATE_ASSISTANT_E2E_ROOT
  if (!root) throw new Error("AVERMATE_ASSISTANT_E2E_ROOT is not configured")
  return JSON.parse(
    await readFile(join(root, "e2e-fixture.json"), "utf8")
  ) as ProductionFixture
}

export async function gotoHydrated(page: Page, url: string) {
  await page.goto(url)
  await page.waitForLoadState("networkidle")
}

export async function signIn(page: Page, email: string, next = "/dashboard") {
  await gotoHydrated(page, `/auth/sign-in?next=${encodeURIComponent(next)}`)
  // Wait for the client form to hydrate before filling it. During a cold
  // Turbopack compile, filling the server-rendered inputs sooner can be lost
  // when React replaces them during hydration.
  await page.getByLabel("Email").fill(email)
  await page.getByRole("textbox", { name: /^Password/ }).fill(E2E_PASSWORD)
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url() === "http://localhost:5100/api/auth/sign-in/email" &&
      candidate.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Sign in" }).click()
  const result = await response
  expect(result.ok(), await result.text()).toBe(true)
  // Exercise the authenticated destination explicitly after the production auth
  // endpoint has set its cookie. This avoids coupling unrelated journeys to the
  // sign-in form's client-side redirect timing during a cold Next compilation.
  await gotoHydrated(page, next)
  await expect(page).not.toHaveURL(/\/auth\/sign-in/, { timeout: 30_000 })
}

/**
 * A deliberately small production accessibility gate. axe is intentionally not
 * hidden behind this helper: these journeys prove keyboard names, unique ids,
 * landmarks and responsive containment with the browser's own accessibility
 * model, while component-level audits keep the exhaustive rule set.
 */
export async function assertBasicAccessibility(page: Page) {
  const main = page.locator("main").first()
  await expect(main).toBeVisible()

  const duplicateIds = await page.locator("[id]").evaluateAll((elements) => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const element of elements) {
      if (seen.has(element.id)) duplicates.add(element.id)
      seen.add(element.id)
    }
    return [...duplicates]
  })
  expect(duplicateIds).toEqual([])

  const unnamedControls = await main
    .locator(
      "button:visible, a[href]:visible, input:visible, select:visible, textarea:visible"
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const html = element as HTMLElement
          const style = window.getComputedStyle(html)
          const clippedProxy =
            style.clipPath !== "none" || style.clip !== "auto"
          if (html.getAttribute("aria-hidden") === "true" || clippedProxy) {
            return false
          }
          const id = html.id
          const labelled =
            html.getAttribute("aria-label") ||
            html.getAttribute("aria-labelledby") ||
            html.getAttribute("title") ||
            html.getAttribute("placeholder") ||
            html.textContent?.trim() ||
            (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
          return !labelled
        })
        .map((element) => element.outerHTML.slice(0, 160))
    )
  expect(unnamedControls).toEqual([])

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(overflow).toBeLessThanOrEqual(2)
}
