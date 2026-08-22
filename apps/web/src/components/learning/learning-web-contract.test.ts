import { describe, expect, test } from "bun:test"
import { NAV_ENTRIES, SETTINGS_SECTIONS } from "@/lib/nav"

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("learning Web contract", () => {
  test("keeps the critical loop available outside chat and responsive", async () => {
    const [hub, copy, objective, gradeCopies, quiz] = await Promise.all([
      source("./learning-client.tsx"),
      source("./copy-review-workspace.tsx"),
      source("./objective-evidence-view.tsx"),
      source("../grades/grade-copies.tsx"),
      source("../documents/quiz-document-view.tsx"),
    ])
    expect(hub).toContain('TabsTrigger value="mastery"')
    expect(hub).toContain('TabsTrigger value="copies"')
    expect(hub).toContain('TabsTrigger value="plan"')
    expect(hub).toContain("lg:grid-cols-2")
    expect(copy).toContain("<object")
    expect(copy).toContain('type="application/pdf"')
    expect(copy).toContain('t("Previous page")')
    expect(copy).toContain('t("Undo confirmation")')
    expect(copy).toContain("unsupportedInferences")
    expect(copy).toContain("normalizedBboxStyle")
    expect(copy).toContain('aria-label={t("Detected region map")}')
    expect(copy).toContain("focusedRegionId === region.id")
    expect(objective).toContain('t("Exclude from projection")')
    expect(objective).toContain('t("interval {low}–{high}"')
    expect(gradeCopies).toContain("learning.copies.request")
    expect(quiz).toContain('"practice"')
    expect(quiz).toContain('"progress"')
  })

  test("labels interactive copy controls and embeds the PDF with a title", async () => {
    const copy = await source("./copy-review-workspace.tsx")
    expect(copy).toContain('aria-label={t("Previous page")}')
    expect(copy).toContain('aria-label={t("Next page")}')
    expect(copy).toContain('aria-label={t("Original paper, page {page}"')
    expect(copy).toContain("<Label htmlFor=")
    expect(copy).toContain("<SelectGroup>")
  })

  test("extracts every stable learning label for both locales", async () => {
    const files = await Promise.all([
      source("./learning-client.tsx"),
      source("./copy-review-workspace.tsx"),
      source("./objective-evidence-view.tsx"),
    ])
    for (const file of files) {
      expect(file).toContain("useExtracted")
      expect(file).toContain("const t = useExtracted()")
    }
    expect(files.join("\n")).not.toMatch(
      />\s*(?:Apprentissage|Maîtrise|Copies|Confirmer|Réessayer)\s*</
    )
  })

  test("is reachable from every shared navigation model", async () => {
    expect(NAV_ENTRIES.some((entry) => entry.href === "/learning")).toBe(true)
    expect(
      SETTINGS_SECTIONS.flatMap((section) => section.items ?? []).some(
        (entry) => entry.href === "/settings/integrations#learning-analysis"
      )
    ).toBe(true)
    for (const path of [
      "../shell/app-sidebar.tsx",
      "../shell/mobile-tabbar.tsx",
      "../command/command-palette.tsx",
    ]) {
      expect(await source(path)).toContain('Learning: t("Learning")')
    }
  })
})
