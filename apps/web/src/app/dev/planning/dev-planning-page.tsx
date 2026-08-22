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
import { PlanningHubClient } from "@/components/planning/planning-hub-client"
import { PlanningNavigation } from "@/components/planning/planning-navigation"
import { PlanningCalendarClient } from "@/components/planning/planning-calendar-client"
import { PlanningTasksClient } from "@/components/planning/planning-tasks-client"

export function DevPlanningPage({
  dehydratedState,
  from,
  to,
  selectedDay,
}: {
  dehydratedState: DehydratedState
  from: string
  to: string
  selectedDay: string
}) {
  const [queryClient] = useState(createQueryClient)
  const anchor = new Date(FIXTURE_NOW)
  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>
        <TooltipProvider delay={200}>
          <YearProvider
            initialNow={FIXTURE_NOW.getTime()}
            initialYearId={FIXTURE_YEAR_ID}
          >
            {/* The rail lives in the route layout, which the bench does not
                mount — rendered here so the bench still shows the screen the
                way the app does. */}
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 p-4 md:flex-row md:items-start md:gap-8">
              <PlanningNavigation />
              <div className="flex min-w-0 flex-1 flex-col gap-12">
                <section id="hub">
                  <PlanningHubClient
                    initialYearId={FIXTURE_YEAR_ID}
                    initialYear={anchor.getFullYear()}
                    initialMonth={anchor.getMonth()}
                    initialFrom={from}
                    initialTo={to}
                    initialTimezone="Europe/Paris"
                    initialNow={FIXTURE_NOW.getTime()}
                  />
                </section>
                <section id="calendar">
                  <PlanningCalendarClient
                    initialYearId={FIXTURE_YEAR_ID}
                    initialYear={anchor.getFullYear()}
                    initialMonth={anchor.getMonth()}
                    initialDay={selectedDay}
                    initialFrom={from}
                    initialTo={to}
                    initialTimezone="Europe/Paris"
                    initialNow={FIXTURE_NOW.getTime()}
                    initialView="week"
                    initialFocusId={null}
                    initialFocusStartsAt={null}
                  />
                </section>
                <section id="tasks">
                  <PlanningTasksClient initialYearId={FIXTURE_YEAR_ID} />
                </section>
              </div>
            </div>
          </YearProvider>
        </TooltipProvider>
      </HydrationBoundary>
    </QueryClientProvider>
  )
}
