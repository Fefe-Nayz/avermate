import { lineStyleCurve } from "@/components/charts/line-style"

export interface ReviewChartPoint {
  x: number
  y: number
}

interface CurveSample extends ReviewChartPoint {
  length: number
}

interface CubicSegment {
  start: ReviewChartPoint
  control1: ReviewChartPoint
  control2: ReviewChartPoint
  end: ReviewChartPoint
}

function cubicPoint(
  start: ReviewChartPoint,
  control1: ReviewChartPoint,
  control2: ReviewChartPoint,
  end: ReviewChartPoint,
  progress: number
): ReviewChartPoint {
  const inverse = 1 - progress
  const startWeight = inverse ** 3
  const control1Weight = 3 * inverse ** 2 * progress
  const control2Weight = 3 * inverse * progress ** 2
  const endWeight = progress ** 3

  return {
    x:
      start.x * startWeight +
      control1.x * control1Weight +
      control2.x * control2Weight +
      end.x * endWeight,
    y:
      start.y * startWeight +
      control1.y * control1Weight +
      control2.y * control2Weight +
      end.y * endWeight,
  }
}

/**
 * A path sink that keeps the cubics rather than drawing them.
 *
 * d3's curves speak to a canvas-shaped target. Handing them one that records
 * gives us the same segments a chart would have drawn, which is what makes the
 * arc-length walk below possible: sampling a curve needs its control points, and
 * a path string has thrown them away.
 *
 * The stubs are the rest of the canvas path surface. A curve interpolator never
 * reaches for them, and implementing them empty is cheaper than asserting a
 * narrower type onto something the signature says is wider.
 */
function createSegmentRecorder() {
  const segments: CubicSegment[] = []
  let cursor: ReviewChartPoint = { x: 0, y: 0 }

  return {
    segments,
    moveTo(x: number, y: number): void {
      cursor = { x, y }
    },
    lineTo(x: number, y: number): void {
      const end = { x, y }
      // A straight run is a cubic whose handles sit on its own ends, so the
      // sampler needs no second case for it.
      segments.push({ start: cursor, control1: cursor, control2: end, end })
      cursor = end
    },
    bezierCurveTo(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x: number,
      y: number
    ): void {
      const end = { x, y }
      segments.push({
        start: cursor,
        control1: { x: x1, y: y1 },
        control2: { x: x2, y: y2 },
        end,
      })
      cursor = end
    },
    closePath(): void {},
    arc(): void {},
    arcTo(): void {},
    ellipse(): void {},
    quadraticCurveTo(): void {},
    rect(): void {},
  }
}

/**
 * Builds the curve and an arc-length lookup table.
 *
 * The interpolation is the dashboard's: `lineStyleCurve("smooth")`, which is
 * `curveMonotoneX`. That is the point of taking it from there rather than
 * spelling it out — the review draws the same average as the dashboard, so it
 * should draw it with the same shape, and it will keep doing so if that shared
 * definition ever changes.
 *
 * It used to build a Catmull-Rom spline instead. Catmull-Rom overshoots: to pass
 * smoothly through its points it swings past them, inventing dips before a climb
 * and peaks above the highest reading. On a year of averages that reads as a
 * curve doing things the numbers never did. Monotone interpolation is built on
 * the opposite promise — between two samples it never leaves the range those two
 * samples define — so every bump on screen is a bump in the data.
 *
 * Keeping the lookup pure lets React render the moving camera without reading an
 * SVG ref, while the trace, dot and beacon still share one geometry.
 */
export function buildYearReviewPath(points: readonly ReviewChartPoint[]) {
  if (points.length < 2) {
    const point = points[0] ?? { x: 0, y: 50 }
    return {
      path: points.length === 1 ? `M ${point.x} ${point.y}` : "",
      progressAtPoint: () => 0,
      pointAtProgress: () => point,
    }
  }

  const recorder = createSegmentRecorder()
  const curve = lineStyleCurve("smooth")(recorder)
  curve.lineStart()
  for (const point of points) curve.point(point.x, point.y)
  curve.lineEnd()

  const { segments } = recorder
  let path = `M ${points[0].x} ${points[0].y}`
  const samples: CurveSample[] = [{ ...points[0], length: 0 }]
  const endpointLengths = [0]
  let totalLength = 0

  for (const { start, control1, control2, end } of segments) {
    path += ` C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`

    // SAFETY: seeded with the first point above and only ever appended to, so
    // there is always a last sample to measure the next step against.
    let last = samples.at(-1) as CurveSample
    for (let step = 1; step <= 32; step += 1) {
      const point = cubicPoint(start, control1, control2, end, step / 32)
      totalLength += Math.hypot(point.x - last.x, point.y - last.y)
      last = { ...point, length: totalLength }
      samples.push(last)
    }
    endpointLengths.push(totalLength)
  }

  const pointAtProgress = (progress: number): ReviewChartPoint => {
    const target = Math.max(0, Math.min(1, progress)) * totalLength
    let low = 0
    let high = samples.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (samples[middle].length < target) low = middle + 1
      else high = middle
    }

    const after = samples[low]
    const before = samples[Math.max(0, low - 1)]
    const span = after.length - before.length
    const local = span > 0 ? (target - before.length) / span : 0
    return {
      x: before.x + (after.x - before.x) * local,
      y: before.y + (after.y - before.y) * local,
    }
  }

  return {
    path,
    // Indexed against the segments actually recorded, not the points handed in:
    // a curve drops a point that repeats the one before it, and clamping to the
    // input length would then read past the end of this table.
    progressAtPoint: (index: number) =>
      totalLength > 0
        ? (endpointLengths[
            Math.max(0, Math.min(index, endpointLengths.length - 1))
          ] ?? 0) / totalLength
        : 0,
    pointAtProgress,
  }
}
