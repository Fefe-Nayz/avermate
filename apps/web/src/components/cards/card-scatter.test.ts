import { describe, expect, test } from "bun:test"
import { scatterMedian, scatterPoints } from "./card-scatter"
import type { WidgetDataFrame } from "@avermate/core"

/**
 * A quadrant chart is read by position, so the two things that can make it lie are where
 * the dividing lines sit and which points exist at all.
 */

const frame: WidgetDataFrame = {
  schema: {
    dimensions: [{ id: "subject", type: "category" }],
    measures: [
      { id: "steady", type: "number", valueType: "percent" },
      { id: "gain", type: "number", valueType: "ratio" },
    ],
  },
  rows: [
    {
      key: "maths",
      dimensions: { subject: "Mathematics" },
      labels: { subject: "Mathematics" },
      measures: { steady: 0.9, gain: 0.05 },
    },
    {
      key: "art",
      dimensions: { subject: "Art" },
      labels: { subject: "Art" },
      measures: { steady: 0.7, gain: -0.02 },
    },
    {
      key: "music",
      dimensions: { subject: "Music" },
      labels: { subject: "Music" },
      // Never graded: no steadiness to plot.
      measures: { steady: null, gain: 0.01 },
    },
  ],
}

describe("the points of a quadrant", () => {
  test("takes the groups that have both readings", () => {
    const points = scatterPoints(frame, ["steady", "gain"])

    expect(points.map((point) => point.label)).toEqual(["Mathematics", "Art"])
    expect(points[0]).toEqual({
      key: "maths",
      label: "Mathematics",
      x: 0.9,
      y: 0.05,
    })
  })

  test("leaves out a group missing one of them", () => {
    // Plotting Music at zero steadiness would put it in the bottom-left corner — "erratic
    // and going nowhere" — which is a claim about a subject that has never been graded.
    expect(
      scatterPoints(frame, ["steady", "gain"]).some(
        (point) => point.label === "Music"
      )
    ).toBe(false)
  })

  test("reads the axes in the order it is given", () => {
    const flipped = scatterPoints(frame, ["gain", "steady"])

    expect(flipped[0]?.x).toBe(0.05)
    expect(flipped[0]?.y).toBe(0.9)
  })
})

describe("where the dividing lines sit", () => {
  test("splits an odd set at its middle value", () => {
    expect(scatterMedian([3, 1, 2])).toBe(2)
  })

  test("splits an even set between the two middle values", () => {
    expect(scatterMedian([1, 2, 3, 4])).toBe(2.5)
  })

  test("is unmoved by an outlier, which is why it is the median", () => {
    /**
     * The whole argument for the median over the midpoint of the axis. One subject
     * improving by five points stretches the axis, and a line at the middle of *that*
     * would put every other subject on the "below" side — reporting four ordinary
     * subjects as laggards because a fifth did well.
     */
    const ordinary = [0.01, 0.02, 0.03, 0.04, 0.05]
    const withOutlier = [...ordinary, 5]

    expect(scatterMedian(withOutlier)).toBe(scatterMedian([...ordinary, 0.06]))
    const midpoint = (Math.min(...withOutlier) + Math.max(...withOutlier)) / 2
    expect(scatterMedian(withOutlier)).toBeLessThan(midpoint)
  })

  test("has no middle for nothing", () => {
    expect(scatterMedian([])).toBeNull()
  })
})
