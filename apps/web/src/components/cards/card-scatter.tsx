"use client"

import { useCallback, useMemo } from "react"
import {
  dot,
  ruleX,
  ruleY,
  text,
  type DomChartDefinition,
} from "@tanstack/charts"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { useFormatter, useExtracted } from "next-intl"
import type {
  WidgetDataFrame,
  WidgetValueType,
  WidgetVisualization,
} from "@avermate/core"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { cn } from "@/lib/utils"
import { CardAccessibleSummary } from "./card-accessible-summary"
import { FOOTNOTE_TEXT } from "./card-figure"
import {
  widgetDisplayValue,
  widgetValuePresentation,
} from "./widget-view-model"

/**
 * One reading against another, with the group as the point.
 *
 * Every other chart in this app plots a reading against *what it is of* — a date, a
 * subject, a band. This plots two readings against each other, which is the only way to
 * ask a question with two answers in it: which subjects are both improving *and* steady,
 * which carry weight *and* have room. Neither axis alone has an answer.
 *
 * The quadrant lines are the **medians**, not the midpoints of the axes and not a round
 * number somebody chose. A midpoint says "above average for this chart's scale", which
 * moves when a single outlier stretches the axis; a median says "in the better half of
 * your own subjects", which is the sentence a reader is actually reading. Four quadrants
 * of roughly equal population, always.
 */

export interface ScatterPoint {
  key: string
  label: string
  x: number
  y: number
}

/** The rows that have both readings, as points. */
export function scatterPoints(
  frame: WidgetDataFrame,
  measures: readonly [string, string]
): ScatterPoint[] {
  const axis = frame.schema.dimensions[0]?.id ?? ""
  return frame.rows.flatMap((row) => {
    const x = row.measures[measures[0]]
    const y = row.measures[measures[1]]
    // A group missing either reading is not a point. Plotting it against zero would put
    // it in a corner it does not belong in, and reading a quadrant chart is reading
    // positions.
    if (typeof x !== "number" || typeof y !== "number") return []
    return [{ key: row.key, label: row.labels[axis] ?? "", x, y }]
  })
}

/**
 * The middle of a set of numbers.
 *
 * Its own function because the quadrant lines are the whole argument of this chart: a
 * median splits the points in half whatever the outliers do, and that property is what
 * makes "top right" mean something.
 */
export function scatterMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number)
}

/** A little air around the points, so none of them sits on the frame. */
function domainOf(values: readonly number[]): [number, number] {
  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const span = highest - lowest
  const padding =
    span > 0 ? span * 0.12 : Math.max(Math.abs(highest) * 0.1, 0.05)
  return [lowest - padding, highest + padding]
}

export function CardScatter({
  frame,
  xMeasure,
  yMeasure,
  xLabel,
  yLabel,
  visualization,
  quadrants,
  showLabels,
  size,
  scale,
  decimals,
  xDifference,
  yDifference,
  ariaLabel,
}: {
  frame: WidgetDataFrame
  /** Column ids of the two readings, in the order the analysis declared them. */
  xMeasure: string
  yMeasure: string
  /** What the two readings are called. */
  xLabel: string
  yLabel: string
  visualization: WidgetVisualization
  quadrants: boolean
  showLabels: boolean
  size: number
  scale: number
  decimals: number
  xDifference: boolean
  yDifference: boolean
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
    () => scatterPoints(frame, measures),
    [frame, measures]
  )
  /** How each axis reads, from the column it plots. */
  const types = useMemo<[WidgetValueType, WidgetValueType]>(
    () => [
      frame.schema.measures.find((item) => item.id === measures[0])
        ?.valueType ?? "ratio",
      frame.schema.measures.find((item) => item.id === measures[1])
        ?.valueType ?? "ratio",
    ],
    [frame.schema.measures, measures]
  )
  const exactValue = useCallback(
    (value: number, valueType: WidgetValueType, difference: boolean) => {
      const presentation = widgetValuePresentation(
        value,
        valueType,
        visualization.format,
        scale,
        decimals
      )
      const number = format.number(presentation.displayed, {
        minimumFractionDigits: presentation.decimals,
        maximumFractionDigits: presentation.decimals,
        notation: presentation.compact ? "compact" : "standard",
        signDisplay: difference ? "exceptZero" : "auto",
      })
      if (difference) return number
      if (presentation.unit === "percent") return `${number}%`
      if (presentation.unit === "days") return `${number} ${t("days")}`
      if (presentation.unit === "ratio") {
        return `${number} / ${format.number(scale)}`
      }
      return number
    },
    [decimals, format, scale, t, visualization.format]
  )
  const exactValues = points.map(
    (point) =>
      `${point.label}: ${labels[0]} ${exactValue(point.x, types[0], xDifference)}, ${labels[1]} ${exactValue(point.y, types[1], yDifference)}`
  )

  const definition = useMemo(() => {
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const middleX = scatterMedian(xs)
    const middleY = scatterMedian(ys)
    /**
     * Each axis in its own units.
     *
     * The two measures need not read the same way — steadiness is a percentage and
     * improvement is a number of points — so one formatter for both axes drew a regularity
     * of 88% as "17.7". The frame carries a value type per column for exactly this.
     */
    const axisFormat =
      (valueType: WidgetValueType, difference: boolean) => (value: number) =>
        format.number(
          widgetDisplayValue(
            value,
            valueType,
            visualization.format.unit,
            scale
          ),
          {
            maximumFractionDigits: valueType === "percent" ? 0 : decimals,
            signDisplay: difference ? "exceptZero" : "auto",
          }
        )
    const formatX = axisFormat(types[0], xDifference)
    const formatY = axisFormat(types[1], yDifference)

    return scatterChart({
      /**
       * Measured, because whether the names fit is a fact about the card's width.
       *
       * Ten subject names on a phone is a thicket; the same ten on a study is the reading.
       * The option asks for labels and the width decides whether they can be had.
       */
      chart: ({ width }: { width: number }) => ({
        marks: [
          ...(quadrants && middleX !== null && middleY !== null
            ? [
                ruleX([{ at: middleX }], {
                  id: "card-scatter-median-x",
                  x: "at",
                  stroke: "var(--border)",
                  strokeDasharray: "4 3",
                }),
                ruleY([{ at: middleY }], {
                  id: "card-scatter-median-y",
                  y: "at",
                  stroke: "var(--border)",
                  strokeDasharray: "4 3",
                }),
              ]
            : []),
          dot(points, {
            id: "card-scatter-points",
            x: "x",
            y: "y",
            key: "key",
            r: Math.max(2, size / 2),
            fill: "var(--chart-1)",
            fillOpacity: 0.85,
            stroke: "var(--background)",
            strokeWidth: 1,
          }),
          ...(showLabels && width >= 280
            ? [
                text(points, {
                  id: "card-scatter-labels",
                  x: "x",
                  y: "y",
                  key: "key",
                  text: (point: ScatterPoint) => point.label,
                  dx: size / 2 + 4,
                  anchor: "start",
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                }),
              ]
            : []),
        ],
        x: {
          scale: scaleLinear().domain(xs.length > 0 ? domainOf(xs) : [0, 1]),
          grid: visualization.axes.x.grid,
          axis: {
            line: false,
            label: visualization.axes.x.label ?? labels[0],
            ticks: { size: 0, padding: 6, format: formatX },
            tickLabels: { fontSize: 10 },
          },
        },
        y: {
          scale: scaleLinear().domain(ys.length > 0 ? domainOf(ys) : [0, 1]),
          grid: visualization.axes.y.grid,
          axis: {
            line: false,
            label: visualization.axes.y.label ?? labels[1],
            ticks: { size: 0, padding: 6, format: formatY },
            tickLabels: { fontSize: 10 },
          },
        },
        clip: true,
      }),
      focus: "nearest",
      focusRing: true,
      keyboard: true,
      tooltip: {
        use: tooltip,
        placement: ["top", "bottom", "left", "right"],
        content: (focused: Array<{ datum?: ScatterPoint }>) => {
          const point = focused[0]?.datum
          if (!point) return { title: "", rows: [] }
          return {
            title: point.label,
            rows: [
              {
                color: "var(--chart-1)",
                label: labels[0],
                value: exactValue(point.x, types[0], xDifference),
              },
              {
                color: "var(--muted-foreground)",
                label: labels[1],
                value: exactValue(point.y, types[1], yDifference),
              },
            ],
          }
        },
      },
    })
  }, [
    decimals,
    exactValue,
    format,
    labels,
    points,
    quadrants,
    scale,
    showLabels,
    size,
    visualization.axes.x.grid,
    visualization.axes.x.label,
    visualization.axes.y.grid,
    visualization.axes.y.label,
    visualization.format.unit,
    types,
    xDifference,
    yDifference,
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
      <div className="min-h-24 flex-1 text-muted-foreground">
        <ResponsiveChart
          ariaLabel={ariaLabel}
          definition={definition}
          fill
          height={200}
          initialWidth={280}
          updateTransition={INSTANT_CHART_UPDATES}
        />
      </div>
      {/* What the lines are. A dashed cross with no explanation is read as a target, and
          it is the opposite: the middle of your own subjects. */}
      {quadrants ? (
        <figcaption className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
          {t("lines at the middle of your own {count} groups", {
            count: String(points.length),
          })}
        </figcaption>
      ) : null}
    </figure>
  )
}

/** Cast for the same reason as `bandChart`: the marks tuple depends on the options. */
function scatterChart(
  definition: unknown
): DomChartDefinition<ScatterPoint, number, number> {
  return definition as DomChartDefinition<ScatterPoint, number, number>
}
