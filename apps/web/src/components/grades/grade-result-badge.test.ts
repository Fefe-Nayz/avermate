import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import type { Grade, Period } from "@avermate/core"
import { gradePeriod } from "./grade-result-badge"

const grade: Pick<Grade, "periodId" | "passedAt"> = {
  periodId: "cumulative",
  passedAt: new Date("2026-02-03T10:00:00"),
}

const periods: Period[] = [
  {
    id: "cumulative",
    name: "Semester 2",
    startAt: new Date("2025-09-01T00:00:00"),
    endAt: new Date("2026-06-30T23:59:59"),
    isCumulative: true,
    sortOrder: 1,
  },
  {
    id: "specific",
    name: "Term 2",
    startAt: new Date("2026-01-01T00:00:00"),
    endAt: new Date("2026-03-31T23:59:59"),
    isCumulative: false,
    sortOrder: 2,
  },
]

describe("rich grade result badge", () => {
  test("uses the explicitly linked period before inferring one from the date", () => {
    expect(gradePeriod(grade, periods)?.id).toBe("cumulative")
    expect(gradePeriod({ ...grade, periodId: null }, periods)?.id).toBe(
      "specific"
    )
  })

  test("is wired to isolated result badges without nesting links in row links", async () => {
    const [component, table] = await Promise.all([
      readFile(new URL("./grade-result-badge.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("./hierarchical-grade-table.tsx", import.meta.url),
        "utf8"
      ),
    ])

    expect(component).toContain("<HoverCard")
    expect(component).toContain("delay={350}")
    expect(component).toContain("if (!open || !hasGrade) return null")
    expect(component).toContain("max-h-(--available-height)")
    expect(component).toContain(
      "<PointsValue value={grade.value} outOf={grade.outOf} />"
    )
    expect(component).toContain("grade.note")
    expect(component).toContain("grade.components.slice(0, 4)")
    expect(table).toContain("<GradeResultBadge key={grade.id} grade={grade} />")
    expect(table).not.toContain("title={grade.name}")
  })

  test("carries the weight on the badge, and only when there is one", async () => {
    const component = await readFile(
      new URL("./grade-result-badge.tsx", import.meta.url),
      "utf8"
    )

    // On the badge itself rather than at each call site, so every surface that
    // shows a grade shows its weight under one rule. Without `showWhenOne` —
    // that is the whole restraint: a coefficient of one draws nothing, so the
    // ordinary row is untouched and only the grades that pull on the average
    // say so. The hover card keeps `showWhenOne` because a panel headed
    // "Weight" with nothing under it answers nothing.
    expect(component).toContain(
      "<CoefficientBadge coefficient={grade.coefficient} />"
    )
    expect(component).toContain("showWhenOne")

    // Said in words for a screen reader: the chip's `×3` beside a link label is
    // either read as a stray symbol or skipped.
    expect(component).toContain("aria-label={accessibleLabel}")
    expect(component).toContain("grade.coefficient === 1")
  })
})
