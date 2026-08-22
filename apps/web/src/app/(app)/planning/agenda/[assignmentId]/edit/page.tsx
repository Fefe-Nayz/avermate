import { PlanningAssignmentEditor } from "@/components/planning/planning-edit-loader"

export default async function EditPlanningAssignmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>
}) {
  const { assignmentId } = await params
  return <PlanningAssignmentEditor assignmentId={assignmentId} />
}
