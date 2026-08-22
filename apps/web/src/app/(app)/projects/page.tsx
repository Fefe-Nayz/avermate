import { ProjectsClient } from "@/components/projects/projects-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"

export default async function ProjectsPage() {
  const { queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  await queryClient.prefetchQuery({
    ...orpc.projects.list.queryOptions({ input: { include: "all" } }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  return (
    <HydrateClient queryClient={queryClient}>
      <ProjectsClient />
    </HydrateClient>
  )
}
