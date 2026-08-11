import type {
  ChartFocusStrategy,
  ChartPoint,
  ResolvedScale,
} from "@tanstack/charts"

export type NumericDomain = readonly [start: number, end: number]

type NumericScale = Pick<ResolvedScale, "invert" | "map">

interface NearestSeriesOptions<TDatum> {
  getSeriesId: (datum: TDatum) => string
  getTimestamp?: (datum: TDatum) => number
  isEnabled?: (point: ChartPoint<TDatum, number, number>) => boolean
}

function isFiniteDomain(domain: NumericDomain) {
  return domain.every(Number.isFinite) && domain[0] !== domain[1]
}

function assertDomain(domain: NumericDomain, name: string) {
  if (!isFiniteDomain(domain)) {
    throw new RangeError(`${name} must contain two distinct finite values.`)
  }
}

function toAscending(domain: NumericDomain): NumericDomain {
  return domain[0] <= domain[1] ? domain : ([domain[1], domain[0]] as const)
}

function restoreDirection(
  ascending: NumericDomain,
  reference: NumericDomain
): NumericDomain {
  return reference[0] <= reference[1]
    ? ascending
    : ([ascending[1], ascending[0]] as const)
}

function constrainDomain(
  requested: NumericDomain,
  extent: NumericDomain,
  maximumZoom: number
): NumericDomain {
  assertDomain(requested, "requested domain")
  assertDomain(extent, "domain extent")

  if (!Number.isFinite(maximumZoom) || maximumZoom < 1) {
    throw new RangeError("maximumZoom must be a finite value of at least 1.")
  }

  const [extentStart, extentEnd] = toAscending(extent)
  const [requestedStart, requestedEnd] = toAscending(requested)
  const extentSpan = extentEnd - extentStart
  const minimumSpan = extentSpan / maximumZoom
  const span = Math.min(
    extentSpan,
    Math.max(minimumSpan, requestedEnd - requestedStart)
  )
  const requestedCenter = (requestedStart + requestedEnd) / 2
  let start = requestedCenter - span / 2
  let end = start + span

  if (start < extentStart) {
    end += extentStart - start
    start = extentStart
  }

  if (end > extentEnd) {
    start -= end - extentEnd
    end = extentEnd
  }

  return restoreDirection([start, end], requested)
}

function invertNumber(scale: NumericScale, position: number) {
  const value = scale.invert?.(position)
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(
      "Time-series gestures require an invertible numeric scale."
    )
  }

  return value
}

/** Zooms a semantic time domain around a scene-coordinate anchor. */
export function zoomDomainAt(
  scale: NumericScale,
  domain: NumericDomain,
  extent: NumericDomain,
  anchor: number,
  factor: number,
  maximumZoom = 64
): NumericDomain {
  assertDomain(domain, "visible domain")
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError("factor must be a finite positive value.")
  }

  const first = anchor + (scale.map(domain[0]) - anchor) / factor
  const second = anchor + (scale.map(domain[1]) - anchor) / factor
  return constrainDomain(
    [invertNumber(scale, first), invertNumber(scale, second)],
    extent,
    maximumZoom
  )
}

/** Positive pixel delta means the plotted content moved to the right. */
export function panDomainBy(
  scale: NumericScale,
  domain: NumericDomain,
  extent: NumericDomain,
  delta: number,
  maximumZoom = 64
): NumericDomain {
  if (!Number.isFinite(delta)) {
    throw new RangeError("delta must be finite.")
  }

  return constrainDomain(
    [
      invertNumber(scale, scale.map(domain[0]) - delta),
      invertNumber(scale, scale.map(domain[1]) - delta),
    ],
    extent,
    maximumZoom
  )
}

/**
 * Resolves a complete two-pointer gesture from a fixed baseline. Rebuilding
 * from the baseline keeps a pure two-finger translation from becoming zoom.
 */
export function pinchDomainFromGesture(
  scale: NumericScale,
  baselineDomain: NumericDomain,
  extent: NumericDomain,
  baselineMidpoint: number,
  currentMidpoint: number,
  factor: number,
  maximumZoom = 64
): NumericDomain {
  assertDomain(baselineDomain, "pinch baseline domain")
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError("pinch factor must be a finite positive value.")
  }

  const firstScene = scale.map(baselineDomain[0])
  const secondScene = scale.map(baselineDomain[1])
  return constrainDomain(
    [
      invertNumber(
        scale,
        baselineMidpoint + (firstScene - currentMidpoint) / factor
      ),
      invertNumber(
        scale,
        baselineMidpoint + (secondScene - currentMidpoint) / factor
      ),
    ],
    extent,
    maximumZoom
  )
}

function pointTimestamp<TDatum>(
  point: ChartPoint<TDatum, number, number>,
  getTimestamp?: (datum: TDatum) => number
) {
  return getTimestamp?.(point.datum) ?? point.xValue
}

function comparePointIdentity<TDatum>(
  left: ChartPoint<TDatum, number, number>,
  right: ChartPoint<TDatum, number, number>,
  getSeriesId: (datum: TDatum) => string,
  getTimestamp?: (datum: TDatum) => number
) {
  const timestamp =
    pointTimestamp(left, getTimestamp) - pointTimestamp(right, getTimestamp)
  if (timestamp !== 0) return timestamp

  const series = getSeriesId(left.datum).localeCompare(getSeriesId(right.datum))
  return series !== 0 ? series : left.datumIndex - right.datumIndex
}

/** Selects one independently nearest real sample per enabled series. */
export function resolveNearestSeriesPoints<TDatum>(
  points: readonly ChartPoint<TDatum, number, number>[],
  pointer: { x: number; y: number },
  options: NearestSeriesOptions<TDatum>
): readonly ChartPoint<TDatum, number, number>[] {
  const nearestBySeries = new Map<string, ChartPoint<TDatum, number, number>>()

  for (const point of points) {
    if (!(options.isEnabled?.(point) ?? true)) continue
    const seriesId = options.getSeriesId(point.datum)
    const current = nearestBySeries.get(seriesId)
    if (!current) {
      nearestBySeries.set(seriesId, point)
      continue
    }

    const distance = Math.abs(point.x - pointer.x)
    const currentDistance = Math.abs(current.x - pointer.x)
    if (
      distance < currentDistance ||
      (distance === currentDistance &&
        comparePointIdentity(
          point,
          current,
          options.getSeriesId,
          options.getTimestamp
        ) < 0)
    ) {
      nearestBySeries.set(seriesId, point)
    }
  }

  const selected = [...nearestBySeries.values()]
  if (selected.length < 2) return selected

  let primaryIndex = 0
  let primaryDistance = Number.POSITIVE_INFINITY
  selected.forEach((point, index) => {
    const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y)
    if (
      distance < primaryDistance ||
      (distance === primaryDistance &&
        comparePointIdentity(
          point,
          selected[primaryIndex],
          options.getSeriesId,
          options.getTimestamp
        ) < 0)
    ) {
      primaryIndex = index
      primaryDistance = distance
    }
  })

  const [primary] = selected.splice(primaryIndex, 1)
  return [primary, ...selected]
}

/** Adapter for TanStack Charts' public focus grammar. */
export function createIndependentSeriesFocus<TDatum>(
  options: NearestSeriesOptions<TDatum>
): ChartFocusStrategy<TDatum, number, number> {
  const resolveAround = (
    points: readonly ChartPoint<TDatum, number, number>[],
    point: { x: number; y: number }
  ) => resolveNearestSeriesPoints(points, point, options)

  return {
    resolve: (points, context) => resolveAround(points, context),
    group: (points, context) => resolveAround(points, context.point),
    navigation: (points) =>
      points
        .filter((point) => options.isEnabled?.(point) ?? true)
        .toSorted((left, right) =>
          comparePointIdentity(
            left,
            right,
            options.getSeriesId,
            options.getTimestamp
          )
        ),
  }
}

export type ChartKeyboardCommand =
  "pan-left" | "pan-right" | "reset" | "zoom-in" | "zoom-out"

/** Plain arrows and Home/End remain reserved for TanStack datum navigation. */
export function resolveChartKeyboardCommand(input: {
  altKey: boolean
  key: string
}): ChartKeyboardCommand | null {
  if (input.key === "0") return "reset"
  if (input.key === "+" || input.key === "=") return "zoom-in"
  if (input.key === "-") return "zoom-out"
  if (input.altKey && input.key === "ArrowLeft") return "pan-left"
  if (input.altKey && input.key === "ArrowRight") return "pan-right"
  return null
}

export function createPointerInspectionController(handlers: {
  clear: () => void
  inspect: (clientX: number, clientY: number) => void
}) {
  return {
    leave: handlers.clear,
    move: handlers.inspect,
  }
}

/** Converts wheel line/page units into the scene-pixel units used by scales. */
export function normalizeWheelDelta(
  input: { deltaMode: number; deltaX: number; deltaY: number },
  page: { height: number; width: number },
  lineSize = 16
) {
  if (input.deltaMode === 1) {
    return {
      x: input.deltaX * lineSize,
      y: input.deltaY * lineSize,
    }
  }
  if (input.deltaMode === 2) {
    return {
      x: input.deltaX * page.width,
      y: input.deltaY * page.height,
    }
  }
  return { x: input.deltaX, y: input.deltaY }
}

/** Chart zoom needs an explicitly active listener so wheel default can be prevented. */
export function installNonPassiveWheelListener(
  target: HTMLElement,
  listener: (event: WheelEvent) => void
) {
  target.addEventListener("wheel", listener, { passive: false })
  return () => target.removeEventListener("wheel", listener)
}

/** Browser zoom and page scrolling remain available until the plot is engaged. */
export function shouldHandleChartWheel(input: {
  armedByPointer: boolean
  ctrlKey: boolean
  focusedWithin: boolean
}) {
  return input.armedByPointer || input.focusedWithin
}
