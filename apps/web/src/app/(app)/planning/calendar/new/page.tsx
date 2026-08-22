import { cookies } from "next/headers"
import { PlanningEventForm } from "@/components/planning/planning-event-form"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import {
  planningTimezoneCookie,
  readTimezoneCookie,
} from "@/lib/planning-timezone"

/**
 * The day the form opens on comes from the address when the calendar sent you
 * here, so adding something to next Tuesday starts on next Tuesday.
 */
export default async function NewPlanningCalendarItemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { activeYearId, renderedAt } = await prepareAuthenticatedShell()
  const params = await searchParams
  const raw = params.date
  const asked = Array.isArray(raw) ? raw[0] : raw
  const timezone = readTimezoneCookie(
    (await cookies()).get(planningTimezoneCookie())?.value
  )
  const today = new Date(renderedAt).toISOString().slice(0, 10)

  return (
    <PlanningEventForm
      yearId={activeYearId}
      timezone={timezone}
      mode="create"
      initialDate={asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today}
    />
  )
}
