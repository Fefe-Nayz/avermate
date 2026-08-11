import { ReviewClient } from "./review-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"
import { reviewStatusInput } from "@/lib/route-query-inputs"

export default async function ReviewPage() {
  const { activeYearId } = await prepareAuthenticatedShell()
  const queryClient = createServerQueryClient()

  await queryClient.fetchQuery(
    getServerOrpc().review.status.queryOptions({
      input: reviewStatusInput(activeYearId),
    })
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <ReviewClient />
    </HydrateClient>
  )
}
