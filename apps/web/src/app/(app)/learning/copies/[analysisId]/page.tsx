import { CopyReviewWorkspace } from "@/components/learning/copy-review-workspace"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { HydrateClient } from "@/lib/query-server"

export default async function CopyReviewPage({
  params,
}: {
  params: Promise<{ analysisId: string }>
}) {
  const { analysisId } = await params
  const { queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  const copy = await queryClient.fetchQuery(
    orpc.learning.copies.get.queryOptions({ input: { analysisId } })
  )
  await queryClient.prefetchQuery(
    orpc.learning.concepts.list.queryOptions({
      input: {
        yearId: copy.analysis.yearId,
        subjectId: copy.analysis.subjectId,
      },
    })
  )
  if (copy.analysis.jobId) {
    await queryClient.prefetchQuery(
      orpc.jobs.get.queryOptions({ input: { jobId: copy.analysis.jobId } })
    )
  }
  return (
    <HydrateClient queryClient={queryClient}>
      <CopyReviewWorkspace analysisId={analysisId} />
    </HydrateClient>
  )
}
