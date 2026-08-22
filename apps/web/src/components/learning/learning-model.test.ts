import { describe, expect, test } from "bun:test"
import {
  learningPlanGroup,
  learningRationaleV2,
  parseConceptPackJson,
} from "./learning-model"

const pack = {
  namespace: "curriculum",
  source: "reviewed-curriculum",
  sourceVersion: "2026.1",
  title: "Algebra",
  locale: "en",
  concepts: [
    {
      stableKey: "algebra",
      canonicalLabel: "Algebra",
      parentStableKey: null,
    },
  ],
  objectives: [
    {
      stableKey: "solve",
      conceptStableKey: "algebra",
      statement: "Solve an equation",
    },
  ],
}

describe("learning Web model", () => {
  test("validates a portable concept pack and applies safe defaults", () => {
    const result = parseConceptPackJson(JSON.stringify(pack))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary).toEqual({
      concepts: 1,
      objectives: 1,
      prerequisites: 0,
    })
    expect(result.value.objectives[0]?.expectedLevel).toBe(3)
    expect(result.value).not.toHaveProperty("yearId")
  })

  test("rejects dangling references and cycles before upload", () => {
    const result = parseConceptPackJson(
      JSON.stringify({
        ...pack,
        concepts: [
          { stableKey: "a", canonicalLabel: "A", parentStableKey: "b" },
          { stableKey: "b", canonicalLabel: "B", parentStableKey: "a" },
        ],
        objectives: [
          {
            stableKey: "x",
            conceptStableKey: "missing",
            statement: "X",
            prerequisiteStableKeys: ["missing-objective"],
          },
        ],
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(" ")).toContain("cycle")
    expect(result.errors.join(" ")).toContain("unknown concept")
    expect(result.errors.join(" ")).toContain("Unknown prerequisite")
  })

  test("groups authoritative planning dates as today, overdue, or upcoming", () => {
    const now = new Date("2026-08-22T12:00:00+02:00")
    expect(
      learningPlanGroup(
        {
          planningTask: {
            scheduledAt: new Date("2026-08-22T18:00:00+02:00"),
            dueAt: null,
          },
        },
        now
      )
    ).toBe("today")
    expect(
      learningPlanGroup(
        {
          planningTask: {
            scheduledAt: null,
            dueAt: new Date("2026-08-25T18:00:00+02:00"),
          },
        },
        now
      )
    ).toBe("upcoming")
    expect(
      learningPlanGroup(
        {
          planningTask: {
            scheduledAt: new Date("2026-08-25T18:00:00+02:00"),
            dueAt: new Date("2026-08-20T18:00:00+02:00"),
          },
        },
        now
      )
    ).toBe("today")
    expect(learningPlanGroup({ planningTask: null }, now)).toBe("objectives")
  })

  test("accepts only an inspectable rationale v2", () => {
    expect(
      learningRationaleV2({
        version: 2,
        score: 0.7,
        estimate: null,
        interval: null,
        freshnessDays: null,
        dueAt: null,
        dueUrgency: 0,
        unmetPrerequisiteIds: [],
        neededByWeakObjectiveIds: [],
        availableMinutes: 30,
        estimatedMinutes: 20,
      })
    ).not.toBeNull()
    expect(learningRationaleV2({ version: 1, score: 1 })).toBeNull()
  })
})
