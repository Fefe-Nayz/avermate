"use client"

import type { ChartRenderContext, ChartValue } from "@tanstack/charts"
import { Chart, type ChartProps } from "@tanstack/charts/react/tooltip"
import { useCallback, useState } from "react"

const MEASUREMENT_TOLERANCE = 0.5

/**
 * Keeps TanStack Charts' deterministic server-rendered SVG without exposing
 * its provisional `initialWidth` geometry at a different browser aspect ratio.
 *
 * TanStack's DOM adapter can only discover a fluid container's width after it
 * mounts. Until the adapter confirms that the scene matches the real DOM
 * width, a fixed-height placeholder is shown over the pre-rendered SVG. This
 * avoids a distorted first paint while preserving SSR markup and layout.
 */
export function ResponsiveChart<
  TDatum,
  TXValue extends ChartValue = ChartValue,
  TYValue extends ChartValue = ChartValue,
>({ onRender, ...props }: ChartProps<TDatum, TXValue, TYValue>) {
  const [hasMeasuredLayout, setHasMeasuredLayout] = useState(false)

  const handleRender = useCallback(
    (context: ChartRenderContext<TDatum, TXValue, TYValue>) => {
      onRender?.(context)

      const containerWidth = context.container.getBoundingClientRect().width
      if (
        containerWidth > 0 &&
        Math.abs(context.scene.width - containerWidth) <= MEASUREMENT_TOLERANCE
      ) {
        setHasMeasuredLayout(true)
      }
    },
    [onRender]
  )

  return (
    <div
      aria-busy={hasMeasuredLayout ? undefined : true}
      className="relative"
      data-chart-layout={hasMeasuredLayout ? "measured" : "pending"}
    >
      <div
        aria-hidden="true"
        className={
          hasMeasuredLayout
            ? "pointer-events-none absolute inset-0 opacity-0"
            : "pointer-events-none absolute inset-0 overflow-hidden opacity-100"
        }
        data-chart-placeholder
      >
        <span className="absolute inset-x-0 top-1/4 border-t border-border/30" />
        <span className="absolute inset-x-0 top-1/2 border-t border-border/30" />
        <span className="absolute inset-x-0 top-3/4 border-t border-border/30" />
        <span className="absolute inset-y-0 left-1/3 w-1/3 animate-pulse bg-linear-to-r from-transparent via-muted/15 to-transparent motion-reduce:animate-none" />
      </div>
      <div
        className={
          hasMeasuredLayout ? "opacity-100" : "pointer-events-none opacity-0"
        }
        data-chart-surface
      >
        <Chart {...props} onRender={handleRender} />
      </div>
    </div>
  )
}
