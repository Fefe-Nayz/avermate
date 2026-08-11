import type { ReactNode } from "react"
import { AuthenticatedProviders } from "@/components/authenticated-providers"
import { requireServerViewer } from "@/lib/authenticated-data"
import { createServerQueryClient, HydrateClient } from "@/lib/query-server"

/** Protected consent routes that must not require an academic year or app shell. */
export default async function SocialConsentLayout({
  children,
}: {
  children: ReactNode
}) {
  const queryClient = createServerQueryClient()
  const user = await requireServerViewer()

  return (
    <AuthenticatedProviders user={user}>
      <HydrateClient queryClient={queryClient}>
        <main className="min-h-svh bg-background px-4 py-8 sm:px-6">
          {children}
        </main>
      </HydrateClient>
    </AuthenticatedProviders>
  )
}
