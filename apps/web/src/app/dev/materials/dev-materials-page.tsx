"use client"

import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
} from "@tanstack/react-query"
import { useState } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { YearProvider } from "@/components/year/year-provider"
import {
  FIXTURE_NOW,
  FIXTURE_YEAR_ID,
} from "@/components/cards/card-matrix-fixture"
import { createQueryClient } from "@/lib/query-client"
import { MaterialsClient } from "@/components/materials/materials-client"

export function DevMaterialsPage({
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
            {/* The shell gives this screen the whole pane, so the harness
                has to as well or the two panes have no height to share. */}
            <div className="flex h-svh min-h-0 flex-col overflow-hidden">
              <MaterialsClient />
            </div>
          </YearProvider>
        </TooltipProvider>
      </HydrationBoundary>
    </QueryClientProvider>
  )
}
