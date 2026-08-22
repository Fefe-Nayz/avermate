import type { ReactNode } from "react"
import { requireServerViewer } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"
import { gradeAttachmentsInput } from "@/lib/route-query-inputs"

export default async function GradeDetailLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ gradeId: string }>
}) {
  const [{ gradeId }] = await Promise.all([params, requireServerViewer()])
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.prefetchQuery(
      orpc.grades.get.queryOptions({ input: { gradeId } })
    ),
    queryClient.prefetchQuery(
      orpc.grades.attachments.queryOptions({
        input: gradeAttachmentsInput(gradeId),
      })
    ),
    queryClient.prefetchQuery(orpc.profile.uploadsEnabled.queryOptions()),
  ])

  return <HydrateClient queryClient={queryClient}>{children}</HydrateClient>
}
