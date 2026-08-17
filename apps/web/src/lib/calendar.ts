import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns"

/**
 * Calendar arithmetic shared by everything in the app that draws a month.
 *
 * It lives here rather than beside one of them because the grades calendar and
 * the date picker have to agree on where a month starts and how a day is keyed
 * — a picker that buckets days differently from the calendar it is picking
 * from is how a late-evening grade ends up filed under the wrong day.
 */

/** A local calendar day, as a stable key. Never `toISOString` — that shifts. */
export function dayKey(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, "0")
  const day = `${value.getDate()}`.padStart(2, "0")
  return `${value.getFullYear()}-${month}-${day}`
}

/**
 * The days a month grid has to draw: whole weeks, so the grid stays
 * rectangular and the weekday columns line up.
 */
export function monthGrid(month: Date, weekStartsOn: 0 | 1): Date[] {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn }),
  })
}
