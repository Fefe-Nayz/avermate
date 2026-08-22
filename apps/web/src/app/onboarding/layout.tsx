import type { ReactNode } from "react"
import { AuthenticatedProviders } from "@/components/authenticated-providers"
import { prepareOnboarding } from "@/lib/authenticated-data"
import { dehydrate } from "@tanstack/react-query"

export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode
}) {
  const { queryClient, user } = await prepareOnboarding()

  return (
    <AuthenticatedProviders
      dehydratedState={dehydrate(queryClient)}
      user={user}
    >
      {children}
    </AuthenticatedProviders>
  )
}
