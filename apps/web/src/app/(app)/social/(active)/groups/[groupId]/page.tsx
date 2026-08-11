import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { GroupDetailClient } from "./group-detail-client"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export const metadata: Metadata = {
  title: "Private social group",
  robots: { index: false, follow: false },
}

export default async function SocialGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  if (!groupId) notFound()
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()

  const [detail, current] = await Promise.all([
    queryClient.fetchQuery(
      orpc.social.groups.get.queryOptions({ input: { groupId } })
    ),
    queryClient.fetchQuery(
      orpc.social.groups.policy.current.queryOptions({ input: { groupId } })
    ),
    queryClient.fetchQuery(orpc.years.list.queryOptions()),
  ])

  const reads: Array<Promise<unknown>> = []
  if (detail.group.role === "owner" || detail.group.role === "moderator") {
    reads.push(
      queryClient.fetchQuery(
        orpc.social.groups.invitations.list.queryOptions({ input: { groupId } })
      )
    )
  }
  if (current.membershipState === "active") {
    for (const field of current.policy.fields) {
      reads.push(
        queryClient.fetchQuery(
          orpc.social.groups.stats.queryOptions({
            input: { groupId, metric: field.fieldKey },
          })
        )
      )
      if (field.exposure === "ranking" && current.policy.rankingsEnabled) {
        reads.push(
          queryClient.fetchQuery(
            orpc.social.groups.rankings.queryOptions({
              input: { groupId, metric: field.fieldKey },
            })
          )
        )
      }
    }
  }
  await Promise.all(reads)

  return (
    <HydrateClient queryClient={queryClient}>
      <GroupDetailClient groupId={groupId} />
    </HydrateClient>
  )
}
