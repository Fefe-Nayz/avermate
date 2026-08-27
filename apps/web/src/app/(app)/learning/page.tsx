import { LearningClient } from "@/components/learning/learning-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"

const learningTabs = new Set([
  "overview",
  "plan",
  "mastery",
  "copies",
  "concepts",
  "history",
] as const)

type LearningTab =
  "overview" | "plan" | "mastery" | "copies" | "concepts" | "history"

export default async function LearningPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[]
    year?: string | string[]
    subject?: string | string[]
  }>
}) {
  const parameters = await searchParams
  const requestedTab = parameters.tab
  const initialTab =
    typeof requestedTab === "string" &&
    learningTabs.has(requestedTab as LearningTab)
      ? (requestedTab as LearningTab)
      : "overview"
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  const years = await queryClient.fetchQuery({
    ...orpc.years.list.queryOptions(),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const requestedYearId =
    typeof parameters.year === "string" ? parameters.year : null
  const deepLinkedYearId =
    requestedYearId && years.some((year) => year.id === requestedYearId)
      ? requestedYearId
      : null
  const initialYearId = deepLinkedYearId ?? activeYearId
  const requestedSubjectId =
    typeof parameters.subject === "string" ? parameters.subject : null
  const scopedSubjects = requestedSubjectId
    ? await queryClient.fetchQuery({
        ...orpc.subjects.list.queryOptions({
          input: { yearId: initialYearId },
        }),
        staleTime: COMMON_QUERY_STALE_TIME,
      })
    : []
  const initialSubjectId = scopedSubjects.some(
    (subject) => subject.id === requestedSubjectId
  )
    ? requestedSubjectId
    : null
  const scope = { yearId: initialYearId, subjectId: initialSubjectId }
  await Promise.all([
    queryClient.prefetchQuery({
      ...orpc.learning.settings.get.queryOptions(),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.concepts.list.queryOptions({
        input: scope,
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.mastery.list.queryOptions({
        input: scope,
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.copies.list.queryOptions({
        input: scope,
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.plan.list.queryOptions({
        input: scope,
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.learning.progress.queryOptions({
        input: scope,
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
      <LearningClient
        initialTab={initialTab}
        initialYearId={deepLinkedYearId}
        initialSubjectId={initialSubjectId}
      />
    </HydrateClient>
  )
}
