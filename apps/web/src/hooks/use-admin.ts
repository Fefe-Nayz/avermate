"use client";

import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";

/**
 * Whether the signed-in account administers the site.
 *
 * Asked of the server rather than read off `user.role`, because an account can
 * also be an administrator through `ADMIN_USER_IDS` — which is how the first
 * one exists at all, before anybody can promote anybody.
 */
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const query = useQuery({
    ...orpc.admin.access.queryOptions(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    isAdmin: query.data?.isAdmin ?? false,
    isLoading: query.isLoading,
  };
}
