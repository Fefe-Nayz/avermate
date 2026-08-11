import { PresetMembershipClient } from "./preset-membership-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { HydrateClient } from "@/lib/query-server"

export default async function PresetSettingsPage() {
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.prefetchQuery(orpc.presets.list.queryOptions()),
    queryClient.prefetchQuery(
      orpc.presets.status.queryOptions({ input: { yearId: activeYearId } })
    ),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <PresetMembershipClient />
    </HydrateClient>
  )
}
