import "server-only"

import { unstable_cache } from "next/cache"
import { getPublicServerRpc } from "./orpc/server"

/**
 * Low-volatility, anonymous landing-page aggregates. The app has not enabled
 * Cache Components, so unstable_cache is Next 16's supported previous-model
 * cache for this non-fetch operation.
 */
export const getPublicStats = unstable_cache(
  () => getPublicServerRpc().public.stats(),
  ["public-stats-v1"],
  { revalidate: 10 * 60, tags: ["public-stats"] }
)
