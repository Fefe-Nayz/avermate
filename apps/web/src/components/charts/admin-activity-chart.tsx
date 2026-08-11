"use client"

import { areaY, defineChart, lineY } from "@tanstack/charts"
import { d3Curve } from "@tanstack/charts/d3/shape"
import { Chart } from "@tanstack/charts/react/tooltip"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { scalePoint } from "@tanstack/charts/scales/point"
import { tooltip } from "@tanstack/charts/tooltip"
import { curveMonotoneX } from "d3-shape"
import { useMemo } from "react"

export interface AdminActivityDatum {
  count: number
  day: string
}

export function AdminActivityChart({
  ariaLabel,
  countLabel,
  data,
  formatCount,
}: {
  ariaLabel: string
  countLabel: string
  data: readonly AdminActivityDatum[]
  formatCount: (count: number) => string
}) {
  const definition = useMemo(() => {
    const maximum = Math.max(1, ...data.map(({ count }) => count))
    return defineChart({
      marks: [
        areaY(data, {
          id: "admin-activity-area",
          x: "day",
          y1: 0,
          y2: "count",
          key: "day",
          curve: d3Curve(curveMonotoneX),
          fill: "var(--chart-1)",
          fillOpacity: 0.2,
        }),
        lineY(data, {
          id: "admin-activity-line",
          x: "day",
          y: "count",
          key: "day",
          curve: d3Curve(curveMonotoneX),
          stroke: "var(--chart-1)",
          strokeWidth: 2,
        }),
      ],
      x: {
        scale: scalePoint<string>().domain(data.map(({ day }) => day)),
        grid: false,
        axis: {
          line: false,
          ticks: { size: 0, padding: 6 },
          tickLabels: {
            fontSize: 10,
            thin: { minGap: 30, priority: "ends" },
          },
        },
      },
      y: {
        scale: scaleLinear().domain([0, maximum]),
        grid: false,
        axis: false,
      },
      margin: { top: 6, right: 6, bottom: 0, left: 6 },
      clip: true,
      focus: "nearest-x",
      keyboard: true,
      tooltip: {
        use: tooltip,
        anchor: "pointer",
        placement: ["top", "right", "left", "bottom"],
        content: (points) => {
          const point = points[0]?.datum
          return {
            title: point?.day,
            rows: point
              ? [
                  {
                    color: "var(--chart-1)",
                    label: countLabel,
                    value: formatCount(point.count),
                  },
                ]
              : [],
          }
        },
      },
    })
  }, [countLabel, data, formatCount])

  return (
    <div className="h-32 text-muted-foreground">
      <Chart
        ariaLabel={ariaLabel}
        definition={definition}
        height={128}
        initialWidth={420}
      />
    </div>
  )
}
