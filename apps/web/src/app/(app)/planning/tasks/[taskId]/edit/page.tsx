import { PlanningTaskEditor } from "@/components/planning/planning-edit-loader"

export default async function EditPlanningTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  return <PlanningTaskEditor taskId={taskId} />
}
