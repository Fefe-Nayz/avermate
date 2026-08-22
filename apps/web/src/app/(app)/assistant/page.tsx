import { AssistantWorkspaceClient } from "@/components/assistant/assistant-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { HydrateClient } from "@/lib/query-server"

export default async function AssistantPage() {
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()

  await Promise.all([
    queryClient.prefetchQuery(
      orpc.assistant.threads.list.queryOptions({
        input: {
          limit: 100,
          includeArchived: true,
          includeDeleted: true,
          starredOnly: false,
        },
      })
    ),
    queryClient.prefetchQuery(orpc.assistant.models.list.queryOptions()),
    queryClient.prefetchQuery(orpc.assistant.skills.list.queryOptions()),
    queryClient.prefetchQuery(
      orpc.projects.list.queryOptions({ input: { include: "live" } })
    ),
    queryClient.prefetchQuery(
      orpc.materials.documents.list.queryOptions({
        input: { yearId: activeYearId, include: "live" },
      })
    ),
    queryClient.prefetchQuery(
      orpc.documents.list.queryOptions({
        input: { yearId: activeYearId, include: "live" },
      })
    ),
    queryClient.prefetchQuery(
      orpc.recordings.list.queryOptions({
        input: { yearId: activeYearId, include: "live" },
      })
    ),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <AssistantWorkspaceClient className="min-h-[calc(100svh-10rem)] md:h-full md:min-h-0" />
    </HydrateClient>
  )
}
