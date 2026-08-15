"use client"

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { cn } from "@/lib/utils"

/**
 * A day-per-tick scrubber for time travel.
 *
 * Every day of the school year is one thin vertical tick, so the strip reads
 * as the year itself rather than an abstract slider track. Ticks near the
 * pointer swell (pure CSS, one custom property per frame), dragging or
 * clicking selects the day under the pointer, and days after the selection
 * fade — they are the part of the year the rewind is hiding.
 */
export function DayScrubber({
  totalDays,
  selectedDay,
  onSelectDay,
  monthStarts = [],
  disabled = false,
  ariaLabel,
  ariaValueText,
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
  /** Localized readout of the selected date for assistive tech. */
  ariaValueText: string
  className?: string
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  // Touch drags preview without committing: every committed day re-filters
  // the whole app, and doing that at finger speed janks a phone. The day
  // under the finger is highlighted live, and committed once on release; a
  // mouse commits continuously, since a desktop absorbs it.
  const draggingRef = useRef<{ touch: boolean } | null>(null)
  const [previewDay, setPreviewDay] = useState<number | null>(null)
  const months = new Set(monthStarts)
  const shownDay = previewDay ?? selectedDay

  const dayAt = useCallback(
    (clientX: number) => {
      const strip = stripRef.current
      if (!strip || totalDays <= 0) return 0
      const rect = strip.getBoundingClientRect()
      if (rect.width <= 0) return 0
      const ratio = (clientX - rect.left) / rect.width
      return Math.min(totalDays, Math.max(0, Math.round(ratio * totalDays)))
    },
    [totalDays]
  )

  const followCursor = useCallback(
    (clientX: number) => {
      const strip = stripRef.current
      if (!strip || totalDays <= 0) return
      const rect = strip.getBoundingClientRect()
      if (rect.width <= 0) return
      const ratio = (clientX - rect.left) / rect.width
      strip.style.setProperty("--cursor", String(ratio * totalDays))
      strip.style.setProperty("--scrub-boost", "1")
    },
    [totalDays]
  )

  const restCursor = useCallback(() => {
    stripRef.current?.style.setProperty("--scrub-boost", "0")
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
      const touch = event.pointerType !== "mouse"
      draggingRef.current = { touch }
      followCursor(event.clientX)
      const day = dayAt(event.clientX)
      if (touch) setPreviewDay(day)
      else onSelectDay(day)
    },
    [dayAt, disabled, followCursor, onSelectDay]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return
      followCursor(event.clientX)
      const dragging = draggingRef.current
      if (!dragging) return
      const day = dayAt(event.clientX)
      if (dragging.touch) setPreviewDay(day)
      else onSelectDay(day)
    },
    [dayAt, disabled, followCursor, onSelectDay]
  )

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragging = draggingRef.current
      draggingRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (dragging?.touch) {
        setPreviewDay((preview: number | null) => {
          if (preview !== null && event.type !== "pointercancel") {
            onSelectDay(preview)
          }
          return null
        })
      }
      if (event.type === "pointercancel" || event.pointerType !== "mouse") {
        restCursor()
      }
    },
    [onSelectDay, restCursor]
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
      aria-valuenow={shownDay}
      aria-valuetext={ariaValueText}
      className={cn(
        "scrubber flex h-9 touch-none items-end justify-between overflow-hidden rounded-md px-0.5 pb-0.5",
        disabled ? "opacity-50" : "cursor-pointer",
        className
      )}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishPointer}
      onPointerDown={handlePointerDown}
      onPointerLeave={restCursor}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      ref={stripRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
    >
      {Array.from({ length: totalDays + 1 }, (_, day) => {
        const isSelected = day === shownDay
        const isMonthStart = months.has(day)
        return (
          <span
            aria-hidden="true"
            className={cn(
              "scrub-tick pointer-events-none w-px shrink-0 rounded-full sm:w-0.5",
              isSelected
                ? "h-6 bg-primary"
                : isMonthStart
                  ? "h-4 bg-muted-foreground/70"
                  : "h-3 bg-muted-foreground/45",
              !isSelected && day > shownDay && "opacity-40"
            )}
            key={day}
            style={{ "--i": day } as CSSProperties}
          />
        )
      })}
    </div>
  )
}
