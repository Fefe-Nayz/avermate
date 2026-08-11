"use client"

import { useMemo, useState, type FormEvent } from "react"
import {
  BotIcon,
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { SettingsSection } from "@/components/settings/settings-section"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"
import { env } from "@/lib/env"
import type {
  OAuthClientSummary,
  OAuthConsentSummary,
} from "@/lib/oauth-integrations"

const SCOPE_OPTIONS = [
  {
    scope: "avermate:read",
    required: true,
  },
  {
    scope: "avermate:write",
  },
  {
    scope: "avermate:delete",
  },
  {
    scope: "avermate:admin",
  },
] as const

function displayDate(value: string | number | undefined): string | null {
  if (value === undefined) return null
  const date = new Date(
    typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value
  )
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString()
}

async function copy(value: string, successMessage: string): Promise<void> {
  await navigator.clipboard.writeText(value)
  toast.success(successMessage)
}

export function IntegrationsPageMeta() {
  const t = useExtracted()
  return <PageMeta title={t("Integrations")} backHref="/more" />
}

export function IntegrationsClient({
  initial,
}: {
  initial: {
    clients: OAuthClientSummary[]
    consents: OAuthConsentSummary[]
  }
}) {
  const t = useExtracted()
  const [clients, setClients] = useState(initial.clients)
  const [consents, setConsents] = useState(initial.consents)
  const [name, setName] = useState("")
  const [redirectUri, setRedirectUri] = useState("")
  const [scopes, setScopes] = useState<Set<string>>(
    new Set(["avermate:read", "avermate:write"])
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [clientToRevoke, setClientToRevoke] = useState<string | null>(null)
  const scopeCopy = {
    "avermate:read": {
      label: t("Read"),
      description: t("Years, subjects, grades, averages, goals and analytics."),
    },
    "avermate:write": {
      label: t("Write"),
      description: t("Create and update academic data and preferences."),
    },
    "avermate:delete": {
      label: t("Delete"),
      description: t("Expose confirmed destructive tools."),
    },
    "avermate:admin": {
      label: t("Admin"),
      description: t(
        "Expose administration tools when this account is an admin."
      ),
    },
  } satisfies Record<
    (typeof SCOPE_OPTIONS)[number]["scope"],
    { label: string; description: string }
  >
  const mcpUrl = useMemo(() => `${env.apiUrl.replace(/\/$/, "")}/mcp`, [])
  const metadataUrl = useMemo(
    () =>
      `${env.apiUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource/mcp`,
    []
  )

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy("create")
    try {
      const { data, error } = await authClient.oauth2.createClient({
        client_name: name.trim(),
        redirect_uris: [redirectUri.trim()],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        type: "user-agent-based",
        scope: ["openid", "profile", "offline_access", ...scopes].join(" "),
      })
      if (error) throw new Error(error.message)
      if (!data?.client_id) {
        throw new Error(t("The OAuth client was not created."))
      }

      // Intentionally copy only public metadata. A `none` client has no
      // credential that could safely be shown or persisted in the browser.
      const created: OAuthClientSummary = {
        client_id: data.client_id,
        client_name: data.client_name ?? name.trim(),
        redirect_uris: data.redirect_uris ?? [redirectUri.trim()],
        scope: data.scope,
        token_endpoint_auth_method: "none",
        grant_types: data.grant_types,
        require_pkce: true,
        client_id_issued_at: data.client_id_issued_at,
      }
      setClients((current) =>
        [...current, created].sort((left, right) =>
          left.client_id.localeCompare(right.client_id)
        )
      )
      setName("")
      setRedirectUri("")
      toast.success(t("Integration client created."))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("The client could not be created.")
      )
    } finally {
      setBusy(null)
    }
  }

  async function revokeClient(clientId: string) {
    setBusy(`client:${clientId}`)
    try {
      const { error } = await authClient.oauth2.deleteClient({
        client_id: clientId,
      })
      if (error) throw new Error(error.message)
      setClients((current) =>
        current.filter((client) => client.client_id !== clientId)
      )
      setConsents((current) =>
        current.filter((consent) => consent.clientId !== clientId)
      )
      setClientToRevoke(null)
      toast.success(t("Client revoked."))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Revocation failed.")
      )
    } finally {
      setBusy(null)
    }
  }

  async function revokeConsent(consentId: string) {
    setBusy(`consent:${consentId}`)
    try {
      const { error } = await authClient.oauth2.deleteConsent({ id: consentId })
      if (error) throw new Error(error.message)
      setConsents((current) =>
        current.filter((consent) => consent.id !== consentId)
      )
      toast.success(t("Access grant revoked."))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Revocation failed.")
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden md:block">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Integrations")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Connect AI assistants without sharing your password.")}
        </p>
      </div>

      <SettingsSection
        title={t("Avermate MCP")}
        description={t(
          "Assistants authenticate with OAuth 2.1 and only receive the permissions you approve."
        )}
      >
        <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-2">
            <BotIcon className="size-4 text-primary" />
            <span className="font-medium">
              MCP 2026-07-28 · Streamable HTTP
            </span>
          </div>
          <button
            type="button"
            onClick={() => void copy(mcpUrl, t("Copied."))}
            className="flex min-w-0 items-center gap-2 rounded-md bg-background px-2.5 py-2 text-left font-mono"
          >
            <span className="min-w-0 flex-1 truncate">{mcpUrl}</span>
            <CopyIcon className="size-3.5 shrink-0" />
          </button>
          <button
            type="button"
            onClick={() => void copy(metadataUrl, t("Copied."))}
            className="flex min-w-0 items-center gap-2 rounded-md bg-background px-2.5 py-2 text-left font-mono text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate">{metadataUrl}</span>
            <CopyIcon className="size-3.5 shrink-0" />
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("Register a public client")}
        description={t(
          "Use this when an assistant cannot publish a Client ID Metadata Document yet."
        )}
      >
        <form className="flex flex-col gap-4" onSubmit={createClient}>
          <div className="grid gap-1.5">
            <Label htmlFor="oauth-client-name">{t("Client name")}</Label>
            <Input
              id="oauth-client-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Claude Desktop"
              maxLength={120}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="oauth-redirect-uri">{t("Redirect URI")}</Label>
            <Input
              id="oauth-redirect-uri"
              type="url"
              value={redirectUri}
              onChange={(event) => setRedirectUri(event.target.value)}
              placeholder="https://assistant.example/oauth/callback"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label>{t("Maximum permissions")}</Label>
            {SCOPE_OPTIONS.map((option) => {
              const copy = scopeCopy[option.scope]
              return (
                <label
                  key={option.scope}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  <Checkbox
                    checked={scopes.has(option.scope)}
                    disabled={"required" in option && option.required}
                    onCheckedChange={(checked) => {
                      setScopes((current) => {
                        const next = new Set(current)
                        if (checked) next.add(option.scope)
                        else next.delete(option.scope)
                        return next
                      })
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {copy.label}
                    </span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">
                      {copy.description}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <ShieldCheckIcon /> PKCE S256
            </Badge>
            <Badge variant="outline">
              <KeyRoundIcon /> client auth: none
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t("No client secret is created.")}
            </span>
          </div>

          <Button type="submit" disabled={busy !== null} className="self-start">
            <PlusIcon /> {t("Create client")}
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection
        title={t("Registered clients")}
        description={t(
          "Client IDs are public identifiers and can be copied safely."
        )}
      >
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("No integration client has been registered yet.")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {clients.map((client) => (
              <article key={client.client_id} className="rounded-lg border p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {client.client_name || t("Unnamed client")}
                    </p>
                    <button
                      type="button"
                      onClick={() => void copy(client.client_id, t("Copied."))}
                      className="mt-1 flex max-w-full items-center gap-1.5 font-mono text-xs text-muted-foreground"
                    >
                      <span className="truncate">{client.client_id}</span>
                      <CopyIcon className="size-3 shrink-0" />
                    </button>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="destructive"
                    aria-label={t("Revoke client")}
                    disabled={busy !== null}
                    onClick={() => setClientToRevoke(client.client_id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="outline">
                    <CheckIcon /> PKCE S256
                  </Badge>
                  <Badge variant="outline">none</Badge>
                  {displayDate(client.client_id_issued_at) ? (
                    <Badge variant="secondary">
                      {displayDate(client.client_id_issued_at)}
                    </Badge>
                  ) : null}
                </div>
                {client.redirect_uris?.map((uri) => (
                  <p
                    key={uri}
                    className="mt-2 truncate font-mono text-xs text-muted-foreground"
                  >
                    {uri}
                  </p>
                ))}
              </article>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title={t("Authorized connections")}
        description={t(
          "Revoking a grant blocks refresh and future authorization. Already issued JWTs expire shortly on their own."
        )}
      >
        {consents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("No assistant currently has an active grant.")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {consents.map((consent) => (
              <article
                key={consent.id}
                className="flex items-start gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs">
                    {consent.clientId}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {consent.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="destructive"
                  aria-label={t("Revoke access grant")}
                  disabled={busy !== null}
                  onClick={() => void revokeConsent(consent.id)}
                >
                  <Trash2Icon />
                </Button>
              </article>
            ))}
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "Better Auth does not expose a stable token-list API. Access tokens are therefore never serialized into this page."
          )}
        </p>
      </SettingsSection>

      <AlertDialog
        open={clientToRevoke !== null}
        onOpenChange={(open) => {
          if (!open && busy === null) setClientToRevoke(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Revoke this client?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Its saved grants and refresh access will be removed. Short-lived access tokens already issued expire on their own."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy !== null || clientToRevoke === null}
              onClick={() => {
                if (clientToRevoke) void revokeClient(clientToRevoke)
              }}
            >
              {t("Revoke client")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
