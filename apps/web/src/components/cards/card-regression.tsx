"use client"

import { useMemo } from "react"
import { areaY, dot, lineY, type DomChartDefinition } from "@tanstack/charts"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { useFormatter, useExtracted } from "next-intl"
import {
  linearFit,
  regressionInterval,
  type LinearFit,
  type WidgetSeriesDatum,
  type WidgetVisualization,
} from "@avermate/core"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { cn } from "@/lib/utils"
import { CardAccessibleSummary } from "./card-accessible-summary"
import { FOOTNOTE_TEXT } from "./card-figure"

/**
 * The results, the line through them, and how much of them it explains.
 *
 * The card a trend arrow cannot be. An arrow says "up"; this says up how fast, over what,
 * and — in the sentence under the chart — how closely the results actually follow the
 * line. That last part is what keeps the first two honest, so it is on by default and the
 * band is drawn by default with it.
 *
 * Two decisions worth stating:
 *
 * - **The x axis is the reading's own position on the axis**, not its index in the list. A
 *   month with no results is a gap on a time axis, and fitting to indices would quietly
 *   close it — the slope would come out steeper because the drought had been deleted.
 * - **The line stops where the results stop.** Extending it is the one thing the band's
 *   shape argues against: it flares at the ends precisely because the tilt is what the fit
 *   is least sure of, so continuing past the last result is a claim, not a reading.
 */

export interface RegressionRow {
  key: string
  x: number
  label: string
  value: number
}

/**
 * The plotted rows, positioned on the axis they will be drawn against.
 *
 * A time axis positions by timestamp; anything else falls back to the row's place in the
 * frame, which is the only distance a category has.
 */
export function regressionRows(
  rows: readonly WidgetSeriesDatum[]
): RegressionRow[] {
  const temporal = rows.some((row) => row.date !== null)
  const out: RegressionRow[] = []
  rows.forEach((row, index) => {
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) return
    const x = temporal ? (row.date?.getTime() ?? Number.NaN) : index
    if (!Number.isFinite(x)) return
    out.push({ key: row.key, x, label: row.label, value: row.value })
  })
  return out
}

/**
 * The slope, restated per day.
 *
 * A slope over milliseconds is a number with eleven zeroes after the point, and nobody
 * reads it. Time axes are converted to a rate a person can hold: per day, then scaled to
 * the unit the caller asks for.
 */
export function slopePerDay(fit: LinearFit, temporal: boolean): number {
  return temporal ? fit.slope * 86_400_000 : fit.slope
}

export function CardRegression({
  rows,
  visualization,
  showBand,
  showPoints,
  showReading,
  scale,
  decimals,
  ariaLabel,
}: {
  rows: readonly WidgetSeriesDatum[]
  visualization: WidgetVisualization
  showBand: boolean
  showPoints: boolean
  showReading: boolean
  scale: number
  decimals: number
  ariaLabel: string
}) {
  const t = useExtracted()
  const format = useFormatter()

  const points = useMemo(() => regressionRows(rows), [rows])
  const temporal = useMemo(() => rows.some((row) => row.date !== null), [rows])
  const fit = useMemo(
    () => linearFit(points.map((point) => ({ x: point.x, y: point.value }))),
    [points]
  )
  const exactValues = points.map((point) => {
    const mark = (value: number) =>
      format.number(value * scale, { maximumFractionDigits: decimals })
    const fitted = fit === null ? null : fit.intercept + fit.slope * point.x
    return `${point.label}: ${t("Result")} ${mark(point.value)}${fitted === null ? "" : `, ${t("Trend")} ${mark(fitted)}`}`
  })

  const band = useMemo(() => {
    if (fit === null || !showBand) return null
    // Sampled along the run rather than at the results: the band is a curve — a hyperbola
    // — and drawing it through five observations would render it as five straight pieces
    // with corners where the results happen to fall.
    const first = points[0]?.x ?? 0
    const last = points[points.length - 1]?.x ?? 0
    const steps = 24
    const xs = Array.from(
      { length: steps + 1 },
      (_, index) => first + ((last - first) * index) / steps
    )
    const interval = regressionInterval(fit, xs)
    return interval?.map((entry, index) => ({ ...entry, key: String(index) }))
  }, [fit, points, showBand])

  const line = useMemo(() => {
    if (fit === null) return []
    const first = points[0]
    const last = points[points.length - 1]
    if (!first || !last) return []
    // Two points: the fit is straight, so anything more is the same line drawn in pieces.
    return [first, last].map((point) => ({
      key: "fit:" + point.key,
      x: point.x,
      value: fit.intercept + fit.slope * point.x,
    }))
  }, [fit, points])

  const definition = useMemo(() => {
    const spread = [
      ...points.map((point) => point.value),
      ...(band?.flatMap((entry) => [entry.low, entry.high]) ?? []),
    ]
    const span = Math.max(...spread) - Math.min(...spread)
    const padding = Math.max(span * 0.12, 0.02)
    const lowest = visualization.scale.y.zero
      ? 0
      : Math.max(0, Math.min(...spread) - padding)
    const highest = Math.min(1, Math.max(...spread) + padding)
    const mark = (value: number) =>
      format.number(value * scale, { maximumFractionDigits: decimals })

    return regressionChart({
      marks: [
        ...(band
          ? [
              areaY(band, {
                id: "card-regression-band",
                x: "x",
                y1: "low",
                y2: "high",
                key: "key",
                fill: "var(--chart-1)",
                fillOpacity: 0.14,
              }),
            ]
          : []),
        lineY(line, {
          id: "card-regression-line",
          x: "x",
          y: "value",
          key: "key",
          stroke: "var(--chart-1)",
          strokeWidth: 2,
        }),
        ...(showPoints
          ? [
              dot(points, {
                id: "card-regression-points",
                x: "x",
                y: "value",
                key: "key",
                r: 3,
                // The results themselves, in the muted colour: the line is the claim and
                // these are the evidence, and colouring them identically makes the fit look
                // like data.
                fill: "var(--muted-foreground)",
                fillOpacity: 0.7,
              }),
            ]
          : []),
      ],
      x: {
        scale: scaleLinear().domain([
          points[0]?.x ?? 0,
          points[points.length - 1]?.x ?? 1,
        ]),
        grid: false,
        axis: visualization.axes.x.visible
          ? {
              line: false,
              ticks: {
                size: 0,
                padding: 6,
                format: (value: number) =>
                  temporal
                    ? format.dateTime(new Date(value), {
                        day: "numeric",
                        month: "short",
                      })
                    : (points[Math.round(value)]?.label ?? ""),
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
      clip: true,
      focus: "nearest",
      focusRing: true,
      keyboard: true,
      tooltip: {
        use: tooltip,
        placement: ["top", "bottom", "left", "right"],
        content: (focused: Array<{ datum?: RegressionRow }>) => {
          const point = focused[0]?.datum
          if (!point) return { title: "", rows: [] }
          return {
            title: point.label,
            rows: [
              {
                color: "var(--muted-foreground)",
                label: t("Result"),
                value: mark(point.value),
              },
              ...(fit
                ? [
                    {
                      color: "var(--chart-1)",
                      label: t("Trend"),
                      value: mark(fit.intercept + fit.slope * point.x),
                    },
                  ]
                : []),
            ],
          }
        },
      },
    })
  }, [
    band,
    decimals,
    fit,
    format,
    line,
    points,
    scale,
    showPoints,
    t,
    temporal,
    visualization.axes.x.visible,
    visualization.axes.y.grid,
    visualization.axes.y.visible,
    visualization.scale.y.zero,
  ])

  const reading = useRegressionReading(fit, temporal, scale, decimals)

  if (fit === null) {
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
      {showReading ? (
        <figcaption className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
          {reading}
        </figcaption>
      ) : null}
    </figure>
  )
}

/**
 * The slope and the fit quality, in words.
 *
 * A hook rather than a helper taking `t`, for the reason `useBandCaption` is one:
 * extraction only sees `t("…")` inside a function that called `useExtracted`, so a sentence
 * assembled elsewhere ships untranslated.
 *
 * The quality is stated as the share of the variation the line explains rather than as
 * "R² = 0.68", because the first is what the second means and this card is read by someone
 * looking at their own marks. Where the fit withholds it — under three results — the
 * sentence says the sample instead of quietly dropping the clause: a slope with no quality
 * beside it reads as a well-established one.
 */
function useRegressionReading(
  fit: LinearFit | null,
  temporal: boolean,
  scale: number,
  decimals: number
): string {
  const t = useExtracted()
  const format = useFormatter()
  if (fit === null) return ""

  const perDay = slopePerDay(fit, temporal) * scale
  const rate = temporal
    ? t("{amount} a month", {
        // A month, not a day: a tenth of a point a day is four points a term, and the daily
        // figure rounds to zero at the decimals a mark is written with.
        amount: format.number(perDay * 30, {
          maximumFractionDigits: Math.max(1, decimals),
          signDisplay: "exceptZero",
        }),
      })
    : t("{amount} per step", {
        amount: format.number(perDay, {
          maximumFractionDigits: Math.max(1, decimals),
          signDisplay: "exceptZero",
        }),
      })

  return fit.r2 === null
    ? t("{rate} — too few results to say how closely they follow it", { rate })
    : t("{rate} — explains {share}% of the variation over {count} results", {
        rate,
        share: String(Math.round(fit.r2 * 100)),
        count: String(fit.sample),
      })
}

/** Cast for the same reason as `bandChart`: the marks tuple depends on the options. */
function regressionChart(
  definition: unknown
): DomChartDefinition<RegressionRow, number, number> {
  return definition as DomChartDefinition<RegressionRow, number, number>
}
