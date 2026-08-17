import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { NEUTRAL_DELTA } from "@/components/data/value"
import { impactBarShare, impactMagnitude } from "./impact-grid"

/**
 * The bars are the design, so their arithmetic is the thing to pin down.
 *
 * The readings this section shows differ by an order of magnitude — a grade moves
 * its subject a lot, its parent less, the year least — and the point of a bar is
 * that the reader sees that without doing the division. Which only holds if every
 * bar in the list is measured against the same scale.
 */
describe("impactBarShare", () => {
  test("the largest impact fills its side of the track exactly", () => {
    // Half the track is one direction, so 50 is full.
    expect(impactBarShare(0.44, 0.44)).toBe(50)
    expect(impactBarShare(-0.44, 0.44)).toBe(50)
  })

  test("a shared scale is what makes two rows comparable", () => {
    // The scale is the list's largest magnitude, not the row's own value: half the
    // effect is half the bar. Measuring each bar against itself would draw every
    // row full and say nothing.
    const scale = 0.44
    expect(impactBarShare(0.22, scale)).toBeCloseTo(25, 9)
    expect(impactBarShare(0.11, scale)).toBeCloseTo(12.5, 9)
    // And the sign is carried by direction, not by length.
    expect(impactBarShare(-0.22, scale)).toBe(impactBarShare(0.22, scale))
  })

  test("a real but tiny impact keeps a visible stub", () => {
    // 0.004 against 0.44 is under half a percent of the track — a fraction of a
    // pixel, which reads as no bar at all, which reads as "this grade did not move
    // that average". It did.
    expect(impactBarShare(0.004, 0.44)).toBe(2)
    expect(impactBarShare(0.004, 0.44)).toBeGreaterThan(0)
  })

  test("nothing to draw is nothing, with no division to do", () => {
    expect(impactBarShare(null, 0.44)).toBe(0)
    expect(impactBarShare(0, 0.44)).toBe(0)
    // A list where nothing moved has a scale of zero, and this is the guard that
    // keeps it from being a divisor.
    expect(impactBarShare(0.1, 0)).toBe(0)
    expect(Number.isFinite(impactBarShare(0.1, 0))).toBe(true)
  })

  test("float noise is not a movement, however it is ranked", () => {
    // The bug this exists to stop. An average is a sum of quotients, so removing a
    // grade and adding it back returns a float about `1e-16` from the original —
    // different noise per scope. Against exact zero all of it counted, and a scale
    // normalised on the largest turned it into a full-length bar with the rest
    // ranked underneath: five rows reading `±0.00` and `14.01 → 14.01`, each with a
    // confident bar of its own length.
    const noise = [-1.24e-16, -8.1e-16, -3.2e-16, -1.7e-15, -6e-17]
    const scale = Math.max(...noise.map(impactMagnitude))

    expect(scale).toBe(0)
    for (const delta of noise) {
      expect(impactMagnitude(delta), String(delta)).toBe(0)
      expect(impactBarShare(delta, scale), String(delta)).toBe(0)
      // And no bar even if something real elsewhere in the list set the scale.
      expect(impactBarShare(delta, 0.44), String(delta)).toBe(0)
    }
  })

  test("agrees with the figure beside it about what counts as no change", () => {
    // `DeltaValue` prints `±` below `NEUTRAL_DELTA`, so a bar must not appear
    // there: the moment one does, the reader is shown movement the number denies.
    expect(impactMagnitude(NEUTRAL_DELTA - 1e-9)).toBe(0)
    expect(impactMagnitude(NEUTRAL_DELTA)).toBeGreaterThan(0)
    expect(impactBarShare(NEUTRAL_DELTA - 1e-9, 0.44)).toBe(0)
    expect(impactBarShare(NEUTRAL_DELTA, 0.44)).toBeGreaterThan(0)
  })

  test("never overruns its half of the track", () => {
    // `scale` is the maximum by construction, but the function is exported and the
    // guarantee is worth stating: no row can paint past the centre line's opposite.
    for (const delta of [0.001, 0.05, 0.2, 0.44]) {
      expect(impactBarShare(delta, 0.44)).toBeLessThanOrEqual(50)
    }
  })
})

describe("the impacts section", () => {
  const source = readFileSync(
    new URL("./impact-grid.tsx", import.meta.url),
    "utf8"
  )

  test("is a list of readings, not a table of records", () => {
    expect(source).toContain("<ul")
    expect(source).not.toContain("<table")
    expect(source).not.toContain("<thead")
  })

  test("draws every bar against the list's own largest impact", () => {
    // One scale for the whole list. Computed once, above the rows — a scale
    // recomputed per row would be each row's own value and every bar would be full.
    expect(source).toContain("Math.max(...rows.map(magnitude))")
    expect(source).toContain("impactBarShare(delta, scale)")
    // Through `impactMagnitude`, so the scale cannot be set by a value too small
    // to draw a bar for.
    expect(source).toContain("impactMagnitude(reading.impact.delta)")
  })

  test("leaves the bar out of the accessibility tree", () => {
    // The delta is on the row in words, so the bar is scenery. Announcing a
    // decorative length twice is worse than not announcing it.
    expect(source).toContain("aria-hidden")
  })
})
