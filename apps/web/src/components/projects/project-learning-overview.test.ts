import { describe, expect, test } from "bun:test"
import {
  activeProjectLearningPlanRows,
  learningWorkspaceHref,
} from "./project-learning-model"

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("project learning workspace", () => {
  test("keeps authoritative Learning destinations explicit", () => {
    const wholeYear = { yearId: "year 1", subjectId: null }
    const subject = { yearId: "year 1", subjectId: "maths/advanced" }

    expect(learningWorkspaceHref("overview", wholeYear)).toBe(
      "/learning?year=year+1"
    )
    expect(learningWorkspaceHref("plan", subject)).toBe(
      "/learning?year=year+1&subject=maths%2Fadvanced&tab=plan"
    )
    expect(learningWorkspaceHref("mastery", subject)).toBe(
      "/learning?year=year+1&subject=maths%2Fadvanced&tab=mastery"
    )
  })

  test("previews only active plan rows without creating another task state", () => {
    const rows = [
      { item: { id: "one", status: "completed" } },
      { item: { id: "two", status: "in-progress" } },
      { item: { id: "three", status: "accepted" } },
      { item: { id: "four", status: "dismissed" } },
      { item: { id: "five", status: "proposed" } },
      { item: { id: "six", status: "proposed" } },
      { item: { id: "seven", status: "proposed" } },
    ]

    expect(
      activeProjectLearningPlanRows(rows).map((row) => row.item.id)
    ).toEqual(["two", "three", "five", "six"])
    expect(activeProjectLearningPlanRows(rows, 0)).toEqual([])
  })

  test("queries the canonical read models with the exact project scope", async () => {
    const overview = await source("./project-learning-overview.tsx")

    expect(overview).toContain(
      "orpc.learning.progress.queryOptions({ input: scope })"
    )
    expect(overview).toContain(
      "orpc.learning.plan.list.queryOptions({ input: scope })"
    )
    expect(overview).toContain(
      'const scope = { yearId: yearId ?? "", subjectId }'
    )
    expect(overview.match(/enabled: Boolean\(yearId\)/g)?.length).toBe(2)
    expect(overview).toContain("staleTime: COMMON_QUERY_STALE_TIME")
    expect(overview).not.toContain("useMutation")
    expect(overview).not.toContain("invalidateQueries")
  })

  test("shows honest measured, uncertain and missing-evidence states", async () => {
    const overview = await source("./project-learning-overview.tsx")

    for (const contract of [
      't("Evidence coverage")',
      't("Measured estimate")',
      't("Estimate precision")',
      'summary.variation.trend === "method-changed"',
      'summary.variation.trend === "uncertain"',
      'objective.measurementState === "unmeasured"',
      't("Next useful action")',
      "activeProjectLearningPlanRows(planQuery.data ?? [])",
    ]) {
      expect(overview).toContain(contract)
    }
    expect(overview).toContain("if (!yearId)")
    expect(overview).toContain("progressQuery.isLoading")
    expect(overview).toContain("progressQuery.isError")
    expect(overview).toContain("data.summary.objectiveCount === 0")
    expect(overview).toContain('role="status"')
    expect(overview).toContain('aria-labelledby="project-learning-title"')
  })

  test("labels the shared year-and-subject projection honestly", async () => {
    const [overview, projectsClient] = await Promise.all([
      source("./project-learning-overview.tsx"),
      source("./projects-client.tsx"),
    ])

    expect(overview).toContain('t("Progress in this subject")')
    expect(projectsClient).toContain('t("Progress in this subject")')
    expect(overview).toContain(
      "This read-only view is shared by projects linked to the same academic year and subject."
    )
  })

  test("links back to the authoritative Learning views and exact objectives", async () => {
    const [overview, learningPage] = await Promise.all([
      source("./project-learning-overview.tsx"),
      source("../../app/(app)/learning/page.tsx"),
    ])

    expect(overview).toContain('learningWorkspaceHref("plan", learningScope)')
    expect(overview).toContain(
      'learningWorkspaceHref("mastery", learningScope)'
    )
    expect(overview).toContain("`/learning/objectives/${objective.id}`")
    expect(learningPage).toContain("initialYearId={deepLinkedYearId}")
    expect(learningPage).toContain("initialSubjectId={initialSubjectId}")
    expect(learningPage).toContain(
      "learningTabs.has(requestedTab as LearningTab)"
    )
    expect(learningPage).toContain(
      "const scope = { yearId: initialYearId, subjectId: initialSubjectId }"
    )
  })

  test("hydrates the two scoped read models from the project route", async () => {
    const page = await source("../../app/(app)/projects/[projectId]/page.tsx")

    expect(page).toContain("const projectPromise = queryClient.fetchQuery")
    expect(page).toContain("const yearId = result.project.yearId")
    expect(page).toContain(
      "const scope = { yearId, subjectId: result.project.subjectId }"
    )
    expect(page).toContain(
      "orpc.learning.progress.queryOptions({ input: scope })"
    )
    expect(page).toContain(
      "orpc.learning.plan.list.queryOptions({ input: scope })"
    )
  })
})
