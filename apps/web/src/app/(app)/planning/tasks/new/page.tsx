import { PlanningTaskForm } from "@/components/planning/planning-task-form"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"

export default async function NewPlanningTaskPage() {
  const { activeYearId } = await prepareAuthenticatedShell()
  return <PlanningTaskForm yearId={activeYearId} mode="create" />
}
