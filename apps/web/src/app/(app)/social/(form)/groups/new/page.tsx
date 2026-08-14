import type { Metadata } from "next"
import { ClassCreationForm } from "./class-creation-form"
import { getServerOrpc } from "@/lib/orpc/server"
import { getServerQueryClient, HydrateClient } from "@/lib/query-server"

export const metadata: Metadata = {
  title: "New class",
  robots: { index: false, follow: false },
}

export default async function NewClassPage() {
  const queryClient = getServerQueryClient()
  const orpc = getServerOrpc()
  await Promise.all([
    queryClient.prefetchQuery(orpc.presets.list.queryOptions()),
    queryClient.prefetchQuery(orpc.presets.periodTemplates.queryOptions()),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <ClassCreationForm />
    </HydrateClient>
  )
}
