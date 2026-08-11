import { AdminFeedbackClient } from "./admin-feedback-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"
import {
  adminFeedbackQueueInput,
  INITIAL_ADMIN_FEEDBACK_FILTERS,
} from "@/lib/admin-feedback-query"

export default async function AdminFeedbackPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()

  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.fetchQuery(
      orpc.admin.feedbackQueue.queryOptions({
        input: adminFeedbackQueueInput(INITIAL_ADMIN_FEEDBACK_FILTERS),
      })
    ),
    queryClient.fetchQuery(orpc.admin.feedbackTriageStats.queryOptions()),
    queryClient.fetchQuery(orpc.admin.feedbackAssignees.queryOptions()),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminFeedbackClient />
    </HydrateClient>
  )
}
