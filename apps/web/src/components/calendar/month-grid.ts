import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns"

/** A local calendar day as a stable key. Never use UTC for visual buckets. */
export function dayKey(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, "0")
  const day = `${value.getDate()}`.padStart(2, "0")
  return `${value.getFullYear()}-${month}-${day}`
}

/** Whole weeks around one month, so every weekday column stays aligned. */
export function monthGrid(month: Date, weekStartsOn: 0 | 1): Date[] {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn }),
  })
}
