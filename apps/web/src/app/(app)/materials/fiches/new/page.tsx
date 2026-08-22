import { StudyDocumentCreate } from "@/components/documents/study-document-create"
import type { MaterialFolderView } from "@/components/materials/materials-types"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import { materialsFoldersInput } from "@/lib/route-query-inputs"

export default async function NewStudyDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ folderId?: string }>
}) {
  const [{ folderId }, { activeYearId, queryClient }] = await Promise.all([
    searchParams,
    prepareAuthenticatedShell(),
  ])
  const input = materialsFoldersInput(activeYearId)
  const folders = (await queryClient.fetchQuery({
    ...getServerOrpc().materials.folders.list.queryOptions({ input }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })) as MaterialFolderView[]
  const safeFolderId =
    folderId && folders.some((folder) => folder.id === folderId)
      ? folderId
      : null

  return (
    <HydrateClient queryClient={queryClient}>
      <StudyDocumentCreate initialFolderId={safeFolderId} />
    </HydrateClient>
  )
}
