export interface ReviewChartPoint {
  x: number
  y: number
}

interface CurveSample extends ReviewChartPoint {
  length: number
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
 * Builds the canonical Catmull-Rom curve and an arc-length lookup table.
 * Keeping the lookup pure lets React render the moving camera without reading
 * an SVG ref, while the trace, dot and beacon still share one geometry.
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

  let path = `M ${points[0].x} ${points[0].y}`
  const samples: CurveSample[] = [{ ...points[0], length: 0 }]
  const endpointLengths = [0]
  let totalLength = 0

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)]
    const start = points[index]
    const end = points[index + 1]
    const next = points[Math.min(points.length - 1, index + 2)]
    const control1 = {
      x: start.x + (end.x - previous.x) / 6,
      y: start.y + (end.y - previous.y) / 6,
    }
    const control2 = {
      x: end.x - (next.x - start.x) / 6,
      y: end.y - (next.y - start.y) / 6,
    }

    path += ` C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`

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
    progressAtPoint: (index: number) =>
      totalLength > 0
        ? (endpointLengths[Math.max(0, Math.min(index, points.length - 1))] ??
            0) / totalLength
        : 0,
    pointAtProgress,
  }
}
