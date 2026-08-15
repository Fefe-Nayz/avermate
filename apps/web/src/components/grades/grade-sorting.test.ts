import { describe, expect, it } from "bun:test"
import type { Grade, Subject } from "@avermate/core"
import { filterGrades, sortChildren, sortGrades } from "./grade-sorting"

function grade(overrides: Partial<Grade> & { id: string }): Grade {
  return {
    name: overrides.id,
    value: 10,
    outOf: 20,
    coefficient: 1,
    passedAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    subjectId: "s1",
    periodId: null,
    components: [],
    ...overrides,
  }
}

// Newest-first, like the subject page hands them over.
const rows: Grade[] = [
  grade({ id: "recent", value: 14, coefficient: 2 }),
  grade({ id: "middle", value: 18, coefficient: 1 }),
  grade({ id: "oldest", value: 6, coefficient: 3, subjectId: "s2" }),
]

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id)

describe("sortGrades", () => {
  it("keeps the newest-first order for date and reverses it for oldest", () => {
    expect(sortGrades(rows, "date")).toBe(rows)
    expect(ids(sortGrades(rows, "oldest"))).toEqual([
      "oldest",
      "middle",
      "recent",
    ])
  })

  it("orders by result in both directions", () => {
    expect(ids(sortGrades(rows, "best"))).toEqual([
      "middle",
      "recent",
      "oldest",
    ])
    expect(ids(sortGrades(rows, "worst"))).toEqual([
      "oldest",
      "recent",
      "middle",
    ])
  })

  it("sinks unratable grades to the bottom of worst-first", () => {
    const withBroken = [...rows, grade({ id: "broken", outOf: 0 })]
    expect(ids(sortGrades(withBroken, "worst")).at(-1)).toBe("broken")
  })

  it("orders by coefficient descending", () => {
    expect(ids(sortGrades(rows, "coefficient"))).toEqual([
      "oldest",
      "recent",
      "middle",
    ])
  })
})

describe("filterGrades", () => {
  const nameOf = (id: string) => (id === "s2" ? "Physique" : "Maths")

  it("matches the grade name and the subject name, ignoring case", () => {
    expect(ids(filterGrades(rows, "MID", nameOf))).toEqual(["middle"])
    expect(ids(filterGrades(rows, "physique", nameOf))).toEqual(["oldest"])
    expect(filterGrades(rows, "  ", nameOf)).toBe(rows)
  })
})

describe("sortChildren", () => {
  const child = (id: string, coefficient: number): Subject => ({
    id,
    name: id,
    shortName: null,
    parentId: "parent",
    coefficient,
    kind: "subject",
    isMain: false,
    sortOrder: 0,
    grades: [],
  })
  const children = [child("chimie", 2), child("algebre", 1), child("bio", 3)]
  const ratios: Record<string, number | null> = {
    chimie: 0.5,
    algebre: 0.9,
    bio: null,
  }

  it("keeps the custom order, sorts by name, average and coefficient", () => {
    expect(sortChildren(children, "custom", (id) => ratios[id] ?? null)).toBe(
      children
    )
    expect(
      ids(sortChildren(children, "name", (id) => ratios[id] ?? null))
    ).toEqual(["algebre", "bio", "chimie"])
    expect(
      ids(sortChildren(children, "best", (id) => ratios[id] ?? null))
    ).toEqual(["algebre", "chimie", "bio"])
    expect(
      ids(sortChildren(children, "coefficient", (id) => ratios[id] ?? null))
    ).toEqual(["bio", "chimie", "algebre"])
  })
})
