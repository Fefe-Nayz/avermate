import { AdminSocialAuditClient } from "./social-audit-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { INITIAL_ADMIN_SOCIAL_AUDIT_INPUT } from "@/lib/admin-social-inputs"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function AdminSocialAuditPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()

  await queryClient.fetchQuery(
    orpc.admin.socialAudit.queryOptions({
      input: INITIAL_ADMIN_SOCIAL_AUDIT_INPUT,
    })
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminSocialAuditClient />
    </HydrateClient>
  )
}
