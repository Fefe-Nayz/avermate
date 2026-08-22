import { PlanningAgendaClient } from "@/components/planning/planning-agenda-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { planningAssignmentsInput } from "@/lib/route-query-inputs"
import { HydrateClient } from "@/lib/query-server"

export default async function PlanningAgendaPage() {
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  await queryClient.fetchQuery({
    ...getServerOrpc().planning.assignments.list.queryOptions({
      input: planningAssignmentsInput(activeYearId),
    }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  return (
    <HydrateClient queryClient={queryClient}>
      <PlanningAgendaClient initialYearId={activeYearId} />
    </HydrateClient>
  )
}
