import { expect, test } from "@playwright/test"
import {
  assertBasicAccessibility,
  loadProductionFixture,
  NODE_EMAIL,
  signIn,
} from "./helpers"

test.describe.configure({ timeout: 120_000 })

test("pairs a signed offline fixture, plans Node storage, and revokes it without claiming a live provider", async ({
  page,
}) => {
  const fixture = await loadProductionFixture()
  await signIn(page, NODE_EMAIL, "/settings/node")

  await page.getByLabel("One-time pairing code").fill(fixture.node.pairingCode)
  const claimResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/node/claim" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Inspect Node" }).click()
  expect((await claimResponse).ok()).toBe(true)
  await expect(page.getByText("Confirm this exact Node")).toBeVisible()
  await expect(page.getByText(fixture.node.fingerprint)).toBeVisible()
  await page
    .getByRole("checkbox", {
      name: "I compared this fingerprint and capability list with my local Node.",
    })
    .check()
  const confirmResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/node/confirm" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Confirm and pair" }).click()
  expect((await confirmResponse).ok()).toBe(true)

  await expect(page.getByText("Offline", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Node offline").first()).toBeVisible()
  const storagePlacement = page.locator("#placement-storage")
  const storageCard = storagePlacement.locator(
    'xpath=ancestor::*[@data-slot="card"][1]'
  )
  await storagePlacement.click()
  await page.getByRole("option", { name: "Avermate Node" }).click()
  await expect(
    storageCard.getByText(
      "The Node is offline; Node-owned requests will remain unavailable."
    )
  ).toBeVisible()
  await storageCard.getByRole("button", { name: "Review consequences" }).click()
  const placementResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/node/setPlacement" &&
      response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Record migration plan" }).click()
  expect((await placementResponse).ok()).toBe(true)
  await expect(storageCard.getByText("Migration planned")).toBeVisible()

  await assertBasicAccessibility(page)
  await page.getByRole("button", { name: "Revoke Node" }).first().click()
  await expect(page.getByText("Revoke this Node?")).toBeVisible()
  const revokeResponse = page.waitForResponse(
    (response) =>
      response.url() === "http://localhost:5100/rpc/node/revoke" &&
      response.request().method() === "POST"
  )
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Revoke Node" })
    .click()
  expect((await revokeResponse).ok()).toBe(true)
  await expect(page.getByText("The Node has been revoked.")).toBeVisible()
  await expect(page.getByText("Revoked", { exact: true }).first()).toBeVisible()
})
