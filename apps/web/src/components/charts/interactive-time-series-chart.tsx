"use client"

import type {
  ChartRendererRenderContext,
  DomChartDefinition,
  ResolvedScale,
} from "@tanstack/charts"
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip"
import { RotateCcw } from "lucide-react"
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  installNonPassiveWheelListener,
  type NumericDomain,
  normalizeWheelDelta,
  panDomainBy,
  panLinearDomainByPixels,
  pinchDomainFromGesture,
  resolveChartDragIntent,
  resolveChartKeyboardCommand,
  shouldHandleChartWheel,
  shouldPinChartInspection,
  type ChartDragIntent,
  zoomDomainAt,
} from "./time-series-interaction"
import { INSTANT_CHART_UPDATES, ResponsiveChart } from "./responsive-chart"

interface InteractiveTimeSeriesChartProps<TDatum> {
  ariaDescription?: string
  ariaLabel: string
  buildDefinition: (
    viewport: NumericDomain
  ) => DomChartDefinition<TDatum, number, number>
  className?: string
  domain: NumericDomain
  formatDomain?: (domain: NumericDomain) => string
  height: number
  initialWidth?: number
  interactionHint: string
  maximumZoom?: number
  /** The chart reports every viewport move, including gestures and resets. */
  onViewportChange?: (viewport: NumericDomain) => void
  renderTooltipBody?: (
    context: ChartTooltipBodyRenderContext<TDatum, number, number>
  ) => ReactNode
  resetLabel: string
  style?: CSSProperties
  /**
   * An imperative jump (zoom presets): applied once whenever the stamp
   * changes, then gestures take over again.
   */
  viewportRequest?: { domain: NumericDomain; stamp: number } | null
}

interface PointerPosition {
  clientX: number
  clientY: number
  sceneX: number
  sceneY: number
}

interface PanBaseline {
  domain: NumericDomain
  sceneX: number
  width: number
}
interface PinchBaseline {
  distance: number
  domain: NumericDomain
  midpoint: number
  pointerIds: readonly [number, number]
  scale: Pick<ResolvedScale, "invert" | "map">
}

function sameDomain(left: NumericDomain, right: NumericDomain) {
  const extent = Math.max(Math.abs(right[1] - right[0]), 1)
  const tolerance = extent * 1e-9
  return (
    Math.abs(left[0] - right[0]) <= tolerance &&
    Math.abs(left[1] - right[1]) <= tolerance
  )
}

function isInsidePlot<TDatum>(
  context: ChartRendererRenderContext<TDatum, number, number>,
  position: { x: number; y: number }
) {
  const { chart } = context.scene
  return (
    position.x >= chart.x &&
    position.x <= chart.x + chart.width &&
    position.y >= chart.y &&
    position.y <= chart.y + chart.height
  )
}

/** Owns inspection and semantic-domain gestures around a native chart. */
export function InteractiveTimeSeriesChart<TDatum>(
  props: InteractiveTimeSeriesChartProps<TDatum>
) {
  return (
    <InteractiveTimeSeriesChartInner
      key={`${props.domain[0]}:${props.domain[1]}`}
      {...props}
    />
  )
}

function InteractiveTimeSeriesChartInner<TDatum>({
  ariaDescription,
  ariaLabel,
  buildDefinition,
  className,
  domain,
  formatDomain,
  height,
  initialWidth = 640,
  interactionHint,
  maximumZoom = 64,
  onViewportChange,
  renderTooltipBody,
  resetLabel,
  style,
  viewportRequest,
}: InteractiveTimeSeriesChartProps<TDatum>) {
  const [viewport, setViewport] = useState<NumericDomain>(domain)
  const viewportRef = useRef(viewport)
  const renderContextRef = useRef<
    ChartRendererRenderContext<TDatum, number, number> | undefined
  >(undefined)
  const gestureHostRef = useRef<HTMLDivElement>(null)
  const pointersRef = useRef(new Map<number, PointerPosition>())
  const pinchBaselineRef = useRef<PinchBaseline | null>(null)
  const panBaselineRef = useRef<PanBaseline | null>(null)
  const wheelArmedRef = useRef(false)
  const draggedRef = useRef(false)
  const dragOriginRef = useRef<PointerPosition | null>(null)
  const dragIntentRef = useRef<ChartDragIntent | null>(null)
  const inspectingRef = useRef(false)
  const focusFrameRef = useRef<number | undefined>(undefined)
  const frameRef = useRef<number | undefined>(undefined)
  const pendingViewportRef = useRef<NumericDomain | undefined>(undefined)
  const onViewportChangeRef = useRef(onViewportChange)

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])

  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  // The outer component remounts this implementation only when the domain's
  // values change, so all viewport and gesture state resets atomically.
  const domainStart = domain[0]
  const domainEnd = domain[1]
  useEffect(() => {
    onViewportChangeRef.current?.([domainStart, domainEnd])
  }, [domainStart, domainEnd])

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
      if (focusFrameRef.current !== undefined) {
        cancelAnimationFrame(focusFrameRef.current)
      }
    },
    []
  )

  const commitViewport = useCallback((next: NumericDomain) => {
    viewportRef.current = next
    pendingViewportRef.current = next
    onViewportChangeRef.current?.(next)
    if (frameRef.current !== undefined) return

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined
      const pending = pendingViewportRef.current
      pendingViewportRef.current = undefined
      if (pending) setViewport(pending)
    })
  }, [])

  // Preset jumps arrive from outside; each stamp applies exactly once so a
  // later gesture is never fought by a stale request replaying.
  const appliedRequestRef = useRef<number | null>(null)
  useEffect(() => {
    if (!viewportRequest) return
    if (appliedRequestRef.current === viewportRequest.stamp) return
    appliedRequestRef.current = viewportRequest.stamp
    renderContextRef.current?.interaction.setControlledFocus(null)
    commitViewport(viewportRequest.domain)
  }, [commitViewport, viewportRequest])

  const reset = useCallback(() => {
    renderContextRef.current?.interaction.setControlledFocus(null)
    commitViewport(domain)
  }, [commitViewport, domain])

  const definition = useMemo(
    () => buildDefinition(viewport),
    [buildDefinition, viewport]
  )

  const resolvePosition = useCallback(
    (clientX: number, clientY: number, requireInsidePlot = true) => {
      const context = renderContextRef.current
      const scenePosition = context?.interaction.clientToScene(clientX, clientY)
      if (
        !context ||
        !scenePosition ||
        (requireInsidePlot && !isInsidePlot(context, scenePosition))
      ) {
        return null
      }

      return {
        clientX,
        clientY,
        sceneX: scenePosition.x,
        sceneY: scenePosition.y,
      }
    },
    []
  )

  const inspect = useCallback((clientX: number, clientY: number) => {
    const context = renderContextRef.current
    const scenePosition = context?.interaction.clientToScene(clientX, clientY)
    if (!context || !scenePosition || !isInsidePlot(context, scenePosition)) {
      context?.interaction.setControlledFocus(null)
      return
    }

    context.interaction.setControlledFocus(
      context.interaction.resolvePointer(clientX, clientY),
      { source: "pointer" }
    )
  }, [])

  const clearInspection = useCallback(() => {
    renderContextRef.current?.interaction.setControlledFocus(null)
  }, [])

  // TanStack also receives the synthesized mobile click after pointerup. Pin
  // one frame later so our deliberate tap/drag result is the final focus.
  const pinPointer = useCallback((clientX: number, clientY: number) => {
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

  const startPinch = useCallback(() => {
    const scale = renderContextRef.current?.scene.scales.x
    const entries = [...pointersRef.current.entries()]
    pinchBaselineRef.current = null
    panBaselineRef.current = null
    if (!scale || entries.length < 2) {
      return
    }

    const [[firstId, first], [secondId, second]] = entries
    const distance = Math.hypot(
      first.sceneX - second.sceneX,
      first.sceneY - second.sceneY
    )
    if (distance <= 0) return

    pinchBaselineRef.current = {
      distance,
      domain: viewportRef.current,
      midpoint: (first.sceneX + second.sceneX) / 2,
      pointerIds: [firstId, secondId],
      scale,
    }
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return
      const position = resolvePosition(event.clientX, event.clientY)
      if (!position) return

      if (focusFrameRef.current !== undefined) {
        cancelAnimationFrame(focusFrameRef.current)
        focusFrameRef.current = undefined
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      wheelArmedRef.current = true
      pointersRef.current.set(event.pointerId, position)
      if (pointersRef.current.size === 1) {
        const chart = renderContextRef.current?.scene.chart
        dragOriginRef.current = position
        dragIntentRef.current =
          event.pointerType === "mouse" ? "horizontal" : null
        panBaselineRef.current = chart
          ? {
              domain: viewportRef.current,
              sceneX: position.sceneX,
              width: chart.width,
            }
          : null
        inspectingRef.current = false
        draggedRef.current = false
      } else {
        dragIntentRef.current = "horizontal"
        panBaselineRef.current = null
        inspectingRef.current = false
        draggedRef.current = true
        if (pointersRef.current.size === 2) startPinch()
      }
    },
    [resolvePosition, startPinch]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const context = renderContextRef.current
      const previous = pointersRef.current.get(event.pointerId)
      if (!context || !previous) {
        if (event.pointerType === "mouse") {
          inspect(event.clientX, event.clientY)
        }
        return
      }

      // Pointer capture keeps an accepted horizontal gesture continuous when
      // it crosses the plot edge. `touch-action: pan-y` still lets the browser
      // cancel us and own a vertical page scroll.
      const current = resolvePosition(event.clientX, event.clientY, false)
      if (!current) return
      const origin = dragOriginRef.current
      const scale = context.scene.scales.x
      if (!scale) return
      pointersRef.current.set(event.pointerId, current)
      const pointers = [...pointersRef.current.values()]

      if (pointers.length >= 2) {
        draggedRef.current = true
        dragIntentRef.current = "horizontal"
        inspectingRef.current = false
        context.interaction.setControlledFocus(null)
        const baseline = pinchBaselineRef.current
        if (!baseline) {
          startPinch()
          return
        }
        const first = pointersRef.current.get(baseline.pointerIds[0])
        const second = pointersRef.current.get(baseline.pointerIds[1])
        if (first && second) {
          const currentDistance = Math.hypot(
            first.sceneX - second.sceneX,
            first.sceneY - second.sceneY
          )
          const currentMidpoint = (first.sceneX + second.sceneX) / 2
          commitViewport(
            pinchDomainFromGesture(
              baseline.scale,
              baseline.domain,
              domain,
              baseline.midpoint,
              currentMidpoint,
              currentDistance / baseline.distance,
              maximumZoom
            )
          )
        }
        return
      }

      if (!origin) return
      if (event.pointerType !== "mouse") {
        let intent = dragIntentRef.current
        if (!intent) {
          intent = resolveChartDragIntent(
            event.clientX - origin.clientX,
            event.clientY - origin.clientY
          )
          if (!intent) return
          dragIntentRef.current = intent
        }
        draggedRef.current = true
        if (intent === "vertical") {
          inspectingRef.current = false
          return
        }
      } else if (
        Math.hypot(
          event.clientX - origin.clientX,
          event.clientY - origin.clientY
        ) > 4
      ) {
        draggedRef.current = true
      }

      // At the full-domain view there is nowhere to pan. A horizontal drag is
      // therefore useful inspection instead, keeping the tooltip under a
      // finger just as hover does under a mouse.
      if (sameDomain(viewportRef.current, domain)) {
        inspectingRef.current = true
        inspect(event.clientX, event.clientY)
        return
      }

      inspectingRef.current = false
      context.interaction.setControlledFocus(null)
      const baseline = panBaselineRef.current
      if (!baseline) return
      const delta = current.sceneX - baseline.sceneX
      if (delta !== 0) {
        commitViewport(
          panLinearDomainByPixels(
            baseline.domain,
            domain,
            delta,
            baseline.width
          )
        )
      }
    },
    [commitViewport, domain, inspect, maximumZoom, resolvePosition, startPinch]
  )

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
      const wasTracked = pointersRef.current.delete(event.pointerId)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      if (
        shouldPinChartInspection({
          activePointers: pointersRef.current.size,
          cancelled,
          dragged: draggedRef.current,
          inspecting: inspectingRef.current,
          wasTracked,
        })
      ) {
        pinPointer(event.clientX, event.clientY)
      }

      if (pointersRef.current.size === 0) {
        pinchBaselineRef.current = null
        panBaselineRef.current = null
        dragOriginRef.current = null
        dragIntentRef.current = null
        inspectingRef.current = false
        draggedRef.current = false
      } else if (pointersRef.current.size >= 2) {
        panBaselineRef.current = null
        dragIntentRef.current = "horizontal"
        startPinch()
      } else {
        // Continue smoothly as a one-finger pan after one finger leaves a
        // pinch. Start from the latest semantic domain, not the renderer's
        // possibly one-frame-old scale.
        const remaining = [...pointersRef.current.values()][0] ?? null
        const chart = renderContextRef.current?.scene.chart
        pinchBaselineRef.current = null
        dragOriginRef.current = remaining
        dragIntentRef.current = "horizontal"
        panBaselineRef.current =
          remaining && chart
            ? {
                domain: viewportRef.current,
                sceneX: remaining.sceneX,
                width: chart.width,
              }
            : null
      }
    },
    [pinPointer, startPinch]
  )

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (
        event
          .composedPath()
          .some(
            (entry) =>
              entry instanceof HTMLElement &&
              entry.hasAttribute("data-chart-interaction-island")
          )
      ) {
        return
      }

      const context = renderContextRef.current
      const host = gestureHostRef.current
      const focusedWithin = Boolean(
        host && document.activeElement && host.contains(document.activeElement)
      )
      if (
        !shouldHandleChartWheel({
          armedByPointer: wheelArmedRef.current,
          ctrlKey: event.ctrlKey,
          focusedWithin,
        })
      ) {
        return
      }

      const position = context?.interaction.clientToScene(
        event.clientX,
        event.clientY
      )
      const scale = context?.scene.scales.x
      if (!context || !position || !scale || !isInsidePlot(context, position)) {
        return
      }

      event.preventDefault()
      context.interaction.setControlledFocus(null)
      const delta = normalizeWheelDelta(event, {
        height: context.scene.chart.height,
        width: context.scene.chart.width,
      })
      if (!event.ctrlKey && Math.abs(delta.x) > Math.abs(delta.y)) {
        commitViewport(
          panDomainBy(scale, viewportRef.current, domain, -delta.x, maximumZoom)
        )
        return
      }

      commitViewport(
        zoomDomainAt(
          scale,
          viewportRef.current,
          domain,
          position.x,
          Math.min(2, Math.max(0.5, Math.exp(-delta.y * 0.002))),
          maximumZoom
        )
      )
    },
    [commitViewport, domain, maximumZoom]
  )

  useEffect(() => {
    const host = gestureHostRef.current
    if (!host) return
    return installNonPassiveWheelListener(host, handleWheel)
  }, [handleWheel])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        (event.target as HTMLElement).closest("[data-chart-interaction-island]")
      ) {
        return
      }

      const context = renderContextRef.current
      const scale = context?.scene.scales.x
      if (!context || !scale) return

      const command = resolveChartKeyboardCommand(event)
      if (!command) return
      event.preventDefault()
      event.stopPropagation()

      if (command === "reset") {
        reset()
        return
      }

      if (command === "zoom-in" || command === "zoom-out") {
        commitViewport(
          zoomDomainAt(
            scale,
            viewportRef.current,
            domain,
            context.scene.chart.x + context.scene.chart.width / 2,
            command === "zoom-out" ? 0.8 : 1.25,
            maximumZoom
          )
        )
        return
      }

      if (command === "pan-left" || command === "pan-right") {
        commitViewport(
          panDomainBy(
            scale,
            viewportRef.current,
            domain,
            context.scene.chart.width * 0.1 * (command === "pan-left" ? 1 : -1),
            maximumZoom
          )
        )
      }
    },
    [commitViewport, domain, maximumZoom, reset]
  )

  const zoomed = !sameDomain(viewport, domain)
  const status = formatDomain?.(viewport)

  return (
    <div className={className}>
      <div
        className="relative select-none"
        onKeyDownCapture={handleKeyDown}
        onLostPointerCapture={(event) => finishPointer(event, true)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => {
          if (pointersRef.current.size === 0) {
            wheelArmedRef.current = false
            clearInspection()
          }
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        ref={gestureHostRef}
        style={{ touchAction: "pan-y", ...style }}
      >
        <ResponsiveChart
          ariaDescription={`${ariaDescription ? `${ariaDescription} ` : ""}${interactionHint}`}
          ariaLabel={ariaLabel}
          definition={definition}
          height={height}
          initialWidth={initialWidth}
          onRender={(context) => {
            renderContextRef.current = context
          }}
          renderTooltipBody={renderTooltipBody}
          updateTransition={INSTANT_CHART_UPDATES}
        />
        {zoomed ? (
          <button
            aria-label={resetLabel}
            className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-md border bg-background/90 px-2 py-1 text-xs shadow-sm backdrop-blur transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            data-chart-interaction-island
            onClick={reset}
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {resetLabel}
          </button>
        ) : null}
      </div>
      {status ? (
        <p aria-live="polite" className="sr-only">
          {status}
        </p>
      ) : null}
    </div>
  )
}
