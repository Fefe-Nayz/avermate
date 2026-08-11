import type { Metadata } from "next"
import { NotificationsClient } from "./notifications-client"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"
import { INITIAL_SOCIAL_NOTIFICATIONS_INPUT } from "@/lib/social-query-inputs"

export const metadata: Metadata = {
  title: "Social updates",
  robots: { index: false, follow: false },
}

export default async function SocialNotificationsPage() {
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()
  await queryClient.fetchQuery(
    orpc.social.notifications.list.queryOptions({
      input: INITIAL_SOCIAL_NOTIFICATIONS_INPUT,
    })
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <NotificationsClient />
    </HydrateClient>
  )
}
