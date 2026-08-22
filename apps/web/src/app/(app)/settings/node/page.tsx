import { AvermateNodeSettingsClient } from "./node-settings-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { HydrateClient } from "@/lib/query-server"

export default async function AvermateNodeSettingsPage() {
  const { queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.prefetchQuery({
      ...orpc.node.readiness.queryOptions(),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.node.list.queryOptions(),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.node.lifecycle.queryOptions({ input: { limit: 100 } }),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.node.remoteDeletions.queryOptions({ input: { limit: 100 } }),
      staleTime: 10_000,
    }),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <AvermateNodeSettingsClient />
    </HydrateClient>
  )
}
