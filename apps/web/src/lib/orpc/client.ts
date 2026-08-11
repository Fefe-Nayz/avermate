"use client"

import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { RouterClient } from "@orpc/server"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"
import type { AppRouter } from "../../../../server/src/routers"
import { resetBrowserQueryCache } from "../browser-query-cache"
import { env } from "../env"

export { isUnauthorized } from "../query-client"

export const SESSION_LOST_EVENT = "avermate:session-lost"

function announceSessionLost() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(SESSION_LOST_EVENT))
}

const link = new RPCLink({
  url: `${env.apiUrl}/rpc`,
  async fetch(request, init) {
    const response = await fetch(request, { ...init, credentials: "include" })
    if (response.status === 401) {
      resetBrowserQueryCache()
      announceSessionLost()
    }
    return response
  },
})

export const rpc: RouterClient<AppRouter> = createORPCClient(link)
export const orpc = createTanstackQueryUtils(rpc)
