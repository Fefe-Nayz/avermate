import { describe, expect, test } from "bun:test"
import {
  endOfZonedDay,
  isPlanningEventKind,
  isoWeekday,
  minutesOfDay,
  timeInTimeZone,
  zonedDateTime,
} from "./planning-calendar-time"

/**
 * What a calendar form types, and what the database stores.
 *
 * The form works in wall-clock strings because that is what a person types; the
 * database works in instants. These are the conversions in between, and the
 * zone is explicit in every one of them — reading a lesson at "09:00" in the
 * browser's zone rather than the timetable's is how a class moves an hour on
 * the day the clocks change.
 */

describe("reading a time field", () => {
  test("counts minutes from midnight", () => {
    expect(minutesOfDay("00:00")).toBe(0)
    expect(minutesOfDay("09:30")).toBe(570)
    expect(minutesOfDay("23:59")).toBe(1439)
  })
})

describe("a date and a time, as an instant", () => {
  test("is read in the zone it is given, not the machine's", () => {
    const paris = zonedDateTime("2026-08-24", "09:00", "Europe/Paris")
    const utc = zonedDateTime("2026-08-24", "09:00", "UTC")

    expect(paris).not.toBeNull()
    expect(utc).not.toBeNull()
    // Paris is two hours ahead in August, so the same wall clock is earlier.
    expect(utc!.getTime() - paris!.getTime()).toBe(2 * 60 * 60 * 1000)
  })

  test("refuses a field that holds nothing usable", () => {
    expect(zonedDateTime("", "09:00", "UTC")).toBeNull()
    expect(zonedDateTime("2026-08-24", "9h", "UTC")).toBeNull()
    expect(zonedDateTime("2026-08-24", "", "UTC")).toBeNull()
  })

  test("round-trips through the clock reader", () => {
    const instant = zonedDateTime("2026-08-24", "14:05", "Europe/Paris")

    expect(timeInTimeZone(instant!, "Europe/Paris")).toBe("14:05")
  })
})

describe("the end of an all-day thing", () => {
  test("is the last instant of its day, not 23:59 sharp", () => {
    // A minute of the day outside the day it belongs to is a minute where an
    // all-day event has already ended.
    const end = endOfZonedDay("2026-08-24", "UTC")
    const nextDay = zonedDateTime("2026-08-25", "00:00", "UTC")

    expect(end).not.toBeNull()
    expect(nextDay!.getTime() - end!.getTime()).toBe(1)
  })
})

describe("which weekday a date is", () => {
  test("counts Monday as 1 and Sunday as 7", () => {
    // 2026-08-24 is a Monday; the recurrence rule wants ISO numbering.
    expect(isoWeekday("2026-08-24")).toBe(1)
    expect(isoWeekday("2026-08-30")).toBe(7)
  })
})

describe("which kinds of entry exist", () => {
  test("recognises the four", () => {
    expect(isPlanningEventKind("holiday")).toBe(true)
    expect(isPlanningEventKind("lesson")).toBe(false)
    expect(isPlanningEventKind(undefined)).toBe(false)
  })
})
