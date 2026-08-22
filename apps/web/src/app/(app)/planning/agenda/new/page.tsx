import { PlanningAssignmentForm } from "@/components/planning/planning-assignment-form"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"

export default async function NewPlanningAssignmentPage() {
  const { activeYearId } = await prepareAuthenticatedShell()
  return <PlanningAssignmentForm yearId={activeYearId} mode="create" />
}
