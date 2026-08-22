import { PlannerEdit } from "@/components/agenda/planner-edit"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"

export default async function EditAgendaItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>
}) {
  const [{ itemId }, { activeYearId, queryClient }] = await Promise.all([
    params,
    prepareAuthenticatedShell(),
  ])
  await queryClient.fetchQuery({
    ...getServerOrpc().planner.list.queryOptions({
      input: { yearId: activeYearId, includeCompleted: true },
    }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  return (
    <HydrateClient queryClient={queryClient}>
      <PlannerEdit itemId={itemId} yearId={activeYearId} />
    </HydrateClient>
  )
}
