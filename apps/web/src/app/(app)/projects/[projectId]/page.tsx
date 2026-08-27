import { ProjectsClient } from "@/components/projects/projects-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import {
  lectureRecordingsInput,
  materialsDocumentsInput,
  studyDocumentsInput,
} from "@/lib/route-query-inputs"

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  const projectPromise = queryClient.fetchQuery({
    ...orpc.projects.get.queryOptions({ input: { projectId } }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  await Promise.all([
    queryClient.prefetchQuery({
      ...orpc.projects.list.queryOptions({ input: { include: "all" } }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    projectPromise,
    queryClient.prefetchQuery({
      ...orpc.projects.retrievalPolicy.queryOptions({ input: { projectId } }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.materials.documents.list.queryOptions({
        input: materialsDocumentsInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.documents.list.queryOptions({
        input: studyDocumentsInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.recordings.list.queryOptions({
        input: lectureRecordingsInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    projectPromise.then((result) => {
      const yearId = result.project.yearId
      if (!yearId) return
      const scope = { yearId, subjectId: result.project.subjectId }
      return Promise.all([
        queryClient.prefetchQuery({
          ...orpc.learning.progress.queryOptions({ input: scope }),
          staleTime: COMMON_QUERY_STALE_TIME,
        }),
        queryClient.prefetchQuery({
          ...orpc.learning.plan.list.queryOptions({ input: scope }),
          staleTime: COMMON_QUERY_STALE_TIME,
        }),
      ])
    }),
  ])
  return (
    <HydrateClient queryClient={queryClient}>
      <ProjectsClient selectedProjectId={projectId} />
    </HydrateClient>
  )
}
