import type { ReactNode } from "react"
import { AuthenticatedProviders } from "@/components/authenticated-providers"
import { prepareOnboarding } from "@/lib/authenticated-data"
import { HydrateClient } from "@/lib/query-server"

export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode
}) {
  const { queryClient, user } = await prepareOnboarding()

  return (
    <AuthenticatedProviders user={user}>
      <HydrateClient queryClient={queryClient}>{children}</HydrateClient>
    </AuthenticatedProviders>
  )
}
