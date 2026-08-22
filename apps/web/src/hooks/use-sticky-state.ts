"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react"
import {
  stickyCookieName,
  STICKY_COOKIE_MAX_AGE,
  type StickyStateSnapshot,
} from "@/lib/sticky-state"

/**
 * The choices the current request already knows about, keyed by cookie name.
 *
 * Filled by `StickyStateProvider` from the root layout, which is the only place
 * that can read the cookies. Empty is legal — a hook then has nothing to render
 * on the server and the first paint shows the default, which is the behaviour
 * this whole mechanism exists to avoid.
 */
export const StickyStateContext = createContext<StickyStateSnapshot>({})

/**
 * Cookies have no browser event of their own. This tiny in-page external store lets a
 * cookie write invalidate every reader without mirroring that cookie in React state.
 */
const stickySubscribers = new Set<() => void>()

const subscribeToStorage = (subscriber: () => void) => {
  stickySubscribers.add(subscriber)
  return () => stickySubscribers.delete(subscriber)
}

function publishStickyChange(): void {
  for (const subscriber of stickySubscribers) subscriber()
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const prefix = `${name}=`
  for (const entry of document.cookie.split("; ")) {
    if (entry.startsWith(prefix)) {
      return decodeURIComponent(entry.slice(prefix.length))
    }
  }
  return null
}

/** Write a remembered choice without holding it in React state. */
export function writeStickyValue(key: string, value: unknown): void {
  if (typeof document === "undefined") return
  const encoded = encodeURIComponent(JSON.stringify(value))
  document.cookie = `${stickyCookieName(key)}=${encoded}; path=/; max-age=${STICKY_COOKIE_MAX_AGE}; samesite=lax`
  publishStickyChange()
}

/** Promote one value written by the former localStorage implementation. */
export function migrateLegacyStickyValue<T>(
  key: string,
  storage: Pick<Storage, "getItem" | "removeItem">,
  write: (key: string, value: T) => void = writeStickyValue
): boolean {
  const legacy = storage.getItem(key)
  if (legacy === null) return false
  const parsed = JSON.parse(legacy) as T
  // The recoverable copy is removed only after the new store accepted the value.
  write(key, parsed)
  storage.removeItem(key)
  return true
}

/**
 * State that survives a reload, kept in a cookie.
 *
 * The cookie is what makes the server render agree with the browser: the
 * snapshot React uses while hydrating is the value the server was given, and
 * the value the browser reads back is that same string. So there is no
 * correcting render — which is the whole point, see `lib/sticky-state`.
 */
export function useStickyState<T>(
  key: string,
  initial: T
): [T, (value: T) => void] {
  const name = stickyCookieName(key)
  const server = useContext(StickyStateContext)[name] ?? null

  const getSnapshot = useCallback(() => readCookie(name), [name])
  const getServerSnapshot = useCallback(() => server, [server])

  const stored = useSyncExternalStore(
    subscribeToStorage,
    getSnapshot,
    getServerSnapshot
  )

  /**
   * The choice this reader made before any of it was a cookie.
   *
   * The previous implementation kept the same JSON under the same key in
   * localStorage. Moving to cookies simply stopped reading it, so everyone who had
   * arranged a screen found it back at the defaults with their arrangement still on
   * disk, unread.
   *
   * After mount rather than during render, and only when no cookie exists: the whole
   * point of the cookie is that the server render and the first client render agree,
   * and reading storage in the snapshot would break exactly that. Upgraders get one
   * corrective render, once, and then the cookie is authoritative — the old entry is
   * cleared so this never runs twice.
   */
  useEffect(() => {
    if (stored !== null) return
    try {
      migrateLegacyStickyValue<T>(key, window.localStorage)
    } catch {
      // Unavailable or corrupted storage leaves the default standing.
    }
  }, [key, stored])

  let value = initial
  if (stored !== null) {
    try {
      value = JSON.parse(stored) as T
    } catch {
      // A cookie edited by hand, or left by an older version, falls back to the
      // initial value rather than throwing during render.
    }
  }

  const update = useCallback(
    (next: T) => {
      writeStickyValue(key, next)
    },
    [key]
  )

  return [value, update]
}
