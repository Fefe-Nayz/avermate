import { expoClient, getCookie } from "@better-auth/expo/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { env } from "./env";

/**
 * The session, held in the keychain rather than a cookie jar.
 *
 * A native app has no cookies, so better-auth's Expo plugin stores the session
 * token in the secure store and hands it back as a header. Every request in
 * `lib/orpc.ts` attaches it the same way.
 */

const STORAGE_PREFIX = env.scheme;

/**
 * Must match `advanced.cookiePrefix` on the server.
 *
 * The Expo plugin only stores a `Set-Cookie` whose name starts with this — it
 * is how it tells our session apart from a third-party cookie it should leave
 * alone. Its default is `better-auth`, so leaving it unset against a server
 * that renames its cookies means every sign-in succeeds and every session is
 * dropped on the floor a moment later.
 */
const COOKIE_PREFIX = "avermate";

export const authClient = createAuthClient({
  baseURL: env.apiUrl,
  basePath: "/api/auth",
  plugins: [
    emailOTPClient(),
    // `@better-auth/expo` and `better-auth` ship separate copies of the
    // `@better-fetch/fetch` types, so the plugin's `getActions` signature is
    // nominally distinct from the one `BetterAuthClientPlugin` declares even
    // though it is structurally the same function. Suppressing it beats
    // casting: a cast here collapses the client's inferred session type.
    // @ts-expect-error upstream type-identity mismatch, not a real one
    expoClient({
      scheme: env.scheme,
      storagePrefix: STORAGE_PREFIX,
      cookiePrefix: COOKIE_PREFIX,
      storage: SecureStore,
    }),
  ],
});

/**
 * The session as a `Cookie` header value, or `null` when signed out.
 *
 * Synchronous on purpose: it is read while building every request, and an
 * async hop there would mean a promise per RPC call for a value that changes
 * twice a year.
 */
export function sessionCookie(): string | null {
  const stored = SecureStore.getItem(`${STORAGE_PREFIX}_cookie`);
  if (!stored) return null;
  const header = getCookie(stored);
  return header.length > 0 ? header : null;
}

export const { useSession, signIn, signOut, signUp } = authClient;
export type User = typeof authClient.$Infer.Session.user;
