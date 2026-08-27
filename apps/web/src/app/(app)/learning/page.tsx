import { LearningClient } from "@/components/learning/learning-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"

export default async function LearningPage() {
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.prefetchQuery({
      ...orpc.learning.settings.get.queryOptions(),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.concepts.list.queryOptions({
        input: { yearId: activeYearId, subjectId: null },
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.mastery.list.queryOptions({
        input: { yearId: activeYearId, subjectId: null },
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.copies.list.queryOptions({
        input: { yearId: activeYearId, subjectId: null },
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.plan.list.queryOptions({
        input: { yearId: activeYearId, subjectId: null },
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.progress.queryOptions({
        input: { yearId: activeYearId, subjectId: null },
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.privacy.preview.queryOptions(),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
  ])
  return (
    <HydrateClient queryClient={queryClient}>
      <LearningClient />
    </HydrateClient>
  )
}
