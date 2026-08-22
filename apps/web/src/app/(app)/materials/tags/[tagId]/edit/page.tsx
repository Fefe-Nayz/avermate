import { MaterialTagEditor } from "@/components/materials/material-tag-loader"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import { materialTagsInput } from "@/lib/route-query-inputs"

export default async function EditMaterialTagPage({
  params,
}: {
  params: Promise<{ tagId: string }>
}) {
  const [{ tagId }, { activeYearId, queryClient }] = await Promise.all([
    params,
    prepareAuthenticatedShell(),
  ])
  await queryClient.fetchQuery({
    ...getServerOrpc().materials.tags.list.queryOptions({
      input: materialTagsInput(activeYearId),
    }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  return (
    <HydrateClient queryClient={queryClient}>
      <MaterialTagEditor tagId={tagId} />
    </HydrateClient>
  )
}
