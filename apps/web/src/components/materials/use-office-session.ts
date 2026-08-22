"use client"

import { useQuery } from "@tanstack/react-query"
import { env } from "@/lib/env"
import type { OnlyOfficeSession } from "./onlyoffice-model"

/**
 * A signed editing session for one document.
 *
 * Everything that decides what the reader can do is minted on the server and
 * arrives here already settled: the URL the Document Server fetches the file
 * from (which is not the URL the browser can reach), whether editing is
 * permitted, where saved bytes are posted back to, and the JWT that says the
 * whole config came from us. The browser hands the result to the Document
 * Server verbatim, because a client that reshapes a signed payload is a client
 * that can disagree with what was signed.
 *
 * Not an oRPC procedure but a plain endpoint, for the same reason the
 * transcription stream is one: this is a capability that may not be configured
 * at all, and a deployment without a Document Server should answer "no" rather
 * than fail. Any non-200 means the same thing to this screen — no editor — and
 * the pane falls back to what it did before.
 */
export interface OfficeSessionResult {
  session: OnlyOfficeSession | null
  /** `false` when this deployment has no Document Server configured. */
  available: boolean
}

async function fetchOfficeSession(
  documentId: string,
  mode: "view" | "edit"
): Promise<OfficeSessionResult> {
  const url = new URL(
    `/api/materials/documents/${encodeURIComponent(documentId)}/office-session`,
    env.apiUrl
  )
  url.searchParams.set("mode", mode)

  const response = await fetch(url, { credentials: "include" })
  // 404 and 501 both mean "this deployment does not do that", which is not an
  // error worth showing anybody: the pane simply keeps its old behaviour.
  if (response.status === 404 || response.status === 501) {
    return { session: null, available: false }
  }
  if (!response.ok) {
    throw new Error(
      (await response.text().catch(() => "")) ||
        `office-session ${response.status}`
    )
  }
  return {
    session: (await response.json()) as OnlyOfficeSession,
    available: true,
  }
}

/**
 * Sessions are short-lived by design — the file URL inside them is signed and
 * expires — so this is not cached beyond the life of the pane that asked.
 */
export function useOfficeSession(
  documentId: string,
  mode: "view" | "edit",
  enabled: boolean
) {
  return useQuery({
    queryKey: ["office-session", documentId, mode],
    queryFn: () => fetchOfficeSession(documentId, mode),
    enabled,
    gcTime: 0,
    staleTime: 0,
    // A Document Server that is down stays down for more than three retries.
    retry: 1,
  })
}
