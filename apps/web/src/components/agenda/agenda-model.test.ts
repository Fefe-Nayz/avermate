import { describe, expect, test } from "bun:test"
import {
  agendaOccurrences,
  agendaTone,
  boardDropBeforeId,
  groupAgendaByDay,
  moveBoardTask,
  plannerTasksByLane,
  type AgendaEntry,
  type PlannerItem,
} from "./agenda-model"

function entry(
  id: string,
  kind: AgendaEntry["kind"],
  startsAt: Date,
  endsAt: Date | null = null
): AgendaEntry {
  const source = kind === "task" || kind === "event" ? "planner" : kind
  return {
    id,
    source,
    kind,
    title: id,
    startsAt,
    endsAt,
    allDay: true,
    ...(kind === "task" ? { status: "todo" as const } : {}),
    completed: kind === "grade",
    subjectId: null,
    referenceId: id,
    href: "/",
  }
}

function item(
  id: string,
  status: PlannerItem["status"],
  sortOrder: number,
  kind: PlannerItem["kind"] = "task"
): PlannerItem {
  return {
    id,
    kind,
    title: id,
    notes: null,
    startsAt: null,
    endsAt: null,
    allDay: true,
    status,
    completedAt: null,
    subjectId: null,
    sortOrder,
    yearId: "year-1",
  }
}

describe("agenda model", () => {
  test("buckets moments by their local calendar day", () => {
    const late = new Date(2026, 7, 31, 23, 30)
    const groups = groupAgendaByDay(
      agendaOccurrences([entry("late", "grade", late)])
    )

    expect(groups.map((group) => group.key)).toEqual(["2026-08-31"])
  })

  test("emits honest period boundaries and clips them to the requested month", () => {
    const period = entry(
      "semester",
      "period",
      new Date(2026, 6, 20, 12),
      new Date(2026, 8, 5, 12)
    )
    const visible = agendaOccurrences([period], {
      from: new Date(2026, 7, 1),
      to: new Date(2026, 7, 31, 23, 59, 59, 999),
    })
    const whole = agendaOccurrences([period])

    expect(visible).toEqual([])
    expect(whole.map((occurrence) => occurrence.boundary)).toEqual([
      "start",
      "end",
    ])
  })

  test("keeps both boundaries when a period starts and ends on one day", () => {
    const date = new Date(2026, 7, 20, 12)
    const occurrences = agendaOccurrences([
      entry("single-day", "period", date, new Date(2026, 7, 20, 18)),
    ])

    expect(occurrences.map(({ boundary }) => boundary)).toEqual([
      "start",
      "end",
    ])
  })

  test("assigns stable semantic tones rather than id-derived colours", () => {
    expect(agendaTone(entry("a", "task", new Date()))).toBe("planner-task")
    expect(agendaTone(entry("b", "event", new Date()))).toBe("planner-event")
    expect(agendaTone(entry("c", "goal", new Date()))).toBe("goal")
    expect(agendaTone(entry("d", "grade", new Date()))).toBe("grade")
    expect(agendaTone(entry("e", "period", new Date()))).toBe("period")
  })

  test("keeps the board task-only and ordered inside each lane", () => {
    const lanes = plannerTasksByLane([
      item("later", "todo", 4),
      item("event", "todo", 0, "event"),
      item("first", "todo", 1),
      item("done", "done", 0),
    ])

    expect(lanes.todo.map(({ id }) => id)).toEqual(["first", "later"])
    expect(lanes.done.map(({ id }) => id)).toEqual(["done"])
    expect(
      Object.values(lanes)
        .flat()
        .some(({ id }) => id === "event")
    ).toBe(false)
  })

  test("moves a task within and across lanes using the server beforeId contract", () => {
    const original = [
      item("a", "todo", 0),
      item("b", "todo", 1),
      item("c", "doing", 0),
    ]
    const within = moveBoardTask(original, "b", "todo", "a")
    const across = moveBoardTask(within, "a", "doing", "c")

    expect(plannerTasksByLane(within).todo.map(({ id }) => id)).toEqual([
      "b",
      "a",
    ])
    expect(plannerTasksByLane(across).doing.map(({ id }) => id)).toEqual([
      "a",
      "c",
    ])
    expect(across.find(({ id }) => id === "a")?.completedAt).toBeNull()
  })

  test("translates a downward hover into an insertion after the target", () => {
    const items = [
      item("a", "todo", 0),
      item("b", "todo", 1),
      item("c", "todo", 2),
    ]
    const beforeId = boardDropBeforeId(items, "a", "todo", "b")
    const moved = moveBoardTask(items, "a", "todo", beforeId)

    expect(beforeId).toBe("c")
    expect(plannerTasksByLane(moved).todo.map(({ id }) => id)).toEqual([
      "b",
      "a",
      "c",
    ])
  })
})
