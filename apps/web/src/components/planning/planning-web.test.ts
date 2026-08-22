import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  planningAssignmentsInput,
  planningCalendarInput,
  planningDayInput,
  planningTasksInput,
} from "@/lib/route-query-inputs"
import { recordingHrefForLesson } from "./planning-model"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("Planning routes", () => {
  test("keeps school agenda, personal tasks, and calendar as distinct routes", async () => {
    const [hub, agenda, tasks, calendar] = await Promise.all([
      source("../../app/(app)/planning/page.tsx"),
      source("../../app/(app)/planning/agenda/page.tsx"),
      source("../../app/(app)/planning/tasks/page.tsx"),
      source("../../app/(app)/planning/calendar/page.tsx"),
    ])

    for (const page of [hub, agenda, tasks, calendar]) {
      expect(page).not.toContain('"use client"')
      expect(page).toContain("prepareAuthenticatedShell")
      expect(page).toContain("HydrateClient")
    }
    expect(agenda).toContain("planning.assignments.list.queryOptions")
    expect(tasks).toContain("planning.tasks.list.queryOptions")
    expect(calendar).toContain("planning.calendar.queryOptions")
    expect(calendar).toContain("planning.day.queryOptions")
  })

  test("redirects only the former agenda landing page to the new class agenda", async () => {
    const compatibility = await source("../../app/(app)/agenda/page.tsx")
    expect(compatibility).toContain('redirect("/planning/agenda")')
    expect(compatibility).not.toContain("planner.agenda")
  })

  test("uses shared deterministic SSR inputs", () => {
    const anchor = new Date(2026, 7, 20, 12)
    const calendar = planningCalendarInput("year-1", anchor, "month", "UTC")
    expect(calendar.yearId).toBe("year-1")
    expect(calendar.timezone).toBe("UTC")
    expect(calendar.from.getUTCDay()).toBe(1)
    expect(calendar.to.getUTCDay()).toBe(0)
    expect(calendar.from.getUTCHours()).toBe(0)
    expect(calendar.to.getUTCHours()).toBe(23)

    const newYork = planningCalendarInput(
      "year-1",
      new Date("2026-03-01T01:30:00.000Z"),
      "month",
      "America/New_York"
    )
    expect(newYork.from.toISOString()).toBe("2026-01-26T05:00:00.000Z")
    expect(newYork.to.toISOString()).toBe("2026-03-02T04:59:59.999Z")
    expect(planningDayInput("year-1", "2026-08-20", "Europe/Paris")).toEqual({
      yearId: "year-1",
      date: "2026-08-20",
      timezone: "Europe/Paris",
    })
    expect(planningAssignmentsInput("year-1")).toEqual({ yearId: "year-1" })
    expect(planningTasksInput("year-1")).toEqual({
      yearId: "year-1",
      includeCompleted: true,
    })
  })
})

describe("Planning provider and recording affordances", () => {
  test("shows management metadata and keeps provider mutations explicit", async () => {
    const [management, agenda, calendar] = await Promise.all([
      source("./planning-management.tsx"),
      source("./planning-agenda-client.tsx"),
      source("./planning-calendar-client.tsx"),
    ])
    expect(management).toContain("lockedFields")
    expect(management).toContain("Detach as an editable copy")
    expect(management).toContain("Hide this synced item")
    expect(agenda).toContain("assignments.updateLocal")
    expect(agenda).toContain("assignments.setCompleted")
    expect(calendar).toContain("timetable.dismissOccurrence")
    expect(calendar).toContain("timetable.detachOccurrence")
  })

  test("prefills and persists a concrete recording link from Planning", async () => {
    const [calendar, page, recorder] = await Promise.all([
      source("./planning-calendar-client.tsx"),
      source("../../app/(app)/materials/recordings/new/page.tsx"),
      source("../recordings/lecture-recorder.tsx"),
    ])
    expect(calendar).toContain("recordingHrefForLesson")
    expect(calendar).toContain("Record this class")
    expect(calendar).toContain("Record this event")
    expect(page).toContain("initialTitle")
    expect(page).toContain("initialSubjectId")
    expect(page).toContain("initialPlanningContext")
    expect(page).toContain("seriesOccurrence")
    expect(recorder).toContain("initialTitle")
    expect(recorder).toContain("initialSubjectId")
    expect(recorder).toContain("initialPlanningContext")
    expect(recorder).toContain("planningLocatorFromContext")

    expect(
      recordingHrefForLesson({
        id: "event-1",
        kind: "event",
        title: "Oral exam",
        startsAt: "2026-09-07T08:00:00.000Z",
        endsAt: null,
        allDay: false,
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
    ).toContain("eventId=event-1")
  })

  test("exposes only the Planning hub in global navigation", () => {
    const nav = readFileSync(
      new URL("../../lib/nav.ts", import.meta.url),
      "utf8"
    )
    expect(nav).toContain('href: "/planning"')
    expect(nav).toContain('matches: ["/agenda"]')
    expect(nav).not.toContain('href: "/planning/agenda"')
    expect(nav).not.toContain('href: "/planning/tasks"')
    expect(nav).not.toContain('href: "/planning/calendar"')
  })

  test("creates and edits through screens, not panels that unfold in a list", async () => {
    const [agenda, calendar, tasks, assignmentForm, eventForm, taskForm] =
      await Promise.all([
        source("./planning-agenda-client.tsx"),
        source("./planning-calendar-client.tsx"),
        source("./planning-tasks-client.tsx"),
        source("./planning-assignment-form.tsx"),
        source("./planning-event-form.tsx"),
        source("./planning-task-form.tsx"),
      ])

    // Every "new" is a link to a page, so it can be linked to, gone back from,
    // and reached from the phone header — none of which a panel could do.
    expect(agenda).toContain('href="/planning/agenda/new"')
    expect(tasks).toContain('href="/planning/tasks/new"')
    expect(calendar).toContain('href="/planning/calendar/new"')
    expect(agenda).toContain("<PageActions>")
    expect(calendar).toContain("<PageActions>")

    // The same shell as every other creation screen in the app.
    for (const form of [assignmentForm, eventForm, taskForm]) {
      expect(form).toContain("<FormFlow")
      expect(form).toContain("backHref=")
    }

    // The writes each form owns, and the deletes that stayed on the lists.
    expect(assignmentForm).toContain("assignments.create")
    expect(assignmentForm).toContain("assignments.update")
    expect(agenda).toContain("assignments.delete")
    expect(taskForm).toContain("tasks.create")
    expect(taskForm).toContain("tasks.update")
    expect(eventForm).toContain("events.create")
    expect(eventForm).toContain("events.update")
    expect(calendar).toContain("events.delete")
    expect(eventForm).toContain("timetable.createOccurrence")
    expect(eventForm).toContain("timetable.createSeries")

    // The four kinds a calendar entry can be, still offered.
    for (const kind of ["holiday", "workday", "block"]) {
      expect(eventForm).toContain(`value: "${kind}"`)
    }
  })
})
