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
