"use client"

import { useMemo } from "react"
import { areaY, dot, lineY, type DomChartDefinition } from "@tanstack/charts"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { useFormatter, useExtracted } from "next-intl"
import type {
  IntervalKind,
  IntervalPoint,
  ProjectionBand,
} from "@avermate/core"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { cn } from "@/lib/utils"
import { CardAccessibleSummary } from "./card-accessible-summary"
import { FOOTNOTE_TEXT } from "./card-figure"

/**
 * Where the average could end up.
 *
 * The chart is the easy half. The hard half is saying what the band *is*, and this
 * component insists on it: the caption names the interval, and for a scenario band it
 * says which scenarios — *if your next results look like your usual quarter* — because
 * a band with no caption is read as a prediction by every reader who ever saw one.
 *
 * The words come from `intervalKind`, which the result carries. A renderer may not
 * promote a scenario band to a confidence interval by captioning it as one.
 */

export function CardBand({
  result,
  opacity,
  showCenter,
  compact = false,
  scale,
  decimals,
  ariaLabel,
}: {
  result: ProjectionBand
  opacity: number
  showCenter: boolean
  /** Draw the interval's centre as its shape-safe narrow line fallback. */
  compact?: boolean
  scale: number
  decimals: number
  ariaLabel: string
}) {
  const t = useExtracted()
  const format = useFormatter()
  const caption = useBandCaption(result)
  const exactValues = result.points.map((point) => {
    const mark = (value: number) =>
      format.number(value * scale, { maximumFractionDigits: decimals })
    const step =
      point.step === 0
        ? t("now")
        : t("after {count} more results", { count: String(point.step) })
    return `${step}: ${t("Usual")} ${mark(point.center)}, ${t("Range")} ${mark(point.low)} – ${mark(point.high)}`
  })

  const definition = useMemo(() => {
    const points = result.points
    const lows = points.map((point) => point.low)
    const highs = points.map((point) => point.high)
    const span = Math.max(...highs) - Math.min(...lows)
    // A little air, and never a domain narrower than a tenth of the scale: a band of
    // two hundredths stretched to fill a card reads as a wild swing.
    const padding = Math.max(span * 0.15, 0.05)
    const lowest = Math.max(0, Math.min(...lows) - padding)
    const highest = Math.min(1, Math.max(...highs) + padding)
    return bandChart({
      marks: [
        ...(compact
          ? []
          : [
              areaY(points, {
                id: "card-band-area",
                x: "step",
                y1: "low",
                y2: "high",
                key: "key",
                fill: "var(--chart-1)",
                fillOpacity: opacity,
              }),
            ]),
        ...(showCenter || compact
          ? [
              lineY(points, {
                id: "card-band-center",
                x: "step",
                y: "center",
                key: "key",
                stroke: "var(--chart-1)",
                strokeWidth: 2,
              }),
            ]
          : []),
        // Today, which is the one point that is not a scenario.
        dot(
          points.filter((point) => point.observed !== null),
          {
            id: "card-band-today",
            x: "step",
            y: "center",
            key: "key",
            r: 3.5,
            fill: "var(--chart-1)",
            stroke: "var(--background)",
            strokeWidth: 2,
          }
        ),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([0, Math.max(1, points.length - 1)]),
          grid: false,
          axis: {
            line: false,
            ticks: {
              size: 0,
              padding: 6,
              // Assessments ahead, not dates: the band is built per further result, and
              // dating them would claim a calendar the estimate does not have.
              format: (value: number) =>
                value === 0 ? t("now") : `+${format.number(value)}`,
            },
            tickLabels: { fontSize: 10 },
          },
        },
        y: {
          scale: scaleLinear().domain([lowest, highest]),
          grid: true,
          axis: {
            line: false,
            ticks: {
              size: 0,
              padding: 6,
              format: (value: number) =>
                format.number(value * scale, { maximumFractionDigits: 0 }),
            },
            tickLabels: { fontSize: 10 },
          },
        },
      },
      clip: true,
      focus: "nearest",
      focusRing: true,
      keyboard: true,
      tooltip: {
        use: tooltip,
        placement: ["top", "bottom", "left", "right"],
        content: (focused: Array<{ datum?: IntervalPoint }>) => {
          const point = focused[0]?.datum
          if (!point) return { title: "", rows: [] }
          const mark = (value: number) =>
            format.number(value * scale, { maximumFractionDigits: decimals })
          return {
            title:
              point.step === 0
                ? t("now")
                : t("after {count} more results", {
                    count: String(point.step),
                  }),
            rows: [
              {
                color: "var(--chart-1)",
                label: t("Usual"),
                value: mark(point.center),
              },
              {
                color: "var(--muted-foreground)",
                label: t("Range"),
                value: `${mark(point.low)} – ${mark(point.high)}`,
              },
            ],
          }
        },
      },
    })
  }, [compact, decimals, format, opacity, result.points, scale, showCenter, t])

  if (result.points.length < 2) {
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
      {/* What the band is. Not decoration: without it the reader supplies their own
          interpretation, and the one they supply is "prediction". */}
      <figcaption className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
        {caption}
      </figcaption>
    </figure>
  )
}

/**
 * The caption, from the kind of interval the result says it is.
 *
 * A hook rather than a helper taking `t`: extraction reads `t("…")` calls in whatever
 * function called `useExtracted`, so a caption assembled elsewhere would be left out
 * of the catalogues and shipped untranslated.
 *
 * Exhaustive over `IntervalKind` on purpose — a kind added without a sentence here
 * stops compiling rather than being drawn unlabelled, which is the whole point of
 * separating the four.
 */
function useBandCaption(result: ProjectionBand): string {
  const t = useExtracted()
  const percent = (value: number) => String(Math.round(value * 100))
  const kind: IntervalKind = result.intervalKind
  switch (kind) {
    case "scenario":
      return t(
        "if your next results look like your usual ones — from your bottom {low}% to your top {high}%, over {count} marks",
        {
          low: percent(result.quantiles.low),
          high: percent(1 - result.quantiles.high),
          count: String(result.sample),
        }
      )
    case "range":
      return t("the widest and narrowest this could end up")
    case "confidence":
      return t("uncertainty about the fitted trend")
    case "prediction":
      return t("where a further result is expected to land")
    case "control":
      /**
       * Unreachable, and kept because the switch is the guard.
       *
       * A control band is drawn by `CardControl`, which states its own width and sample —
       * this renderer is about where an average could *go*. The case exists because the
       * exhaustive switch is what stops a new kind of band being drawn with somebody
       * else's caption, and deleting it to save a line would remove that.
       */
      return t("where your ordinary results fall")
  }
}

/**
 * The config, cast rather than inferred — the same trick, and for the same reason, as
 * `dynamicChart` in `widget-view`: the centre line is present or absent depending on an
 * option, so the marks tuple cannot be resolved statically.
 */
function bandChart(
  definition: unknown
): DomChartDefinition<IntervalPoint, number, number> {
  return definition as DomChartDefinition<IntervalPoint, number, number>
}
