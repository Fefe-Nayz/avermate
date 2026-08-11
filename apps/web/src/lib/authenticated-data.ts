import "server-only"

import type { QueryClient } from "@tanstack/react-query"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"
import type { AuthenticatedUser } from "./authenticated-user"
import { getServerOrpc, getServerRpc } from "./orpc/server"
import { isUnauthorized } from "./query-client"
import { COMMON_QUERY_STALE_TIME } from "./query-policy"
import { getServerQueryClient } from "./query-server"
import { REQUEST_PATH_HEADER } from "./request-path"
import { ACTIVE_YEAR_COOKIE, resolveActiveYearId } from "./year-selection"

export interface AuthenticatedShellData {
  activeYearId: string
  queryClient: QueryClient
  renderedAt: number
  user: AuthenticatedUser
}

function safeReturnPath(value: string | null): string | null {
  return value?.startsWith("/") && !value.startsWith("//") ? value : null
}

async function signInPath(): Promise<string> {
  const requestPath = safeReturnPath((await headers()).get(REQUEST_PATH_HEADER))
  return requestPath
    ? `/auth/sign-in?next=${encodeURIComponent(requestPath)}`
    : "/auth/sign-in"
}

/** Authenticate through the same protected API contract used by every client. */
export const requireServerViewer = cache(
  async (): Promise<AuthenticatedUser> => {
    try {
      return await getServerRpc().profile.viewer()
    } catch (error) {
      if (isUnauthorized(error)) redirect(await signInPath())
      throw error
    }
  }
)

/**
 * Prepare the data every authenticated application route consumes.
 *
 * Independent work starts together. Snapshot follows the year list only when
 * a new browser has not yet supplied its semantic active-year cookie; after
 * that, its prefetch starts in the same parallel batch too.
 */
export const prepareAuthenticatedShell = cache(
  async (): Promise<AuthenticatedShellData> => {
    const renderedAt = Date.now()
    const queryClient = getServerQueryClient()
    const orpc = getServerOrpc()
    const cookieStore = await cookies()
    const preferredYearId = cookieStore.get(ACTIVE_YEAR_COOKIE)?.value ?? null

    const yearsOptions = orpc.years.list.queryOptions()
    const preferredSnapshotOptions = preferredYearId
      ? orpc.snapshot.get.queryOptions({
          input: { yearId: preferredYearId },
        })
      : null

    const [user, years] = await Promise.all([
      requireServerViewer(),
      queryClient.fetchQuery(yearsOptions),
      queryClient.prefetchQuery({
        ...orpc.preferences.get.queryOptions(),
        staleTime: COMMON_QUERY_STALE_TIME,
      }),
      queryClient.prefetchQuery({
        ...orpc.announcements.active.queryOptions(),
        staleTime: COMMON_QUERY_STALE_TIME,
      }),
      queryClient.prefetchQuery({
        ...orpc.admin.access.queryOptions(),
        staleTime: COMMON_QUERY_STALE_TIME,
        retry: false,
      }),
      queryClient.prefetchQuery({
        ...orpc.social.eligibility.get.queryOptions(),
        staleTime: COMMON_QUERY_STALE_TIME,
        retry: false,
      }),
      preferredSnapshotOptions
        ? queryClient.prefetchQuery(preferredSnapshotOptions)
        : Promise.resolve(),
    ])

    const activeYearId = resolveActiveYearId(years, preferredYearId)
    if (!activeYearId) redirect("/onboarding")

    // This is a cache hit when the valid cookie started the snapshot above.
    await queryClient.prefetchQuery(
      orpc.snapshot.get.queryOptions({ input: { yearId: activeYearId } })
    )

    return { activeYearId, queryClient, renderedAt, user }
  }
)

/** Onboarding needs identity, appearance, and its first two read models. */
export async function prepareOnboarding(): Promise<{
  queryClient: QueryClient
  user: AuthenticatedUser
}> {
  const queryClient = getServerQueryClient()
  const orpc = getServerOrpc()

  const [user] = await Promise.all([
    requireServerViewer(),
    queryClient.prefetchQuery({
      ...orpc.preferences.get.queryOptions(),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.prefetchQuery(orpc.years.list.queryOptions()),
    queryClient.prefetchQuery(orpc.presets.list.queryOptions()),
  ])

  return { queryClient, user }
}
