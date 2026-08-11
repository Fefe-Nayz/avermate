import type { Metadata } from "next"
import { SocialSettingsClient } from "./social-settings-client"
import { requireServerViewer } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export const metadata: Metadata = {
  title: "Social & sharing",
  description: "Eligibility, consent and social sharing controls.",
}

export default async function SocialSettingsPage() {
  await requireServerViewer()
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()

  await Promise.all([
    queryClient.fetchQuery(orpc.social.eligibility.get.queryOptions()),
    queryClient.fetchQuery(orpc.social.profile.mine.queryOptions()),
    queryClient.fetchQuery(orpc.social.guardian.requests.queryOptions()),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <SocialSettingsClient />
    </HydrateClient>
  )
}
