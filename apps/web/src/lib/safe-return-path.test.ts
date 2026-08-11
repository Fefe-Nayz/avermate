import { describe, expect, test } from "bun:test"
import { safeReturnPath } from "./safe-return-path"

describe("safe return path", () => {
  test("keeps an internal onboarding destination", () => {
    expect(
      safeReturnPath(
        "/onboarding/year/y_123?step=subjects",
        "/subjects"
      )
    ).toBe("/onboarding/year/y_123?step=subjects")
  })

  test("rejects external and protocol-relative destinations", () => {
    expect(safeReturnPath("https://example.com", "/subjects")).toBe(
      "/subjects"
    )
    expect(safeReturnPath("//example.com", "/subjects")).toBe("/subjects")
  })
})
