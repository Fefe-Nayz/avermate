import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("subjects and averages parity", () => {
  test("the subjects overview exposes general and custom average analytics", async () => {
    const overview = await source("../../app/(app)/subjects/page.tsx")

    expect(overview).toContain('href="/averages/general"')
    expect(overview).toContain("resolveCustomAverage(graph, average)")
    expect(overview).toContain("href={`/averages/${average.id}`}")
    expect(overview).toContain('t("Custom averages")')
  })

  test("general and custom averages share a complete analytical destination", async () => {
    const detail = await source("../../app/(app)/averages/[averageId]/page.tsx")

    expect(detail).toContain('averageId === "general"')
    expect(detail).toContain("resolveCustomAverage(graph, custom)")
    expect(detail).toContain("<AverageChart")
    expect(detail).toContain("<ImpactGrid")
    expect(detail).toContain("resolved.graph.allGrades()")
    expect(detail).toContain("custom.entries.flatMap")
    expect(detail).toContain("href={`/subjects/${subject.id}`}")
    expect(detail).toContain('backHref="/subjects"')
  })

  test("subject charts preserve the opt-in child series", async () => {
    const detail = await source("../../app/(app)/subjects/[subjectId]/page.tsx")

    expect(detail).toContain("preferences.chartSettings.showSubSubjects")
    expect(detail).toContain("graph.childrenOf(subjectId)")
    expect(detail).toContain("<MultiSeriesAverageChart")
    expect(detail).toContain("series={averageSeries}")
  })

  test("the desktop header vertically centers its divider", async () => {
    const header = await source("../shell/site-header.tsx")

    expect(header).toContain("<span")
    expect(header).toContain("aria-hidden")
    expect(header).toContain('className="mr-1 h-4 w-px shrink-0 bg-border"')
  })
})
