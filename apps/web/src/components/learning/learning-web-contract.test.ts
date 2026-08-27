import { describe, expect, test } from "bun:test"
import { NAV_ENTRIES, SETTINGS_SECTIONS } from "@/lib/nav"

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("learning Web contract", () => {
  test("keeps the critical loop available outside chat and responsive", async () => {
    const [hub, copy, panel, objective, gradeCopies, quiz] = await Promise.all([
      source("./learning-client.tsx"),
      source("./copy-review-workspace.tsx"),
      source("./copy-review-panel.tsx"),
      source("./objective-evidence-view.tsx"),
      source("../grades/grade-copies.tsx"),
      source("../documents/quiz-document-view.tsx"),
    ])
    expect(hub).toContain('TabsTrigger value="overview"')
    expect(hub).toContain('TabsTrigger value="mastery"')
    expect(hub).toContain('TabsTrigger value="copies"')
    expect(hub).toContain('TabsTrigger value="plan"')
    expect(hub).toContain('TabsTrigger value="history"')
    expect(hub).toContain("lg:grid-cols-2")
    expect(hub).toContain('role="group"')
    expect(hub).toContain('aria-label={t("Filter learning by subject")}')
    expect(hub).toContain("aria-pressed={subjectId === null}")
    expect(hub).toContain("aria-pressed={subjectId === subject.id}")
    expect(panel).toContain("<object")
    expect(panel).toContain('type="application/pdf"')
    expect(panel).toContain('t("Previous page")')
    expect(panel).toContain('t("Undo confirmation")')
    expect(copy).toContain("unsupportedInferences")
    expect(panel).toContain("normalizedBboxStyle")
    expect(panel).toContain('aria-label={t("Detected region map")}')
    expect(panel).toContain("focusedRegionId === region.id")
    expect(objective).toContain('t("Exclude from projection")')
    expect(objective).toContain('t("interval {low}–{high}"')
    expect(gradeCopies).toContain("learning.copies.request")
    expect(quiz).toContain('"practice"')
    expect(quiz).toContain('"progress"')
  })

  test("separates measured progress, measurement quality and cautious history", async () => {
    const hub = await source("./learning-client.tsx")

    expect(hub).toContain(
      "const [tab, setTab] = useState<LearningTab>(initialTab)"
    )
    expect(hub).toContain(
      "orpc.learning.progress.queryOptions({ input: scope })"
    )
    expect(hub).toContain('objective.measurementState === "unmeasured"')
    expect(hub).toContain("summary.measuredObjectiveCount")
    expect(hub).toContain("summary.variation")
    expect(hub).toContain("summary.precision")
    expect(hub).toContain("summary.evidence")
    expect(hub).toContain("summary.freshness")
    expect(hub).toContain("summary.nextAction")
    expect(hub).toContain('t("Estimate precision")')
    expect(hub).not.toContain('t("Confidence")')
    expect(hub).not.toContain("highest-priority active suggestion")
    expect(hub).toContain("<ProgressTimeline")
    expect(hub).toContain("row.projection.evidenceCount > 0")
    expect(hub).not.toContain("projection?.estimate ?? 0.5")
    expect(hub).not.toContain("projection.estimate ?? 0.5")
    expect(hub).toContain('aria-label={t("Loading learning summary")}')
    expect(hub).toContain("progress.isError ? (")
    expect(hub.indexOf("progress.isLoading ? (")).toBeLessThan(
      hub.indexOf('t("Evidence coverage")')
    )
  })

  test("hydrates the exact validated deep-link scope used by the client", async () => {
    const [page, hub] = await Promise.all([
      source("../../app/(app)/learning/page.tsx"),
      source("./learning-client.tsx"),
    ])

    expect(page).toContain(
      "const scope = { yearId: initialYearId, subjectId: initialSubjectId }"
    )
    expect(page).toContain("years.some((year) => year.id === requestedYearId)")
    expect(page).toContain("subject.id === requestedSubjectId")

    for (const procedure of ["copies.list", "plan.list", "progress"]) {
      const start = page.indexOf(`orpc.learning.${procedure}.queryOptions`)
      expect(start).toBeGreaterThan(-1)
      expect(page.slice(start, start + 220)).toContain("input: scope")
    }
    expect(hub).toContain(
      'const scope = { yearId: scopedYearId ?? "", subjectId }'
    )
    expect(hub).toContain("enabled: Boolean(scopedYearId)")
    expect(hub).toContain(
      "const [pendingYearId, setPendingYearId] = useState(initialYearId)"
    )
    expect(hub).toContain("const scopedYearId = pendingYearId ?? yearId")
    expect(hub).toContain("if (!cancelled) setPendingYearId(null)")
    expect(hub).toContain("subjectSelection.yearId === scopedYearId")
    expect(hub).toContain("setSubjectSelection({")
    expect(hub).not.toContain("const scopedYearId = initialYearId ?? yearId")
  })

  test("labels interactive copy controls and embeds the PDF with a title", async () => {
    // The two review panes live in copy-review-panel.tsx now.
    const copy = await source("./copy-review-panel.tsx")
    expect(copy).toContain('aria-label={t("Previous page")}')
    expect(copy).toContain('aria-label={t("Next page")}')
    expect(copy).toContain('aria-label={t("Original paper, page {page}"')
    expect(copy).toContain("<Label htmlFor=")
    expect(copy).toContain("<SelectGroup>")
  })

  test("extracts every stable learning label for both locales", async () => {
    const [files, frenchCatalogue] = await Promise.all([
      Promise.all([
        source("./learning-client.tsx"),
        source("./copy-review-workspace.tsx"),
        source("./objective-evidence-view.tsx"),
      ]),
      source("../../../messages/fr.json"),
    ])
    for (const file of files) {
      expect(file).toContain("useExtracted")
      expect(file).toContain("const t = useExtracted()")
    }
    expect(files.join("\n")).not.toMatch(
      />\s*(?:Apprentissage|Maîtrise|Copies|Confirmer|Réessayer)\s*</
    )
    expect(frenchCatalogue).toContain("Précision de l’estimation")
  })

  test("localizes every difficulty taxonomy through one exhaustive typed map", async () => {
    const [model, labels, hub, review] = await Promise.all([
      source("./copy-review-model.ts"),
      source("./learning-labels.ts"),
      source("./learning-client.tsx"),
      source("./copy-review-workspace.tsx"),
    ])
    expect(model).toContain(
      "export type ErrorTaxonomy = (typeof taxonomyValues)[number]"
    )
    expect(labels).toContain(
      "useLearningTaxonomyLabels(): Record<ErrorTaxonomy, string>"
    )
    for (const taxonomy of [
      "missing-knowledge",
      "misunderstood-concept",
      "method-strategy",
      "calculation",
      "notation",
      "reading-instruction",
      "justification",
      "transfer",
      "time-management",
      "unclassified",
    ]) {
      expect(labels).toContain(
        `${taxonomy.includes("-") ? `\"${taxonomy}\"` : taxonomy}: t(`
      )
    }
    expect(hub).toContain("taxonomyLabels[difficulty.taxonomy]")
    expect(review).toContain("label: taxonomyLabels[value]")
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
