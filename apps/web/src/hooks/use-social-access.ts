"use client"

import { useQuery } from "@tanstack/react-query"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  socialAppIsAccessible,
  socialFeatureIsKnown,
  socialGroupIsAccessible,
  socialSetupIsAccessible,
  type SocialEligibilityView,
} from "@/lib/social-access"

/** Reads the request-prefetched, allow-listed eligibility projection. */
export function useSocialAccess() {
  const query = useQuery({
    ...orpc.social.eligibility.get.queryOptions(),
    staleTime: COMMON_QUERY_STALE_TIME,
    retry: false,
  })
  const eligibility: SocialEligibilityView | undefined = query.data

  return {
    eligibility,
    isLoading: query.isLoading,
    isKnown: socialFeatureIsKnown(eligibility),
    canAccess: socialGroupIsAccessible(eligibility),
    canAccessFriends: socialAppIsAccessible(eligibility),
    canConfigure: socialSetupIsAccessible(eligibility),
  }
}
