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
  createPointerInspectionController,
  installNonPassiveWheelListener,
  type NumericDomain,
  normalizeWheelDelta,
  panDomainBy,
  pinchDomainFromGesture,
  resolveChartKeyboardCommand,
  shouldHandleChartWheel,
  zoomDomainAt,
} from "./time-series-interaction"
import { ResponsiveChart } from "./responsive-chart"

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
  resetLabel: string
  renderTooltipBody?: (
    context: ChartTooltipBodyRenderContext<TDatum, number, number>
  ) => ReactNode
  style?: CSSProperties
}

interface PointerPosition {
  clientX: number
  clientY: number
  sceneX: number
  sceneY: number
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
export function InteractiveTimeSeriesChart<TDatum>({
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
  resetLabel,
  renderTooltipBody,
  style,
}: InteractiveTimeSeriesChartProps<TDatum>) {
  const [viewport, setViewport] = useState<NumericDomain>(domain)
  const viewportRef = useRef(viewport)
  const renderContextRef = useRef<
    ChartRendererRenderContext<TDatum, number, number> | undefined
  >(undefined)
  const gestureHostRef = useRef<HTMLDivElement>(null)
  const pointersRef = useRef(new Map<number, PointerPosition>())
  const pinchBaselineRef = useRef<PinchBaseline | null>(null)
  const wheelArmedRef = useRef(false)
  const draggedRef = useRef(false)
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)
  const frameRef = useRef<number | undefined>(undefined)
  const pendingViewportRef = useRef<NumericDomain | undefined>(undefined)

  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  useEffect(() => {
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = undefined
    }
    pendingViewportRef.current = undefined
    pointersRef.current.clear()
    pinchBaselineRef.current = null
    wheelArmedRef.current = false
    dragOriginRef.current = null
    draggedRef.current = false
    renderContextRef.current?.interaction.setControlledFocus(null)
    viewportRef.current = domain
    setViewport(domain)
  }, [domain])

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
    },
    []
  )

  const commitViewport = useCallback((next: NumericDomain) => {
    viewportRef.current = next
    pendingViewportRef.current = next
    if (frameRef.current !== undefined) return

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined
      const pending = pendingViewportRef.current
      pendingViewportRef.current = undefined
      if (pending) setViewport(pending)
    })
  }, [])

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

  const inspection = useMemo(
    () =>
      createPointerInspectionController({
        clear: () =>
          renderContextRef.current?.interaction.setControlledFocus(null),
        inspect,
      }),
    [inspect]
  )

  const startPinch = useCallback(() => {
    const scale = renderContextRef.current?.scene.scales.x
    const entries = [...pointersRef.current.entries()]
    pinchBaselineRef.current = null
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

      event.currentTarget.setPointerCapture(event.pointerId)
      wheelArmedRef.current = true
      pointersRef.current.set(event.pointerId, position)
      if (pointersRef.current.size === 2) startPinch()
      dragOriginRef.current ??= { x: event.clientX, y: event.clientY }
      draggedRef.current = false
    },
    [resolvePosition, startPinch]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const context = renderContextRef.current
      const previous = pointersRef.current.get(event.pointerId)
      if (!context || !previous) {
        if (event.pointerType === "mouse") {
          inspection.move(event.clientX, event.clientY)
        }
        return
      }

      // Pointer capture intentionally keeps an active gesture continuous when
      // a finger or mouse crosses the plot edge. Only gesture start is bounded.
      const current = resolvePosition(event.clientX, event.clientY, false)
      if (!current) return
      const origin = dragOriginRef.current
      if (
        origin &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4
      ) {
        draggedRef.current = true
      }

      const scale = context.scene.scales.x
      if (!scale) return
      pointersRef.current.set(event.pointerId, current)
      const pointers = [...pointersRef.current.values()]
      context.interaction.setControlledFocus(null)

      if (pointers.length >= 2) {
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

      const delta = current.sceneX - previous.sceneX
      if (delta !== 0) {
        commitViewport(
          panDomainBy(scale, viewportRef.current, domain, delta, maximumZoom)
        )
      }
    },
    [
      commitViewport,
      domain,
      inspection,
      maximumZoom,
      resolvePosition,
      startPinch,
    ]
  )

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
      const wasTracked = pointersRef.current.delete(event.pointerId)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      if (
        wasTracked &&
        !cancelled &&
        !draggedRef.current &&
        pointersRef.current.size === 0
      ) {
        const resolution = renderContextRef.current?.interaction.resolvePointer(
          event.clientX,
          event.clientY
        )
        renderContextRef.current?.interaction.setControlledFocus(
          resolution ?? null,
          { pinned: true, source: "pointer" }
        )
      }

      if (pointersRef.current.size === 0) {
        pinchBaselineRef.current = null
        dragOriginRef.current = null
        draggedRef.current = false
      } else if (pointersRef.current.size >= 2) {
        startPinch()
      } else {
        pinchBaselineRef.current = null
      }
    },
    [startPinch]
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
        className="relative overscroll-contain select-none"
        onKeyDownCapture={handleKeyDown}
        onLostPointerCapture={(event) => finishPointer(event, true)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => {
          if (pointersRef.current.size === 0) {
            wheelArmedRef.current = false
            inspection.leave()
          }
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        ref={gestureHostRef}
        style={{ touchAction: "none", ...style }}
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
