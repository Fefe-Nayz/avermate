import "server-only"

import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { RouterClient } from "@orpc/server"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"
import { headers } from "next/headers"
import { cache } from "react"
import type { AppRouter } from "../../../../server/src/routers"
import { serverEnv } from "../server-env"

const FORWARDED_HEADERS = [
  "accept-language",
  "authorization",
  "cookie",
  "user-agent",
] as const

async function requestHeaders(): Promise<Headers> {
  const incoming = await headers()
  const forwarded = new Headers()

  for (const name of FORWARDED_HEADERS) {
    const value = incoming.get(name)
    if (value) forwarded.set(name, value)
  }

  return forwarded
}

function createPublicRpc(): RouterClient<AppRouter> {
  const link = new RPCLink({
    url: `${serverEnv.apiUrl}/rpc`,
    fetch(request, init) {
      return fetch(request, { ...init, cache: "no-store" })
    },
  })

  return createORPCClient(link)
}

// A transport contains no response data or user state. This headerless client
// is safe to reuse for genuinely public procedures and, unlike getServerRpc,
// can run inside Next's cross-request data cache.
const publicRpc = createPublicRpc()

export function getPublicServerRpc(): RouterClient<AppRouter> {
  return publicRpc
}

/** Request-memoized server transport with a deliberately narrow header set. */
export const getServerRpc = cache((): RouterClient<AppRouter> => {
  const link = new RPCLink({
    url: `${serverEnv.apiUrl}/rpc`,
    headers: requestHeaders,
    fetch(request, init) {
      return fetch(request, { ...init, cache: "no-store" })
    },
  })

  return createORPCClient(link)
})

/** Shared typed query-option factories for server prefetch and client hydrate. */
export const getServerOrpc = cache(() =>
  createTanstackQueryUtils(getServerRpc())
)
