"use client"

import type { QueryClient } from "@tanstack/react-query"

export const QUERY_CACHE_RESET_EVENT = "avermate:query-cache-reset"

const activeClients = new Set<QueryClient>()
let resetGeneration = 0

/** Monotonic value used by a provider to catch a reset fired before its effect. */
export function getBrowserQueryCacheGeneration(): number {
  return resetGeneration
}

/** Register the cache currently mounted below QueryClientProvider. */
export function registerBrowserQueryClient(client: QueryClient): () => void {
  activeClients.add(client)
  return () => activeClients.delete(client)
}

/**
 * Destroy every mounted personalized cache and ask the provider for a fresh
 * instance. This is synchronous so stale user data cannot flash after logout.
 */
export function resetBrowserQueryCache(): void {
  for (const client of activeClients) client.clear()
  resetGeneration += 1

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(QUERY_CACHE_RESET_EVENT))
  }
}
