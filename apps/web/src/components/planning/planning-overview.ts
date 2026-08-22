import {
  comparePlanningItems,
  planningItemIsComplete,
  planningItemStart,
  type PlanningItem,
} from "./planning-model"

/**
 * What the planning screen is actually for.
 *
 * It used to open on three counters that repeated the three tabs above them,
 * and then one flat list of eight things — classes, homework and tasks run
 * together in one column with no day boundaries, nothing to tick, and every row
 * a link to somewhere else. Three ways of saying the same three words, and then
 * a list that answered no question in particular.
 *
 * A student arriving here asks two things, and they are not the same question:
 *
 * - **What do I have to do?** Unfinished work, most urgent first, overdue at the
 *   top. Chronology is the wrong order for this: something three days late
 *   belongs above a class starting in an hour.
 * - **What is coming?** The next days, in order, grouped by day — because "Sat,
 *   Aug 22" repeated on five consecutive rows is a day heading written five
 *   times.
 *
 * So this module answers exactly those, and the screen renders the answers.
 */

const DAY_MS = 86_400_000

export interface PlanningDayGroup {
  /** Midnight of the day, in the reader's own zone. */
  date: Date
  items: PlanningItem[]
}

/** Midnight of `date`, so two instants on the same day compare equal. */
export function startOfDay(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

/** Whole days from today to `date`: 0 today, 1 tomorrow, -1 yesterday. */
export function dayOffset(date: Date, now: Date): number {
  return Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS
  )
}

/**
 * Something unfinished whose moment has passed.
 *
 * An all-day item is late only once its whole day is over: homework due "Friday"
 * is not late at nine in the morning on Friday.
 */
export function planningItemIsOverdue(item: PlanningItem, now: Date): boolean {
  if (planningItemIsComplete(item)) return false
  const start = planningItemStart(item)
  if (!start) return false
  if (item.allDay) return dayOffset(start, now) < 0
  return start.getTime() < now.getTime()
}

/**
 * The work, most urgent first.
 *
 * Only what a person can finish — homework and tasks. A lesson is not a to-do:
 * it happens whether or not you tick it, and mixing the two is what made the old
 * list unreadable. Something with no date at all sorts last rather than being
 * dropped, because a task nobody dated is still a task.
 */
export function planningTodo(
  items: readonly PlanningItem[],
  now: Date
): PlanningItem[] {
  return items
    .filter(
      (item) =>
        (item.kind === "assignment" || item.kind === "task") &&
        !planningItemIsComplete(item) &&
        !item.cancelled
    )
    .sort((left, right) => {
      const leftLate = planningItemIsOverdue(left, now)
      const rightLate = planningItemIsOverdue(right, now)
      if (leftLate !== rightLate) return leftLate ? -1 : 1
      const leftAt = planningItemStart(left)?.getTime()
      const rightAt = planningItemStart(right)?.getTime()
      if (leftAt === undefined || rightAt === undefined) {
        if (leftAt === rightAt) return left.title.localeCompare(right.title)
        return leftAt === undefined ? 1 : -1
      }
      return leftAt - rightAt || left.title.localeCompare(right.title)
    })
}

/**
 * The days ahead, each with what happens on it.
 *
 * Today is always the first group, even when it is empty — "nothing left today"
 * is an answer, and a screen that silently starts at tomorrow leaves the reader
 * checking the date. Days after it appear only when they hold something.
 */
export function planningDays(
  items: readonly PlanningItem[],
  now: Date,
  days = 7
): PlanningDayGroup[] {
  const buckets = new Map<number, PlanningItem[]>([[0, []]])

  for (const item of items) {
    if (item.cancelled || planningItemIsComplete(item)) continue
    const start = planningItemStart(item)
    if (!start) continue
    const offset = dayOffset(start, now)
    if (offset < 0 || offset >= days) continue
    const bucket = buckets.get(offset)
    if (bucket) bucket.push(item)
    else buckets.set(offset, [item])
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([offset, dayItems]) => ({
      date: new Date(startOfDay(now).getTime() + offset * DAY_MS),
      items: [...dayItems].sort(comparePlanningItems),
    }))
}

/**
 * The next thing today, which is what a glance at this screen is for.
 *
 * Something running right now wins over something starting later: at 12:20 the
 * answer to "what now" is the class you are sitting in, not the next one. All-day
 * items are excluded — they are not a *next thing*, they are the whole day.
 */
export function planningNextToday(
  items: readonly PlanningItem[],
  now: Date
): PlanningItem | null {
  const candidates = items.filter(
    (item) =>
      !item.cancelled &&
      !item.allDay &&
      !planningItemIsComplete(item) &&
      item.kind !== "task" &&
      item.kind !== "assignment"
  )

  let running: PlanningItem | null = null
  let next: PlanningItem | null = null

  for (const item of candidates) {
    const start = planningItemStart(item)
    if (!start || dayOffset(start, now) !== 0) continue
    const end = item.endsAt ? new Date(item.endsAt) : null
    if (
      start.getTime() <= now.getTime() &&
      end &&
      end.getTime() > now.getTime()
    ) {
      if (!running || start > (planningItemStart(running) as Date))
        running = item
      continue
    }
    if (start.getTime() < now.getTime()) continue
    if (!next || start < (planningItemStart(next) as Date)) next = item
  }

  return running ?? next
}
