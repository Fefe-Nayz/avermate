import "server-only"

import { headers } from "next/headers"
import { serverEnv } from "./server-env"

export interface OAuthClientSummary {
  client_id: string
  client_name?: string
  redirect_uris?: string[]
  scope?: string
  token_endpoint_auth_method?: string
  grant_types?: string[]
  require_pkce?: boolean
  disabled?: boolean
  client_id_issued_at?: number
}

export interface OAuthConsentSummary {
  id: string
  clientId: string
  scopes: string[]
  createdAt: string | number
  updatedAt: string | number
}

export interface OAuthPublicClient {
  client_id: string
  client_name?: string
  client_uri?: string
  logo_uri?: string
  policy_uri?: string
  tos_uri?: string
  redirect_uris?: string[]
  scope?: string
}

async function forwardedHeaders(): Promise<Headers> {
  const incoming = await headers()
  const result = new Headers({ accept: "application/json" })
  for (const name of ["cookie", "accept-language", "user-agent"]) {
    const value = incoming.get(name)
    if (value) result.set(name, value)
  }
  return result
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${serverEnv.apiUrl}/api/auth${path}`, {
    headers: await forwardedHeaders(),
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error(`OAuth integration API returned ${response.status}`)
  }
  return (await response.json()) as T
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const requestHeaders = await forwardedHeaders()
  requestHeaders.set("content-type", "application/json")
  const response = await fetch(`${serverEnv.apiUrl}/api/auth${path}`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error(`OAuth integration API returned ${response.status}`)
  }
  return (await response.json()) as T
}

/** Request-scoped SSR read; never exposes OAuth tokens or client secrets. */
export async function loadOAuthIntegrations(): Promise<{
  clients: OAuthClientSummary[]
  consents: OAuthConsentSummary[]
}> {
  const [clients, consents] = await Promise.all([
    getJson<OAuthClientSummary[]>("/oauth2/get-clients"),
    getJson<OAuthConsentSummary[]>("/oauth2/get-consents"),
  ])
  return {
    clients: [...clients].sort((left, right) =>
      left.client_id.localeCompare(right.client_id)
    ),
    consents: [...consents].sort((left, right) =>
      left.clientId.localeCompare(right.clientId)
    ),
  }
}

/**
 * Resolve consent-screen metadata only after Better Auth validates the signed
 * authorization query. This prevents a tampered client_id from being rendered
 * as if it were the client in the real OAuth transaction.
 */
export async function loadOAuthConsentClient(
  clientId: string,
  oauthQuery: string
): Promise<OAuthPublicClient> {
  return postJson<OAuthPublicClient>("/oauth2/public-client-prelogin", {
    client_id: clientId,
    oauth_query: oauthQuery,
  })
}
