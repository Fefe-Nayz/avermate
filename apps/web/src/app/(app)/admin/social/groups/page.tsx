import { AdminSocialGroupsClient } from "./social-groups-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { INITIAL_ADMIN_SOCIAL_GROUPS_INPUT } from "@/lib/admin-social-inputs"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function AdminSocialGroupsPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()

  await queryClient.fetchQuery(
    orpc.admin.socialGroups.queryOptions({
      input: INITIAL_ADMIN_SOCIAL_GROUPS_INPUT,
    })
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminSocialGroupsClient />
    </HydrateClient>
  )
}
