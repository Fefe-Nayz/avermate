import { describe, expect, test } from "bun:test"
import {
  groupAssignmentsByDueDay,
  itemsForDay,
  normalizePlanningItems,
  planningItemIsLocked,
  planningRange,
  recordingHrefForLesson,
  tasksByStatus,
  timelinePlacements,
  type PlanningItem,
} from "./planning-model"

const management = {
  mode: "user" as const,
  syncState: "detached" as const,
  sourceConnectionId: null,
  externalId: null,
  lockedFields: [],
  editableFields: [],
}

function item(
  id: string,
  kind: PlanningItem["kind"],
  startsAt: Date | null
): PlanningItem {
  return {
    id,
    kind,
    title: id,
    startsAt,
    endsAt: null,
    allDay: kind !== "lesson",
    subjectId: null,
    management,
  }
}

describe("planning model", () => {
  test("normalizes both list and calendar payloads without trusting malformed rows", () => {
    const rows = normalizePlanningItems({
      items: [
        { id: "task-1", kind: "task", title: "Read", dueAt: "2026-08-21" },
        { id: 12, kind: "task", title: "bad" },
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.startsAt).toBe("2026-08-21")
    expect(rows[0]?.management.mode).toBe("user")

    const scheduled = normalizePlanningItems(
      [
        {
          id: "task-2",
          title: "Call",
          scheduledAt: "2026-08-21T08:00:00.000Z",
        },
      ],
      "task"
    )
    expect(scheduled[0]?.allDay).toBe(false)
  })

  test("keeps assignments separate from personal task lanes", () => {
    const assignment = item("homework", "assignment", new Date(2026, 7, 23))
    const task = { ...item("personal", "task", null), status: "doing" as const }

    expect(groupAssignmentsByDueDay([task, assignment])[0]?.items).toEqual([
      assignment,
    ])
    expect(tasksByStatus([task, assignment]).doing).toEqual([task])
  })

  test("groups homework by its due date, never by its assigned date", () => {
    const withoutDueDate = {
      ...item("undated", "assignment", new Date(2026, 7, 20)),
      assignedAt: new Date(2026, 7, 20),
      dueAt: null,
    }
    const dueTomorrow = {
      ...item("dated", "assignment", new Date(2026, 7, 22)),
      assignedAt: new Date(2026, 7, 20),
      dueAt: new Date(2026, 7, 22),
    }
    const groups = groupAssignmentsByDueDay([withoutDueDate, dueTomorrow])
    expect(groups.map((group) => group.key)).toEqual([
      "2026-08-22",
      "unscheduled",
    ])
  })

  test("includes multi-day blocks on every covered day", () => {
    const holiday = {
      ...item("holiday", "event", new Date(2026, 7, 20, 12)),
      endsAt: new Date(2026, 7, 22, 12),
    }
    expect(itemsForDay([holiday], new Date(2026, 7, 21, 12))).toEqual([holiday])
  })

  test("computes a six-week-capable month read window and a Monday week", () => {
    const range = planningRange(new Date(2026, 7, 20, 12), "month")
    expect(range.from.getDay()).toBe(1)
    expect(range.to.getDay()).toBe(0)
    expect(range.from <= new Date(2026, 7, 1)).toBe(true)
    expect(range.to >= new Date(2026, 7, 31)).toBe(true)
  })

  test("locks only provider-managed fields named by the service", () => {
    const managed: PlanningItem = {
      ...item("lesson", "lesson", new Date()),
      management: {
        ...management,
        mode: "provider",
        syncState: "managed",
        lockedFields: ["title", "startsAt"],
      },
    }
    expect(planningItemIsLocked(managed, "title")).toBe(true)
    expect(planningItemIsLocked(managed, "localNote")).toBe(false)
  })

  test("prefills the recorder from the exact lesson occurrence", () => {
    const lesson = {
      ...item("lesson-1", "lesson", new Date("2026-08-20T08:00:00.000Z")),
      title: "Organic chemistry",
      subjectId: "subject-1",
      occurrenceId: "occurrence-1",
    }
    const href = recordingHrefForLesson(lesson)
    expect(href).toContain("title=Organic+chemistry")
    expect(href).toContain("subjectId=subject-1")
    expect(href).toContain("occurrenceId=occurrence-1")

    const recurring = recordingHrefForLesson({
      ...lesson,
      id: "virtual:series-1:2026-08-20",
      occurrenceId: null,
      seriesId: "series-1",
      occurrenceDate: "2026-08-20",
      virtual: true,
    })
    expect(recurring).toContain("seriesId=series-1")
    expect(recurring).toContain("occurrenceDate=2026-08-20")
    expect(recurring).not.toContain("occurrenceId=")
  })

  test("places timed lessons on the daily timeline and leaves all-day work out", () => {
    const lesson = {
      ...item("lesson", "lesson", new Date(2026, 7, 20, 9, 30)),
      endsAt: new Date(2026, 7, 20, 11),
    }
    const homework = item("homework", "assignment", new Date(2026, 7, 20))
    const placements = timelinePlacements([homework, lesson], 7, 21)

    expect(placements).toHaveLength(1)
    expect(placements[0]?.item.id).toBe("lesson")
    expect(placements[0]?.heightPercent).toBeGreaterThan(5)
  })

  test("splits simultaneous timeline items into visible columns", () => {
    const first = {
      ...item("first", "lesson", new Date(2026, 7, 20, 9)),
      endsAt: new Date(2026, 7, 20, 11),
    }
    const second = {
      ...item("second", "event", new Date(2026, 7, 20, 9, 30)),
      allDay: false,
      endsAt: new Date(2026, 7, 20, 10, 30),
    }
    const placements = timelinePlacements([first, second], 7, 21)
    expect(placements).toHaveLength(2)
    expect(placements.map((placement) => placement.widthPercent)).toEqual([
      50, 50,
    ])
    expect(
      new Set(placements.map((placement) => placement.leftPercent)).size
    ).toBe(2)
  })
})
