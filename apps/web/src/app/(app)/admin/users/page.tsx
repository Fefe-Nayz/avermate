import { AdminUsersClient } from "./admin-users-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"
import { adminUsersInput } from "@/lib/route-query-inputs"

export default async function AdminUsersPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()

  await queryClient.fetchQuery(
    getServerOrpc().admin.users.queryOptions({
      input: adminUsersInput(""),
    })
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminUsersClient />
    </HydrateClient>
  )
}
