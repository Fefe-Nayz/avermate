import { CapabilitySettingsClient } from "./processing-settings-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { HydrateClient } from "@/lib/query-server"

export default async function CapabilitySettingsPage() {
  const { queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()

  await Promise.all([
    queryClient.prefetchQuery({
      ...orpc.capabilities.catalogue.queryOptions(),
      staleTime: 60_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.capabilities.readiness.queryOptions(),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.capabilities.connections.list.queryOptions(),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.capabilities.offerings.list.queryOptions(),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.capabilities.policies.list.queryOptions(),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.capabilities.consents.list.queryOptions(),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.capabilities.operations.list.queryOptions({
        input: { limit: 50 },
      }),
      staleTime: 5_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.capabilities.usage.summary.queryOptions(),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.capabilities.diagnostics.shadowMismatches.queryOptions({
        input: { limit: 50 },
      }),
      staleTime: 10_000,
    }),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <CapabilitySettingsClient />
    </HydrateClient>
  )
}
