import { ActionActivityClient } from "@/components/assistant/actions/action-activity-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { HydrateClient } from "@/lib/query-server"

export default async function AssistantActionsPage() {
  const { queryClient } = await prepareAuthenticatedShell()
  await queryClient.prefetchQuery(
    getServerOrpc().actions.activity.list.queryOptions({
      input: { limit: 50 },
    })
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <ActionActivityClient />
    </HydrateClient>
  )
}
