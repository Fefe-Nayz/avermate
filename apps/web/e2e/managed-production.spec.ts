import { expect, test } from "@playwright/test"
import {
  assertBasicAccessibility,
  MANAGED_ADMIN_EMAIL,
  MANAGED_CUSTOMER_EMAIL,
  signIn,
} from "./helpers"

test.describe.configure({ timeout: 120_000 })

test("customer controls consent, usage and managed-only deletion without checkout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, MANAGED_CUSTOMER_EMAIL, "/settings/managed")

  await expect(page.getByRole("tab", { name: "Usage & limits" })).toBeVisible()
  await expect(page.getByText("Checkout off")).toBeVisible()
  await expect(page.getByRole("button", { name: /checkout/i })).toHaveCount(0)

  await page.getByRole("tab", { name: "Providers & data" }).click()
  await expect(page.getByText("Managed processing consent")).toBeVisible()
  const consentResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        "http://localhost:5100/rpc/managed/beta/updateConsent" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Revoke consent" }).click()
  expect((await consentResponse).ok()).toBe(true)
  await expect(
    page.getByRole("button", { name: "Revoke consent" })
  ).toBeDisabled()

  await page.getByRole("tab", { name: "Privacy & lifecycle" }).click()
  await page.getByRole("button", { name: "Delete managed data" }).click()
  await page.getByLabel("Type DELETE MANAGED DATA").fill("DELETE MANAGED DATA")
  await expect(page.getByText("Academic Core is unaffected")).toBeVisible()
  const deletionResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        "http://localhost:5100/rpc/managed/privacy/requestManagedDeletion" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Start deletion" }).click()
  expect((await deletionResponse).ok()).toBe(true)
  await expect(
    page.getByText(/Deletion started\. Remote data remains pending/)
  ).toBeVisible()
  await expect(page.getByText("delete-now")).toBeVisible()
  await assertBasicAccessibility(page)
})

test("operator role opens a real breaker while billing remains test-only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, MANAGED_ADMIN_EMAIL, "/admin/managed")

  await expect(
    page.getByText("Production checkout is hard-disabled")
  ).toBeVisible()
  const breakerTab = page.getByRole("tab", { name: "Limits & breakers" })
  await breakerTab.click()
  await expect(breakerTab).toHaveAttribute("aria-selected", "true")
  await expect(page.locator("#breaker-scope-id")).toHaveValue("managed")
  const breakerResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        "http://localhost:5100/rpc/managed/admin/circuitBreaker" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Update breaker" }).click()
  expect((await breakerResponse).ok()).toBe(true)
  await expect(page.getByText("Circuit breaker updated.")).toBeVisible()
  await expect(page.getByText("managed", { exact: true }).last()).toBeVisible()

  await page.getByRole("tab", { name: "Billing test mode" }).click()
  await expect(page.getByText("Checkout off")).toBeVisible()
  await expect(page.getByRole("button", { name: /checkout/i })).toHaveCount(0)
  await assertBasicAccessibility(page)
})
