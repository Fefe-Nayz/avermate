import { AdminPresetsClient } from "./admin-presets-client"
import { requireServerAdmin } from "@/lib/admin-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function AdminPresetsPage() {
  await requireServerAdmin()
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()
  const presets = await queryClient.fetchQuery(
    orpc.presets.admin.list.queryOptions()
  )
  const first = presets[0]
  if (first) {
    await queryClient.prefetchQuery(
      orpc.presets.admin.get.queryOptions({ input: { presetId: first.id } })
    )
  }

  return (
    <HydrateClient queryClient={queryClient}>
      <AdminPresetsClient initialPresetId={first?.id ?? null} />
    </HydrateClient>
  )
}
