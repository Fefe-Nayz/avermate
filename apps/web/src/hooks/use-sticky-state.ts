"use client"

import { useCallback, useState, useSyncExternalStore } from "react"

const subscribeToStorage = () => () => {}
const getServerSnapshot = () => null

/**
 * State that survives a reload, kept in localStorage.
 *
 * The server snapshot deliberately has no storage. `useSyncExternalStore`
 * keeps that initial hydration render stable, then exposes the browser value.
 */
export function useStickyState<T>(
  key: string,
  initial: T
): [T, (value: T) => void] {
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  }, [key])
  const stored = useSyncExternalStore(
    subscribeToStorage,
    getSnapshot,
    getServerSnapshot
  )
  const [override, setOverride] = useState<{ key: string; value: T } | null>(
    null
  )

  let value = initial
  if (override?.key === key) {
    value = override.value
  } else if (stored !== null) {
    try {
      value = JSON.parse(stored) as T
    } catch {
      // Corrupted storage falls back to the initial value.
    }
  }

  const update = useCallback(
    (next: T) => {
      setOverride({ key, value: next })
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Private browsing refuses writes; the value still holds in memory.
      }
    },
    [key]
  )

  return [value, update]
}
