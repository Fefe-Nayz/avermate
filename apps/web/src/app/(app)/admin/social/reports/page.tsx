import { AdminSocialReportsClient } from "./social-reports-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { INITIAL_ADMIN_SOCIAL_REPORTS_INPUT } from "@/lib/admin-social-inputs"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function AdminSocialReportsPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()

  await Promise.all([
    queryClient.fetchQuery(
      orpc.admin.socialReports.queryOptions({
        input: INITIAL_ADMIN_SOCIAL_REPORTS_INPUT,
      })
    ),
    queryClient.fetchQuery(orpc.admin.feedbackAssignees.queryOptions()),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminSocialReportsClient />
    </HydrateClient>
  )
}
