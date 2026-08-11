import type { Metadata } from "next"
import { NewGroupClient } from "./new-group-client"
import { getServerOrpc } from "@/lib/orpc/server"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

export const metadata: Metadata = {
  title: "Create a private group",
  robots: { index: false, follow: false },
}

export default async function NewSocialGroupPage() {
  const queryClient = createServerQueryClient()
  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.fetchQuery(orpc.social.groups.list.queryOptions()),
    queryClient.fetchQuery(orpc.years.list.queryOptions()),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <NewGroupClient />
    </HydrateClient>
  )
}
