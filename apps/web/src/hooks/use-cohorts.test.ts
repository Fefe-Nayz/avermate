import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import type { FriendContext } from "@avermate/core"
import { orpc } from "@/lib/orpc"
import {
  cohortChoices,
  cohortFigureGroupIds,
  cohortMemberChoices,
  friendChoices,
  invalidateCohortQueriesForGroup,
  type CohortListGroup,
} from "./use-cohorts"

const groups: CohortListGroup[] = [
  {
    groupId: "group-a",
    name: "Terminale 2",
    comparisons: [
      { id: "general-a", subjectName: null },
      { id: "maths-a", subjectName: "Maths" },
    ],
  },
  {
    groupId: "group-b",
    name: "Option latin",
    comparisons: [{ id: "general-b", subjectName: null }],
  },
]

describe("cohort query planning", () => {
  test("builds the picker from the cheap list response", () => {
    expect(cohortChoices(groups)).toEqual([
      {
        comparisonId: "general-a",
        groupId: "group-a",
        name: "Terminale 2",
      },
      {
        comparisonId: "maths-a",
        groupId: "group-a",
        name: "Terminale 2 · Maths",
      },
      {
        comparisonId: "general-b",
        groupId: "group-b",
        name: "Option latin",
      },
    ])
  })

  test("loads only the group that owns a stored comparison", () => {
    expect(cohortFigureGroupIds(groups, ["maths-a"], false)).toEqual([
      "group-a",
    ])
    expect(cohortFigureGroupIds(groups, ["missing"], false)).toEqual([])
  })

  test("loads a group once when several requested comparisons belong to it", () => {
    expect(
      cohortFigureGroupIds(groups, ["general-a", "maths-a"], false)
    ).toEqual(["group-a"])
  })

  test("loads every group only for a picker that explicitly asks for it", () => {
    expect(cohortFigureGroupIds(groups, [], true)).toEqual([
      "group-a",
      "group-b",
    ])
  })

  test("offers members only from the selected comparison and deduplicates ids", () => {
    const cohorts = new Map([
      [
        "general-a",
        {
          groupId: "general-a",
          name: "Terminale 2",
          memberCount: 3,
          viewerUserId: "viewer",
          members: [
            { userId: "alice", name: "Alice", average: 0.7 },
            { userId: "alice", name: "Alice", average: 0.7 },
          ],
        },
      ],
      [
        "general-b",
        {
          groupId: "general-b",
          name: "Option latin",
          memberCount: 2,
          viewerUserId: "viewer",
          members: [{ userId: "bob", name: "Bob", average: 0.8 }],
        },
      ],
    ])

    expect(cohortMemberChoices(cohorts, "general-a")).toEqual([
      { value: "alice", label: "Alice" },
    ])
    expect(cohortMemberChoices(cohorts, "general-b")).toEqual([
      { value: "bob", label: "Bob" },
    ])
    expect(cohortMemberChoices(cohorts, "missing")).toEqual([])
  })
})

describe("friend slot choices", () => {
  const friends = new Map<string, FriendContext>([
    [
      "average",
      {
        userId: "average",
        name: "Average only",
        scale: 20,
        generalAverage: 0.7,
        subjects: [],
        history: null,
      },
    ],
    [
      "history",
      {
        userId: "history",
        name: "History only",
        scale: 20,
        generalAverage: null,
        subjects: [],
        history: [{ at: new Date("2026-06-01"), ratio: 0.72 }],
      },
    ],
    [
      "subjects",
      {
        userId: "subjects",
        name: "Subjects only",
        scale: 20,
        generalAverage: null,
        subjects: [{ name: "Maths", average: 0.8, gradeCount: 3 }],
        history: null,
      },
    ],
    [
      "all",
      {
        userId: "all",
        name: "All shared",
        scale: 20,
        generalAverage: 0.75,
        subjects: [{ name: "Maths", average: 0.75, gradeCount: 2 }],
        history: [{ at: new Date("2026-06-02"), ratio: 0.75 }],
      },
    ],
  ])

  test("matches every friend metric to its own sharing payload", () => {
    expect(
      friendChoices(friends, "generalAverage").map((row) => row.value)
    ).toEqual(["average", "all"])
    expect(friendChoices(friends, "history").map((row) => row.value)).toEqual([
      "history",
      "all",
    ])
    expect(friendChoices(friends, "subjects").map((row) => row.value)).toEqual([
      "subjects",
      "all",
    ])
  })

  test("keeps legacy requirement-less slots usable", () => {
    expect(friendChoices(friends).map((row) => row.value)).toEqual([
      "average",
      "history",
      "subjects",
      "all",
    ])
  })
})

describe("cohort mutation invalidation", () => {
  test("invalidates the cohort list and only the changed group's figures", async () => {
    const queryClient = new QueryClient()
    const listKey = orpc.social.cohorts.list.key()
    const changedKey = orpc.social.cohorts.get.key({
      input: { groupId: "group-a" },
    })
    const unrelatedKey = orpc.social.cohorts.get.key({
      input: { groupId: "group-b" },
    })
    queryClient.setQueryData(listKey, [])
    queryClient.setQueryData(changedKey, { enabled: false })
    queryClient.setQueryData(unrelatedKey, { enabled: true })

    await invalidateCohortQueriesForGroup(queryClient, "group-a")

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(changedKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
    queryClient.clear()
  })
})
