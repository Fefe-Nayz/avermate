import { describe, expect, test } from "bun:test"
import { settingsHrefSection } from "./use-settings-highlight"

/**
 * Which section a settings search result points at.
 *
 * The ring is stamped on the element whose id this returns, so a result that
 * names a whole page has to answer null rather than something almost-right —
 * ringing a section the reader did not ask for is worse than ringing none.
 */

describe("the section in a settings href", () => {
  test("is the fragment", () => {
    expect(settingsHrefSection("/settings/appearance#charts")).toBe("charts")
  })

  test("a whole page names no section", () => {
    expect(settingsHrefSection("/settings/appearance")).toBeNull()
  })

  test("and neither does an empty fragment", () => {
    // "/settings#" is a link to the top of the page, not to a section called "".
    expect(settingsHrefSection("/settings#")).toBeNull()
  })
})
