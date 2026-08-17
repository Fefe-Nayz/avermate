"use client"

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react"

/**
 * Where you were on each screen, restored only when you go back to it.
 *
 * The shell used to zero the pane on every route change, and its comment was
 * right about why: arriving somewhere new part-way down reads as a bug, and the
 * phone header would come back already collapsed. But it is only right about
 * *forward* navigation. Tapping a grade and pressing back should return you to
 * the row you tapped, not to the top of a list you had scrolled halfway
 * through — the two cases want opposite things, and the old code could not tell
 * them apart.
 *
 * `popstate` is what tells them apart: the browser fires it for back and
 * forward, and never for a pushed navigation. The flag it raises is consumed by
 * the very next layout pass, so a restore can never leak into the following
 * ordinary navigation.
 *
 * Positions are recorded *while scrolling*, not on the way out. Reading the
 * pane when the route has already changed returns zero — the incoming page has
 * replaced the content and the browser has clamped the offset long before a
 * layout effect runs. Measured: saving on the way out restored 0 every time.
 * A throttled write during scrolling always leaves the outgoing route with its
 * last real offset.
 */
export function usePaneScrollRestoration(
  paneRef: RefObject<HTMLDivElement | null>,
  routeKey: string
) {
  const positions = useRef(new Map<string, number>())
  const cameBack = useRef(false)
  /** The key the scroll listener is currently attributing offsets to. */
  const currentKey = useRef(routeKey)

  useEffect(() => {
    const onPopState = () => {
      cameBack.current = true
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  // One listener for the life of the pane, reading the key from a ref:
  // re-subscribing per route would drop the offsets written between renders.
  // The write is synchronous — a Map.set is cheaper than the bookkeeping any
  // throttle would need, and a frame-throttled version silently records
  // nothing whenever requestAnimationFrame is being starved.
  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const onScroll = () => {
      positions.current.set(currentKey.current, pane.scrollTop)
    }
    pane.addEventListener("scroll", onScroll, { passive: true })
    return () => pane.removeEventListener("scroll", onScroll)
  }, [paneRef])

  useLayoutEffect(() => {
    const pane = paneRef.current
    if (!pane) return

    currentKey.current = routeKey

    const restoring = cameBack.current
    cameBack.current = false
    const saved = restoring ? positions.current.get(routeKey) : undefined

    // A restored offset can exceed what the incoming page can scroll to until
    // its content has laid out, so the assignment is repeated once the browser
    // has measured it. Without this a long list restored to a short first paint
    // lands wherever the clamp put it.
    const target = saved ?? 0
    pane.scrollTo({ top: target })
    if (target > 0) {
      requestAnimationFrame(() => {
        if (pane.scrollTop < target) pane.scrollTo({ top: target })
      })
    }
    zeroClippedAncestors(pane)
  }, [paneRef, routeKey])
}

/**
 * The shell's ancestors are `overflow-clip`, so they own no scrollbar — but the
 * router's own focus/scrollIntoView on an incoming segment can still scroll one
 * programmatically, and nothing the user does could ever bring it back. The
 * page then sits under the sticky header with its bottom cropped.
 */
function zeroClippedAncestors(pane: HTMLElement): void {
  let ancestor = pane.parentElement
  while (ancestor) {
    if (ancestor.scrollTop !== 0) ancestor.scrollTop = 0
    ancestor = ancestor.parentElement
  }
}
