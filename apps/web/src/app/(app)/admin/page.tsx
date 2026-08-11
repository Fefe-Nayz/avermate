import { AdminOverviewClient } from "./admin-overview-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"
import { ADMIN_OVERVIEW_INPUT } from "@/lib/route-query-inputs"

export default async function AdminPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()

  await queryClient.fetchQuery(
    getServerOrpc().admin.overview.queryOptions({
      input: ADMIN_OVERVIEW_INPUT,
    })
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminOverviewClient />
    </HydrateClient>
  )
}
