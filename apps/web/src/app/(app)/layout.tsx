import type { ReactNode } from "react"
import { AuthenticatedProviders } from "@/components/authenticated-providers"
import { CommandPaletteProvider } from "@/components/command/command-palette"
import { FeedbackProvider } from "@/components/feedback/feedback-provider"
import { YearReviewTrigger } from "@/components/review/year-review-trigger"
import { AppShell } from "@/components/shell/app-shell"
import { PageChromeProvider } from "@/components/shell/page-chrome"
import { QuickAddProvider } from "@/components/shell/quick-add"
import { YearSheetProvider } from "@/components/shell/year-sheet"
import { YearGate } from "@/components/year/year-gate"
import { YearProvider } from "@/components/year/year-provider"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { HydrateClient } from "@/lib/query-server"
import { yearReviewWindowKey } from "@/lib/year-review-window"

/**
 * The authenticated route shell is a Server Component. It authenticates once,
 * prepares common read models in parallel, and hands only interactive chrome
 * to the browser with its query cache already populated.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { activeYearId, queryClient, renderedAt, user } =
    await prepareAuthenticatedShell()

  // Only the short seasonal recap window pays for this server-side aggregate.
  // The matching client trigger receives it through hydration and never opens
  // an API waterfall from the dashboard.
  const snapshot = await queryClient.fetchQuery(
    getServerOrpc().snapshot.get.queryOptions({
      input: { yearId: activeYearId },
    })
  )
  const reviewKey = yearReviewWindowKey(
    new Date(renderedAt),
    new Date(snapshot.year.startsAt),
    new Date(snapshot.year.endsAt)
  )
  if (reviewKey) {
    await queryClient.prefetchQuery(
      getServerOrpc().review.status.queryOptions({
        input: { yearId: activeYearId, reviewKey },
      })
    )
  }

  return (
    <AuthenticatedProviders user={user}>
      <HydrateClient queryClient={queryClient}>
        <YearProvider initialNow={renderedAt} initialYearId={activeYearId}>
          <PageChromeProvider>
            <CommandPaletteProvider>
              <FeedbackProvider>
                <QuickAddProvider>
                  <YearSheetProvider>
                    <AppShell>
                      <YearGate>{children}</YearGate>
                    </AppShell>
                    <YearReviewTrigger />
                  </YearSheetProvider>
                </QuickAddProvider>
              </FeedbackProvider>
            </CommandPaletteProvider>
          </PageChromeProvider>
        </YearProvider>
      </HydrateClient>
    </AuthenticatedProviders>
  )
}
