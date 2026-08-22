import { ObjectiveEvidenceView } from "@/components/learning/objective-evidence-view"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { HydrateClient } from "@/lib/query-server"

export default async function ObjectivePage({
  params,
}: {
  params: Promise<{ objectiveId: string }>
}) {
  const { objectiveId } = await params
  const { queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.prefetchQuery(
      orpc.learning.mastery.explain.queryOptions({ input: { objectiveId } })
    ),
    queryClient.prefetchQuery(
      orpc.learning.evidence.list.queryOptions({ input: { objectiveId } })
    ),
  ])
  return (
    <HydrateClient queryClient={queryClient}>
      <ObjectiveEvidenceView objectiveId={objectiveId} />
    </HydrateClient>
  )
}
