import { MaterialsTagsClient } from "@/components/materials/materials-tags-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import { materialTagsInput } from "@/lib/route-query-inputs"

/** The tags in this year: what they are called, and what they are on. */
export default async function MaterialTagsPage() {
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  await queryClient.fetchQuery({
    ...getServerOrpc().materials.tags.list.queryOptions({
      input: materialTagsInput(activeYearId),
    }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  return (
    <HydrateClient queryClient={queryClient}>
      <MaterialsTagsClient />
    </HydrateClient>
  )
}
