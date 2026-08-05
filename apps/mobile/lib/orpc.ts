import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";
import type { AppRouter } from "../../server/src/routers";
import { sessionCookie } from "./auth-client";
import { env } from "./env";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A year changes when the user changes it. A generous stale time is what
      // makes moving between tabs feel instant on a phone.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
    },
    mutations: { retry: 0 },
  },
});

/**
 * `expo/fetch` rather than the global one: it is the implementation that
 * streams properly on both platforms and honours request cancellation.
 */
async function expoFetch(request: Request, init?: RequestInit) {
  const { fetch } = await import("expo/fetch");
  return fetch(request.url, {
    body: request.method === "GET" ? undefined : await request.blob(),
    headers: request.headers,
    method: request.method,
    signal: request.signal,
    ...init,
  }) as unknown as Promise<Response>;
}

const link = new RPCLink({
  url: `${env.apiUrl}/rpc`,
  fetch: (request, init) =>
    expoFetch(request, {
      ...init,
      // On native the session travels as a header, not a cookie.
      credentials: Platform.OS === "web" ? "include" : "omit",
    }),
  headers() {
    if (Platform.OS === "web") return {};
    const cookie = sessionCookie();
    return cookie ? { Cookie: cookie } : {};
  },
});

export const client: RouterClient<AppRouter> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
