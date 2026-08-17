import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  resolveScrubberTickStep,
  resolveVisibleScrubberDays,
} from "./day-scrubber"

describe("timeline scrubber tick density", () => {
  test("thins minor ticks on both phone and desktop widths", () => {
    expect(resolveScrubberTickStep(365, 360)).toBe(5)
    expect(resolveScrubberTickStep(365, 1000)).toBe(2)
    expect(resolveScrubberTickStep(365, 1600)).toBe(1)
  })

  test("keeps short ranges dense and has a stable pre-measure fallback", () => {
    expect(resolveScrubberTickStep(30, 360)).toBe(1)
    expect(resolveScrubberTickStep(365, 0)).toBe(4)
  })

  test("mounts only visible ticks while preserving semantic month anchors", () => {
    const days = resolveVisibleScrubberDays(365, 5, [31, 59, 90])
    expect(days).toContain(0)
    expect(days).toContain(365)
    expect(days).toContain(31)
    expect(days).toContain(59)
    expect(days).not.toContain(1)
    expect(days.length).toBeLessThan(100)
  })
})

describe("the timeline drawer's swipe exemption", () => {
  const source = (file: string) =>
    readFileSync(new URL(file, import.meta.url), "utf8")

  /** The element that opens the exemption, to its matching close. */
  function exemptBlock(jsx: string): string {
    const start = jsx.indexOf('<div data-base-ui-swipe-ignore="">')
    if (start < 0) throw new Error("nothing opens the exemption")
    let depth = 0
    for (let index = start; index < jsx.length; index += 1) {
      if (jsx.startsWith("<div", index)) depth += 1
      else if (jsx.startsWith("</div>", index)) {
        depth -= 1
        if (depth === 0) return jsx.slice(start, index + "</div>".length)
      }
    }
    throw new Error("the exemption is never closed")
  }

  test("covers the dates under the ticks, not only the ticks", () => {
    // The drawer resolves the exemption with `target.closest()`, so it reaches
    // whatever the attribute encloses and stops there. On the ticks alone it
    // stopped at their bottom edge: a drag begun on a date label was an ordinary
    // downward swipe and shut the sheet mid-gesture.
    const block = exemptBlock(source("./timeline-banner.tsx"))

    expect(block).toContain("<DayScrubber")
    expect(block).toContain("marks.map(")
  })

  test("stays on the scrubber for any surface that wraps it differently", () => {
    expect(source("./day-scrubber.tsx")).toContain(
      'data-base-ui-swipe-ignore=""'
    )
  })
})
