"use client"

import type { ChartRendererRenderContext, ChartValue } from "@tanstack/charts"
import { motion, type ChartMotionTransition } from "@tanstack/charts/motion"
import {
  RendererChart,
  type RendererChartProps,
} from "@tanstack/charts/react/tooltip"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

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
 *
 * The box is measured *before* the chart mounts, and the chart mounts straight
 * at that size. The order matters for the entrance: the motion renderer
 * animates the first client render, and when the first render happened at
 * `initialWidth` behind the placeholder, the entrance played to an audience of
 * nobody and the visible chart simply popped in after the re-measure.
 *
 * With `fill`, the chart also takes whatever height its box resolves to
 * instead of imposing one: the surface is absolutely positioned so the drawn
 * SVG can never push its own container taller, and `height` becomes the floor
 * drawn while the box is measured. The caller owns the box — typically
 * `min-h-* flex-1`, so the chart absorbs whatever the row has spare.
 */
export function ResponsiveChart<
  TDatum,
  TXValue extends ChartValue = ChartValue,
  TYValue extends ChartValue = ChartValue,
>({
  onRender,
  fill = false,
  entrance = "wipe",
  updateTransition,
  ...props
}: Omit<RendererChartProps<TDatum, TXValue, TYValue>, "renderer"> & {
  fill?: boolean
  /**
   * How the chart makes its entrance. The library cannot: its React host
   * adopts a pre-rendered SVG, and adopted roots skip the initial animation
   * by design. So the reveal is ours — a left-to-right wipe for anything
   * with a time axis, a rise for radial shapes — and it replays on every
   * mount because the class arrives with the first measured render.
   */
  entrance?: "wipe" | "rise" | "none"
  /**
   * Default transition for renderer updates. Gesture-driven charts pass a
   * zero-duration tween so panning and zooming track the pointer with no
   * chase; marks with their own state transitions still animate those.
   */
  updateTransition?: ChartMotionTransition
}) {
  const isClient = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot
  )
  const [hasMeasuredLayout, setHasMeasuredLayout] = useState(false)
  const [box, setBox] = useState<{ width: number; height: number } | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // The motion renderer animates the first client render — marks grow, draw
  // and stagger in — where the plain SVG renderer only animates updates.
  const renderer = useMemo(
    () =>
      motion<TDatum, TXValue, TYValue>({
        initial: true,
        respectReducedMotion: true,
        resize: false,
        transition: updateTransition,
      }),
    [updateTransition]
  )

  useEffect(() => {
    const node = boxRef.current
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      const next = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
      setBox((current) =>
        current &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next.width > 0
            ? next
            : current
      )
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const handleRender = useCallback(
    (context: ChartRendererRenderContext<TDatum, TXValue, TYValue>) => {
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
      ref={boxRef}
      aria-busy={hasMeasuredLayout ? undefined : true}
      className={fill ? "relative h-full" : "relative"}
      data-chart-layout={hasMeasuredLayout ? "measured" : "pending"}
      style={fill ? undefined : { height: props.height }}
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
          (hasMeasuredLayout
            ? "opacity-100" +
              (entrance === "wipe"
                ? " chart-enter-wipe"
                : entrance === "rise"
                  ? " chart-enter-rise"
                  : "")
            : "pointer-events-none opacity-0") +
          (fill ? " absolute inset-0" : "")
        }
        data-chart-surface
      >
        {isClient && box ? (
          <RendererChart
            {...props}
            renderer={renderer}
            width={box.width}
            height={fill ? Math.max(box.height, 1) : props.height}
            onRender={handleRender}
          />
        ) : null}
      </div>
    </div>
  )
}
