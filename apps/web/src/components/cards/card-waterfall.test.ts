import { describe, expect, test } from "bun:test"
import { waterfallRows } from "./card-waterfall"
import { axisNameAtWidth } from "./card-figure"
import type { ContributionStep, WaterfallResult } from "@avermate/core"

const labels = {
  start: "Before",
  end: "After",
  rest: "Everything else",
  unexplained: "Unexplained",
}

describe("a sideways axis's names", () => {
  test("leave the bars room on a narrow card", () => {
    // A subject can be called this, and the chart reserves whatever its longest name
    // needs: unbudgeted, this one took 380px of a 228px card and pushed every bar off the
    // right edge — measured on the bench as bars one pixel wide at x = 353.
    const long =
      "Travaux d'Initiative Personnelle Encadrés — Compétences Transversales"

    expect(axisNameAtWidth(long, 228).length).toBeLessThanOrEqual(15)
    expect(axisNameAtWidth(long, 228).endsWith("…")).toBe(true)
  })

  test("keep a name that fits, whole", () => {
    expect(axisNameAtWidth("Before", 228)).toBe("Before")
    expect(axisNameAtWidth("Mathematics", 400)).toBe("Mathematics")
  })

  test("grow with the card", () => {
    const name = "History and Geography"

    expect(axisNameAtWidth(name, 200).length).toBeLessThan(
      axisNameAtWidth(name, 500).length
    )
    // Wide enough and nothing is cut: truncation is a response to the width, not a style.
    expect(axisNameAtWidth(name, 500)).toBe(name)
  })

  test("never cut below a readable stub", () => {
    // On a card too narrow for any name, six characters and an ellipsis still say which
    // row is which when read against the tooltip; zero characters say nothing at all.
    expect(axisNameAtWidth("Mathematics", 40).length).toBeGreaterThanOrEqual(6)
  })

  test("do not leave a space before the ellipsis", () => {
    expect(axisNameAtWidth("History and Geography", 228)).not.toContain(" …")
  })
})

describe("a waterfall's rows", () => {
  /**
   * A step, with the parts a reader can ask for filled in plausibly.
   *
   * The rows this file is about are built from `key`, `label`, `start`, `end`, `delta` and
   * `role`; the decomposition's own fields — which half of the effect was the marks and
   * which was the weight — are `contributionBreakdown`'s business and are asserted there.
   */
  const step = (
    key: string,
    label: string,
    start: number,
    delta: number
  ): ContributionStep => ({
    key,
    label,
    start,
    end: start + delta,
    delta,
    markEffect: delta,
    weightEffect: 0,
    role: delta >= 0 ? "increase" : "decrease",
    weightBefore: 0.25,
    weightAfter: 0.25,
    averageBefore: 0.7,
    averageAfter: 0.7 + delta,
  })

  const result: WaterfallResult = {
    startValue: 0.7,
    endValue: 0.74,
    steps: [
      step("maths", "Mathematics", 0.7, 0.03),
      step("history", "History", 0.73, -0.01),
      step("art", "Art", 0.72, 0.015),
      step("music", "Music", 0.735, 0.005),
    ],
  }

  test("chain from the start value to the end value", () => {
    const rows = waterfallRows(result, 4, true, labels)

    expect(rows[0]?.end).toBeCloseTo(result.startValue, 12)
    expect(rows.at(-1)?.end).toBeCloseTo(result.endValue, 12)
  })

  test("fold the tail without losing the total", () => {
    const rows = waterfallRows(result, 2, true, labels)
    const rest = rows.find((row) => row.label === labels.rest)

    // Two named steps, then everything else — and the fold has to land exactly where the
    // last step does, or the drawing shows a change the results did not make.
    expect(rest?.start).toBeCloseTo(0.72, 12)
    expect(rest?.end).toBeCloseTo(result.endValue, 12)
    expect(rest?.delta).toBeCloseTo(0.02, 12)
  })

  test("drop the totals when they are not wanted", () => {
    const rows = waterfallRows(result, 4, false, labels)

    expect(rows.map((row) => row.label)).not.toContain(labels.start)
    expect(rows.map((row) => row.label)).not.toContain(labels.end)
  })
})
