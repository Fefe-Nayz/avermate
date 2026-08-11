import { AnnouncementsClient } from "./announcements-client"
import { getServerOrpc } from "@/lib/orpc/server"
import { getServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function AnnouncementsPage() {
  const queryClient = getServerQueryClient()
  await queryClient.fetchQuery(
    getServerOrpc().announcements.history.queryOptions()
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <AnnouncementsClient />
    </HydrateClient>
  )
}
