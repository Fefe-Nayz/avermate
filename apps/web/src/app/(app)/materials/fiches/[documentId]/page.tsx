import { StudyDocumentReader } from "@/components/documents/study-document-reader"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import { studyDocumentInput } from "@/lib/route-query-inputs"

export default async function StudyDocumentPage({
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
    ...getServerOrpc().documents.get.queryOptions({ input }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  return (
    <HydrateClient queryClient={queryClient}>
      <StudyDocumentReader documentId={documentId} />
    </HydrateClient>
  )
}
