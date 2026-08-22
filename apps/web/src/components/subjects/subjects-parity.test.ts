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
    // The same chart a subject page draws, not a single-series one. This asked
    // for `<AverageChart` until the averages page was given the multi-series
    // chart and its child-series toggle — which is *more* parity, not less, so
    // the assertion follows rather than pins the older component.
    expect(detail).toContain("<MultiSeriesAverageChart")
    expect(detail).toContain("series={averageSeries}")
    expect(detail).toContain("preferences.chartSettings.showSubSubjects")
    expect(detail).toContain("<ImpactGrid")
    expect(detail).toContain("resolved.graph.allGrades()")
    // The composition is built from the average's own entries — `shown`, which is the
    // custom average being read, or the one a year nominated as its general average.
    // That page used to resolve `/averages/general` to the whole year regardless, so a
    // substituted headline sat above a breakdown of a different set of subjects.
    expect(detail).toContain("shown.entries.flatMap")
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

  test("the desktop header vertically centers its dividers", async () => {
    const header = await source("../shell/site-header.tsx")

    // A vertical Separator stretches to the flex line by default, which drew
    // a full-height rule through the header. Both classes are the fix: a
    // fixed height, and self-auto so the flex container stops stretching it.
    expect(header).toContain('orientation="vertical"')
    expect(header).toContain("data-vertical:h-4")
    expect(header).toContain("data-vertical:self-auto")
  })
})
