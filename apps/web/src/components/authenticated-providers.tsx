"use client"

import {
  HydrationBoundary,
  isServer,
  QueryClientProvider,
  type DehydratedState,
} from "@tanstack/react-query"
import { useEffect, useState, type ReactNode } from "react"
import { AuthenticatedUserProvider } from "@/components/authenticated-user"
import { AppearanceSync } from "@/components/theme/appearance-sync"
import { MokattamCelebration } from "@/components/theme/mokattam-celebration"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { AuthenticatedUser } from "@/lib/authenticated-user"
import {
  getBrowserQueryCacheGeneration,
  getBrowserQueryClient,
  QUERY_CACHE_RESET_EVENT,
} from "@/lib/browser-query-cache"
import { SESSION_LOST_EVENT } from "@/lib/orpc"
import { createQueryClient } from "@/lib/query-client"

function SessionWatcher() {
  useEffect(() => {
    const onLost = () => {
      // This provider only mounts for authenticated route trees, so every lost
      // session should return to sign-in with its intended destination intact.
      const target = `${window.location.pathname}${window.location.search}`
      window.location.replace(
        `/auth/sign-in?next=${encodeURIComponent(target)}`
      )
    }
    window.addEventListener(SESSION_LOST_EVENT, onLost)
    return () => window.removeEventListener(SESSION_LOST_EVENT, onLost)
  }, [])
  return null
}

/**
 * One cache per document in the browser, one throwaway cache per server
 * render. See `browser-query-cache` for why it cannot live in component state
 * — briefly: the server fills this cache during render, and component state is
 * not a safe place to keep something no component put there.
 */
function QueryCacheScope({
  children,
  identity,
}: {
  children: ReactNode
  identity: string
}) {
  const queryClient = isServer
    ? createQueryClient()
    : getBrowserQueryClient(identity)

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function SessionScopedQueryProvider({
  children,
  identity,
}: {
  children: ReactNode
  identity: string
}) {
  const [generation, setGeneration] = useState(getBrowserQueryCacheGeneration)

  useEffect(() => {
    const rotate = () => setGeneration(getBrowserQueryCacheGeneration())
    window.addEventListener(QUERY_CACHE_RESET_EVENT, rotate)
    // A very fast 401 can arrive before effects mount. Catch that generation
    // here so its just-created cache is still discarded.
    rotate()
    return () => window.removeEventListener(QUERY_CACHE_RESET_EVENT, rotate)
  }, [])

  // Identity participates in the key so React destroys everything derived from
  // the previous user before rendering any personalized descendants for the
  // next one. The cache itself is swapped by `getBrowserQueryClient`, which
  // does it while rendering rather than after; the key is about the component
  // state around it, which no cache reset can reach.
  return (
    <QueryCacheScope key={`${identity}:${generation}`} identity={identity}>
      {children}
    </QueryCacheScope>
  )
}

/**
 * Browser state and protected reads used only below authenticated layouts.
 *
 * `dehydratedState` is required, and the hydration sits at the very top of this
 * tree, because of the bug that shape prevents. The boundary used to be handed
 * in as part of `children`, which put it *below* `AppearanceSync` — a reader of
 * the same preferences. React renders siblings in order, so the reader ran
 * first, created the query itself, and by the time the boundary rendered the
 * server's answer was no longer new data for an unknown query but an update to
 * an existing one. `HydrationBoundary` applies those in an effect.
 *
 * The cost was one commit's worth of wrong screen on every page load, in the
 * server HTML too since no effect runs there: the sidebar's optional button
 * missing, the language showing "Match my device" instead of the stored
 * choice — every preference reading its default — plus a browser fetch for
 * data the response already carried. The year context never showed it because
 * it happened to be rendered inside the boundary.
 *
 * Nothing here may read a query above this line.
 */
export function AuthenticatedProviders({
  children,
  dehydratedState,
  user,
}: {
  children: ReactNode
  dehydratedState: DehydratedState
  user: AuthenticatedUser
}) {
  return (
    <SessionScopedQueryProvider identity={user.id}>
      <HydrationBoundary state={dehydratedState}>
        <AuthenticatedUserProvider user={user}>
          <TooltipProvider delay={200}>
            <AppearanceSync />
            <MokattamCelebration />
            <SessionWatcher />
            {children}
          </TooltipProvider>
        </AuthenticatedUserProvider>
      </HydrationBoundary>
    </SessionScopedQueryProvider>
  )
}
