/**
 * Where a remembered UI choice lives.
 *
 * A cookie rather than localStorage, for the same reason the palette and the
 * locale are cookies: the server renders the first paint, and it can only get a
 * layout choice right if it is told. Read from storage, the choice arrives one
 * commit after hydration — long enough to watch the grades page open on the
 * timeline and then switch to the calendar you actually left it on.
 *
 * Cookie names are tokens, so the key is flattened into one. The app's keys are
 * few and a test asserts they stay distinct through this.
 */
export const STICKY_COOKIE_PREFIX = "avermate.ui."

export const STICKY_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export function stickyCookieName(key: string): string {
  return `${STICKY_COOKIE_PREFIX}${key.replace(/[^A-Za-z0-9_-]/g, ".")}`
}

/** The stored choices a server render should hand to the browser, by cookie name. */
export type StickyStateSnapshot = Record<string, string>
