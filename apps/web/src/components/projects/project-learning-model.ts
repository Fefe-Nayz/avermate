export type ProjectLearningDestination = "overview" | "plan" | "mastery"

export type ProjectLearningScope = {
  yearId: string
  subjectId: string | null
}

const ACTIVE_PLAN_STATUSES = new Set(["proposed", "accepted", "in-progress"])

export function learningWorkspaceHref(
  destination: ProjectLearningDestination,
  scope: ProjectLearningScope
) {
  const query = new URLSearchParams({ year: scope.yearId })
  if (scope.subjectId) query.set("subject", scope.subjectId)
  if (destination !== "overview") query.set("tab", destination)
  return `/learning?${query.toString()}`
}

export function activeProjectLearningPlanRows<
  Row extends { item: { status: string } },
>(rows: readonly Row[], limit = 4): Row[] {
  if (limit <= 0) return []
  return rows
    .filter((row) => ACTIVE_PLAN_STATUSES.has(row.item.status))
    .slice(0, limit)
}
