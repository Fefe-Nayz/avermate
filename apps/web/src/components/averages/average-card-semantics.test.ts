import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("custom average dashboard semantics", () => {
  test("offers a one-shot dedicated DataCard only while creating", async () => {
    const form = await source("./average-form.tsx")

    expect(form).toContain('t("Add a DataCard to the dashboard")')
    expect(form).toContain('mode === "create"')
    expect(form).toContain("addDashboardCard")
    expect(form).not.toContain("Use this instead of the general average")
    expect(form).not.toContain("is-main-average")
  })

  test("the dashboard curve always uses the general graph", async () => {
    const dashboard = await source("../../app/(app)/dashboard/page.tsx")
    const provider = await source("../year/year-provider.tsx")

    expect(dashboard).toContain("averageEventDates(graph.subjects, from, to)")
    expect(dashboard).not.toContain("resolveHeadline")
    expect(dashboard).not.toContain("headlineAverage")
    expect(provider).not.toContain("resolveHeadline")
    expect(provider).not.toContain("headlineAverage")
  })

  test("preset editors cannot mark a custom average as headline", async () => {
    const editor = await source("../admin/preset-visual-editor.tsx")

    expect(editor).not.toContain('t("Headline")')
    expect(editor).not.toContain("checked={average.isMain}")
  })
})
