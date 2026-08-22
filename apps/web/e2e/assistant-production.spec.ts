import { expect, test } from "@playwright/test"

test("signs in and creates a conversation through the production assistant route", async ({
  page,
}) => {
  await page.goto("/auth/sign-in?next=/assistant")
  await page.waitForLoadState("networkidle")
  await page.getByLabel("Email").fill("assistant-e2e@example.com")
  await page
    .getByRole("textbox", { name: /^Password/ })
    .fill("assistant-e2e-password")
  const signInResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/api/auth/sign-in/email" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Sign in" }).click()
  expect((await signInResponse).ok()).toBe(true)
  await expect(page.getByText("Your study assistant")).toBeVisible({
    timeout: 15_000,
  })

  const threadsLoaded = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/assistant/threads/list" &&
      response.request().method() === "POST"
  )
  await page.goto("/assistant")
  expect((await threadsLoaded).ok()).toBe(true)
  await page.waitForLoadState("networkidle")
  await expect(page).toHaveURL((url) => url.pathname === "/assistant")
  await expect(page.getByText("Your study assistant")).toBeVisible()
  const createThreadResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/assistant/threads/create" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "New chat" }).first().click()
  expect((await createThreadResponse).ok()).toBe(true)

  await expect(page.getByRole("combobox").first()).toContainText(
    "mock-readonly"
  )
  await page
    .getByRole("textbox", {
      name: "Ask about your courses, grades or documents…",
    })
    .fill("Summarize the evidence available for this test.")
  await page.getByRole("button", { name: "Send message" }).click()

  await expect(
    page.getByText(/Je n’ai pas trouvé de preuve textuelle suffisante/)
  ).toBeVisible({ timeout: 15_000 })
  await expect(page).not.toHaveURL(/\/dev\//)
})
