import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

const detailUrl = new URL(
  "../../app/(app)/grades/[gradeId]/page.tsx",
  import.meta.url
)
const impactUrl = new URL("../analytics/impact-grid.tsx", import.meta.url)

describe("grade detail", () => {
  test("presents the grade result and supporting details", async () => {
    const detail = await readFile(detailUrl, "utf8")

    expect(detail).toContain('subtitle={subject?.name ?? t("Subject")}')
    expect(detail).toContain('className="flex flex-col gap-4"')
    expect(detail).toContain(
      'className="hidden items-center justify-between md:flex"'
    )
    expect(detail).toContain('aria-labelledby="grade-result-title"')
    expect(detail).toContain('id="grade-result-title"')
    expect(detail).not.toContain('t("Grade details")')
    expect(detail).toContain("<time dateTime={machineDate}>")
    expect(detail).toContain("href={`/subjects/${subject.id}`}")
    expect(detail).not.toContain('variant="trajectory"')
    expect(detail).toContain("<AverageValue")
    expect(detail).toContain("showScale")
    expect(detail).toContain("colored")
    expect(detail).toContain('data-grade-panel="result"')
    expect(detail).not.toContain("min-h-36")
    expect(detail).not.toContain("md:min-h-40")
    expect(detail).toContain("text-muted-foreground uppercase")
    expect(detail).not.toContain("gap-3 pt-4")
    expect(detail).toContain('data-grade-panel="details"')
    expect(detail).toContain("showOriginalPoints")
    expect(detail).not.toContain("bg-primary")
    expect(detail).toContain('aria-labelledby="grade-components-title"')
    expect(detail).toContain('aria-labelledby="grade-note-title"')
  })

  test("uses the original compact impact cards", async () => {
    const impactGrid = await readFile(impactUrl, "utf8")

    expect(impactGrid).toContain("grid grid-cols-2 gap-3")
    expect(impactGrid).not.toContain("trajectory")
    expect(impactGrid).not.toContain("Without this grade")
  })

  test("keeps optional supporting sections out of empty layouts", async () => {
    const detail = await readFile(detailUrl, "utf8")

    expect(detail).toContain("grade.components.length > 0 || grade.note")
    expect(detail).toContain("grade.components.length > 0 && grade.note")
    expect(detail).toContain("grade.components.length > 0 ?")
    expect(detail).toContain("grade.note ?")
  })
})
