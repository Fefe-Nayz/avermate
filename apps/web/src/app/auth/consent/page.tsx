import type { Metadata } from "next"
import { Suspense, use } from "react"
import { Spinner } from "@/components/ui/spinner"
import { requireServerViewer } from "@/lib/authenticated-data"
import {
  loadOAuthConsentClient,
  type OAuthPublicClient,
} from "@/lib/oauth-integrations"
import { ConsentClient } from "./consent-client"

export const metadata: Metadata = { title: "Authorize integration" }

type ConsentSearchParams = Record<string, string | string[] | undefined>

function serializeSearchParams(values: ConsentSearchParams): string {
  const params = new URLSearchParams()
  for (const [name, rawValue] of Object.entries(values)) {
    for (const value of Array.isArray(rawValue)
      ? rawValue
      : rawValue === undefined
        ? []
        : [rawValue]) {
      params.append(name, value)
    }
  }
  return params.toString()
}

function first(values: ConsentSearchParams, name: string): string | null {
  const value = values[name]
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

async function ConsentData({
  clientId,
  oauthQuery,
  requestedScopes,
}: {
  clientId: string | null
  oauthQuery: string
  requestedScopes: string[]
}) {
  // Authentication is enforced server-side before client metadata is loaded.
  // The proxy preserves this exact internal path if a session has expired.
  await requireServerViewer()

  let client: OAuthPublicClient | null = null
  if (clientId && oauthQuery.includes("sig=")) {
    try {
      client = await loadOAuthConsentClient(clientId, oauthQuery)
    } catch {
      // A deliberately generic state avoids leaking whether a client exists.
    }
  }

  return (
    <ConsentClient
      client={client}
      oauthQuery={oauthQuery}
      requestedScopes={requestedScopes}
    />
  )
}

export default function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<ConsentSearchParams>
}) {
  const values = use(searchParams)
  const oauthQuery = serializeSearchParams(values)
  const clientId = first(values, "client_id")
  const requestedScopes = (first(values, "scope") ?? "")
    .split(" ")
    .filter(Boolean)

  return (
    <Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      }
    >
      <ConsentData
        clientId={clientId}
        oauthQuery={oauthQuery}
        requestedScopes={requestedScopes}
      />
    </Suspense>
  )
}
