"use client"

import { useCallback, useEffect } from "react"
import { usePathname } from "next/navigation"

/**
 * Marking the settings section a search result just pointed at.
 *
 * Three things had to be true at once, and each of them broke it on its own.
 *
 * `:target` is not a signal. It is true for as long as the URL names the
 * section, so it is simply already on when the page paints — and picking the
 * same result twice changes no hash at all, so the second time nothing happens
 * whatsoever, which is exactly when a reader is looking hardest.
 *
 * The section is not there yet when the click happens. A result for another
 * settings page navigates first; at the moment of the click the target element
 * belongs to a page that has not rendered. So the ring waits for it, briefly,
 * instead of asking once and giving up.
 *
 * And the navigation itself is invisible to the obvious listeners. The rail
 * lives in the settings layout, which does not re-mount between settings pages,
 * and `hashchange` does not fire when the *path* changes. So the trigger is the
 * pathname, watched from the layout, plus `hashchange` for the same-page case.
 */

const ATTRIBUTE = "data-settings-highlight"
const DURATION_MS = 2400
/** How long to wait for a section that is still being rendered. */
const WAIT_MS = 2000
const POLL_MS = 80

let clearTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null
let ringing: string | null = null

function stopPending() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

/**
 * Rings one section by id, waiting for it to exist.
 *
 * Re-ringing the section already lit is a no-op rather than a restart: the
 * click and the route change both ask for it, a fraction of a second apart, and
 * a ring that replays instantly reads as a flicker.
 */
export function highlightSettingsSection(id: string): void {
  if (typeof document === "undefined") return
  if (ringing === id) return

  stopPending()
  const deadline = Date.now() + WAIT_MS

  const attempt = () => {
    const target = document.getElementById(id)
    if (!target) {
      if (Date.now() > deadline) {
        pollTimer = null
        return
      }
      pollTimer = setTimeout(attempt, POLL_MS)
      return
    }
    pollTimer = null

    for (const previous of document.querySelectorAll(`[${ATTRIBUTE}]`)) {
      previous.removeAttribute(ATTRIBUTE)
    }
    if (clearTimer) clearTimeout(clearTimer)

    ringing = id
    target.setAttribute(ATTRIBUTE, "true")
    target.scrollIntoView({ block: "start", behavior: "smooth" })
    clearTimer = setTimeout(() => {
      target.removeAttribute(ATTRIBUTE)
      clearTimer = null
      ringing = null
    }, DURATION_MS)
  }

  attempt()
}

/** The id in a settings href, or null when it points at a whole page. */
export function settingsHrefSection(href: string): string | null {
  const hash = href.indexOf("#")
  return hash === -1 ? null : href.slice(hash + 1) || null
}

/**
 * Rings the section the address names: on arrival, on every page change inside
 * settings, and on a bare hash change. Mount once, in the settings layout.
 */
export function useSettingsHashHighlight(): void {
  const pathname = usePathname()

  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) highlightSettingsSection(id)
    return stopPending
  }, [pathname])

  useEffect(() => {
    const onHashChange = () => {
      const id = window.location.hash.slice(1)
      if (id) {
        // A deliberate re-request: let it ring again even if it just did.
        ringing = null
        highlightSettingsSection(id)
      }
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])
}

/**
 * The click handler a settings search result needs.
 *
 * Covers the one case the two effects above cannot see: the result points at
 * the page you are already on, at the hash already in the address, so neither
 * the pathname nor the hash changes and nothing fires.
 */
export function useSettingsResultClick(): (href: string) => void {
  return useCallback((href: string) => {
    const id = settingsHrefSection(href)
    if (!id) return
    ringing = null
    highlightSettingsSection(id)
  }, [])
}
