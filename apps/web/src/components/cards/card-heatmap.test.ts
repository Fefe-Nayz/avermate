import { describe, expect, test } from "bun:test"
import { calendarLayout } from "./card-heatmap"

/**
 * Deterministic naming, so the calendar is measured and not the locale data.
 * `Date.getDay()` is Sunday-first; the calendar draws Monday-first, and the two
 * orders disagreeing is exactly the kind of thing this file exists to catch.
 */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
const names = {
  weekday: (date: Date) => DAY_NAMES[date.getDay()]!,
  month: (date: Date) => `M${date.getMonth() + 1}`,
}

/** 2026-01-05 is a Monday, so a week here starts on the 5th. */
const on = (day: number) => ({ date: new Date(2026, 0, day) })

describe("heatmap calendar", () => {
  test("keeps one row when every point lands on the same weekday", () => {
    // A weekly series buckets to a single day. Drawing seven rows would leave
    // six of them empty and squeeze the cells into a seventh of the card.
    const weekly = calendarLayout([on(5), on(12), on(19)], names)

    expect(weekly?.weekdayLabels).toEqual(["Mon"])
    expect(weekly?.weeks).toEqual([0, 1, 2])
  })

  test("orders rows from Monday, not from Sunday", () => {
    // Sunday is `getDay() === 0`, so a naive sort puts it first. The calendar
    // is Monday-first, which puts the weekend where a reader expects it.
    const spread = calendarLayout([on(11), on(5), on(10)], names)

    expect(spread?.weekdayLabels).toEqual(["Mon", "Sat", "Sun"])
  })

  test("labels every cell with its own weekday", () => {
    // The rows and the labels used to be two arrays held in step by index, so
    // a cell could be drawn on one row and named after another. Each cell now
    // reads its own name, and this is the assertion that says so.
    const spread = calendarLayout([on(5), on(6), on(10), on(11)], names)

    for (const cell of spread?.cells ?? []) {
      expect(cell.weekdayLabel).toBe(DAY_NAMES[cell.date.getDay()]!)
    }
    expect(spread?.cells).toHaveLength(4)
  })

  test("counts weeks from the Monday of the earliest point, in any order", () => {
    // The origin is derived, not assumed to be the first row given.
    const shuffled = calendarLayout([on(20), on(7), on(14)], names)
    const weekOf = new Map(
      shuffled?.cells.map((cell) => [cell.date.getDate(), cell.week])
    )

    expect(weekOf.get(7)).toBe(0)
    expect(weekOf.get(14)).toBe(1)
    expect(weekOf.get(20)).toBe(2)
    expect(shuffled?.monthOf(0)).toBe("M1")
  })

  test("draws nothing rather than an empty grid", () => {
    expect(calendarLayout([], names)).toBeNull()
  })
})
