import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("targeted year configuration flow", () => {
  test("the route verifies ownership on the server and hydrates every step", async () => {
    const route = await source("../../app/onboarding/year/[yearId]/page.tsx")

    expect(route).not.toContain('"use client"')
    expect(route).toContain("years.configurationStatus")
    expect(route).toContain("snapshot.get")
    expect(route).toContain("presets.periodTemplates")
    expect(route).toContain("presets.status")
    expect(route).toContain("notFound()")
    expect(route).toContain("<HydrateClient")
  })

  test("subjects, custom averages and exact periods stay editable", async () => {
    const wizard = await source("./year-configuration-wizard.tsx")

    expect(wizard).toContain("new SubjectGraph(snapshot.data.subjects)")
    expect(wizard).toContain("presets.previewApply")
    expect(wizard).toContain("rpc.presets.reapply")
    expect(wizard).toContain('formHref("/subjects/new"')
    expect(wizard).toContain('formHref("/settings/averages/new"')
    expect(wizard).toContain("<PeriodDraftEditor")
    expect(wizard).toContain("orpc.periods.replaceAll")
    expect(wizard).toContain("periodDraftProblems")
  })

  test("new-year setup recovers a lost response and continues on the target", async () => {
    const wizard = await source("./year-setup-wizard.tsx")

    expect(wizard).toContain("useSyncExternalStore")
    expect(wizard).toContain("parseYearSetupDraft")
    expect(wizard).toContain("writeYearSetupDraft")
    expect(wizard).toContain("presets.setupYearStatus")
    expect(wizard).toContain("setupStatus.data?.year")
    expect(wizard).toContain("/onboarding/year/${encodeURIComponent")
    expect(wizard).not.toContain('router.replace("/dashboard")\n    } catch')
  })

  test("an empty subject page offers guided setup and manual creation", async () => {
    const subjects = await source("../../app/(app)/subjects/page.tsx")

    expect(subjects).toContain("/onboarding/year/${encodeURIComponent(yearId)}")
    expect(subjects).toContain('t("Set up subjects")')
    expect(subjects).toContain('t("Add manually")')
  })
})
