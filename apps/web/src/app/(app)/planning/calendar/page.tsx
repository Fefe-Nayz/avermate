import { cookies } from "next/headers"
import { notFound } from "next/navigation"
import { PlanningCalendarClient } from "@/components/planning/planning-calendar-client"
import {
  planningTimezoneCookie,
  readTimezoneCookie,
} from "@/lib/planning-timezone"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  planningCalendarInput,
  planningDayInput,
} from "@/lib/route-query-inputs"
import { HydrateClient } from "@/lib/query-server"
import { stickyCookieName } from "@/lib/sticky-state"
import type { PlanningView } from "@/components/planning/planning-model"

type PlanningCalendarSearchParams = Promise<
  Record<string, string | string[] | undefined>
>

export default async function PlanningCalendarPage({
  searchParams,
}: {
  searchParams: PlanningCalendarSearchParams
}) {
  const { activeYearId, queryClient, renderedAt } =
    await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  const locator = planningLocatorFromSearchParams(await searchParams)
  const located = locator
    ? await queryClient
        .fetchQuery({
          ...orpc.planning.locate.queryOptions({ input: locator }),
          staleTime: COMMON_QUERY_STALE_TIME,
        })
        .catch(() => null)
    : null
  if (locator && (!located || !located.available)) notFound()
  const focus = located?.available ? located : null
  const calendarYearId = focus?.yearId ?? activeYearId
  const anchor = focus ? new Date(focus.startsAt) : new Date(renderedAt)
  // A located item carries its own zone; otherwise the reader's, remembered from a
  // previous visit. Guessing UTC here cost the same wasted prefetch as on the hub.
  const timezone =
    focus?.timezone ??
    readTimezoneCookie((await cookies()).get(planningTimezoneCookie())?.value)
  const selectedDay = focus?.date ?? anchor.toISOString().slice(0, 10)
  const initialView = focus
    ? "day"
    : parsePlanningView(
        (await cookies()).get(
          stickyCookieName("avermate:planning-calendar-view")
        )?.value
      )
  const calendarInput = planningCalendarInput(
    calendarYearId,
    anchor,
    initialView,
    timezone
  )
  const reads: Array<Promise<unknown>> = [
    queryClient.fetchQuery({
      ...orpc.planning.day.queryOptions({
        input: planningDayInput(calendarYearId, selectedDay, timezone),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
  ]
  if (initialView !== "day") {
    reads.push(
      queryClient.fetchQuery({
        ...orpc.planning.calendar.queryOptions({ input: calendarInput }),
        staleTime: COMMON_QUERY_STALE_TIME,
      })
    )
  }
  await Promise.all(reads)

  return (
    <HydrateClient queryClient={queryClient}>
      <PlanningCalendarClient
        initialYearId={calendarYearId}
        initialYear={Number(selectedDay.slice(0, 4))}
        initialMonth={Number(selectedDay.slice(5, 7)) - 1}
        initialDay={selectedDay}
        initialFrom={calendarInput.from.toISOString()}
        initialTo={calendarInput.to.toISOString()}
        initialTimezone={timezone}
        initialNow={renderedAt}
        initialView={initialView}
        initialFocusId={focus?.id ?? null}
        initialFocusStartsAt={focus?.startsAt.toISOString() ?? null}
      />
    </HydrateClient>
  )
}

function planningLocatorFromSearchParams(
  params: Record<string, string | string[] | undefined>
) {
  const eventId = singleParam(params.eventId)
  const occurrenceId = singleParam(params.occurrenceId)
  if (eventId && !occurrenceId) {
    return { kind: "calendarEvent" as const, eventId }
  }
  if (occurrenceId && !eventId) {
    return { kind: "timetableOccurrence" as const, occurrenceId }
  }
  return null
}

function singleParam(value: string | string[] | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function parsePlanningView(value: string | undefined): PlanningView {
  if (!value) return "month"
  for (const candidate of [value, safeDecode(value)]) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed === "month" || parsed === "week" || parsed === "day") {
        return parsed
      }
    } catch {
      // A stale or hand-edited cookie falls back to the month view.
    }
  }
  return "month"
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
