"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import { useEffect, useState, type ReactNode } from "react"
import { AuthenticatedUserProvider } from "@/components/authenticated-user"
import { AppearanceSync } from "@/components/theme/appearance-sync"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { AuthenticatedUser } from "@/lib/authenticated-user"
import {
  getBrowserQueryCacheGeneration,
  QUERY_CACHE_RESET_EVENT,
  registerBrowserQueryClient,
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

function QueryCacheScope({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  useEffect(() => {
    const unregister = registerBrowserQueryClient(queryClient)
    return () => {
      unregister()
      queryClient.clear()
    }
  }, [queryClient])

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

  // Identity participates in the key so React destroys the previous user's
  // cache before rendering any personalized descendants for the next one.
  return (
    <QueryCacheScope key={`${identity}:${generation}`}>
      {children}
    </QueryCacheScope>
  )
}

/** Browser state and protected reads used only below authenticated layouts. */
export function AuthenticatedProviders({
  children,
  user,
}: {
  children: ReactNode
  user: AuthenticatedUser
}) {
  return (
    <SessionScopedQueryProvider identity={user.id}>
      <AuthenticatedUserProvider user={user}>
        <TooltipProvider delay={200}>
          <AppearanceSync />
          <SessionWatcher />
          {children}
        </TooltipProvider>
      </AuthenticatedUserProvider>
    </SessionScopedQueryProvider>
  )
}
