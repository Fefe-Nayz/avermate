import { describe, expect, test } from "bun:test"
import { sharingHistoryState } from "./sharing-preview"

describe("sharing history preview", () => {
  test("keeps a hidden history locked", () => {
    expect(sharingHistoryState(null)).toBe("locked")
    expect(sharingHistoryState(undefined)).toBe("locked")
  })

  test("does not call a shared but empty history locked", () => {
    expect(sharingHistoryState([])).toBe("empty")
  })

  test("reports shared points", () => {
    expect(sharingHistoryState([{ date: "2026-08-20" }])).toBe("shared")
  })
})
