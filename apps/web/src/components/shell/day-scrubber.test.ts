import { describe, expect, test } from "bun:test"
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
