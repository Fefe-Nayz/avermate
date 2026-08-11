import type { Metadata } from "next"
import { ProfileSharingClient } from "./profile-sharing-client"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export const metadata: Metadata = {
  title: "Social profile & sharing",
  description: "Control each social profile field and its exact audiences.",
  robots: { index: false, follow: false },
}

export default async function SocialProfilePage() {
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()

  await Promise.all([
    queryClient.fetchQuery(orpc.social.profile.mine.queryOptions()),
    queryClient.fetchQuery(orpc.social.grants.list.queryOptions()),
    queryClient.fetchQuery(orpc.social.friends.list.queryOptions()),
    queryClient.fetchQuery(orpc.social.circles.list.queryOptions()),
    queryClient.fetchQuery(
      orpc.social.profile.previewMineAs.queryOptions({
        input: { audience: "friends", audienceId: null },
      })
    ),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <ProfileSharingClient />
    </HydrateClient>
  )
}
