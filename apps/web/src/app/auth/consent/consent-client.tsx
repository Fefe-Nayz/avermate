"use client"

import Link from "next/link"
import { useState } from "react"
import {
  BotIcon,
  CheckIcon,
  ExternalLinkIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { useMcpScopeCopy } from "@/app/(app)/settings/integrations/mcp-scope-copy"
import { MCP_SCOPE_OPTIONS } from "@/app/(app)/settings/integrations/mcp-scope-model"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import type { OAuthPublicClient } from "@/lib/oauth-integrations"

const KNOWN_SCOPES: readonly string[] = [
  "openid",
  "profile",
  "email",
  "offline_access",
  ...MCP_SCOPE_OPTIONS.map((option) => option.scope),
]

function clientWebsite(client: OAuthPublicClient): string | null {
  if (!client.client_uri) return null
  try {
    const url = new URL(client.client_uri)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

export function ConsentClient({
  client,
  oauthQuery,
  requestedScopes,
}: {
  client: OAuthPublicClient | null
  oauthQuery: string
  requestedScopes: string[]
}) {
  const t = useExtracted()
  const mcpScopeCopy = useMcpScopeCopy()
  const [busy, setBusy] = useState<"accept" | "deny" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scopeCopy: Record<string, { label: string; description: string }> = {
    openid: {
      label: t("Sign you in"),
      description: t("Confirm which Avermate account is connecting."),
    },
    profile: {
      label: t("Read your basic profile"),
      description: t("See your name and public profile details."),
    },
    email: {
      label: t("Read your email address"),
      description: t("Use the verified email attached to this account."),
    },
    offline_access: {
      label: t("Stay connected"),
      description: t("Refresh access without asking you to sign in each time."),
    },
    ...mcpScopeCopy,
  }
  const unknownScopeDescription = t(
    "An additional permission requested by this client."
  )

  if (!client) {
    return (
      <div className="flex flex-col gap-5 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <ShieldCheckIcon className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("This authorization request is not valid")}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t(
              "The request may have expired or been changed. Return to the assistant and start the connection again."
            )}
          </p>
        </div>
        <Button variant="outline" render={<Link href="/" />}>
          {t("Return to Avermate")}
        </Button>
      </div>
    )
  }

  const website = clientWebsite(client)
  const scopes = requestedScopes
    .filter((scope, index, values) => values.indexOf(scope) === index)
    .sort((left, right) => {
      const leftIndex = KNOWN_SCOPES.indexOf(left)
      const rightIndex = KNOWN_SCOPES.indexOf(right)
      return (
        (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex)
      )
    })

  async function decide(accept: boolean) {
    setBusy(accept ? "accept" : "deny")
    setError(null)
    try {
      const { data, error: failure } = await authClient.oauth2.consent({
        accept,
        oauth_query: oauthQuery,
      })
      if (failure) throw new Error(failure.message)

      // Better Auth's redirect plugin follows the server-validated registered
      // redirect URI. Never navigate to a URL read directly from this page.
      if (!data?.redirect || !data.url) {
        throw new Error(t("The authorization response was incomplete."))
      }
    } catch (reason) {
      setBusy(null)
      setError(
        reason instanceof Error
          ? reason.message
          : t("The authorization request could not be completed.")
      )
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <BotIcon className="size-6" />
        </div>
        <p className="mt-4 text-xs font-semibold tracking-[0.18em] text-primary uppercase">
          {t("Secure connection")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance">
          {t("Allow {client} to access Avermate?", {
            client: client.client_name || t("this assistant"),
          })}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("Only the permissions listed below will be granted.")}
        </p>
        {website ? (
          <a
            href={website}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {new URL(website).hostname}
            <ExternalLinkIcon className="size-3" />
          </a>
        ) : null}
      </div>

      <div
        role="list"
        className="grid gap-2"
        aria-label={t("Requested permissions")}
      >
        {scopes.map((scope) => {
          const copy = scopeCopy[scope] ?? {
            label: scope,
            description: unknownScopeDescription,
          }
          return (
            <div
              key={scope}
              role="listitem"
              className="flex items-start gap-3 rounded-xl border p-3"
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CheckIcon className="size-3.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{copy.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {copy.description}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      <p className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
        {t(
          "You can revoke this connection at any time from Settings → Integrations. Avermate never gives the assistant your password."
        )}
      </p>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          variant="outline"
          size="lg"
          disabled={busy !== null}
          onClick={() => void decide(false)}
        >
          {busy === "deny" ? <Spinner className="size-4" /> : null}
          {t("Deny")}
        </Button>
        <Button
          size="lg"
          disabled={busy !== null}
          onClick={() => void decide(true)}
        >
          {busy === "accept" ? <Spinner className="size-4" /> : null}
          {t("Allow access")}
        </Button>
      </div>
    </div>
  )
}
