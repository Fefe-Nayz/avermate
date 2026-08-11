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

/** Hydrate the queries prefetched through getServerQueryClient. */
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
