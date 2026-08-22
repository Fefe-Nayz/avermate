import { describe, expect, test } from "bun:test"
import {
  dayOffset,
  planningDays,
  planningItemIsOverdue,
  planningNextToday,
  planningTodo,
} from "./planning-overview"
import type { PlanningItem } from "./planning-model"

/**
 * The two questions the planning screen exists to answer.
 *
 * It opened on three counters repeating the three tabs above them and one flat
 * list of eight rows — classes, homework and tasks run together, nothing to tick,
 * every row a link elsewhere. These are the answers the screen renders instead.
 */

const NOW = new Date(2026, 7, 21, 12, 30)
const at = (day: number, hour = 9, minute = 0) =>
  new Date(2026, 7, day, hour, minute)

const item = (over: Partial<PlanningItem> & { id: string }): PlanningItem => ({
  kind: "task",
  title: over.id,
  startsAt: null,
  endsAt: null,
  allDay: false,
  subjectId: null,
  management: {
    mode: "local",
    syncState: "local",
    lockedFields: [],
  } as unknown as PlanningItem["management"],
  ...over,
})

describe("what is still to do", () => {
  test("late work first, whatever its date says", () => {
    // Something three days late belongs above a class starting in an hour, which
    // is exactly what a chronological list gets wrong.
    const rows = planningTodo(
      [
        item({ id: "soon", kind: "assignment", dueAt: at(23) }),
        item({ id: "late", kind: "assignment", dueAt: at(18) }),
        item({ id: "today", kind: "task", scheduledAt: at(21, 17) }),
      ],
      NOW
    )

    expect(rows.map((row) => row.id)).toEqual(["late", "today", "soon"])
  })

  test("holds only what a person can finish", () => {
    // A lesson happens whether or not you tick it.
    const rows = planningTodo(
      [
        item({ id: "lesson", kind: "lesson", startsAt: at(21, 14) }),
        item({ id: "task", kind: "task", scheduledAt: at(21, 15) }),
      ],
      NOW
    )

    expect(rows.map((row) => row.id)).toEqual(["task"])
  })

  test("drops what is already done, and what was cancelled", () => {
    const rows = planningTodo(
      [
        item({ id: "done", kind: "task", status: "done", scheduledAt: at(21) }),
        item({ id: "off", kind: "task", cancelled: true, scheduledAt: at(21) }),
        item({ id: "open", kind: "task", scheduledAt: at(21) }),
      ],
      NOW
    )

    expect(rows.map((row) => row.id)).toEqual(["open"])
  })

  test("keeps an undated task, at the end", () => {
    // Nobody dated it; that does not make it not a task.
    const rows = planningTodo(
      [
        item({ id: "undated", kind: "task" }),
        item({ id: "dated", kind: "task", scheduledAt: at(25) }),
      ],
      NOW
    )

    expect(rows.map((row) => row.id)).toEqual(["dated", "undated"])
  })
})

describe("what counts as late", () => {
  test("an all-day item is late only once its day is over", () => {
    // Homework due "Friday" is not late at nine in the morning on Friday.
    const today = item({
      id: "today",
      kind: "assignment",
      allDay: true,
      dueAt: at(21),
    })
    const yesterday = item({
      id: "yesterday",
      kind: "assignment",
      allDay: true,
      dueAt: at(20),
    })

    expect(planningItemIsOverdue(today, NOW)).toBe(false)
    expect(planningItemIsOverdue(yesterday, NOW)).toBe(true)
  })

  test("a timed item is late the minute it passes", () => {
    expect(
      planningItemIsOverdue(
        item({ id: "x", kind: "task", scheduledAt: at(21, 12, 0) }),
        NOW
      )
    ).toBe(true)
  })

  test("something finished is never late", () => {
    expect(
      planningItemIsOverdue(
        item({ id: "x", kind: "task", status: "done", scheduledAt: at(18) }),
        NOW
      )
    ).toBe(false)
  })
})

describe("the days ahead", () => {
  test("today comes first even with nothing in it", () => {
    // "Nothing left today" is an answer; a list that silently starts tomorrow
    // leaves the reader checking the date.
    const days = planningDays([], NOW)

    expect(days).toHaveLength(1)
    expect(dayOffset(days[0]!.date, NOW)).toBe(0)
    expect(days[0]!.items).toEqual([])
  })

  test("one group per day, in time order inside it", () => {
    const days = planningDays(
      [
        item({ id: "late-today", kind: "lesson", startsAt: at(21, 16) }),
        item({ id: "early-today", kind: "lesson", startsAt: at(21, 14) }),
        item({ id: "tomorrow", kind: "lesson", startsAt: at(22, 8) }),
      ],
      NOW
    )

    expect(days.map((day) => day.items.map((row) => row.id))).toEqual([
      ["early-today", "late-today"],
      ["tomorrow"],
    ])
  })

  test("a day with nothing on it is not a heading", () => {
    const days = planningDays(
      [item({ id: "friday", kind: "lesson", startsAt: at(24, 9) })],
      NOW
    )

    expect(days.map((day) => dayOffset(day.date, NOW))).toEqual([0, 3])
  })

  test("stops at the horizon, and never looks back", () => {
    const days = planningDays(
      [
        item({ id: "past", kind: "lesson", startsAt: at(19) }),
        item({ id: "far", kind: "lesson", startsAt: at(30) }),
      ],
      NOW,
      7
    )

    expect(days).toHaveLength(1)
  })
})

describe("what is happening now", () => {
  test("the class you are sitting in beats the one after it", () => {
    // At 12:30 the answer to "what now" is the period in progress.
    const next = planningNextToday(
      [
        item({
          id: "running",
          kind: "lesson",
          startsAt: at(21, 12),
          endsAt: at(21, 13),
        }),
        item({ id: "later", kind: "lesson", startsAt: at(21, 14) }),
      ],
      NOW
    )

    expect(next?.id).toBe("running")
  })

  test("otherwise the next one today", () => {
    const next = planningNextToday(
      [
        item({ id: "done-with", kind: "lesson", startsAt: at(21, 8) }),
        item({ id: "later", kind: "lesson", startsAt: at(21, 14) }),
        item({ id: "tomorrow", kind: "lesson", startsAt: at(22, 8) }),
      ],
      NOW
    )

    expect(next?.id).toBe("later")
  })

  test("an all-day item is not a next thing", () => {
    // It is the whole day, so it answers a different question.
    expect(
      planningNextToday(
        [item({ id: "trip", kind: "event", allDay: true, startsAt: at(21) })],
        NOW
      )
    ).toBeNull()
  })

  test("nothing left today says so", () => {
    expect(
      planningNextToday(
        [item({ id: "gone", kind: "lesson", startsAt: at(21, 8) })],
        NOW
      )
    ).toBeNull()
  })
})
