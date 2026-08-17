import { describe, expect, test } from "bun:test"
import type { Grade, Subject } from "@avermate/core"
import { gradeTableRows, sortGrades } from "./grade-table-rows"

function grade(
  id: string,
  name: string,
  value: number,
  day: number,
  outOf = 20
): Grade {
  const passedAt = new Date(2026, 0, day)
  return {
    id,
    name,
    value,
    outOf,
    coefficient: 1,
    passedAt,
    createdAt: passedAt,
    subjectId: "maths",
    periodId: null,
    components: [],
  }
}

function subject(
  id: string,
  name: string,
  grades: Grade[],
  shortName: string | null = null
): Subject {
  return {
    id,
    name,
    shortName,
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: false,
    sortOrder: 0,
    grades,
  }
}

const devoir = grade("g1", "Devoir surveillé", 11, 3)
const oral = grade("g2", "Oral", 17, 10)
const bac = grade("g3", "Bac blanc", 14, 20)

const maths = subject("maths", "Mathématiques", [devoir, oral, bac], "Maths")
const history = subject("hist", "Histoire", [grade("h1", "Oral", 8, 5)])
const tree = [
  { subject: maths, depth: 0 },
  { subject: history, depth: 1 },
]

const ids = (grades: readonly Grade[]) => grades.map((item) => item.id)

describe("searching the grade table", () => {
  test("shows every subject with every grade when nothing is typed", () => {
    const rows = gradeTableRows(tree, { query: "  ", order: "newest" })

    expect(rows.map((row) => row.subject.id)).toEqual(["maths", "hist"])
    expect(ids(rows[0]!.grades)).toEqual(["g3", "g2", "g1"])
  })

  test("a subject asked about by name keeps all its grades", () => {
    const rows = gradeTableRows(tree, { query: "mathé", order: "newest" })

    expect(rows.map((row) => row.subject.id)).toEqual(["maths"])
    expect(rows[0]!.matchedSubject).toBe(true)
    expect(ids(rows[0]!.grades)).toEqual(["g3", "g2", "g1"])
  })

  test("matches a subject on its short name too", () => {
    expect(
      gradeTableRows(tree, { query: "maths", order: "newest" }).map(
        (row) => row.subject.id
      )
    ).toEqual(["maths"])
  })

  test("a subject reached through a grade shows only that grade", () => {
    // The bug this fixes: typing the name of one assessment answered with the
    // whole term, which is the opposite of a search.
    const rows = gradeTableRows(tree, { query: "bac", order: "newest" })

    expect(rows.map((row) => row.subject.id)).toEqual(["maths"])
    expect(rows[0]!.matchedSubject).toBe(false)
    expect(ids(rows[0]!.grades)).toEqual(["g3"])
  })

  test("answers with both kinds of match at once", () => {
    // "oral" names a grade in each subject; neither subject is named that. Both
    // subjects come back, each with only the grade that matched.
    const rows = gradeTableRows(tree, { query: "oral", order: "newest" })

    expect(rows.map((row) => row.subject.id)).toEqual(["maths", "hist"])
    expect(ids(rows[0]!.grades)).toEqual(["g2"])
    expect(ids(rows[1]!.grades)).toEqual(["h1"])
  })

  test("a query that names the subject wins over its grade filter", () => {
    // "Histoire" is a subject and holds nothing called that, so it keeps every
    // grade — a subject matched by name is being asked about as a subject.
    const rows = gradeTableRows(tree, { query: "histoire", order: "newest" })

    expect(rows[0]!.matchedSubject).toBe(true)
    expect(ids(rows[0]!.grades)).toEqual(["h1"])
  })

  test("drops a subject that answers neither way", () => {
    expect(gradeTableRows(tree, { query: "chimie", order: "newest" })).toEqual(
      []
    )
  })

  test("keeps the tree's own order and depth", () => {
    const rows = gradeTableRows(tree, { query: "", order: "newest" })

    expect(rows.map((row) => row.depth)).toEqual([0, 1])
  })
})

describe("ordering the grades inside a subject", () => {
  test("newest and oldest walk the day the grade was sat", () => {
    expect(ids(sortGrades(maths.grades, "newest"))).toEqual(["g3", "g2", "g1"])
    expect(ids(sortGrades(maths.grades, "oldest"))).toEqual(["g1", "g2", "g3"])
  })

  test("best and worst walk the result", () => {
    expect(ids(sortGrades(maths.grades, "best"))).toEqual(["g2", "g3", "g1"])
    expect(ids(sortGrades(maths.grades, "worst"))).toEqual(["g1", "g3", "g2"])
  })

  test("puts a grade with no result last, whichever way round", () => {
    // A mark out of zero counts for no average, so it has no rank — better last
    // than pretending to be a zero in "worst" and a perfect score in "best".
    const uncounted = grade("void", "Non noté", 0, 15, 0)
    const grades = [...maths.grades, uncounted]

    expect(ids(sortGrades(grades, "best")).at(-1)).toBe("void")
    expect(ids(sortGrades(grades, "worst")).at(-1)).toBe("void")
  })

  test("is stable, so a badge row cannot reshuffle between renders", () => {
    const tie = [grade("b", "B", 14, 8), grade("a", "A", 14, 8)]

    for (const order of ["newest", "oldest", "best", "worst"] as const) {
      expect(ids(sortGrades(tie, order)), order).toEqual(
        ids(sortGrades([...tie].reverse(), order))
      )
    }
  })

  test("leaves the caller's array alone", () => {
    const original = ids(maths.grades)
    sortGrades(maths.grades, "best")
    expect(ids(maths.grades)).toEqual(original)
  })
})
