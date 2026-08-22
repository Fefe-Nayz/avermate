"use client"

import { useMemo } from "react"
import { dot, ruleX, type DomChartDefinition } from "@tanstack/charts"
import { tooltip } from "@tanstack/charts/tooltip"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { useFormatter, useExtracted } from "next-intl"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { CardAccessibleSummary } from "./card-accessible-summary"

/**
 * Every mark as its own tick along the scale.
 *
 * The drawing a histogram cannot be honest about on few results: five buckets over
 * fourteen marks invents a shape, and the reader takes the tallest bar for a
 * tendency that is two results and a coincidence. A strip shows the fourteen, and
 * answers the question that was actually asked — *where do my marks sit out of
 * twenty* — with no binning decision in between.
 *
 * Two rules, and the second is the one that keeps it a measurement:
 *
 * - The domain is the **whole scale**, always. A strip auto-fitted to its data
 *   would put a term of thirteens and a term of nineteens in visually identical
 *   positions, which is exactly the comparison a strip exists to make possible.
 * - Coincident marks **stack**, they are not jittered. A random offset moves
 *   between renders and turns two elevens into a smear that reads as "about
 *   eleven-ish"; a stack says "two elevens" and says it the same way every time.
 */

/**
 * The config, cast rather than inferred — the same trick, and for the same reason,
 * as `dynamicChart` in `widget-view`: the median rule is present or absent
 * depending on an option, so `defineChart` cannot resolve the marks tuple and
 * spelling its generics out would be a fiction. Every datum and option inside stays
 * typed; the assertion is at this one boundary.
 */
function stripChart(
  definition: unknown
): DomChartDefinition<StripTick, number, number> {
  return definition as DomChartDefinition<StripTick, number, number>
}

/** A tick's place on the strip: its value, and how many marks are under it. */
export interface StripTick {
  key: string
  value: number
  /** 0 for the first mark at this value, 1 for the second, and so on. */
  row: number
}

/**
 * Ticks, stacked where marks coincide.
 *
 * Rounded to the scale's own resolution before stacking, because "coincident" has
 * to mean *the same mark* rather than the same float: 14/20 entered as 14/20 and as
 * 7/10 are the same result and must share a column. The stacking order is the order
 * the marks arrived in, so the drawing is stable under a re-render and under a
 * refetch that returns the same marks.
 */
export function stripTicks(
  values: readonly number[],
  scale: number
): StripTick[] {
  const seen = new Map<number, number>()
  return values.flatMap((value, index) => {
    if (!Number.isFinite(value)) return []
    // Half a point of the year's scale: fine enough that 13.5 and 14 stay apart,
    // coarse enough that two roundings of the same mark meet.
    const step = 1 / (scale * 2)
    const bucket = Math.round(value / step)
    const row = seen.get(bucket) ?? 0
    seen.set(bucket, row + 1)
    return [{ key: `${index}:${value}`, value, row }]
  })
}

export function CardStrip({
  values,
  scale,
  decimals,
  tick,
  showMedian,
  median,
  ariaLabel,
}: {
  /** The marks themselves, as ratios. */
  values: readonly number[]
  /** The year's scale, so the axis reads in the marks the reader writes down. */
  scale: number
  decimals: number
  /** Diameter of one tick, in pixels. */
  tick: number
  showMedian: boolean
  /** The median, as a ratio, drawn through the ticks when asked for. */
  median: number | null
  ariaLabel: string
}) {
  const t = useExtracted()
  const format = useFormatter()
  const exactValues = [
    `${t("Grades")}: ${values
      .map((value) =>
        format.number(value * scale, { maximumFractionDigits: decimals })
      )
      .join(", ")}`,
  ]

  const ticks = useMemo(() => stripTicks(values, scale), [values, scale])

  const definition = useMemo(() => {
    const rows = Math.max(1, ...ticks.map((item) => item.row + 1))
    return stripChart({
      marks: [
        // The median first, so the ticks sit over it rather than under it.
        ...(showMedian && median !== null
          ? [
              ruleX([{ x: median }], {
                id: "card-strip-median",
                x: "x",
                stroke: "var(--muted-foreground)",
                strokeWidth: 1,
                strokeDasharray: "3 3",
              }),
            ]
          : []),
        dot(ticks, {
          id: "card-strip",
          x: "value",
          y: "row",
          key: "key",
          fill: "var(--chart-1)",
          r: tick / 2,
        }),
      ],
      x: {
        // The whole scale, never the data's own range: see the note above.
        scale: scaleLinear().domain([0, 1]),
        grid: false,
        axis: {
          line: false,
          // The format belongs to the ticks, not to the axis: on the axis it was
          // ignored and the strip read "0.0 … 1.0" — ratios, which nobody writes
          // on a paper.
          ticks: {
            size: 0,
            padding: 6,
            format: (value: number) =>
              format.number(value * scale, { maximumFractionDigits: 0 }),
          },
          tickLabels: { fontSize: 10 },
        },
      },
      y: {
        // One row per stack, plus half a row of air so the top tick is not
        // clipped by the plot's own edge.
        scale: scaleLinear().domain([-0.5, rows - 0.5]),
        grid: false,
        axis: false,
      },
      clip: true,
      focus: "nearest",
      focusRing: true,
      keyboard: true,
      tooltip: {
        use: tooltip,
        placement: ["top", "bottom", "left", "right"],
        content: (focused: Array<{ datum?: StripTick }>) => {
          const point = focused[0]?.datum
          return {
            title: point
              ? format.number(point.value * scale, {
                  maximumFractionDigits: decimals,
                })
              : "",
            rows: point
              ? [
                  {
                    color: "var(--chart-1)",
                    label: t("Grades"),
                    // The stack depth *at this value*, which is the count the tick
                    // stands in for.
                    value: format.number(
                      ticks.filter(
                        (item) =>
                          Math.round(item.value * scale * 2) ===
                          Math.round(point.value * scale * 2)
                      ).length
                    ),
                  },
                ]
              : [],
          }
        },
      },
    })
  }, [decimals, format, median, scale, showMedian, t, tick, ticks])

  if (ticks.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("Not enough data yet")}
      </p>
    )
  }

  return (
    // A strip is short by nature — one row of ticks — so it holds the height it
    // needs and lets the rest of the card have the rest.
    <figure className="h-full min-h-14 text-muted-foreground">
      <CardAccessibleSummary items={exactValues} />
      <ResponsiveChart
        ariaLabel={ariaLabel}
        definition={definition}
        fill
        height={56}
        initialWidth={180}
        updateTransition={INSTANT_CHART_UPDATES}
      />
    </figure>
  )
}
