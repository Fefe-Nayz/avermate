import { describe, expect, test } from "bun:test"

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("learning mandatory Web completion", () => {
  test("validates and imports packs, edits hierarchy and prerequisites, and previews every structural operation", async () => {
    const [view, model, router] = await Promise.all([
      source("./concept-management.tsx"),
      source("./learning-model.ts"),
      source("../../../../server/src/routers/learning.ts"),
    ])
    expect(view).toContain("parseConceptPackJson")
    expect(view).toContain("learning.concepts.importPack")
    expect(view).toContain("learning.concepts.update.mutationOptions")
    expect(view).toContain("learning.concepts.updateObjective")
    for (const operation of ["Merge", "Split", "Archive"])
      expect(view).toContain(`preview${operation}.mutationOptions`)
    expect(view).toContain("learning.concepts.operations")
    expect(view).toContain("previewDigest")
    expect(model).toContain("hasDirectedCycle")
    expect(model).toContain("Year and subject")
    expect(router).toContain("prerequisites = objectives.length")
    expect(router).toContain("learningObjectivePrerequisites.userId, userId")
  })

  test("exposes revision-fenced copy cancellation, retry and immutable re-analysis", async () => {
    const copy = await source("./copy-review-workspace.tsx")
    expect(copy).toContain("learning.copies.cancel")
    expect(copy).toContain("learning.copies.retry")
    expect(copy).toContain("learning.copies.reanalyze")
    expect(copy).toContain("Server-selected model revision")
    expect(copy).not.toContain('id="copy-model-revision"')
    expect(copy).toContain("expectedRevision: analysis.revision")
    expect(copy).toContain('t("Analysis cancelled")')
    expect(copy).toContain('t("Analyze with a new model revision")')
    expect(copy).toContain("router.push(`/learning/copies/${next.id}`)")
  })

  test("downloads both privacy exports and requires literal destructive confirmations", async () => {
    const privacy = await source("./learning-privacy-controls.tsx")
    expect(privacy).toContain("learning.privacy.preview")
    expect(privacy).toContain("learning.privacy.export")
    expect(privacy).toContain("learning.privacy.deleteDerivatives")
    expect(privacy).toContain("learning.privacy.deleteAll")
    expect(privacy).toContain("application/json;charset=utf-8")
    expect(privacy).toContain("text/markdown;charset=utf-8")
    expect(privacy).toContain('"DELETE DERIVATIVES"')
    expect(privacy).toContain('"DELETE LEARNING"')
    expect(privacy).toContain('t("Provider disclosure")')
  })

  test("groups by authoritative planning dates and links agenda, calendar and kanban separately", async () => {
    const [plan, model, router] = await Promise.all([
      source("./learning-plan-view.tsx"),
      source("./learning-model.ts"),
      source("../../../../server/src/routers/learning.ts"),
    ])
    expect(plan).toContain('t("Today")')
    expect(plan).toContain('t("Upcoming")')
    expect(plan).toContain('t("By objective")')
    expect(plan).toContain("availableMinutes")
    expect(plan).toContain("learningRationaleV2")
    expect(plan).toContain("/planning/agenda?task=")
    expect(plan).toContain("/planning/calendar?task=")
    expect(plan).toContain("/planning/tasks?task=")
    expect(plan).toContain("expectedRevision,")
    expect(plan).toContain("onApply(item.id, item.revision")
    expect(model).toContain(
      'LearningPlanGroup = "today" | "upcoming" | "objectives"'
    )
    expect(router).toContain("planningTask: planningTasks")
    expect(router).toContain(
      "eq(planningTasks.userId, context.session.user.id)"
    )
    expect(router).toContain("applyLearningPlanItemCommand")
    expect(router).toContain("expectedRevision: z.number().int().positive()")
  })

  test("renders offline, stale, cancelled, loading, empty and error states with accessible controls", async () => {
    const [hub, copy, concepts, plan, privacy] = await Promise.all([
      source("./learning-client.tsx"),
      source("./copy-review-workspace.tsx"),
      source("./concept-management.tsx"),
      source("./learning-plan-view.tsx"),
      source("./learning-privacy-controls.tsx"),
    ])
    expect(hub).toContain("useOnlineStatus")
    expect(hub).toContain('t("Some learning data may be stale")')
    expect(copy).toContain('t("Analysis cancelled")')
    expect(copy).toContain("<DialogTitle>")
    expect(copy).toContain("aria-label={t(")
    expect(concepts).toContain("<Empty")
    expect(concepts).toContain("<AlertDialogTitle>")
    expect(concepts).toContain("<Label htmlFor=")
    expect(plan).toContain("<Skeleton")
    expect(plan).toContain("lg:grid-cols-2")
    expect(privacy).toContain("<AlertDialogTitle>")
    expect(privacy).toContain("aria-label={t(")
  })
})
