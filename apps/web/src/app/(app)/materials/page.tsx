import { MaterialsClient } from "@/components/materials/materials-client"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import {
  lectureRecordingsInput,
  materialsDocumentsInput,
  materialsFoldersInput,
  studyDocumentsInput,
} from "@/lib/route-query-inputs"

export default async function MaterialsPage() {
  const { activeYearId, queryClient } = await prepareAuthenticatedShell()
  const orpc = getServerOrpc()

  await Promise.all([
    queryClient.prefetchQuery({
      ...orpc.materials.folders.list.queryOptions({
        input: materialsFoldersInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.materials.documents.list.queryOptions({
        input: materialsDocumentsInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.documents.list.queryOptions({
        input: studyDocumentsInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.recordings.list.queryOptions({
        input: lectureRecordingsInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      ...orpc.materials.documents.uploadsEnabled.queryOptions(),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <MaterialsClient />
    </HydrateClient>
  )
}
