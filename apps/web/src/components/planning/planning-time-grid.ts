import {
  planningItemEnd,
  planningItemStart,
  type PlanningItem,
} from "./planning-model"

/**
 * Where a timed item sits on a day column.
 *
 * The week view used to be seven stacked lists, so a lesson at eight and a meeting at
 * five in the afternoon drew the same card in the same place: the one thing a week is
 * read for — the shape of a day, where the gaps are — was the one thing it could not
 * show. Placing an item needs arithmetic, and arithmetic belongs somewhere it can be
 * tested rather than inside a render.
 */

export interface TimeGridPlacement {
  item: PlanningItem
  /** Minutes from midnight, clamped into the visible window. */
  startMinutes: number
  endMinutes: number
  /** 0..1 across the column, so overlapping items sit side by side. */
  left: number
  width: number
}

export interface TimeGridWindow {
  /** First and last hour drawn, inclusive of the first, exclusive of the last. */
  fromHour: number
  toHour: number
}

/** The minute of the day an item starts, in local time. */
function minutesOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * The hours worth drawing.
 *
 * A fixed 00:00–24:00 axis spends two thirds of its height on hours nobody has a lesson
 * in. The window follows the day's own contents, padded by an hour on each side so an
 * item never touches the edge, and never narrower than a school morning-to-evening so an
 * empty week still looks like a week.
 */
export function timeGridWindow(items: readonly PlanningItem[]): TimeGridWindow {
  let earliest = 8 * 60
  let latest = 18 * 60
  for (const item of items) {
    if (item.allDay) continue
    const start = planningItemStart(item)
    const end = planningItemEnd(item)
    if (!start) continue
    earliest = Math.min(earliest, minutesOf(start))
    latest = Math.max(latest, minutesOf(end ?? start))
  }
  return {
    fromHour: Math.max(0, Math.floor(earliest / 60) - 1),
    toHour: Math.min(24, Math.ceil(latest / 60) + 1),
  }
}

/**
 * Lay a day's timed items out, splitting the column between the ones that overlap.
 *
 * Greedy by design: items are walked in start order and each one takes the first lane
 * whose last item has already finished. That is what a calendar is expected to do —
 * two lessons at the same hour stand side by side — and it needs no lookahead. A cluster
 * shares the column equally rather than cascading, because a reader compares the two
 * blocks against the axis, not against each other.
 */
export function placeDayItems(
  items: readonly PlanningItem[],
  window: TimeGridWindow
): TimeGridPlacement[] {
  const dayStart = window.fromHour * 60
  const dayEnd = window.toHour * 60
  const timed = items
    .filter((item) => !item.allDay)
    .flatMap((item) => {
      const start = planningItemStart(item)
      if (!start) return []
      const end = planningItemEnd(item) ?? start
      const startMinutes = Math.max(
        dayStart,
        Math.min(dayEnd, minutesOf(start))
      )
      // A zero-length item would be invisible; every entry gets half an hour of
      // presence so a bare timestamp is still something to aim at.
      const rawEnd = minutesOf(end)
      const endMinutes = Math.max(
        startMinutes + 30,
        Math.max(dayStart, Math.min(dayEnd, rawEnd))
      )
      return [{ item, startMinutes, endMinutes }]
    })
    .sort((left, right) => left.startMinutes - right.startMinutes)

  // Clusters of items that touch, so a pair at nine shares the width and an
  // afternoon item alone keeps all of it.
  const placements: TimeGridPlacement[] = []
  let cluster: Array<{
    item: PlanningItem
    startMinutes: number
    endMinutes: number
    lane: number
  }> = []
  let clusterEnd = -1

  const flush = () => {
    if (cluster.length === 0) return
    const lanes = Math.max(...cluster.map((entry) => entry.lane)) + 1
    for (const entry of cluster) {
      placements.push({
        item: entry.item,
        startMinutes: entry.startMinutes,
        endMinutes: entry.endMinutes,
        left: entry.lane / lanes,
        width: 1 / lanes,
      })
    }
    cluster = []
    clusterEnd = -1
  }

  for (const entry of timed) {
    if (cluster.length > 0 && entry.startMinutes >= clusterEnd) flush()
    const taken = new Set(
      cluster
        .filter((other) => other.endMinutes > entry.startMinutes)
        .map((other) => other.lane)
    )
    let lane = 0
    while (taken.has(lane)) lane += 1
    cluster.push({ ...entry, lane })
    clusterEnd = Math.max(clusterEnd, entry.endMinutes)
  }
  flush()

  return placements
}

/** The all-day entries, which live in a strip above the axis rather than on it. */
export function allDayItems(items: readonly PlanningItem[]): PlanningItem[] {
  return items.filter((item) => item.allDay)
}
