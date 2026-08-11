"use client"

import { createAuthClient } from "better-auth/react"
import { adminClient, emailOTPClient } from "better-auth/client/plugins"
import { resetBrowserQueryCache } from "./browser-query-cache"
import { env } from "./env"

export const authClient = createAuthClient({
  baseURL: env.apiUrl,
  basePath: "/api/auth",
  plugins: [emailOTPClient(), adminClient()],
  fetchOptions: { credentials: "include" },
})

export const { useSession, signIn, signUp } = authClient

/** Sign out without leaving data from the previous identity in memory. */
export async function signOut() {
  try {
    return await authClient.signOut()
  } finally {
    resetBrowserQueryCache()
  }
}

export type User = typeof authClient.$Infer.Session.user
export type Session = typeof authClient.$Infer.Session.session
