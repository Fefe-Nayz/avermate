import { AnnouncementsClient } from "./announcements-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"

export default async function AnnouncementsPage() {
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  await queryClient.fetchQuery({
    ...getServerOrpc().announcements.history.queryOptions({
      input: { yearId: activeYearId },
    }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  return (
    <HydrateClient queryClient={queryClient}>
      <AnnouncementsClient />
    </HydrateClient>
  )
}
