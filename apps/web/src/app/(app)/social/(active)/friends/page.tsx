import type { Metadata } from "next"
import { FriendsClient } from "./friends-client"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export const metadata: Metadata = {
  title: "Friends",
  robots: { index: false, follow: false },
}

export default async function FriendsPage() {
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.fetchQuery(orpc.social.friends.list.queryOptions()),
    queryClient.fetchQuery(orpc.social.friends.requests.queryOptions()),
    queryClient.fetchQuery(orpc.social.friends.invitations.list.queryOptions()),
    queryClient.fetchQuery(orpc.social.circles.list.queryOptions()),
    queryClient.fetchQuery(orpc.social.blocks.list.queryOptions()),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <FriendsClient />
    </HydrateClient>
  )
}
