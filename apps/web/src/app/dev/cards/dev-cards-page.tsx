"use client"

import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
} from "@tanstack/react-query"
import { useState } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { YearProvider } from "@/components/year/year-provider"
import { CardMatrixBench } from "@/components/cards/card-matrix-bench"
import {
  FIXTURE_NOW,
  FIXTURE_YEAR_ID,
} from "@/components/cards/card-matrix-fixture"
import { createQueryClient } from "@/lib/query-client"

/**
 * The bench's own providers, and only the ones it needs.
 *
 * Not `AuthenticatedProviders`: that mounts the appearance sync, which reads the
 * account — and a 401 there clears the cache this page *is*, then sends the
 * browser to sign-in. The year provider is the real one, reading the real
 * seeded caches, which is the part that has to be faithful.
 */
export function DevCardsPage({
  dehydratedState,
}: {
  dehydratedState: DehydratedState
}) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>
        <TooltipProvider delay={200}>
          <YearProvider
            initialNow={FIXTURE_NOW.getTime()}
            initialYearId={FIXTURE_YEAR_ID}
          >
            <CardMatrixBench />
          </YearProvider>
        </TooltipProvider>
      </HydrationBoundary>
    </QueryClientProvider>
  )
}
