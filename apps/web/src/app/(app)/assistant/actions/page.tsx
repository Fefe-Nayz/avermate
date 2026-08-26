import { ActionActivityClient } from "@/components/assistant/actions/action-activity-client"
import { AssistantWorkspaceClient } from "@/components/assistant/assistant-client"
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
      {/*
        Shown where the conversation is shown, with the same rail beside it and
        a close that goes back to it — the way opening a document inside the
        file browser already works. As its own page it left the assistant with
        no visible return on a wide screen.
      */}
      <AssistantWorkspaceClient
        className="h-full min-h-0 w-full"
        pane={<ActionActivityClient initialThreadId={initialThreadId} />}
        paneCloseHref="/assistant"
      />
    </HydrateClient>
  )
}
