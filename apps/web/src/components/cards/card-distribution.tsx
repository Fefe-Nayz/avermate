"use client"

import { useMemo } from "react"
import { barY, defineChart } from "@tanstack/charts"
import { tooltip } from "@tanstack/charts/tooltip"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { useFormatter, useExtracted } from "next-intl"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"

/**
 * The histogram a card wears.
 *
 * The generic series chart draws a distribution as a full cartesian plot: a
 * y-axis, a grid, and every bucket boundary spelled out. On a card that is a
 * study where a shape was wanted. This is the dashboard's own: bars on the chart
 * accent with a soft radius, an x-axis showing each bucket's *floor* and nothing
 * else, no y-axis at all, and the full range owed to the tooltip rather than to
 * the axis.
 */
export function MiniDistribution({
  ariaLabel,
  buckets,
  scale,
}: {
  ariaLabel: string
  buckets: readonly { from: number; to: number; count: number }[]
  scale: number
}) {
  const t = useExtracted()
  const format = useFormatter()
  const data = useMemo(
    () =>
      buckets.map((bucket) => ({
        label: `${Math.round(bucket.from * scale)}`,
        // The axis shows each bucket's floor; the tooltip owes the full range.
        range: `${format.number(bucket.from * scale, {
          maximumFractionDigits: 0,
        })} – ${format.number(bucket.to * scale, { maximumFractionDigits: 0 })}`,
        count: bucket.count,
      })),
    [buckets, format, scale]
  )
  const maximum = Math.max(1, ...data.map(({ count }) => count))
  const definition = defineChart({
    marks: [
      barY(data, {
        id: "card-distribution",
        x: "label",
        y: "count",
        key: "label",
        fill: "var(--chart-1)",
        radius: 4,
      }),
    ],
    x: {
      scale: scaleBand<string>()
        .domain(data.map(({ label }) => label))
        .padding(0.12),
      grid: false,
      axis: {
        line: false,
        ticks: { size: 0, padding: 6 },
        tickLabels: { fontSize: 10 },
      },
    },
    y: {
      scale: scaleLinear().domain([0, maximum]),
      grid: false,
      axis: false,
    },
    clip: true,
    focus: "nearest",
    keyboard: false,
    tooltip: {
      use: tooltip,
      placement: ["top", "bottom", "left", "right"],
      content: (focused) => {
        const point = focused[0]?.datum
        return {
          title: point?.range,
          rows: point
            ? [
                {
                  color: "var(--chart-1)",
                  label: t("Grades"),
                  value: format.number(point.count),
                },
              ]
            : [],
        }
      },
    },
  })

  return (
    // The histogram is the whole body of its card, so it takes the full
    // height the row resolves to — h-24 is only the floor it insists on.
    <div className="h-full min-h-24 text-muted-foreground">
      <ResponsiveChart
        ariaLabel={ariaLabel}
        definition={definition}
        fill
        height={96}
        initialWidth={220}
        updateTransition={INSTANT_CHART_UPDATES}
      />
    </div>
  )
}
