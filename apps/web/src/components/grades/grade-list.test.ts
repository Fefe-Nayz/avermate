import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

describe("shared grade list", () => {
  test("keeps every standard grade list on the same card", async () => {
    const [component, dashboard, gradesPage, subjectPage, averagePage] =
      await Promise.all([
        readFile(new URL("./grade-list.tsx", import.meta.url), "utf8"),
        readFile(new URL("./recent-grades.tsx", import.meta.url), "utf8"),
        readFile(
          new URL("../../app/(app)/grades/page.tsx", import.meta.url),
          "utf8"
        ),
        readFile(
          new URL(
            "../../app/(app)/subjects/[subjectId]/page.tsx",
            import.meta.url
          ),
          "utf8"
        ),
        readFile(
          new URL(
            "../../app/(app)/averages/[averageId]/page.tsx",
            import.meta.url
          ),
          "utf8"
        ),
      ])

    expect(dashboard).toContain("<GradeList grades={grades} />")
    expect(gradesPage).toContain("<GradeList grades={group.grades} />")
    expect(subjectPage).toContain("<GradeList grades={grades} />")
    expect(averagePage).toContain("<GradeList grades={grades} />")
    expect(component).toContain('<ul className="divide-y">')
    expect(component).toContain('className={gradeListItemClassName}')
    expect(component).toContain("<ChevronRightIcon")
  })

  test("visually separates the subject from the date", async () => {
    const component = await readFile(
      new URL("./grade-list.tsx", import.meta.url),
      "utf8"
    )

    expect(component).toContain("font-medium text-foreground/75")
    expect(component).toContain("bg-muted-foreground/45")
    expect(component).toContain("<time")
    expect(component).toContain("dateTime={grade.passedAt.toISOString()}")
  })
})
