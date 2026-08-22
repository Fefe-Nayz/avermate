import { MediaStudioClient } from "@/components/media-studio/media-studio-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"

export default async function MediaStudioPage() {
  const { queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()

  await Promise.all([
    queryClient.prefetchQuery({
      ...orpc.projects.list.queryOptions({ input: { include: "all" } }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.mediaStudio.capabilities.queryOptions(),
      staleTime: 30_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.mediaStudio.videoExtractionConsent.queryOptions(),
      staleTime: 30_000,
    }),
    queryClient.prefetchQuery({
      ...orpc.mediaStudio.listWorkflows.queryOptions({
        input: { projectId: null, artifactId: null, limit: 50 },
      }),
    }),
    queryClient.prefetchQuery({
      ...orpc.mediaStudio.listArtifacts.queryOptions({
        input: { projectId: null },
      }),
    }),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <MediaStudioClient />
    </HydrateClient>
  )
}
