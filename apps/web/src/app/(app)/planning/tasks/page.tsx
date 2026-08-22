import { PlanningTasksClient } from "@/components/planning/planning-tasks-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { planningTasksInput } from "@/lib/route-query-inputs"
import { HydrateClient } from "@/lib/query-server"

export default async function PlanningTasksPage() {
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  await queryClient.fetchQuery({
    ...getServerOrpc().planning.tasks.list.queryOptions({
      input: planningTasksInput(activeYearId),
    }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  return (
    <HydrateClient queryClient={queryClient}>
      <PlanningTasksClient initialYearId={activeYearId} />
    </HydrateClient>
  )
}
