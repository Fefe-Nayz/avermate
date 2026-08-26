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
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  resolveChartDragIntent,
  shouldPinChartInspection,
  type ChartDragIntent,
} from "./time-series-interaction"

const MEASUREMENT_TOLERANCE = 0.5
/** Pointer jitter to absorb before a press is read as a drag. */
const DRAG_THRESHOLD = 8

/**
 * Renderer updates with no duration — what every pointer-driven chart wants.
 *
 * The motion renderer's fallback tween is 1100ms, and it does not only govern
 * the data morph: `applyStateFocus` re-runs the update animation on every
 * focus change, so left at the default the active point spends over a second
 * arriving and over a second leaving while the pointer has long moved on.
 * Zooming and panning pay it too — those re-render every frame, and any tween
 * between frames reads as lag.
 *
 * Marks that declare their own `states` transition keep it; this is the floor
 * under everything else. The entrance is unaffected (that is `initial`, plus
 * the CSS wipe). The trade is that a data refresh snaps in rather than
 * morphing — worth it wherever a pointer is driving the chart.
 */
export const INSTANT_CHART_UPDATES: ChartMotionTransition = {
  type: "tween",
  duration: 0,
}

/**
 * Focus-state transition for a mark the pointer drives.
 *
 * A mark's `states` transition is passed to the renderer as an *override*,
 * applied after everything else — so it wins over INSTANT_CHART_UPDATES, and a
 * chart can be instant on data updates while still crawling on focus.
 *
 * It has to be zero, not merely short. `applyStateFocus` cancels the animation
 * in flight and starts a fresh one on every focus change, so during a drag a
 * 90ms tween is killed at roughly a tenth of its progress, ten times a second:
 * the active point creeps a few percent per event and reads as frozen, then
 * jumps to where the finger has been the moment the moves stop. A slow drag
 * looks fine because it leaves the tween time to run — which is the tell.
 */
export const INSTANT_FOCUS_STATE = {
  type: "tween",
  duration: 0,
  respectReducedMotion: true,
} as const
/** Keeps the clamped pointer off the plot's exact edge, which resolves to nothing. */
const PLOT_EDGE_INSET = 1

/** Client-space pointer, pulled back inside the plot rectangle. */
function clampToPlot<
  TDatum,
  TXValue extends ChartValue,
  TYValue extends ChartValue,
>(
  context: ChartRendererRenderContext<TDatum, TXValue, TYValue>,
  clientX: number,
  clientY: number
): [number, number] {
  const rect = context.container.getBoundingClientRect()
  const { chart } = context.scene
  const left = rect.left + chart.x + PLOT_EDGE_INSET
  const right = rect.left + chart.x + chart.width - PLOT_EDGE_INSET
  const top = rect.top + chart.y + PLOT_EDGE_INSET
  const bottom = rect.top + chart.y + chart.height - PLOT_EDGE_INSET
  return [
    Math.min(Math.max(clientX, left), right),
    Math.min(Math.max(clientY, top), bottom),
  ]
}
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
  dragInspection = false,
  onInspectingChange,
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
  /**
   * Lets a pointer drag inspect the chart, with the pointer captured for the
   * whole gesture so it keeps tracking once the finger or cursor leaves the
   * plot. Touch still yields to vertical page scrolling; a held mouse button
   * has nothing to yield to, so it commits on the first movement in any
   * direction. Intended for compact, non-zoomable charts such as sparklines.
   *
   * Capture is what makes this work at all: driving focus through
   * `setControlledFocus` takes ownership away from the renderer's own pointer
   * tracking, so its `mouseleave` teardown no longer drops the reading when
   * the gesture wanders outside.
   */
  dragInspection?: boolean
  /**
   * Fires when a drag starts and ends. Callers that dress the chart during
   * inspection read it from here rather than tracking a parallel gesture of
   * their own — the events are captured here, so a duplicate listener on an
   * ancestor would miss every move (and every release) outside the box.
   */
  onInspectingChange?: (inspecting: boolean) => void
}) {
  const isClient = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot
  )
  const [hasMeasuredLayout, setHasMeasuredLayout] = useState(false)
  const [box, setBox] = useState<{ width: number; height: number } | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const renderContextRef = useRef<
    ChartRendererRenderContext<TDatum, TXValue, TYValue> | undefined
  >(undefined)
  const touchPointersRef = useRef(new Set<number>())
  const touchGestureRef = useRef<{
    dragged: boolean
    inspecting: boolean
    intent: ChartDragIntent | null
    originX: number
    originY: number
    pointerId: number
    pointerType: string
  } | null>(null)
  const focusFrameRef = useRef<number | undefined>(undefined)
  const inspectingRef = useRef(false)
  // Held in a ref so the captured-pointer handlers never have to be rebuilt
  // mid-gesture just because the caller re-created its callback.
  const onInspectingChangeRef = useRef(onInspectingChange)
  useEffect(() => {
    onInspectingChangeRef.current = onInspectingChange
  }, [onInspectingChange])

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

  useEffect(
    () => () => {
      if (focusFrameRef.current !== undefined) {
        cancelAnimationFrame(focusFrameRef.current)
      }
    },
    []
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
    // The first measurement is immediate — the chart cannot draw without it.
    measure()
    if (typeof ResizeObserver === "undefined") return
    /*
     * Later ones wait for the drag to settle.
     *
     * The renderer only reads its size when it mounts, so a width change has
     * to remount it. Feeding that straight from the observer would remount a
     * canvas chart on every frame of a window drag, which is worse than the
     * stale layout it fixes. A short settle turns a drag into one remount at
     * the end.
     */
    let settle: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      if (settle) clearTimeout(settle)
      settle = setTimeout(measure, 120)
    })
    observer.observe(node)
    return () => {
      if (settle) clearTimeout(settle)
      observer.disconnect()
    }
  }, [])

  const handleRender = useCallback(
    (context: ChartRendererRenderContext<TDatum, TXValue, TYValue>) => {
      renderContextRef.current = context
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

  const pinTouchPointer = useCallback((clientX: number, clientY: number) => {
    if (focusFrameRef.current !== undefined) {
      cancelAnimationFrame(focusFrameRef.current)
    }
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = undefined
      const interaction = renderContextRef.current?.interaction
      const resolution = interaction?.resolvePointer(clientX, clientY)
      interaction?.setControlledFocus(resolution ?? null, {
        pinned: true,
        source: "pointer",
      })
    })
  }, [])

  const setInspecting = useCallback((next: boolean) => {
    if (inspectingRef.current === next) return
    inspectingRef.current = next
    onInspectingChangeRef.current?.(next)
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragInspection) return
      touchPointersRef.current.add(event.pointerId)
      if (touchPointersRef.current.size > 1) {
        touchGestureRef.current = null
        return
      }

      const context = renderContextRef.current
      const position = context?.interaction.clientToScene(
        event.clientX,
        event.clientY
      )
      const chart = context?.scene.chart
      if (
        !context ||
        !position ||
        !chart ||
        position.x < chart.x ||
        position.x > chart.x + chart.width ||
        position.y < chart.y ||
        position.y > chart.y + chart.height
      ) {
        return
      }

      if (focusFrameRef.current !== undefined) {
        cancelAnimationFrame(focusFrameRef.current)
        focusFrameRef.current = undefined
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      touchGestureRef.current = {
        dragged: false,
        inspecting: false,
        intent: null,
        originX: event.clientX,
        originY: event.clientY,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
      }
    },
    [dragInspection]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragInspection) return
      const gesture = touchGestureRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return

      if (!gesture.intent) {
        const deltaX = event.clientX - gesture.originX
        const deltaY = event.clientY - gesture.originY
        // A held mouse button has no page scroll to lose, so any direction
        // past the jitter threshold means "scrub". Touch keeps the axis
        // arbitration, where committing to vertical hands the drag back to
        // the page.
        gesture.intent =
          gesture.pointerType === "mouse"
            ? Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD
              ? null
              : "horizontal"
            : resolveChartDragIntent(deltaX, deltaY, DRAG_THRESHOLD)
        if (!gesture.intent) return
        gesture.dragged = true
      }
      if (gesture.intent === "vertical") return

      gesture.inspecting = true
      setInspecting(true)
      const context = renderContextRef.current
      const interaction = context?.interaction
      if (!interaction) return
      // Resolve against the pointer held inside the plot rather than its real
      // position. A gesture that wanders off the chart keeps reading as the
      // nearest column instead of resolving to nothing and stranding the
      // last value — the drag follows the finger past the edge, and vertical
      // excursion stops mattering once it has left.
      const [clientX, clientY] = clampToPlot(
        context,
        event.clientX,
        event.clientY
      )
      interaction.setControlledFocus(
        interaction.resolvePointer(clientX, clientY),
        { source: "pointer" }
      )
    },
    [dragInspection, setInspecting]
  )

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
      if (!dragInspection) return
      touchPointersRef.current.delete(event.pointerId)
      const gesture = touchGestureRef.current
      const wasTracked = gesture?.pointerId === event.pointerId
      if (wasTracked) touchGestureRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      // Release runs through both `pointerup` and the `lostpointercapture`
      // it causes; only the pass that still owned the gesture reports the end.
      if (wasTracked) setInspecting(false)

      // Tap-to-pin is a touch affordance: it stands in for the hover a finger
      // cannot do. A mouse already hovers, so pinning after a mouse drag would
      // just strand the reading.
      if (
        event.pointerType !== "mouse" &&
        shouldPinChartInspection({
          activePointers: touchPointersRef.current.size,
          cancelled,
          dragged: gesture?.dragged ?? false,
          inspecting: gesture?.inspecting ?? false,
          wasTracked,
        })
      ) {
        pinTouchPointer(event.clientX, event.clientY)
      }
    },
    [dragInspection, pinTouchPointer, setInspecting]
  )

  return (
    <div
      ref={boxRef}
      aria-busy={hasMeasuredLayout ? undefined : true}
      className={
        (fill ? "relative h-full" : "relative") +
        (dragInspection ? " select-none" : "")
      }
      data-chart-layout={hasMeasuredLayout ? "measured" : "pending"}
      onLostPointerCapture={(event) => finishPointer(event, true)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      style={{
        ...(fill ? undefined : { height: props.height }),
        ...(dragInspection ? { touchAction: "pan-y pinch-zoom" } : undefined),
      }}
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
          /*
           * Keyed on the width, because the renderer only sizes its host once.
           *
           * It writes `width: 678px` onto `.ts-chart-host` at mount and never
           * rewrites it: the measurement here does update — observed 678 then
           * 340 — and the new width is handed over, but the scene stays laid
           * out for the old one. Arriving at a narrow window is fine, since
           * the first measurement is already narrow; dragging across a
           * breakpoint left a chart drawn for a width that no longer existed,
           * which is why capping it with `max-width` only squashed it. A new
           * key remounts the renderer so it measures again.
           */
          <RendererChart
            key={box.width}
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
