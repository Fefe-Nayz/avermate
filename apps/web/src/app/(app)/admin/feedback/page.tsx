import { AdminFeedbackClient } from "./admin-feedback-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"
import {
  adminFeedbackInput,
  INITIAL_ADMIN_FEEDBACK_STATUS,
} from "@/lib/route-query-inputs"

export default async function AdminFeedbackPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()

  await queryClient.fetchQuery(
    getServerOrpc().admin.feedback.queryOptions({
      input: adminFeedbackInput(INITIAL_ADMIN_FEEDBACK_STATUS),
    })
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminFeedbackClient />
    </HydrateClient>
  )
}
