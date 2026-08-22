import { describe, expect, test } from "bun:test"
import { radarAxes, RADAR_MAXIMUM_AXES } from "./card-radar"
import type { WidgetSeriesDatum } from "@avermate/core"

function row(label: string, value: number | null): WidgetSeriesDatum {
  return {
    key: label,
    label,
    date: null,
    value,
    delta: null,
    count: 1,
    series: null,
  }
}

/**
 * A radar's spokes are the one place this card can misreport: the shape depends on how
 * many there are and on what order they are in, so both have to be the analysis's answer
 * rather than the renderer's.
 */
describe("radar axes", () => {
  test("plots readings in the year's own marks", () => {
    // The spec's rings are labelled 0 … scale, so a ratio would draw every subject at the
    // centre of the ring.
    const { points } = radarAxes([row("Maths", 0.7)], 20)

    expect(points).toEqual([{ subject: "Maths", value: 14 }])
  })

  test("keeps the order it was given", () => {
    const labels = ["History", "Art", "Biology"]
    const { points } = radarAxes(
      labels.map((label, index) => row(label, 0.5 + index / 10)),
      20
    )

    // Not sorted: the polygon a radar draws depends on the order of its spokes, so
    // re-sorting them here would draw a different shape from the same readings.
    expect(points.map((point) => point.subject)).toEqual(labels)
  })

  test("leaves out a subject with no reading", () => {
    const { points } = radarAxes(
      [row("Maths", 0.7), row("Art", null), row("Biology", 0.6)],
      20
    )

    expect(points.map((point) => point.subject)).toEqual(["Maths", "Biology"])
  })

  test("counts what it could not fit rather than dropping it quietly", () => {
    const rows = Array.from({ length: 11 }, (_, index) =>
      row("Subject " + index, 0.5)
    )
    const { points, hidden } = radarAxes(rows, 20)

    expect(points).toHaveLength(RADAR_MAXIMUM_AXES)
    expect(hidden).toBe(3)
  })

  test("counts only the readings it could have drawn", () => {
    // Eight readings and three holes is eight spokes and nothing hidden — the holes were
    // never candidates, and reporting them as "3 more" would invent missing subjects.
    const rows = [
      ...Array.from({ length: 8 }, (_, index) => row("Subject " + index, 0.5)),
      row("Art", null),
      row("Music", null),
      row("Drama", null),
    ]
    const { points, hidden } = radarAxes(rows, 20)

    expect(points).toHaveLength(8)
    expect(hidden).toBe(0)
  })

  test("has nothing to draw for nothing", () => {
    expect(radarAxes([], 20)).toEqual({ points: [], hidden: 0 })
  })
})
