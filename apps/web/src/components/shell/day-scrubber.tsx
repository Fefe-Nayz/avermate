"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { useMotionValue, useSpring } from "motion/react"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

const FALLBACK_TICK_TARGET = 96
const MIN_TICK_GAP_PX = 4

/** Keeps minor timeline ticks legible at every scrubber width. */
export function resolveScrubberTickStep(totalDays: number, width: number) {
  if (totalDays <= 0) return 1
  if (width <= 0) {
    return Math.max(1, Math.ceil((totalDays + 1) / FALLBACK_TICK_TARGET))
  }
  const visibleCapacity = Math.max(2, Math.floor(width / MIN_TICK_GAP_PX))
  return Math.max(1, Math.ceil((totalDays + 1) / visibleCapacity))
}

/** Mount only ticks that can actually be seen; month anchors are never dropped. */
export function resolveVisibleScrubberDays(
  totalDays: number,
  tickStep: number,
  monthStarts: readonly number[]
) {
  const days = new Set<number>([0, totalDays])
  for (let day = 0; day <= totalDays; day += Math.max(1, tickStep))
    days.add(day)
  for (const day of monthStarts) {
    if (day >= 0 && day <= totalDays) days.add(day)
  }
  return [...days].sort((left, right) => left - right)
}

/**
 * A day-per-tick scrubber for time travel.
 *
 * Every day of the school year is one thin vertical tick, so the strip reads
 * as the year itself rather than an abstract slider track. Ticks near the
 * pointer spread apart (pure CSS custom properties), dragging or clicking
 * selects the day under the pointer, and days after the selection
 * fade — they are the part of the year the rewind is hiding.
 */
export function DayScrubber({
  totalDays,
  selectedDay,
  onSelectDay,
  monthStarts = [],
  disabled = false,
  ariaLabel,
  formatDayAction,
  className,
}: {
  /** Highest selectable day index; day 0 is the first day of the year. */
  totalDays: number
  selectedDay: number
  onSelectDay: (day: number) => void
  /** Day indices where a month begins — drawn taller as anchors. */
  monthStarts?: readonly number[]
  disabled?: boolean
  ariaLabel: string
  /** Localized date for the live tooltip and assistive technology. */
  formatDayAction: (day: number) => string
  className?: string
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const geometryRef = useRef<{ left: number; width: number } | null>(null)
  // Touch drags preview without committing: every committed day re-filters
  // the whole app. Preview presentation therefore stays entirely outside
  // React's render loop and commits only once on release.
  const draggingRef = useRef<{ touch: boolean } | null>(null)
  const previewDayRef = useRef<number | null>(null)
  const pendingMouseDayRef = useRef<number | null>(null)
  const mouseCommitFrameRef = useRef<number | null>(null)
  const [stripWidth, setStripWidth] = useState(0)
  const months = useMemo(() => new Set(monthStarts), [monthStarts])
  const visibleTickStep = resolveScrubberTickStep(totalDays, stripWidth)
  const visibleDays = useMemo(
    () => resolveVisibleScrubberDays(totalDays, visibleTickStep, monthStarts),
    [monthStarts, totalDays, visibleTickStep]
  )

  // One spring drives the whole Dock-style magnification. Motion updates the
  // CSS variable imperatively, so no React render occurs during enter/leave.
  const boostTarget = useMotionValue(0)
  const boostSpring = useSpring(boostTarget, {
    stiffness: 520,
    damping: 24,
    mass: 0.55,
  })

  const measureStrip = useCallback(() => {
    const strip = stripRef.current
    if (!strip) return null
    const rect = strip.getBoundingClientRect()
    if (rect.width <= 0) return null
    const geometry = { left: rect.left, width: rect.width }
    geometryRef.current = geometry
    strip.style.setProperty(
      "--scrub-day-width",
      `${rect.width / Math.max(1, totalDays)}px`
    )
    const width = Math.round(rect.width)
    setStripWidth((current) => (current === width ? current : width))
    return geometry
  }, [totalDays])

  useEffect(() => {
    measureStrip()
    const strip = stripRef.current
    if (!strip || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measureStrip)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [measureStrip])

  useEffect(
    () =>
      boostSpring.on("change", (value) => {
        stripRef.current?.style.setProperty(
          "--scrub-boost",
          String(Math.min(1.12, Math.max(-0.12, value)))
        )
      }),
    [boostSpring]
  )

  const pointAt = useCallback(
    (clientX: number) => {
      const geometry = geometryRef.current ?? measureStrip()
      if (!geometry || totalDays <= 0) return { cursorDay: 0, day: 0 }
      const ratio = Math.min(
        1,
        Math.max(0, (clientX - geometry.left) / geometry.width)
      )
      const cursorDay = ratio * totalDays
      return { cursorDay, day: Math.round(cursorDay) }
    },
    [measureStrip, totalDays]
  )

  const followCursor = useCallback(
    (cursorDay: number) => {
      stripRef.current?.style.setProperty("--cursor", String(cursorDay))
      if (boostTarget.get() !== 1) boostTarget.set(1)
    },
    [boostTarget]
  )

  const positionSelection = useCallback(
    (day: number) => {
      const strip = stripRef.current
      if (!strip) return
      strip.style.setProperty(
        "--selection-position",
        `${(day / Math.max(1, totalDays)) * 100}%`
      )
      strip.style.setProperty("--selection-day", String(day))
    },
    [totalDays]
  )

  const updateTouchPreview = useCallback(
    (day: number) => {
      if (previewDayRef.current === day) return
      previewDayRef.current = day
      const label = formatDayAction(day)
      const strip = stripRef.current
      strip?.setAttribute("aria-valuenow", String(day))
      strip?.setAttribute("aria-valuetext", label)
      const tooltip = tooltipRef.current
      if (tooltip) {
        tooltip.classList.remove("invisible")
        tooltip.textContent = label
      }
    },
    [formatDayAction]
  )

  const commitMouseDay = useCallback(
    (day: number) => {
      if (pendingMouseDayRef.current === day) return
      pendingMouseDayRef.current = day
      if (mouseCommitFrameRef.current !== null) return
      mouseCommitFrameRef.current = window.requestAnimationFrame(() => {
        mouseCommitFrameRef.current = null
        const next = pendingMouseDayRef.current
        pendingMouseDayRef.current = null
        if (next !== null) onSelectDay(next)
      })
    },
    [onSelectDay]
  )

  useEffect(
    () => () => {
      if (mouseCommitFrameRef.current !== null) {
        window.cancelAnimationFrame(mouseCommitFrameRef.current)
      }
    },
    []
  )

  const restCursor = useCallback(() => {
    if (boostTarget.get() !== 0) boostTarget.set(0)
  }, [boostTarget])

  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return
      measureStrip()
      followCursor(pointAt(event.clientX).cursorDay)
    },
    [disabled, followCursor, measureStrip, pointAt]
  )

  /**
   * A day is a detent, so it gets a tick.
   *
   * Picking up the handle is the firmer of the two, then one light tick per day
   * crossed — the same pair the sparkline uses, so a scrub feels the same
   * wherever you do it. Held against the last day rather than fired on every
   * move: a pointer travels many pixels inside one day, and buzzing for each of
   * them reads as a rattle instead of a scale.
   */
  const hapticDayRef = useRef<number | null>(null)
  const tickDay = useCallback((day: number) => {
    if (hapticDayRef.current === day) return
    hapticDayRef.current = day
    haptic("selection")
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (event.pointerType === "mouse" && event.button !== 0) return
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // A capture refusal (exotic input, synthetic events) only costs the
        // capture; the drag still tracks while the pointer stays over us.
      }
      measureStrip()
      const touch = event.pointerType !== "mouse"
      draggingRef.current = { touch }
      const { cursorDay, day } = pointAt(event.clientX)
      hapticDayRef.current = day
      haptic("light")
      followCursor(cursorDay)
      positionSelection(day)
      if (touch) updateTouchPreview(day)
      else commitMouseDay(day)
    },
    [
      commitMouseDay,
      disabled,
      followCursor,
      measureStrip,
      pointAt,
      positionSelection,
      updateTouchPreview,
    ]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return
      const { cursorDay, day } = pointAt(event.clientX)
      followCursor(cursorDay)
      const dragging = draggingRef.current
      if (!dragging) return
      tickDay(day)
      positionSelection(day)
      if (dragging.touch) updateTouchPreview(day)
      else commitMouseDay(day)
    },
    [
      commitMouseDay,
      disabled,
      followCursor,
      pointAt,
      positionSelection,
      tickDay,
      updateTouchPreview,
    ]
  )

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragging = draggingRef.current
      draggingRef.current = null
      hapticDayRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (dragging?.touch) {
        const preview = previewDayRef.current
        previewDayRef.current = null
        tooltipRef.current?.classList.add("invisible")
        if (event.type === "pointercancel") {
          positionSelection(selectedDay)
          const label = formatDayAction(selectedDay)
          stripRef.current?.setAttribute("aria-valuenow", String(selectedDay))
          stripRef.current?.setAttribute("aria-valuetext", label)
        } else if (preview !== null) {
          positionSelection(preview)
          onSelectDay(preview)
        }
      } else if (dragging) {
        if (mouseCommitFrameRef.current !== null) {
          window.cancelAnimationFrame(mouseCommitFrameRef.current)
          mouseCommitFrameRef.current = null
        }
        const pending = pendingMouseDayRef.current
        pendingMouseDayRef.current = null
        if (pending !== null && event.type !== "pointercancel") {
          onSelectDay(pending)
        }
      }
      if (event.type === "pointercancel" || event.pointerType !== "mouse") {
        restCursor()
      }
    },
    [formatDayAction, onSelectDay, positionSelection, restCursor, selectedDay]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      const steps: Record<string, number> = {
        ArrowLeft: -1,
        ArrowDown: -1,
        ArrowRight: 1,
        ArrowUp: 1,
        PageDown: -7,
        PageUp: 7,
      }
      let next: number | null = null
      if (event.key in steps) {
        next = Math.min(
          totalDays,
          Math.max(0, selectedDay + (steps[event.key] ?? 0))
        )
      } else if (event.key === "Home") next = 0
      else if (event.key === "End") next = totalDays
      if (next === null || next === selectedDay) {
        if (next !== null) event.preventDefault()
        return
      }
      event.preventDefault()
      haptic("selection")
      onSelectDay(next)
    },
    [disabled, onSelectDay, selectedDay, totalDays]
  )

  return (
    <div
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-valuemax={totalDays}
      aria-valuemin={0}
      aria-valuenow={selectedDay}
      aria-valuetext={formatDayAction(selectedDay)}
      className={cn(
        "scrubber relative h-16 touch-none overflow-hidden px-0.5 pb-0.5 md:h-9",
        disabled ? "opacity-50" : "cursor-pointer",
        className
      )}
      data-base-ui-swipe-ignore=""
      onKeyDown={handleKeyDown}
      onPointerCancel={finishPointer}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={() => {
        if (!draggingRef.current) restCursor()
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      ref={stripRef}
      role="slider"
      style={
        {
          "--selection-day": selectedDay,
          "--selection-position": `${
            (selectedDay / Math.max(1, totalDays)) * 100
          }%`,
        } as CSSProperties
      }
      tabIndex={disabled ? -1 : 0}
    >
      <span
        aria-hidden="true"
        className="scrub-tooltip pointer-events-none invisible absolute top-0 z-20 max-w-32 truncate rounded-md border bg-popover/95 px-2 py-1 text-[11px] leading-4 font-medium whitespace-nowrap text-popover-foreground shadow-sm backdrop-blur-sm md:hidden"
        ref={tooltipRef}
      >
        {formatDayAction(selectedDay)}
      </span>
      <span
        aria-hidden="true"
        className="scrub-selection pointer-events-none absolute bottom-0.5 z-10 h-8 w-0.5 rounded-full bg-primary md:h-6"
      />
      {visibleDays.map((day) => {
        const isMonthStart = months.has(day)
        return (
          <span
            aria-hidden="true"
            className={cn(
              "scrub-tick pointer-events-none absolute bottom-0.5 block rounded-full",
              isMonthStart
                ? "h-5 w-0.5 bg-muted-foreground/70 md:h-4 md:w-px"
                : "h-3.5 w-px bg-muted-foreground/45 md:h-3 md:w-0.5"
            )}
            key={day}
            style={
              {
                "--i": day,
                "--scrub-scale-amplitude": 0.9,
                "--tick-position": `${(day / Math.max(1, totalDays)) * 100}%`,
              } as CSSProperties
            }
          />
        )
      })}
    </div>
  )
}
