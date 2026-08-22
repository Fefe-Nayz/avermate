"use client"

import { useSyncExternalStore } from "react"

function subscribe(callback: () => void) {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)
  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

function browserSnapshot() {
  return navigator.onLine
}

/**
 * Browser connectivity hint for direct client-side queries.
 *
 * The server snapshot deliberately stays online so hydration is stable. This
 * does not claim that the API is healthy; request errors remain authoritative.
 */
export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, browserSnapshot, () => true)
}
