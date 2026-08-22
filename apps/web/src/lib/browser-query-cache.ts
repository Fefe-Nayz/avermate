"use client"

import type { QueryClient } from "@tanstack/react-query"
import { createQueryClient } from "./query-client"

export const QUERY_CACHE_RESET_EVENT = "avermate:query-cache-reset"

/**
 * The one query cache this document has.
 *
 * TanStack's own advice for the App Router, and for a reason worth stating: a
 * cache held in component state is only as durable as the component holding
 * it, and everything the authenticated shell shows is put into this cache by
 * the server, during render, before any component has settled. React is free
 * to discard state from a render that suspends, and in development it mounts
 * every effect twice — so a cache created with `useState`, or emptied from a
 * cleanup, could lose data that nothing would put back. `HydrationBoundary`
 * hydrates in a `useMemo`; once its dependencies are unchanged it will not run
 * again.
 *
 * That is what a reload looked like from the outside: the new page painted
 * complete, then fell back to defaults — the optional sidebar button gone, the
 * language reading "Match my device", the average card at 0 / 20 with no
 * sparkline and the pass rate at 0% — and only then showed a spinner, because
 * every query had to be asked for again. Nothing was reset; the answers had
 * been thrown away.
 *
 * A module holds it instead, for as long as the document lives, and hands out
 * the same instance however often the tree above it is rebuilt.
 */
let current: { client: QueryClient; identity: string } | null = null
let resetGeneration = 0

/** Monotonic value used by a provider to catch a reset fired before its effect. */
export function getBrowserQueryCacheGeneration(): number {
  return resetGeneration
}

/**
 * The cache for this account, created on first use.
 *
 * Identity is checked rather than remembered by a caller: two accounts must
 * never share a cache, and swapping it here — synchronously, while rendering
 * the provider — means no descendant can read the previous user's data even
 * once. Servers never get this; each server render owns a throwaway cache.
 */
export function getBrowserQueryClient(identity: string): QueryClient {
  if (current && current.identity !== identity) {
    current.client.clear()
    current = null
  }
  if (!current) {
    current = { client: createQueryClient(), identity }
  }
  return current.client
}

/**
 * Destroy this document's personalized cache and ask the provider for a fresh
 * one. Synchronous, so stale user data cannot flash after a logout or a 401.
 */
export function resetBrowserQueryCache(): void {
  current?.client.clear()
  current = null
  resetGeneration += 1

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(QUERY_CACHE_RESET_EVENT))
  }
}
