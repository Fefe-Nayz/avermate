import { AdminAnnouncementsClient } from "./admin-announcements-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function AdminAnnouncementsPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()

  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.fetchQuery({
      ...orpc.admin.announcements.queryOptions(),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.fetchQuery({
      ...orpc.presets.admin.list.queryOptions(),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminAnnouncementsClient />
    </HydrateClient>
  )
}
