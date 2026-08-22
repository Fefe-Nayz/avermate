import { describe, expect, test } from "bun:test"
import {
  placeDayItems,
  timeGridWindow,
  type TimeGridWindow,
} from "./planning-time-grid"
import type { PlanningItem } from "./planning-model"

/**
 * Placing an item on a day column.
 *
 * The week view was seven stacked lists: an eight o'clock lesson and a five o'clock
 * meeting drew the same card in the same place, so the one thing a week is read for —
 * where the day's gaps are — was the one thing it could not show. This is the arithmetic
 * that replaced them, kept out of the render so it can be checked.
 */

const at = (hour: number, minute = 0) => {
  const date = new Date(2026, 7, 21, hour, minute, 0, 0)
  return date
}

const item = (
  id: string,
  fromHour: number,
  toHour: number,
  allDay = false
): PlanningItem => ({
  id,
  kind: "lesson",
  title: id,
  startsAt: at(fromHour),
  endsAt: at(toHour),
  allDay,
  subjectId: null,
  management: {
    mode: "user",
    syncState: "detached",
    sourceConnectionId: null,
    externalId: null,
    lockedFields: [],
    editableFields: [],
  },
})

const window: TimeGridWindow = { fromHour: 7, toHour: 19 }

describe("the hours a day is drawn over", () => {
  test("follows the day's own contents, with room on each side", () => {
    expect(timeGridWindow([item("a", 9, 11)])).toEqual({
      fromHour: 7,
      toHour: 19,
    })
  })

  test("opens earlier for an early start", () => {
    // A seven o'clock lesson must not touch the top edge of the grid.
    expect(timeGridWindow([item("dawn", 7, 8)]).fromHour).toBe(6)
  })

  test("stays a school day when nothing is scheduled", () => {
    // An empty week still has to look like a week rather than a single line.
    expect(timeGridWindow([])).toEqual({ fromHour: 7, toHour: 19 })
  })

  test("ignores all-day entries, which are not on the axis", () => {
    expect(timeGridWindow([item("holiday", 0, 23, true)])).toEqual({
      fromHour: 7,
      toHour: 19,
    })
  })
})

describe("laying a day out", () => {
  test("gives a lone item the whole column", () => {
    const [placed] = placeDayItems([item("maths", 8, 10)], window)

    expect(placed).toMatchObject({ startMinutes: 480, endMinutes: 600 })
    expect(placed?.left).toBe(0)
    expect(placed?.width).toBe(1)
  })

  test("splits the column between two that overlap", () => {
    const placed = placeDayItems(
      [item("maths", 8, 10), item("colle", 9, 11)],
      window
    )

    expect(placed.map((entry) => entry.width)).toEqual([0.5, 0.5])
    expect(placed.map((entry) => entry.left)).toEqual([0, 0.5])
  })

  test("gives the column back once the overlap is over", () => {
    // Two at nine, one alone at four: the afternoon item keeps the full width.
    const placed = placeDayItems(
      [item("maths", 8, 10), item("colle", 9, 11), item("club", 16, 17)],
      window
    )

    expect(placed.find((entry) => entry.item.id === "club")).toMatchObject({
      left: 0,
      width: 1,
    })
  })

  test("keeps a bare timestamp visible", () => {
    // An item with no duration would otherwise be a zero-height target.
    const [placed] = placeDayItems([item("bell", 12, 12)], window)

    expect((placed?.endMinutes ?? 0) - (placed?.startMinutes ?? 0)).toBe(30)
  })

  test("clamps an item that starts before the window opens", () => {
    const [placed] = placeDayItems([item("earlier", 5, 8)], window)

    expect(placed?.startMinutes).toBe(7 * 60)
  })

  test("leaves all-day entries off the axis", () => {
    expect(placeDayItems([item("holiday", 0, 23, true)], window)).toEqual([])
  })
})
