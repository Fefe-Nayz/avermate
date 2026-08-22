import { ActionActivityClient } from "@/components/assistant/actions/action-activity-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { HydrateClient } from "@/lib/query-server"

export default async function AssistantActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ threadId?: string | string[] }>
}) {
  const { queryClient } = await prepareAuthenticatedShell()
  const requestedThreadId = (await searchParams).threadId
  const initialThreadId = Array.isArray(requestedThreadId)
    ? (requestedThreadId[0] ?? "")
    : (requestedThreadId ?? "")
  await queryClient.prefetchQuery(
    getServerOrpc().actions.activity.list.queryOptions({
      input: {
        limit: 50,
        ...(initialThreadId ? { threadId: initialThreadId } : {}),
      },
    })
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <ActionActivityClient initialThreadId={initialThreadId} />
    </HydrateClient>
  )
}
