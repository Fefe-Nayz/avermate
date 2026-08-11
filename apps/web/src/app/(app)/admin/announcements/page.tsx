import { AdminAnnouncementsClient } from "./admin-announcements-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function AdminAnnouncementsPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()

  await queryClient.fetchQuery(
    getServerOrpc().admin.announcements.queryOptions()
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminAnnouncementsClient />
    </HydrateClient>
  )
}
