import { describe, expect, test } from "bun:test"
import type { Grade } from "@avermate/core"
import { buildGradeCalendarEvents } from "./grade-calendar"

const grade: Grade = {
  id: "grade-1",
  name: "Oral exam",
  value: 15,
  outOf: 20,
  coefficient: 2,
  passedAt: new Date("2026-08-11T14:45:00.000Z"),
  createdAt: new Date("2026-08-11T15:00:00.000Z"),
  subjectId: "subject-1",
  periodId: "period-1",
  components: [],
}

describe("grade calendar events", () => {
  test("maps grades to read-only, UTC-safe all-day events", () => {
    const [event] = buildGradeCalendarEvents([grade], () => "English")

    expect(event).toMatchObject({
      id: "grade-1",
      title: "Oral exam",
      allDay: true,
      readOnly: true,
      data: {
        gradeId: "grade-1",
        subjectName: "English",
        coefficient: 2,
        ratio: 0.75,
      },
    })
    expect(event?.start.toISOString()).toBe("2026-08-11T00:00:00.000Z")
    expect(event?.end.toISOString()).toBe("2026-08-12T00:00:00.000Z")
    expect(event?.color).toMatch(/^var\(--chart-[1-5]\)$/)
  })

  test("keeps subject colors stable without coupling them to display names", () => {
    const second = { ...grade, id: "grade-2", name: "Written exam" }
    const events = buildGradeCalendarEvents([grade, second], () => "English")

    expect(events[0]?.color).toBe(events[1]?.color)
  })
})
