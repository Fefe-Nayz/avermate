import { describe, expect, test } from "bun:test"
import { isFullBleedRoute } from "./page-layout"

describe("which screens own the whole pane", () => {
  test("the browser does", () => {
    expect(isFullBleedRoute("/materials")).toBe(true)
    expect(isFullBleedRoute("/materials/")).toBe(true)
  })

  test("but the documents inside it do not", () => {
    // A revision sheet or a recording is read as a page, so it keeps the
    // centred column every other reading screen has.
    expect(isFullBleedRoute("/materials/fiches/abc")).toBe(false)
    expect(isFullBleedRoute("/materials/recordings/new")).toBe(false)
  })

  test("and neither does anything else", () => {
    expect(isFullBleedRoute("/dashboard")).toBe(false)
    expect(isFullBleedRoute("/")).toBe(false)
  })
})
