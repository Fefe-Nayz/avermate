import { z } from "zod"
import { MediaStudioClient } from "@/components/media-studio/media-studio-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
const studioLocatorSchema = z.string().trim().min(1).max(256)

function studioLocator(value: string | string[] | undefined): string | null {
  const result = studioLocatorSchema.safeParse(value)
  return result.success ? result.data : null
}

export default async function MediaStudioPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string | string[]
    artifact?: string | string[]
  }>
}) {
  const { queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  const query = await searchParams
  const projectId = studioLocator(query.project)
  const artifactId = studioLocator(query.artifact)

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
        input: { projectId, artifactId: null, limit: 50 },
      }),
    }),
    queryClient.prefetchQuery({
      ...orpc.mediaStudio.listArtifacts.queryOptions({
        input: { projectId },
      }),
    }),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <MediaStudioClient
        initialProjectId={projectId}
        initialArtifactId={artifactId}
      />
    </HydrateClient>
  )
}
