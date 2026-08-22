"use client"

import { useEffect } from "react"
import { writeStickyValue } from "@/hooks/use-sticky-state"
import { PLANNING_TIMEZONE_KEY } from "@/lib/planning-timezone"

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

/**
 * Records the browser's timezone so the *next* server render is already right.
 *
 * Deliberately does nothing to this render: changing the window here would trade one
 * refetch for one re-render. The first visit from a new device is off by a timezone and
 * every visit after it is exact, which is the same bargain the palette and the locale
 * make.
 */
export function useRememberedTimezone(serverTimezone: string): void {
  useEffect(() => {
    const actual = browserTimezone()
    if (actual !== serverTimezone) {
      writeStickyValue(PLANNING_TIMEZONE_KEY, actual)
    }
  }, [serverTimezone])
}
