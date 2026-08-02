"use client";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/react-query";
import type { AppRouter } from "../../../server/src/routers";
import { env } from "./env";

/** Thrown by the server when the session is gone or was never there. */
export function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "UNAUTHORIZED"
  );
}

export const SESSION_LOST_EVENT = "avermate:session-lost";

function announceSessionLost() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_LOST_EVENT));
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A year's data changes when the user changes it, not on its own. A
      // generous stale time is what makes navigation feel instant.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) =>
        !isUnauthorized(error) && failureCount < 2,
    },
    mutations: { retry: 0 },
  },
});

const link = new RPCLink({
  url: `${env.apiUrl}/rpc`,
  async fetch(request, init) {
    const response = await fetch(request, { ...init, credentials: "include" });
    if (response.status === 401) {
      void queryClient.cancelQueries();
      announceSessionLost();
    }
    return response;
  },
});

export const rpc: RouterClient<AppRouter> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(rpc);
