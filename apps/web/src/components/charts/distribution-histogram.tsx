"use client"

import { barY, defineChart } from "@tanstack/charts"
import { Chart } from "@tanstack/charts/react"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { useMemo } from "react"

export interface DistributionBucketDatum {
  count: number
  good: boolean
  label: string
}

export function DistributionHistogram({
  ariaLabel,
  data,
}: {
  ariaLabel: string
  data: readonly DistributionBucketDatum[]
}) {
  const definition = useMemo(() => {
    const maximum = Math.max(1, ...data.map(({ count }) => count))
    return defineChart({
      marks: [
        barY(data, {
          id: "result-distribution",
          x: "label",
          y: "count",
          key: "label",
          fill: (datum) =>
            datum.good ? "var(--band-good)" : "var(--band-weak)",
          inset: 4,
          radius: 6,
        }),
      ],
      x: {
        scale: scaleBand<string>()
          .domain(data.map(({ label }) => label))
          .padding(0.12),
        grid: false,
        axis: {
          line: false,
          ticks: { size: 0, padding: 8 },
          tickLabels: { fontSize: 11 },
        },
      },
      y: {
        scale: scaleLinear().domain([0, maximum]),
        grid: false,
        axis: false,
      },
      margin: { top: 4, right: 4, bottom: 0, left: 4 },
      clip: true,
      focus: false,
      keyboard: false,
      pointer: false,
      svgAnimation: {
        duration: 220,
        easing: "ease-out",
        respectReducedMotion: true,
        resize: false,
      },
    })
  }, [data])

  return (
    <>
      <div aria-hidden="true" className="h-40 text-muted-foreground">
        <Chart
          ariaLabel={ariaLabel}
          definition={definition}
          height={160}
          initialWidth={420}
        />
      </div>
      <dl aria-label={ariaLabel} className="sr-only">
        {data.map((bucket) => (
          <div key={bucket.label}>
            <dt>{bucket.label}</dt>
            <dd>{bucket.count}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
