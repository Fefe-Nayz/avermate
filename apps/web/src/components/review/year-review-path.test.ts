import { describe, expect, test } from "bun:test"
import { buildYearReviewPath } from "./year-review-path"

describe("year review peak path", () => {
  test("the arc-length progress lands exactly on the real peak", () => {
    const points = [
      { x: 0, y: 80 },
      { x: 8, y: 65 },
      { x: 76, y: 10 },
      { x: 100, y: 30 },
    ]
    const curve = buildYearReviewPath(points)
    const progress = curve.progressAtPoint(2)
    const peak = curve.pointAtProgress(progress)

    expect(progress).not.toBeCloseTo(0.76, 2)
    expect(peak.x).toBeCloseTo(points[2].x, 6)
    expect(peak.y).toBeCloseTo(points[2].y, 6)
  })

  test("never leaves the range its own samples set", () => {
    // The reason for taking the dashboard's curve. The Catmull-Rom spline this
    // replaces swung past its points to pass smoothly through them, dipping
    // below a climb and cresting above the highest reading — a shape the year's
    // averages never had. Monotone interpolation cannot: between two samples it
    // stays between those two samples.
    const points = [
      { x: 0, y: 50 },
      { x: 25, y: 52 },
      { x: 50, y: 90 },
      { x: 75, y: 20 },
      { x: 100, y: 22 },
    ]
    const curve = buildYearReviewPath(points)

    for (let step = 0; step <= 400; step += 1) {
      const at = curve.pointAtProgress(step / 400)
      // Which pair of samples this sits between, by x — monotone in x, so the
      // reading at any x is bounded by the two readings either side of it.
      let index = 0
      while (index < points.length - 2 && points[index + 1].x < at.x) index += 1
      const low = Math.min(points[index].y, points[index + 1].y)
      const high = Math.max(points[index].y, points[index + 1].y)

      expect(at.y).toBeGreaterThanOrEqual(low - 1e-6)
      expect(at.y).toBeLessThanOrEqual(high + 1e-6)
    }
  })

  test("progress is clamped to both curve endpoints", () => {
    const points = [
      { x: 0, y: 70 },
      { x: 100, y: 20 },
    ]
    const curve = buildYearReviewPath(points)

    expect(curve.pointAtProgress(-1)).toEqual(points[0])
    expect(curve.pointAtProgress(2)).toEqual(points[1])
  })
})
