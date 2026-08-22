import { zonedDateTimeToDate } from "@avermate/core/planning"

/**
 * Turning what a form field holds into an instant, and back.
 *
 * A calendar form works in wall-clock strings — "2026-08-24", "09:00" — because
 * that is what a person types and what a date control returns. The database
 * works in instants. Everything in between happens here, in one place, so the
 * form and any other screen that has to read those strings cannot disagree
 * about which minute they mean.
 *
 * The zone is always explicit. Reading a lesson at "09:00" in the browser's own
 * zone rather than the timetable's is how a class moves an hour on the day the
 * clocks change.
 */

export type PlanningEventKind = "event" | "block" | "holiday" | "workday"
export type PlanningLessonRepeat = "once" | "weekly" | "daily"

export function isPlanningEventKind(
  value: unknown
): value is PlanningEventKind {
  return ["event", "block", "holiday", "workday"].includes(String(value))
}

/** Minutes since midnight, from an `HH:mm` field. */
export function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** A date and a time in one zone, as an instant. `null` when either is unusable. */
export function zonedDateTime(
  date: string,
  time: string,
  timezone: string
): Date | null {
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return null
  try {
    return zonedDateTimeToDate(date, minutesOfDay(time), timezone)
  } catch {
    return null
  }
}

/** The clock part of an instant, read in a given zone. */
export function timeInTimeZone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value)
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00"
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00"
  return `${hour}:${minute}`
}

/** ISO weekday, Monday 1 to Sunday 7 — the shape the recurrence rule wants. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay()
  return day === 0 ? 7 : day
}

/**
 * The last instant of a day in a zone.
 *
 * An all-day thing ends when its day does, and "23:59" would leave the final
 * minute outside it — hence the trailing 59.999 seconds.
 */
export function endOfZonedDay(date: string, timezone: string): Date | null {
  const lastMinute = zonedDateTime(date, "23:59", timezone)
  return lastMinute ? new Date(lastMinute.getTime() + 59_999) : null
}
