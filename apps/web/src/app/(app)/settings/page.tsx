import { ProfileSettingsClient } from "./profile-settings-client"
import { requireServerViewer } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export default async function ProfileSettingsPage() {
  await requireServerViewer()
  const queryClient = createServerQueryClient()

  await queryClient.fetchQuery(
    getServerOrpc().profile.uploadsEnabled.queryOptions()
  )

  return (
    <HydrateClient queryClient={queryClient}>
      <ProfileSettingsClient />
    </HydrateClient>
  )
}
