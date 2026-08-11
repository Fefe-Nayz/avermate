import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { Platform } from "react-native";
import { router } from "expo-router";
import type { AppRouter } from "../../server/src/routers";
import {
  expireLocalSession,
  refreshSessionForUnauthorized,
  sessionCookie,
} from "./auth-client";
import { env } from "./env";
import { clearLocalUserSettings } from "./local-settings";
import { queryClient, queryScope, setQueryIdentity } from "./query-client";
import { createUnauthorizedSessionHandler } from "./auth-unauthorized";

export { queryClient } from "./query-client";

const handleUnauthorized = createUnauthorizedSessionHandler({
  clearExpiredIdentity: clearLocalUserSettings,
  expireSession: expireLocalSession,
  getIdentity: () => queryScope().identity,
  redirectToSignIn: () => router.replace("/sign-in"),
  refreshSession: refreshSessionForUnauthorized,
  setAnonymousIdentity: () => {
    setQueryIdentity("anonymous");
  },
});

/**
 * `expo/fetch` rather than the global one: it is the implementation that
 * streams properly on both platforms and honours request cancellation.
 */
async function expoFetch(request: Request, init?: RequestInit) {
  const { fetch } = await import("expo/fetch");
  const response = (await fetch(request.url, {
    body: request.method === "GET" ? undefined : await request.blob(),
    headers: request.headers,
    method: request.method,
    signal: request.signal,
    ...init,
  })) as unknown as Response;
  if (response.status === 401) {
    await handleUnauthorized();
  }
  return response;
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
