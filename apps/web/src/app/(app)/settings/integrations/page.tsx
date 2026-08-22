import { IntegrationsClient, IntegrationsPageMeta } from "./integrations-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { loadOAuthIntegrations } from "@/lib/oauth-integrations"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import { syncConnectionsInput, syncStatusInput } from "@/lib/route-query-inputs"

export default async function IntegrationsSettingsPage() {
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  const [integrations, connections] = await Promise.all([
    loadOAuthIntegrations(),
    queryClient.fetchQuery({
      ...orpc.sync.connections.list.queryOptions({
        input: syncConnectionsInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.serviceKeys.list.queryOptions(),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.sync.providers.queryOptions(),
      staleTime: Number.POSITIVE_INFINITY,
    }),
  ])

  await Promise.all(
    connections.map((connection) =>
      queryClient.prefetchQuery({
        ...orpc.sync.status.queryOptions({
          input: syncStatusInput(connection.id),
        }),
        staleTime: 10_000,
      })
    )
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <IntegrationsPageMeta />
      <IntegrationsClient initial={integrations} />
    </HydrateClient>
  )
}
