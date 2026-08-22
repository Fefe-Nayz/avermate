import { cookies } from "next/headers"
import { PlanningHubClient } from "@/components/planning/planning-hub-client"
import {
  planningTimezoneCookie,
  readTimezoneCookie,
} from "@/lib/planning-timezone"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  planningAssignmentsInput,
  planningCalendarInput,
  planningTasksInput,
} from "@/lib/route-query-inputs"
import { HydrateClient } from "@/lib/query-server"

export default async function PlanningPage() {
  const { activeYearId, queryClient, renderedAt } =
    await prepareAuthenticatedShell()
  const anchor = new Date(renderedAt)
  /**
   * The reader's own timezone, when a previous visit recorded it.
   *
   * Hardcoding UTC meant the client recomputed the window in its real zone on the first
   * render, missed the cache this page had just filled, and refetched — so the prefetch
   * below was wasted for everyone outside UTC and the panel loaded twice.
   */
  const timezone = readTimezoneCookie(
    (await cookies()).get(planningTimezoneCookie())?.value
  )
  const calendarInput = planningCalendarInput(
    activeYearId,
    anchor,
    "month",
    timezone
  )
  const orpc = getServerOrpc()

  await Promise.all([
    queryClient.fetchQuery({
      ...orpc.planning.assignments.list.queryOptions({
        input: planningAssignmentsInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.fetchQuery({
      ...orpc.planning.tasks.list.queryOptions({
        input: planningTasksInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.fetchQuery({
      ...orpc.planning.calendar.queryOptions({ input: calendarInput }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <PlanningHubClient
        initialYearId={activeYearId}
        initialYear={anchor.getUTCFullYear()}
        initialMonth={anchor.getUTCMonth()}
        initialFrom={calendarInput.from.toISOString()}
        initialTo={calendarInput.to.toISOString()}
        initialTimezone={timezone}
        initialNow={renderedAt}
      />
    </HydrateClient>
  )
}
