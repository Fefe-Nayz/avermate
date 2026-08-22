import "server-only"

import {
  dehydrate,
  HydrationBoundary,
  type QueryClient,
} from "@tanstack/react-query"
import { cache, type ReactNode } from "react"
import { createQueryClient } from "./query-client"

/** One QueryClient per React server render/request, never shared across users. */
export function createServerQueryClient(): QueryClient {
  return createQueryClient()
}

/** Common layout cache, memoized only within the current React server request. */
export const getServerQueryClient = cache(createServerQueryClient)

/**
 * Hydrate the queries prefetched through getServerQueryClient.
 *
 * Everything that reads one of those queries must be a *descendant* of this.
 * A reader rendered as an earlier sibling creates the query itself, before the
 * boundary runs, and `HydrationBoundary` then treats the server's answer as an
 * update to an existing query — which it applies in an effect, one commit
 * later. The reader renders its default in the meantime, and the browser
 * fetches what the server already sent.
 */
export function HydrateClient({
  children,
  queryClient = getServerQueryClient(),
}: {
  children: ReactNode
  queryClient?: QueryClient
}) {
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  )
}
