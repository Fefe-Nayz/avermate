import { StudyDocumentEditor } from "@/components/documents/study-document-editor"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import { studyDocumentInput } from "@/lib/route-query-inputs"

export default async function EditStudyDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>
}) {
  const [{ documentId }, { queryClient }] = await Promise.all([
    params,
    prepareAuthenticatedShell(),
  ])
  const input = studyDocumentInput(documentId)
  await queryClient.fetchQuery({
    ...getServerOrpc().documents.getForEdit.queryOptions({ input }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  return (
    <HydrateClient queryClient={queryClient}>
      <StudyDocumentEditor documentId={documentId} />
    </HydrateClient>
  )
}
