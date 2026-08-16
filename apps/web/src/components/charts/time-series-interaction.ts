import {
  createPointerInspectionController,
  normalizeWheelDelta,
  panDomainBy,
  pinchDomainFromGesture,
  resolveChartKeyboardCommand,
  resolveNearestProjectedSeriesPoints,
  shouldHandleChartWheel,
  zoomDomainAt,
  type ChartKeyboardCommand,
  type NumericDomain,
} from "@avermate/core/chart-interaction"
import type { ChartFocusStrategy, ChartPoint } from "@tanstack/charts"

export {
  createPointerInspectionController,
  normalizeWheelDelta,
  panDomainBy,
  pinchDomainFromGesture,
  resolveChartKeyboardCommand,
  shouldHandleChartWheel,
  zoomDomainAt,
  type ChartKeyboardCommand,
  type NumericDomain,
}

export type ChartDragIntent = "horizontal" | "vertical"

/**
 * Waits out touch jitter, then commits to one axis for the rest of the drag.
 * Ties favor vertical movement so page scrolling remains the safer default.
 */
export function resolveChartDragIntent(
  deltaX: number,
  deltaY: number,
  threshold = 8
): ChartDragIntent | null {
  if (Math.hypot(deltaX, deltaY) < threshold) return null
  return Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical"
}

/**
 * Pans a linear semantic domain from one fixed pointer-down baseline.
 *
 * Gesture renders are frame-batched, so the renderer scale can briefly lag
 * behind the latest semantic viewport. Deriving every move from pixels and
 * the baseline domain avoids feeding a new domain through that stale scale,
 * which otherwise reads as a tiny rollback during fast touch drags.
 */
export function panLinearDomainByPixels(
  baseline: NumericDomain,
  full: NumericDomain,
  deltaPixels: number,
  plotWidth: number
): NumericDomain {
  if (!Number.isFinite(deltaPixels) || !Number.isFinite(plotWidth) || plotWidth <= 0) {
    return baseline
  }
  const span = baseline[1] - baseline[0]
  const fullStart = Math.min(full[0], full[1])
  const fullEnd = Math.max(full[0], full[1])
  const shift = -(deltaPixels / plotWidth) * span
  let start = baseline[0] + shift
  let end = baseline[1] + shift
  if (start < fullStart) {
    end += fullStart - start
    start = fullStart
  }
  if (end > fullEnd) {
    start -= end - fullEnd
    end = fullEnd
  }
  return [Math.max(fullStart, start), Math.min(fullEnd, end)]
}
export function shouldPinChartInspection({
  activePointers,
  cancelled,
  dragged,
  inspecting,
  wasTracked,
}: {
  activePointers: number
  cancelled: boolean
  dragged: boolean
  inspecting: boolean
  wasTracked: boolean
}): boolean {
  return (
    wasTracked && !cancelled && activePointers === 0 && (!dragged || inspecting)
  )
}

interface NearestSeriesOptions<TDatum> {
  getSeriesId: (datum: TDatum) => string
  getTimestamp?: (datum: TDatum) => number
  isEnabled?: (point: ChartPoint<TDatum, number, number>) => boolean
}

/** TanStack adapter around the renderer-independent projected-point resolver. */
export function resolveNearestSeriesPoints<TDatum>(
  points: readonly ChartPoint<TDatum, number, number>[],
  pointer: { x: number; y: number },
  options: NearestSeriesOptions<TDatum>
): readonly ChartPoint<TDatum, number, number>[] {
  return resolveNearestProjectedSeriesPoints(points, pointer, {
    getSeriesId: (point) => options.getSeriesId(point.datum),
    getTimestamp: options.getTimestamp
      ? (point) => options.getTimestamp?.(point.datum) ?? point.xValue
      : (point) => point.xValue,
    isEnabled: options.isEnabled,
  })
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
        .toSorted((left, right) => {
          const timestamp =
            (options.getTimestamp?.(left.datum) ?? left.xValue) -
            (options.getTimestamp?.(right.datum) ?? right.xValue)
          if (timestamp !== 0) return timestamp
          const series = options
            .getSeriesId(left.datum)
            .localeCompare(options.getSeriesId(right.datum))
          return series !== 0 ? series : left.datumIndex - right.datumIndex
        }),
  }
}

/**
 * The values the y-domain must cover for the visible window: every sample
 * inside it, plus — per series — the nearest sample on each side whenever a
 * segment crosses the window's edge. None of the line styles (linear,
 * monotone, step) ever leaves the range of a segment's two endpoints, so
 * framing those off-screen endpoints guarantees the drawn curve only ever
 * exits through the left and right of the plot, never the top or bottom.
 */
export function viewportValues(
  rows: readonly { timestamp: number; value: number; seriesId?: string }[],
  viewport: NumericDomain
): number[] {
  const start = Math.min(viewport[0], viewport[1])
  const end = Math.max(viewport[0], viewport[1])

  const bySeries = new Map<string, { timestamp: number; value: number }[]>()
  for (const row of rows) {
    const key = row.seriesId ?? ""
    const list = bySeries.get(key)
    if (list) list.push(row)
    else bySeries.set(key, [row])
  }

  const values: number[] = []
  for (const series of bySeries.values()) {
    series.sort((left, right) => left.timestamp - right.timestamp)
    let before: { value: number } | null = null
    let after: { value: number } | null = null
    let inside = false
    for (const point of series) {
      if (point.timestamp < start) before = point
      else if (point.timestamp > end) {
        after ??= point
      } else {
        values.push(point.value)
        inside = true
      }
    }
    if (before && (inside || after)) values.push(before.value)
    if (after && (inside || before)) values.push(after.value)
  }
  return values
}

/** Chart zoom needs an explicitly active listener so wheel can be cancelled. */
export function installNonPassiveWheelListener(
  target: HTMLElement,
  listener: (event: WheelEvent) => void
) {
  target.addEventListener("wheel", listener, { passive: false })
  return () => target.removeEventListener("wheel", listener)
}
