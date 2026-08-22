import { MaterialTagCreate } from "@/components/materials/material-tag-loader"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import { materialTagsInput } from "@/lib/route-query-inputs"

/** A new tag, as a screen like every other creation form in the app. */
export default async function NewMaterialTagPage() {
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  // The existing tags come along so a duplicate name is refused in the form
  // rather than by the server after the last step.
  await queryClient.fetchQuery({
    ...getServerOrpc().materials.tags.list.queryOptions({
      input: materialTagsInput(activeYearId),
    }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  return (
    <HydrateClient queryClient={queryClient}>
      <MaterialTagCreate />
    </HydrateClient>
  )
}
