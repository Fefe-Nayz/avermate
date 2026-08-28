"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  type ChartPoint,
  type ChartRendererRenderContext,
  areaY,
  defineChart,
  dot,
  lineY,
} from "@tanstack/charts"
import { d3Curve } from "@tanstack/charts/d3/shape"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { curveMonotoneX } from "d3-shape"
import { useExtracted } from "next-intl"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * The trend line a card wears under its reading.
 *
 * This is the chart the dashboard had before every card was routed through the
 * generic widget renderer, and it is here because that renderer drew the same
 * data as a full cartesian chart: axes, a y-grid, dated ticks — and no reading at
 * all. Correct, and much worse. A card is a glance; a chart is a study.
 *
 * What makes it a sparkline rather than a small chart: no axes and no grid, a
 * gradient that pours to the card's bottom edge, a stroke coloured by which way
 * the period went, and a dot parked on the newest point. And it is draggable —
 * the curve unwrites itself back to the finger and the card's headline reports
 * the value *at* that day, which is the whole reason a trend belongs on a card
 * you can touch.
 */

interface SparklineDatum {
  x: number
  y: number
  value: number
}

const activeDotKey = () => "active"

export function Sparkline({
  points,
  positive,
  onPointFocus,
}: {
  points: Array<{ date: Date; value: number | null }>
  positive: boolean
  onPointFocus?: (value: number | null) => void
}) {
  const t = useExtracted()
  const renderContextRef =
    useRef<ChartRendererRenderContext<SparklineDatum, number, number>>(
      undefined
    )
  const [focusedPointIndex, setFocusedPointIndex] = useState<number | null>(
    null
  )
  const [isInteracting, setIsInteracting] = useState(false)
  const isInteractingRef = useRef(false)
  /** The day the last tick was spent on, so a step fires exactly one. */
  const focusedIndexRef = useRef<number | null>(null)
  const hasDefaultFocusRef = useRef(false)
  // Read through a ref so a parent that re-creates the callback each render
  // cannot re-run anything here.
  const onPointFocusRef = useRef(onPointFocus)
  useEffect(() => {
    onPointFocusRef.current = onPointFocus
  }, [onPointFocus])

  const data = useMemo(
    () =>
      points
        .filter((point) => point.value !== null)
        .map((point) => ({
          x: point.date.getTime(),
          y: point.value as number,
          value: point.value as number,
        })),
    [points]
  )

  const lastPoint = data.at(-1)

  /**
   * Timestamp → position in `data`.
   *
   * Focus reports `datumIndex` relative to whichever mark won the hit test,
   * and the marks here do not share an index space: the dot draws from a
   * one-element array, so it always reports 0. Taken at face value that clips
   * the curve back to the first day, moves the dot there, hands the next hit
   * to the full-length line, and bounces between the two until React gives up
   * with "Maximum update depth exceeded". The x value is the same on every
   * mark, so it is the one identity worth resolving against.
   */
  const indexByX = useMemo(
    () => new Map(data.map((point, index) => [point.x, index])),
    [data]
  )

  /** Parks the reading back on the newest point — the card's resting state. */
  const focusLastPoint = useCallback(() => {
    const context = renderContextRef.current
    const interaction = context?.interaction
    if (!context || !interaction || !lastPoint) return

    const { chart, scales } = context.scene
    const sceneX = scales.x?.map(lastPoint.x)
    const sceneY = scales.y?.map(lastPoint.y)
    if (!Number.isFinite(sceneX) || !Number.isFinite(sceneY)) return

    const rect = context.container.getBoundingClientRect()
    // SAFETY: `Number.isFinite` above rejects both `undefined` (absent scale)
    // and any non-finite mapping, so each is a real number past that guard.
    const resolution = interaction.resolvePointer(
      rect.left + chart.x + (sceneX as number),
      rect.top + chart.y + (sceneY as number)
    )
    if (!resolution) return
    interaction.setControlledFocus(resolution, { source: "programmatic" })
  }, [lastPoint])

  // New series, new story: drop any held reading so the card shows the newest
  // point again rather than a stale index into data that no longer exists.
  // Adjusted during render, not from an effect — a held index against a series
  // that no longer has it must never reach a paint.
  const [lastData, setLastData] = useState(data)
  if (lastData !== data) {
    setLastData(data)
    setFocusedPointIndex(null)
  }

  // The parent is told from an effect, because that is a write to another
  // component and render is not allowed to do it.
  useEffect(() => {
    hasDefaultFocusRef.current = false
    onPointFocusRef.current?.(null)
  }, [data])

  const clippedData = useMemo(() => {
    if (!isInteracting || focusedPointIndex === null) return data
    const end = Math.min(Math.max(focusedPointIndex, 0), data.length - 1)
    return data.slice(0, end + 1)
  }, [data, focusedPointIndex, isInteracting])

  const handleRender = useCallback(
    (context: ChartRendererRenderContext<SparklineDatum, number, number>) => {
      renderContextRef.current = context
      if (hasDefaultFocusRef.current || !lastPoint) return
      hasDefaultFocusRef.current = true
      focusLastPoint()
    },
    [focusLastPoint, lastPoint]
  )

  const handleFocusChange = useCallback(
    (point: ChartPoint<SparklineDatum, number, number> | null) => {
      // Hover is not inspection: only a committed drag moves the reading, so
      // the card does not flicker as the cursor crosses it on its way past.
      if (!isInteractingRef.current || !point) return
      const index = point.datum ? indexByX.get(point.datum.x) : undefined
      if (index === undefined) return
      // One faint tick per day crossed, and only when the day actually
      // changes: the reading snaps between points, so a continuous buzz would
      // describe the finger rather than the data. `selection` is the lightest
      // tone there is, which is what makes a run of them bearable — the firmer
      // one is spent once, on the drag taking hold.
      if (index !== focusedIndexRef.current) {
        focusedIndexRef.current = index
        haptic("selection")
      }
      setFocusedPointIndex((previous) =>
        previous === index ? previous : index
      )
      onPointFocusRef.current?.(data[index]?.value ?? null)
    },
    [data, indexByX]
  )

  const handleInspectingChange = useCallback(
    (inspecting: boolean) => {
      isInteractingRef.current = inspecting
      setIsInteracting(inspecting)
      if (inspecting) {
        // The drag has taken hold: one firmer tick, so the gesture announces
        // itself before the per-day ticks start.
        haptic("light")
        focusedIndexRef.current = null
        return
      }
      focusedIndexRef.current = null
      setFocusedPointIndex(null)
      onPointFocusRef.current?.(null)
      // After the release the marks go back to full length; the focus has to
      // be re-placed against that scene, not the clipped one still on screen.
      requestAnimationFrame(focusLastPoint)
    },
    [focusLastPoint]
  )

  const definition = useMemo(() => {
    if (data.length < 2) return null

    const xValues = data.map(({ x }) => x)
    const yValues = data.map(({ y }) => y)
    const xMinimum = Math.min(...xValues)
    const xMaximum = Math.max(...xValues)
    const yMinimum = Math.min(...yValues)
    const yMaximum = Math.max(...yValues)
    const yPadding = Math.max((yMaximum - yMinimum) * 0.05, 0.01)
    const color = positive ? "var(--positive)" : "var(--negative)"
    return defineChart({
      marks: [
        // Drawn short while a drag is in progress: the curve unwrites itself
        // back to the finger, so the card reads as the value *at* that day.
        areaY(clippedData, {
          id: "card-spark-area",
          x: "x",
          y1: yMinimum - yPadding,
          y2: "y",
          key: "x",
          curve: d3Curve(curveMonotoneX),
          fill: "url(#card-spark-fill)",
        }),
        lineY(clippedData, {
          id: "card-spark-line",
          x: "x",
          y: "y",
          key: "x",
          curve: d3Curve(curveMonotoneX),
          stroke: color,
          strokeWidth: 2,
        }),
        // Invisible twin at full length. Focus resolves against every point in
        // the series, so dragging past the clipped end still finds days the
        // drawn curve is no longer showing.
        lineY(data, {
          id: "card-spark-line-interaction",
          x: "x",
          y: "y",
          key: "x",
          curve: d3Curve(curveMonotoneX),
          stroke: "transparent",
          strokeWidth: 2,
          strokeOpacity: 0,
        }),
        // The story does not end at the card's edge: the moving point keeps
        // the reading visible while the drag walks back through the series.
        dot(clippedData.slice(-1), {
          id: "card-spark-active",
          x: "x",
          y: "y",
          key: activeDotKey,
          r: 4.5,
          fill: color,
          stroke: "transparent",
          strokeWidth: 0,
        }),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain(
            xMinimum === xMaximum
              ? [xMinimum - 1, xMaximum + 1]
              : [xMinimum, xMaximum]
          ),
          grid: false,
          axis: false,
        },
        y: {
          scale: scaleLinear().domain([
            yMinimum - yPadding,
            yMaximum + yPadding,
          ]),
          grid: false,
          axis: false,
        },
      },
      gradients: [
        {
          id: "card-spark-fill",
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 1,
          stops: [
            { offset: 0, color, opacity: 0.28 },
            { offset: 1, color, opacity: 0 },
          ],
        },
      ],
      // Flush left and flush at the base, so the fill can pour to the card's
      // bottom edge; on the right the curve pulls up short — the dot ends it
      // with room to breathe, the way a sentence ends before the margin.
      margin: { top: 4, right: 16, bottom: 0, left: 0 },
      // No clip: the plot's clip rect ends exactly where the last point sits,
      // which halved the dot. The curve cannot overdraw its own domain, so
      // nothing else escapes.
      clip: false,
      focus: "nearest",
      // The built-in ring is a `Canvas`-filled circle sitting under the
      // primary point — white on a light card, and reading as a halo the
      // design never asked for. Off at the source; there is no element left
      // for CSS to chase.
      focusRing: false,
      keyboard: false,
    })
  }, [clippedData, data, positive])

  if (!definition) return null

  return (
    // A floor of h-14, then every pixel the row happens to have spare: the
    // curve is the one part of this card that gets better with more room,
    // and letting it drink the surplus is what keeps a chart card from
    // showing a strip of curve above a field of nothing. It bleeds through
    // the card's padding on three sides — the fill pours to the bottom
    // border — because the curve is scenery, and scenery runs to the edge.
    <div
      className={cn(
        "spark-live -mx-4 mt-2 -mb-4 min-h-14 flex-1",
        isInteracting && "spark-live--active"
      )}
    >
      <ResponsiveChart
        ariaLabel={t("Trend")}
        definition={definition}
        dragInspection
        fill
        height={56}
        initialWidth={180}
        onFocusChange={handleFocusChange}
        onInspectingChange={handleInspectingChange}
        onRender={handleRender}
        updateTransition={INSTANT_CHART_UPDATES}
      />
    </div>
  )
}
