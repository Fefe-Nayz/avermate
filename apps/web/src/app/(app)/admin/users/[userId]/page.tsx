import { AdminUserDetailClient } from "./admin-user-detail-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  await requireServerAdmin()
  const { userId } = await params
  const queryClient = createServerQueryClient()
  await queryClient.fetchQuery(
    getServerOrpc().admin.user.queryOptions({
      input: { userId, days: 90 },
    })
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminUserDetailClient userId={userId} />
    </HydrateClient>
  )
}
