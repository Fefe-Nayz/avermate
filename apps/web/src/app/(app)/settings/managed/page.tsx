import { ManagedServiceClient } from "./managed-service-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { HydrateClient } from "@/lib/query-server"

export default async function ManagedServiceSettingsPage() {
  const { queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.prefetchQuery({
      ...orpc.managed.beta.status.queryOptions(),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.managed.usage.reservations.queryOptions({
        input: { limit: 100 },
      }),
      staleTime: 10_000,
    }),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <ManagedServiceClient />
    </HydrateClient>
  )
}
