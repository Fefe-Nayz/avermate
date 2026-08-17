"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import { ArrowDownIcon, Loader2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { useScrollPane } from "./scroll-pane"

/**
 * Pull-to-refresh on the pane, because the browser's cannot reach it.
 *
 * The shell scrolls a container and that container sets
 * `overscroll-behavior: contain`, which is what stops a scroll at the end of a
 * list from chaining out to the page behind it. The same property also disables
 * the browser's own pull-to-refresh, and there is no value that keeps one and
 * drops the other. That is the whole reason the gesture only worked when it
 * started on the header: the header is outside the pane, so the drag reached the
 * document scroller instead.
 *
 * It has to be built on touch events, not pointer events. The pane's
 * `touch-action` is `auto`, so the browser's scroller claims a vertical drag
 * before any handler runs and then fires `pointercancel` — a pointer-event
 * implementation simply stops receiving moves on a real device, while appearing
 * to work perfectly against synthesised events. A non-passive `touchmove` that
 * calls `preventDefault` is the only way to take the gesture back, and it can
 * only be called once the drag is known to be a downward pull at the top of the
 * list. Everything else is left to the scroller.
 *
 * And everything else includes reordering. A card's drag handle lives inside the
 * pane, so pressing it and pulling down is, to these listeners, the exact shape
 * of a pull — which meant dragging a card down from the top of the dashboard
 * refreshed the page and threw the drag away. A gesture that starts on a
 * `[data-drag-handle]` belongs to the sortable, and is never a pull.
 */

/** How far the finger must travel before the release refreshes. */
const TRIGGER_DISTANCE = 72
/** Past the trigger the indicator keeps moving, but grudgingly. */
const RESISTANCE = 0.45
/** Ignore the first pixels, so a tap or a flick is never a pull. */
const SLOP = 8

export function PullToRefresh({
  paneRef,
}: {
  paneRef: RefObject<HTMLDivElement | null>
}) {
  const t = useExtracted()
  const pane = useScrollPane()
  const [distance, setDistance] = useState(0)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{
    id: number
    startY: number
    startX: number
    committed: boolean
    abandoned: boolean
  } | null>(null)
  const armed = useRef(false)
  // Held in a ref so the touch listeners are attached once for the life of the
  // pane rather than rebuilt whenever the provider re-renders.
  const refreshRef = useRef(pane?.refresh)
  useEffect(() => {
    refreshRef.current = pane?.refresh
  }, [pane?.refresh])

  const refreshing = pane?.refreshing ?? false

  useEffect(() => {
    const node = paneRef.current
    if (!node) return

    const reset = () => {
      gesture.current = null
      armed.current = false
      setDistance(0)
      setDragging(false)
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        reset()
        return
      }
      // Only a list already at its top can be pulled.
      if (node.scrollTop > 0) return
      // A reorder begins with a press on a handle and continues as a drag. That
      // is not a pull, however much it looks like one from here, and deciding it
      // on the target rather than on a later "is a drag running?" flag leaves no
      // window in which both could claim the gesture.
      const target = event.target
      if (
        target instanceof Element &&
        target.closest("[data-drag-handle]") !== null
      ) {
        return
      }
      const touch = event.touches[0]
      if (!touch) return
      gesture.current = {
        id: touch.identifier,
        startY: touch.clientY,
        startX: touch.clientX,
        committed: false,
        abandoned: false,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const current = gesture.current
      if (!current || current.abandoned) return
      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === current.id
      )
      if (!touch) return

      const deltaY = touch.clientY - current.startY
      const deltaX = touch.clientX - current.startX

      if (!current.committed) {
        if (Math.abs(deltaY) < SLOP && Math.abs(deltaX) < SLOP) return
        // Upward, sideways, or the list moved under us: this is the scroller's
        // gesture. Abandon for good rather than re-testing, or a wobbling thumb
        // would flicker between the two owners.
        if (
          deltaY <= 0 ||
          Math.abs(deltaX) > Math.abs(deltaY) ||
          node.scrollTop > 0
        ) {
          current.abandoned = true
          return
        }
        current.committed = true
        setDragging(true)
      }

      // Committed: the pull owns the gesture, so the scroller must not also act
      // on it. Only reachable on a non-passive listener.
      if (event.cancelable) event.preventDefault()

      const pulled =
        deltaY <= TRIGGER_DISTANCE
          ? deltaY
          : TRIGGER_DISTANCE + (deltaY - TRIGGER_DISTANCE) * RESISTANCE
      setDistance(Math.max(0, pulled))

      const nowArmed = deltaY >= TRIGGER_DISTANCE
      if (nowArmed !== armed.current) {
        armed.current = nowArmed
        if (nowArmed) haptic("selection")
      }
    }

    const onTouchEnd = () => {
      const current = gesture.current
      const wasArmed = armed.current
      reset()
      if (!current?.committed || !wasArmed) return
      haptic("light")
      refreshRef.current?.()
    }

    // `touchmove` must be non-passive or `preventDefault` is a no-op; the other
    // two never cancel anything and stay passive.
    node.addEventListener("touchstart", onTouchStart, { passive: true })
    node.addEventListener("touchmove", onTouchMove, { passive: false })
    node.addEventListener("touchend", onTouchEnd, { passive: true })
    node.addEventListener("touchcancel", reset, { passive: true })
    return () => {
      node.removeEventListener("touchstart", onTouchStart)
      node.removeEventListener("touchmove", onTouchMove)
      node.removeEventListener("touchend", onTouchEnd)
      node.removeEventListener("touchcancel", reset)
    }
  }, [paneRef])

  const visible = refreshing || distance > 0
  const progress = Math.min(1, distance / TRIGGER_DISTANCE)

  return (
    <div
      aria-live="polite"
      data-pull-indicator
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center md:hidden"
      style={{
        transform: `translateY(${
          refreshing ? 12 : Math.max(0, distance - 28)
        }px)`,
        opacity: visible ? 1 : 0,
        transition: dragging
          ? "none"
          : "transform 200ms ease-out, opacity 200ms ease-out",
      }}
    >
      <span className="sr-only">{refreshing ? t("Refreshing") : ""}</span>
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-full border bg-card shadow-sm",
          progress >= 1 && !refreshing && "border-primary text-primary"
        )}
      >
        {refreshing ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <ArrowDownIcon
            className="size-4 transition-transform"
            style={{ transform: `rotate(${progress >= 1 ? 180 : 0}deg)` }}
          />
        )}
      </span>
    </div>
  )
}
