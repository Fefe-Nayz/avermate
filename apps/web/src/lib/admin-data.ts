import "server-only"

import { notFound } from "next/navigation"
import { cache } from "react"
import { requireServerViewer } from "./authenticated-data"
import { getServerOrpc } from "./orpc/server"
import { COMMON_QUERY_STALE_TIME } from "./query-policy"
import { getServerQueryClient } from "./query-server"

/** Request-memoized server navigation gate for the complete admin subtree. */
export const requireServerAdmin = cache(async (): Promise<void> => {
  // Give the authenticated layout's redirect precedence over a protected
  // access-query error when layouts and pages render concurrently.
  await requireServerViewer()

  const access = await getServerQueryClient().fetchQuery({
    ...getServerOrpc().admin.access.queryOptions(),
    staleTime: COMMON_QUERY_STALE_TIME,
    retry: false,
  })

  if (!access.isAdmin) notFound()
})
