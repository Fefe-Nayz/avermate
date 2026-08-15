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
 * The sample values inside the visible window, with a small margin on each
 * side so a segment entering the plot keeps its immediate neighbor framed.
 * Feeding these to the y-domain instead of the whole series is what makes
 * zooming reveal detail: the vertical scale follows what is on screen.
 */
export function viewportValues(
  rows: readonly { timestamp: number; value: number }[],
  viewport: NumericDomain
): number[] {
  const span = Math.abs(viewport[1] - viewport[0])
  const start = Math.min(viewport[0], viewport[1]) - span * 0.05
  const end = Math.max(viewport[0], viewport[1]) + span * 0.05
  return rows
    .filter((row) => row.timestamp >= start && row.timestamp <= end)
    .map((row) => row.value)
}

/** Chart zoom needs an explicitly active listener so wheel can be cancelled. */
export function installNonPassiveWheelListener(
  target: HTMLElement,
  listener: (event: WheelEvent) => void
) {
  target.addEventListener("wheel", listener, { passive: false })
  return () => target.removeEventListener("wheel", listener)
}
