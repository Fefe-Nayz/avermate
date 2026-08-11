import { AdminSocialOverviewClient } from "./social-overview-client"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function AdminSocialPage() {
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.fetchQuery(orpc.admin.socialFeatureStatus.queryOptions()),
    queryClient.fetchQuery(orpc.admin.socialOverview.queryOptions()),
  ])
  return (
    <HydrateClient queryClient={queryClient}>
      <AdminSocialOverviewClient />
    </HydrateClient>
  )
}
