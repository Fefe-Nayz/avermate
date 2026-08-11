"use client"

import type { QueryClient } from "@tanstack/react-query"
import { orpc } from "./orpc"

/**
 * Academic configuration mutations can detach a year from its preset. Keep
 * every year-scoped announcement projection honest immediately instead of
 * waiting for its normal stale window.
 */
export function invalidateAnnouncementAudience(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.announcements.active.key(),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.announcements.history.key(),
    }),
  ])
}
