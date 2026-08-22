import { ManagedOperationsClient } from "./managed-operations-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function ManagedOperationsPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()
  await queryClient.prefetchQuery(
    getServerOrpc().managed.admin.beta.overview.queryOptions()
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <ManagedOperationsClient />
    </HydrateClient>
  )
}
