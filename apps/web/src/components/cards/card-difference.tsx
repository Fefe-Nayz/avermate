"use client"

import { useMemo } from "react"
import { areaY, lineY, type DomChartDefinition } from "@tanstack/charts"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { useFormatter, useExtracted } from "next-intl"
import type { WidgetDataFrame, WidgetVisualization } from "@avermate/core"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { cn } from "@/lib/utils"
import { CardAccessibleSummary } from "./card-accessible-summary"
import { FOOTNOTE_TEXT } from "./card-figure"

/**
 * Two readings and the ground between them.
 *
 * The chart the single-measure model could not describe at all: where you are against
 * where you meant to be, this term against the last one, the trend against the result.
 * What the reader is being shown is the *gap*, so the gap is the filled shape and its
 * colour says which reading is on top, rather than leaving the subtraction to the eye.
 *
 * The one piece of real arithmetic is where the lines cross. A fill segmented at the
 * *sample* nearest the crossing puts the change of colour up to a week away from the
 * change of fact — the card would say you were still behind through a bucket in which you
 * pulled ahead. `differenceSegments` interpolates the crossing and splits there.
 */

/** One reading against another at one position on the axis. */
export interface DifferencePoint {
  key: string
  /** Position along the axis, as an index — see the note on the x scale below. */
  step: number
  label: string
  first: number
  second: number
}

export interface DifferenceSegment {
  key: string
  /** Whether the first reading is the higher one through this stretch. */
  sign: "above" | "below"
  points: DifferencePoint[]
}

/**
 * The run split into stretches of one sign, cut at the crossings.
 *
 * Two samples on either side of a crossing produce three points: the two samples and the
 * crossing itself, which belongs to both stretches so the fill closes with no gap and no
 * overlap. A sample where the readings are equal is already a boundary and needs no
 * interpolation.
 *
 * A hole in either reading ends the stretch: a fill drawn across a bucket that has no
 * result claims a gap nobody measured.
 */
export function differenceSegments(
  points: readonly DifferencePoint[]
): DifferenceSegment[] {
  const segments: DifferenceSegment[] = []
  let current: DifferenceSegment | null = null
  // A stretch that opened on a sample sitting exactly on the line has no side yet, and
  // takes the side of the first sample that has one.
  let sided = false

  const open = (sign: "above" | "below", from: DifferencePoint) => {
    const segment: DifferenceSegment = {
      key: segments.length + ":" + from.key,
      sign,
      points: [from],
    }
    segments.push(segment)
    return segment
  }

  for (const point of points) {
    const difference = point.first - point.second
    if (!Number.isFinite(difference)) {
      current = null
      continue
    }
    const sign: "above" | "below" = difference >= 0 ? "above" : "below"

    if (current === null) {
      current = open(sign, point)
      sided = difference !== 0
      continue
    }
    const previous = current.points[current.points.length - 1]
    if (previous === undefined) continue

    // A sample on the line extends whatever stretch it arrives in: it is a boundary, but
    // it is also a real reading, and it belongs to the shape on either side of it.
    if (difference === 0) {
      current.points.push(point)
      continue
    }
    if (!sided) {
      current.points.push(point)
      current.sign = sign
      sided = true
      continue
    }
    if (sign === current.sign) {
      current.points.push(point)
      continue
    }

    // The side changed. If the previous sample sat on the line it *is* the crossing, and
    // interpolating would invent a second point at the same position.
    const before = previous.first - previous.second
    if (before === 0) {
      current = open(sign, previous)
      current.points.push(point)
      continue
    }

    // Otherwise the crossing is between the two samples. Linear in the axis index — which
    // is what the x scale is — so the interpolated position is where the drawn lines
    // actually meet.
    const share = before / (before - difference)
    const crossing: DifferencePoint = {
      key: previous.key + "~" + point.key,
      step: previous.step + share * (point.step - previous.step),
      label: point.label,
      first: previous.first + share * (point.first - previous.first),
      second: previous.second + share * (point.second - previous.second),
    }
    current.points.push(crossing)
    current = open(sign, crossing)
    current.points.push(point)
  }

  return segments
}

/**
 * The two readings a difference card is about, read off the frame.
 *
 * The measure *columns* — the ones with no dot in their id — in the order the analysis
 * declared them: the first is the reading, the second is what it is being held against. A
 * row missing either one is not plotted, for the reason in `differenceSegments`.
 */
export function differencePoints(
  frame: WidgetDataFrame,
  measures: readonly [string, string]
): DifferencePoint[] {
  const axis = frame.schema.dimensions[0]?.id ?? ""
  const points: DifferencePoint[] = []
  frame.rows.forEach((row, index) => {
    const first = row.measures[measures[0]]
    const second = row.measures[measures[1]]
    if (typeof first !== "number" || typeof second !== "number") return
    points.push({
      key: row.key,
      // The row's position in the frame, not in the plotted list: a hole leaves a hole,
      // rather than closing up and moving every later bucket one step to the left.
      step: index,
      label: row.labels[axis] ?? "",
      first,
      second,
    })
  })
  return points
}

export function CardDifference({
  frame,
  xMeasure,
  yMeasure,
  xLabel,
  yLabel,
  visualization,
  showLines,
  opacity,
  scale,
  decimals,
  ariaLabel,
}: {
  frame: WidgetDataFrame
  /** Column ids of the two readings, in the order the analysis declared them. */
  xMeasure: string
  yMeasure: string
  /** What the two readings are called, for the legend and the tooltip. */
  xLabel: string
  yLabel: string
  visualization: WidgetVisualization
  showLines: boolean
  opacity: number
  scale: number
  decimals: number
  ariaLabel: string
}) {
  const t = useExtracted()
  const format = useFormatter()
  /**
   * The pair, rebuilt here rather than passed in.
   *
   * A `[first, second]` prop is a new array on every render of the card body, which
   * defeats every `useMemo` below it — and the body cannot memoise it, because the two
   * ids are read inside a conditional branch where a hook may not go.
   */
  const measures = useMemo<[string, string]>(
    () => [xMeasure, yMeasure],
    [xMeasure, yMeasure]
  )
  const labels = useMemo<[string, string]>(
    () => [xLabel, yLabel],
    [xLabel, yLabel]
  )

  const points = useMemo(
    () => differencePoints(frame, measures),
    [frame, measures]
  )
  const segments = useMemo(() => differenceSegments(points), [points])
  const exactValues = points.map((point) => {
    const mark = (value: number) =>
      format.number(value * scale, { maximumFractionDigits: decimals })
    const gap = point.first - point.second
    return `${point.label}: ${labels[0]} ${mark(point.first)}, ${labels[1]} ${mark(point.second)}, ${t("Gap")} ${gap >= 0 ? "+" : "−"}${mark(Math.abs(gap))}`
  })

  const definition = useMemo(() => {
    const values = points.flatMap((point) => [point.first, point.second])
    const span = Math.max(...values) - Math.min(...values)
    // Room for the fill to be a shape. A gap of two hundredths stretched over a whole card
    // reads as a chasm, so the domain never closes tighter than a fortieth of the scale.
    const padding = Math.max(span * 0.12, 0.025)
    const lowest = visualization.scale.y.zero
      ? 0
      : Math.max(0, Math.min(...values) - padding)
    const highest = Math.min(1, Math.max(...values) + padding)
    const mark = (value: number) =>
      format.number(value * scale, { maximumFractionDigits: decimals })

    return differenceChart({
      marks: [
        // The gap first, so the lines read over it rather than under it.
        ...segments.map((segment) =>
          areaY(segment.points, {
            id: "card-difference-" + segment.key,
            x: "step",
            y1: "first",
            y2: "second",
            key: "key",
            fill:
              segment.sign === "above" ? "var(--chart-2)" : "var(--chart-5)",
            fillOpacity: opacity,
          })
        ),
        ...(showLines
          ? [
              lineY(points, {
                id: "card-difference-first",
                x: "step",
                y: "first",
                key: "key",
                stroke: "var(--chart-1)",
                strokeWidth: 2,
              }),
              lineY(points, {
                id: "card-difference-second",
                x: "step",
                y: "second",
                key: "key",
                stroke: "var(--muted-foreground)",
                strokeWidth: 1.5,
                // Dashed, and the thinner of the two: the second reading is the thing being
                // held against, and drawing it identically makes the pair a two-line chart
                // with no subject.
                strokeDasharray: "4 3",
              }),
            ]
          : []),
      ],
      /**
       * The axis is the row's *position*, not its value.
       *
       * Both a month and a subject become an index, which is what lets one component draw a
       * difference over time and a difference across subjects — and it is also what makes
       * the interpolated crossing above exact rather than approximate.
       */
      scales: {
        x: {
          scale: scaleLinear().domain([0, Math.max(1, frame.rows.length - 1)]),
          grid: false,
          axis: visualization.axes.x.visible
            ? {
                line: false,
                ticks: {
                  size: 0,
                  padding: 6,
                  // Only the samples are labelled: a tick at 2.5 sits between two buckets,
                  // and naming it after either one would be a lie about which.
                  format: (value: number) =>
                    Number.isInteger(value)
                      ? (frame.rows[value]?.labels[
                          frame.schema.dimensions[0]?.id ?? ""
                        ] ?? "")
                      : "",
                },
                tickLabels: { fontSize: 10 },
              }
            : false,
        },
        y: {
          scale: scaleLinear().domain([lowest, highest]),
          grid: visualization.axes.y.grid,
          axis: visualization.axes.y.visible
            ? {
                line: false,
                ticks: { size: 0, padding: 6, format: mark },
                tickLabels: { fontSize: 10 },
              }
            : false,
        },
      },
      clip: true,
      focus: "nearest",
      focusRing: true,
      keyboard: true,
      tooltip: {
        use: tooltip,
        placement: ["top", "bottom", "left", "right"],
        content: (focused: Array<{ datum?: DifferencePoint }>) => {
          const point = focused[0]?.datum
          if (!point) return { title: "", rows: [] }
          const gap = point.first - point.second
          return {
            title: point.label,
            rows: [
              {
                color: "var(--chart-1)",
                label: labels[0],
                value: mark(point.first),
              },
              {
                color: "var(--muted-foreground)",
                label: labels[1],
                value: mark(point.second),
              },
              {
                // The reading the card exists for, said as a number as well as drawn.
                color: gap >= 0 ? "var(--chart-2)" : "var(--chart-5)",
                label: t("Gap"),
                value: (gap >= 0 ? "+" : "−") + mark(Math.abs(gap)),
              },
            ],
          }
        },
      },
    })
  }, [
    decimals,
    format,
    frame.rows,
    frame.schema.dimensions,
    labels,
    opacity,
    points,
    scale,
    segments,
    showLines,
    t,
    visualization.axes.x.visible,
    visualization.axes.y.grid,
    visualization.axes.y.visible,
    visualization.scale.y.zero,
  ])

  if (points.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("Not enough data yet")}
      </p>
    )
  }

  return (
    <figure className="flex h-full min-h-0 flex-col gap-1">
      <CardAccessibleSummary items={exactValues} />
      <div className="min-h-16 flex-1 text-muted-foreground">
        <ResponsiveChart
          ariaLabel={ariaLabel}
          definition={definition}
          fill
          height={140}
          initialWidth={240}
          updateTransition={INSTANT_CHART_UPDATES}
        />
      </div>
      {/* Which line is which. Two readings with no names is a chart the reader has to guess
          at, and the guess is always that the solid one is the important one. */}
      <figcaption
        className={cn(
          FOOTNOTE_TEXT,
          "flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground"
        )}
      >
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-0.5 w-3 shrink-0 rounded-full"
            style={{ background: "var(--chart-1)" }}
          />
          <span className="line-clamp-1">{labels[0]}</span>
        </span>
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-0.5 w-3 shrink-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to right, var(--muted-foreground) 0 4px, transparent 4px 7px)",
            }}
          />
          <span className="line-clamp-1">{labels[1]}</span>
        </span>
      </figcaption>
    </figure>
  )
}

/** Cast for the same reason as `bandChart`: the marks tuple depends on the data. */
function differenceChart(
  definition: unknown
): DomChartDefinition<DifferencePoint, number, number> {
  return definition as DomChartDefinition<DifferencePoint, number, number>
}
