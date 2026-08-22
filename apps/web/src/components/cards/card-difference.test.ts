import { describe, expect, test } from "bun:test"
import {
  differencePoints,
  differenceSegments,
  type DifferencePoint,
} from "./card-difference"
import type { WidgetDataFrame } from "@avermate/core"

/**
 * A difference card's fill says *which reading is on top*, so the only thing that can
 * really go wrong is the fill saying it in the wrong place — a colour that changes a
 * bucket late reports that you were behind through a month in which you were ahead.
 */

function point(step: number, first: number, second: number): DifferencePoint {
  return { key: String(step), step, label: String(step), first, second }
}

describe("difference segments", () => {
  test("keeps a run that never crosses in one stretch", () => {
    const segments = differenceSegments([
      point(0, 0.7, 0.6),
      point(1, 0.75, 0.6),
      point(2, 0.72, 0.6),
    ])

    expect(segments).toHaveLength(1)
    expect(segments[0]?.sign).toBe("above")
    expect(segments[0]?.points).toHaveLength(3)
  })

  test("cuts at the crossing, not at the next sample", () => {
    // The lines meet halfway between the two buckets, so that is where the colour turns.
    const segments = differenceSegments([
      point(0, 0.5, 0.6),
      point(1, 0.7, 0.6),
    ])

    expect(segments.map((segment) => segment.sign)).toEqual(["below", "above"])
    const crossing = segments[0]?.points[1]
    expect(crossing?.step).toBeCloseTo(0.5, 10)
    expect(crossing?.first).toBeCloseTo(0.6, 10)
    // The crossing is a point on both lines at once — that is what makes it the crossing.
    expect(crossing?.second).toBeCloseTo(crossing?.first ?? Number.NaN, 10)
  })

  test("shares the crossing between both stretches so the fill closes", () => {
    const segments = differenceSegments([
      point(0, 0.5, 0.6),
      point(1, 0.7, 0.6),
    ])

    const end = segments[0]?.points[segments[0].points.length - 1]
    expect(segments[1]?.points[0]).toEqual(end)
  })

  test("interpolates a crossing where both readings move", () => {
    // first 0.4 → 0.8, second 0.6 → 0.5: they meet a third of the way along.
    const segments = differenceSegments([
      point(0, 0.4, 0.6),
      point(1, 0.8, 0.5),
    ])

    expect(segments[0]?.points[1]?.step).toBeCloseTo(0.2 / 0.5, 10)
    expect(segments[0]?.points[1]?.first).toBeCloseTo(0.4 + 0.4 * 0.4, 10)
  })

  test("treats a sample that lands on the line as its own boundary", () => {
    // Equal readings need no interpolated crossing: the sample *is* the crossing, and
    // inventing a second point at the same position would draw a zero-width fill.
    const segments = differenceSegments([
      point(0, 0.7, 0.6),
      point(1, 0.6, 0.6),
      point(2, 0.5, 0.6),
    ])

    expect(segments.map((segment) => segment.sign)).toEqual(["above", "below"])
    expect(segments[0]?.points.map((entry) => entry.step)).toEqual([0, 1])
    expect(segments[1]?.points.map((entry) => entry.step)).toEqual([1, 2])
  })

  test("ends the stretch at a hole rather than filling across it", () => {
    const segments = differenceSegments([
      point(0, 0.7, 0.6),
      point(1, Number.NaN, 0.6),
      point(2, 0.72, 0.6),
    ])

    expect(segments).toHaveLength(2)
    expect(segments[0]?.points.map((entry) => entry.step)).toEqual([0])
    expect(segments[1]?.points.map((entry) => entry.step)).toEqual([2])
  })

  test("has nothing to draw for nothing", () => {
    expect(differenceSegments([])).toEqual([])
  })
})

describe("difference points", () => {
  const frame: WidgetDataFrame = {
    schema: {
      dimensions: [{ id: "when", type: "time" }],
      measures: [
        { id: "actual", type: "number", valueType: "ratio" },
        { id: "target", type: "number", valueType: "ratio" },
      ],
    },
    rows: [
      {
        key: "a",
        dimensions: { when: 0 },
        labels: { when: "September" },
        measures: { actual: 0.7, target: 0.75 },
      },
      {
        key: "b",
        dimensions: { when: 1 },
        labels: { when: "October" },
        measures: { actual: null, target: 0.75 },
      },
      {
        key: "c",
        dimensions: { when: 2 },
        labels: { when: "November" },
        measures: { actual: 0.8, target: 0.75 },
      },
    ],
  }

  test("reads the two measures the analysis named", () => {
    const points = differencePoints(frame, ["actual", "target"])

    expect(points.map((entry) => entry.label)).toEqual([
      "September",
      "November",
    ])
    expect(points.map((entry) => entry.first)).toEqual([0.7, 0.8])
  })

  test("leaves the gap where the reading is missing", () => {
    // November is the third bucket and stays the third bucket: closing up would slide it
    // onto October's tick and every label after it would name the wrong month.
    expect(differencePoints(frame, ["actual", "target"]).at(-1)?.step).toBe(2)
  })

  test("reads the pair in the order it is given", () => {
    const flipped = differencePoints(frame, ["target", "actual"])

    expect(flipped[0]?.first).toBe(0.75)
    expect(flipped[0]?.second).toBe(0.7)
  })
})
