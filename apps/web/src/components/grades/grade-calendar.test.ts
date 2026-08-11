import { describe, expect, test } from "bun:test"
import type { Grade } from "@avermate/core"
import { dayKey, groupGradesByDay, monthGrid } from "./grade-calendar"

function grade(id: string, passedAt: Date): Grade {
  return {
    id,
    name: "Oral exam",
    value: 15,
    outOf: 20,
    coefficient: 2,
    passedAt,
    createdAt: passedAt,
    subjectId: "subject-1",
    periodId: "period-1",
    components: [],
  }
}

describe("grade calendar", () => {
  test("buckets a grade into the local day it was sat", () => {
    // Late evening local time. Bucketing this in UTC — as the previous
    // scheduling calendar did — pushed it onto the following day, so the
    // calendar and the month-grouped list disagreed about which month a
    // grade belonged to.
    const late = new Date(2026, 7, 31, 23, 30)
    const byDay = groupGradesByDay([grade("grade-1", late)])

    expect([...byDay.keys()]).toEqual(["2026-08-31"])
  })

  test("keeps every grade on a day rather than the last one", () => {
    const day = new Date(2026, 2, 14, 9, 0)
    const byDay = groupGradesByDay([
      grade("grade-1", day),
      grade("grade-2", new Date(2026, 2, 14, 15, 0)),
    ])

    expect(byDay.get("2026-03-14")).toHaveLength(2)
  })

  test("pads the month to whole weeks so the columns line up", () => {
    const days = monthGrid(new Date(2026, 7, 1), 1)

    expect(days.length % 7).toBe(0)
    expect(days[0]?.getDay()).toBe(1)
    expect(dayKey(days[0] as Date)).toBe("2026-07-27")
  })

  test("respects a Sunday week start", () => {
    const days = monthGrid(new Date(2026, 7, 1), 0)

    expect(days[0]?.getDay()).toBe(0)
  })
})
