"use client"

import type { ChartRenderContext, ChartValue } from "@tanstack/charts"
import { Chart, type ChartProps } from "@tanstack/charts/react/tooltip"
import { useCallback, useState, useSyncExternalStore } from "react"

const MEASUREMENT_TOLERANCE = 0.5
const subscribeToClient = () => () => undefined
const getClientSnapshot = () => true
const getServerSnapshot = () => false

/**
 * Reserves the final chart height during SSR, then mounts TanStack Charts once
 * React owns the browser tree.
 *
 * The 0.11 renderer serialises its scene into `dangerouslySetInnerHTML`; some
 * responsive definitions produce different SVG bytes on the server and during
 * hydration even with the same `initialWidth`. Rendering the interactive
 * surface only after hydration avoids that mismatch. The surrounding route and
 * its chart data remain server-rendered, and the fixed-height placeholder keeps
 * the layout stable while the real container width is measured.
 */
export function ResponsiveChart<
  TDatum,
  TXValue extends ChartValue = ChartValue,
  TYValue extends ChartValue = ChartValue,
>({ onRender, ...props }: ChartProps<TDatum, TXValue, TYValue>) {
  const isClient = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot
  )
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
      style={{ height: props.height }}
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
        {isClient ? <Chart {...props} onRender={handleRender} /> : null}
      </div>
    </div>
  )
}
