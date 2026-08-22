"use client"

import { useMemo } from "react"
import { areaY, dot, lineY, type DomChartDefinition } from "@tanstack/charts"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { useFormatter, useExtracted } from "next-intl"
import type { ControlBand, IntervalPoint } from "@avermate/core"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { cn } from "@/lib/utils"
import { CardAccessibleSummary } from "./card-accessible-summary"
import { FOOTNOTE_TEXT } from "./card-figure"

/**
 * Where your ordinary results fall, and which ones did not.
 *
 * The reading a list of marks hides: not whether a result is good, but whether it belongs
 * to the same pattern as the others. A fourteen among fourteens and a fourteen among
 * eighteens are the same number and different news.
 *
 * Two things keep it from overclaiming, and both are visible on the card:
 *
 * - The unusual marks are drawn in the **warning** colour rather than the negative one,
 *   and a mark *above* the band gets the same treatment as one below. Outside the band is
 *   not the same as bad, and colouring a high mark red would say it was.
 * - The caption states the width and the sample. "Two deviations over nineteen marks" is
 *   a claim a reader can weigh; an unlabelled band is one they cannot.
 */

export function CardControl({
  result,
  showPoints,
  compact = false,
  scale,
  decimals,
  ariaLabel,
}: {
  result: ControlBand
  showPoints: boolean
  /** Omit the area when the responsive policy resolves this interval to a line. */
  compact?: boolean
  scale: number
  decimals: number
  ariaLabel: string
}) {
  const t = useExtracted()
  const format = useFormatter()

  const unusual = useMemo(() => new Set(result.unusual), [result.unusual])
  const exactValues = result.points.flatMap((point) => {
    if (point.observed === null) return []
    const mark = (value: number) =>
      format.number(value * scale, { maximumFractionDigits: decimals })
    return [
      `${t("Result")} ${point.step + 1}: ${mark(point.observed)}, ${t("Your usual range")} ${mark(point.low)} – ${mark(point.high)}, ${unusual.has(point.key) ? t("Unusual") : t("Usual")}`,
    ]
  })

  const definition = useMemo(() => {
    const points = result.points
    const observed = points.flatMap((point) =>
      point.observed === null ? [] : [point.observed]
    )
    // The band *and* the marks, so a result outside the limits is inside the picture.
    const lowest = Math.max(
      0,
      Math.min(points[0]?.low ?? 0, ...observed) - 0.04
    )
    const highest = Math.min(
      1,
      Math.max(points[0]?.high ?? 1, ...observed) + 0.04
    )
    const mark = (value: number) =>
      format.number(value * scale, { maximumFractionDigits: decimals })

    return controlChart({
      marks: [
        ...(compact
          ? []
          : [
              areaY(points, {
                id: "card-control-band",
                x: "step",
                y1: "low",
                y2: "high",
                key: "key",
                fill: "var(--chart-1)",
                fillOpacity: 0.1,
              }),
            ]),
        // The level, solid; the limits are the edges of the fill and need no lines of
        // their own — two more dashed lines on a small card is furniture.
        lineY(points, {
          id: "card-control-center",
          x: "step",
          y: "center",
          key: "key",
          stroke: "var(--chart-1)",
          strokeWidth: 1.5,
          strokeDasharray: "5 3",
        }),
        ...(showPoints
          ? [
              lineY(
                points.filter((point) => point.observed !== null),
                {
                  id: "card-control-run",
                  x: "step",
                  y: "observed",
                  key: "key",
                  stroke: "var(--muted-foreground)",
                  strokeWidth: 1,
                  strokeOpacity: 0.5,
                }
              ),
              /**
               * Two marks rather than one coloured by a callback.
               *
               * `dot` takes a constant fill — no per-point colour channel — which is the
               * same reason the slope arrow draws its rising and falling shafts
               * separately. Splitting says the same thing without asking the renderer for
               * something it does not offer.
               */
              dot(
                points.filter(
                  (point) => point.observed !== null && !unusual.has(point.key)
                ),
                {
                  id: "card-control-marks",
                  x: "step",
                  y: "observed",
                  key: "key",
                  r: 2.5,
                  fill: "var(--muted-foreground)",
                  stroke: "var(--background)",
                  strokeWidth: 1,
                }
              ),
              // Outside the band is *unusual*, not bad — a mark above the limits gets the
              // same treatment as one below, because that is what the chart knows.
              dot(
                points.filter(
                  (point) => point.observed !== null && unusual.has(point.key)
                ),
                {
                  id: "card-control-unusual",
                  x: "step",
                  y: "observed",
                  key: "key",
                  r: 4,
                  fill: "var(--band-weak)",
                  stroke: "var(--background)",
                  strokeWidth: 1.5,
                }
              ),
            ]
          : []),
      ],
      x: {
        scale: scaleLinear().domain([0, Math.max(1, points.length - 1)]),
        grid: false,
        // No axis: the x position is "which mark", and numbering them adds a scale
        // nobody reads. The order is the reading.
        axis: false,
      },
      y: {
        scale: scaleLinear().domain([lowest, highest]),
        grid: true,
        axis: {
          line: false,
          ticks: { size: 0, padding: 6, format: mark },
          tickLabels: { fontSize: 10 },
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
          if (!point || point.observed === null) return { title: "", rows: [] }
          return {
            title: unusual.has(point.key) ? t("Unusual") : t("Usual"),
            rows: [
              {
                color: "var(--muted-foreground)",
                label: t("Result"),
                value: mark(point.observed),
              },
              {
                color: "var(--chart-1)",
                label: t("Your usual range"),
                value: `${mark(point.low)} – ${mark(point.high)}`,
              },
            ],
          }
        },
      },
    })
  }, [compact, decimals, format, result.points, scale, showPoints, t, unusual])

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
      {/* The width and the sample, said outright — an unlabelled band is a claim a reader
          cannot weigh. And the count of unusual marks, which is the reading. */}
      <figcaption className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
        {result.unusual.length === 0
          ? t(
              "every mark inside {deviations} deviations, over {count} results",
              {
                deviations: String(result.deviations),
                count: String(result.sample),
              }
            )
          : t(
              "{unusual} of {count} marks outside {deviations} deviations of your usual",
              {
                unusual: String(result.unusual.length),
                count: String(result.sample),
                deviations: String(result.deviations),
              }
            )}
      </figcaption>
    </figure>
  )
}

/** Cast for the same reason as `bandChart`: the marks tuple depends on the options. */
function controlChart(
  definition: unknown
): DomChartDefinition<IntervalPoint, number, number> {
  return definition as DomChartDefinition<IntervalPoint, number, number>
}
