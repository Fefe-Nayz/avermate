"use client"

import { useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react"

/**
 * A handle on the pane that actually scrolls.
 *
 * The shell scrolls a container, not the document, and three separate
 * behaviours need to reach it: restoring where you were when you come back,
 * tapping the current tab to go to the top, and pull-to-refresh. Each of them
 * would otherwise reinvent its own way of finding the pane — by class name, or
 * by walking up from a child — and drift apart the moment the shell's markup
 * changes. One context, one owner.
 */
interface ScrollPaneValue {
  /** The scrolling element, or `null` before the shell has mounted it. */
  readonly ref: RefObject<HTMLDivElement | null>
  /** True when the pane is at (or within a hair of) its top. */
  isAtTop: () => boolean
  scrollToTop: (behavior?: ScrollBehavior) => void
  /**
   * Refetch the current screen, and say so.
   *
   * `router.refresh()` alone is silent — server components are replaced with no
   * spinner, no flash, nothing. A tap that produces no visible response is
   * indistinguishable from a tap that did nothing, so the refreshing flag lives
   * here and the pull indicator renders it for whoever asked.
   */
  refresh: () => void
  refreshing: boolean
}

/** Momentum rarely settles on exactly zero; treat the first pixels as "top". */
const TOP_EPSILON = 2

const ScrollPaneContext = createContext<ScrollPaneValue | null>(null)

export function ScrollPaneProvider({
  paneRef,
  children,
}: {
  paneRef: RefObject<HTMLDivElement | null>
  children: React.ReactNode
}) {
  const isAtTop = useCallback(
    () => (paneRef.current?.scrollTop ?? 0) <= TOP_EPSILON,
    [paneRef]
  )

  const scrollToTop = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      paneRef.current?.scrollTo({ top: 0, behavior })
    },
    [paneRef]
  )

  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(() => {
    setRefreshing(true)
    router.refresh()
  }, [router])

  // Nothing to await: `router.refresh()` returns void and the new tree simply
  // arrives. The flag is dropped after long enough to have been seen.
  useEffect(() => {
    if (!refreshing) return
    const timer = window.setTimeout(() => setRefreshing(false), 900)
    return () => window.clearTimeout(timer)
  }, [refreshing])

  const value = useMemo(
    () => ({ ref: paneRef, isAtTop, scrollToTop, refresh, refreshing }),
    [paneRef, isAtTop, scrollToTop, refresh, refreshing]
  )

  return (
    <ScrollPaneContext.Provider value={value}>
      {children}
    </ScrollPaneContext.Provider>
  )
}

/**
 * `null` outside the shell — the auth screens and the landing page have no
 * pane, and callers there must degrade rather than crash.
 */
export function useScrollPane(): ScrollPaneValue | null {
  return useContext(ScrollPaneContext)
}
