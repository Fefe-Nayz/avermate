import { stickyCookieName } from "@/lib/sticky-state"

/**
 * Where the reader's timezone is remembered.
 *
 * A cookie, for the reason the whole sticky-state module exists: the server renders the
 * first paint, and it can only get a time-based window right if it is told which timezone
 * to build it in. The planning pages used to prefetch their month in UTC and hand the
 * browser an `initialTimezone` of `"UTC"`; the client then recomputed the window in its
 * own zone, missed the cache the server had just filled, and refetched — so everyone
 * outside UTC paid for a prefetch they never used and watched the panel load twice.
 *
 * Deliberately not a client module. Both functions below are read by server components,
 * and `"use client"` on the file they live in makes that a runtime error.
 */
export const PLANNING_TIMEZONE_KEY = "avermate:planning-timezone"

export const planningTimezoneCookie = () =>
  stickyCookieName(PLANNING_TIMEZONE_KEY)

/**
 * The timezone a cookie holds, or UTC.
 *
 * Written by `writeStickyValue`, so the value is JSON inside a URI-encoded cookie — and
 * read back through both, exactly as the planning view cookie is: a stale or hand-edited
 * value falls back rather than throwing during a server render.
 */
export function readTimezoneCookie(value: string | undefined): string {
  if (!value) return "UTC"
  for (const candidate of [value, safeDecode(value)]) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (typeof parsed === "string" && parsed.trim()) return parsed
    } catch {
      // Not JSON: fall through to the next candidate, then to UTC.
    }
  }
  return "UTC"
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
