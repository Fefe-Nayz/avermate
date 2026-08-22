import { dehydrate } from "@tanstack/react-query"
import { notFound } from "next/navigation"
import { getServerOrpc } from "@/lib/orpc/server"
import { createQueryClient } from "@/lib/query-client"
import {
  FIXTURE_NOW,
  FIXTURE_YEAR_ID,
  fixtureSnapshot,
  fixtureYear,
} from "@/components/cards/card-matrix-fixture"
import {
  planningAssignmentsInput,
  planningCalendarInput,
  planningDayInput,
  planningTasksInput,
} from "@/lib/route-query-inputs"
import { DevPlanningPage } from "./dev-planning-page"

/**
 * The planning screens, on a fixture, outside the authenticated tree.
 *
 * Same device as `/dev/cards` and for the same reason: these screens are about layout
 * and density, and a screen you have to sign in to reach is a screen nobody looks at
 * while working on it. Development only.
 */
export default async function DevPlanningRoute() {
  if (process.env.NODE_ENV === "production") notFound()

  const queryClient = createQueryClient()
  const orpc = getServerOrpc()
  const seed = (key: readonly unknown[], value: unknown) => {
    queryClient.setQueryData(
      key as Parameters<typeof queryClient.setQueryData>[0],
      value as never
    )
  }

  const dayIso = (offset: number, hour = 9) => {
    const at = new Date(FIXTURE_NOW)
    at.setDate(at.getDate() + offset)
    at.setHours(hour, 0, 0, 0)
    return at.toISOString()
  }
  const management = {
    mode: "user" as const,
    syncState: "detached" as const,
    sourceConnectionId: null,
    externalId: null,
    lockedFields: [],
  }
  const subjectId = fixtureSnapshot().subjects[0]?.id ?? null

  seed(orpc.years.list.queryKey(), [fixtureYear])
  seed(
    orpc.snapshot.get.queryKey({ input: { yearId: FIXTURE_YEAR_ID } }),
    fixtureSnapshot()
  )
  seed(
    orpc.planning.assignments.list.queryKey({
      input: planningAssignmentsInput(FIXTURE_YEAR_ID),
    }),
    [
      {
        id: "hw-1",
        kind: "assignment",
        title: "Exercices 4 à 8, chapitre sur les suites",
        dueAt: dayIso(1),
        subjectId,
        management,
      },
      {
        id: "hw-2",
        kind: "assignment",
        title: "Compte rendu de TP",
        dueAt: dayIso(4),
        subjectId,
        management,
      },
    ]
  )
  seed(
    orpc.planning.tasks.list.queryKey({
      input: planningTasksInput(FIXTURE_YEAR_ID),
    }),
    [
      {
        id: "task-1",
        kind: "task",
        title: "Relire le chapitre 4",
        status: "todo",
        dueAt: dayIso(2),
        subjectId,
        management,
      },
      {
        id: "task-2",
        kind: "task",
        title: "Refaire les annales de 2024",
        status: "todo",
        dueAt: dayIso(6),
        subjectId,
        management,
      },
      {
        id: "task-3",
        kind: "task",
        title: "Préparer les questions pour la colle",
        status: "doing",
        dueAt: dayIso(2),
        subjectId,
        management,
      },
      {
        id: "task-4",
        kind: "task",
        title: "Rendre le devoir de français",
        status: "done",
        completedAt: dayIso(-3),
        subjectId,
        management,
      },
    ]
  )
  const calendarInput = planningCalendarInput(
    FIXTURE_YEAR_ID,
    new Date(FIXTURE_NOW),
    "month",
    "Europe/Paris"
  )
  seed(orpc.planning.calendar.queryKey({ input: calendarInput }), {
    items: [
      {
        id: "lesson-1",
        kind: "lesson",
        title: "Mathématiques",
        startsAt: dayIso(0, 8),
        endsAt: dayIso(0, 10),
        subjectId,
        management,
      },
      {
        id: "lesson-2",
        kind: "lesson",
        title: "Colle de maths",
        startsAt: dayIso(0, 9),
        endsAt: dayIso(0, 10),
        subjectId,
        management,
      },
      {
        id: "lesson-3",
        kind: "lesson",
        title: "Physique-Chimie — TP",
        startsAt: dayIso(1, 14),
        endsAt: dayIso(1, 16),
        subjectId,
        management,
      },
      {
        id: "event-1",
        kind: "event",
        title: "Conseil de classe",
        startsAt: dayIso(2, 17),
        endsAt: dayIso(2, 19),
        subjectId: null,
        management,
      },
      {
        id: "event-2",
        kind: "event",
        eventKind: "holiday",
        title: "Pont de l'Ascension",
        startsAt: dayIso(1, 0),
        endsAt: dayIso(1, 23),
        allDay: true,
        subjectId: null,
        management,
      },
    ],
  })

  const day = (offset: number, hour = 9) => {
    const at = new Date(FIXTURE_NOW)
    at.setDate(at.getDate() + offset)
    at.setHours(hour, 0, 0, 0)
    return at
  }
  const selectedDay = day(0).toISOString().slice(0, 10)
  seed(
    orpc.planning.day.queryKey({
      input: planningDayInput(FIXTURE_YEAR_ID, selectedDay, "Europe/Paris"),
    }),
    {
      items: [
        {
          id: "lesson-1",
          kind: "lesson",
          title: "Mathématiques",
          startsAt: day(0, 8).toISOString(),
          endsAt: day(0, 10).toISOString(),
          subjectId,
          management,
        },
        {
          id: "lesson-2",
          kind: "lesson",
          title: "Physique-Chimie — TP",
          startsAt: day(0, 14).toISOString(),
          endsAt: day(0, 16).toISOString(),
          subjectId,
          management,
        },
      ],
    }
  )

  return (
    <DevPlanningPage
      selectedDay={selectedDay}
      dehydratedState={dehydrate(queryClient)}
      from={calendarInput.from.toISOString()}
      to={calendarInput.to.toISOString()}
    />
  )
}
