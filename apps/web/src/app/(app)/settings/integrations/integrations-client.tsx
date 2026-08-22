"use client"

import { useMemo, useState, type FormEvent } from "react"
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  KeyRoundIcon,
  PlugIcon,
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
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"
import type {
  OAuthClientSummary,
  OAuthConsentSummary,
} from "@/lib/oauth-integrations"
import { useMcpScopeCopy } from "./mcp-scope-copy"
import { MCP_SCOPE_GROUPS, type McpScopeGroup } from "./mcp-scope-model"
import { MoodleSyncSection } from "./moodle-sync-section"
import { DriveSyncSection, type DriveProvider } from "./drive-sync-section"
import { SchoolServicesSection } from "./school-services-section"
import { ServiceKeysSection } from "./service-keys-section"
import { CustomMcpSection } from "./custom-mcp-section"

/**
 * The personal drives this build knows about.
 *
 * Google Drive joins the day the server widens `content_connections.provider`
 * and implements the provider — the interface is already the same, because the
 * two really are the same shape: OAuth, folders you point at, a delta cursor
 * and a webhook.
 */
const DRIVE_PROVIDERS: DriveProvider[] = [
  { id: "onedrive", name: "OneDrive", rootLabel: "OneDrive" },
  { id: "googledrive", name: "Google Drive", rootLabel: "My Drive" },
]

function displayDate(value: string | number | undefined): string | null {
  if (value === undefined) return null
  const date = new Date(
    typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value
  )
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString()
}

async function copy(value: string, successMessage: string): Promise<void> {
  if (await copyText(value)) toast.success(successMessage)
}

/**
 * A value whose only purpose is to be copied.
 *
 * The address is the whole product of this page — it is what someone pastes
 * into their assistant — and it used to be a grey monospace line with a small
 * icon, indistinguishable from the caption underneath it. Something meant to
 * be copied should look pressable.
 */
function CopyField({
  value,
  label,
  muted = false,
}: {
  value: string
  label: string
  muted?: boolean
}) {
  const t = useExtracted()
  const [copied, setCopied] = useState(false)

  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <button
        type="button"
        onClick={() => {
          void copy(value, t("Copied."))
          setCopied(true)
        }}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          muted && "text-muted-foreground"
        )}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {value}
        </span>
        {copied ? (
          <CheckIcon className="size-4 shrink-0 text-positive" />
        ) : (
          <CopyIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="sr-only">{t("Copy")}</span>
      </button>
    </div>
  )
}

export function IntegrationsPageMeta() {
  const t = useExtracted()
  return <PageMeta title={t("Integrations")} backHref="/more" />
}

/**
 * Integrations.
 *
 * The page had been written for someone implementing OAuth rather than for
 * someone connecting an assistant: it led with a protocol version, labelled
 * things `client auth: none`, showed granted permissions as raw scope strings
 * and identified a connected assistant by an opaque client id — so the one
 * question a reader actually has, *what does this thing have access to and how
 * do I stop it*, was the hardest to answer. Names, plain permissions and the
 * address to paste come first; the registration form is folded away because
 * most assistants never need it.
 */
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
  const [registerOpen, setRegisterOpen] = useState(initial.clients.length === 0)

  const scopeCopy = useMcpScopeCopy()

  const scopeGroupCopy = {
    academic: t("Account and academics"),
    social: t("Social"),
    planner: t("Planning"),
    materials: t("Course materials"),
    documents: t("Study documents"),
  } satisfies Record<McpScopeGroup, string>

  /** `avermate:write` means nothing to a reader; "Write" does. */
  function scopeLabel(scope: string) {
    if (scope in scopeCopy) {
      return scopeCopy[scope as keyof typeof scopeCopy].label
    }
    if (scope === "openid" || scope === "profile") return t("Identity")
    if (scope === "offline_access") return t("Stay signed in")
    return scope
  }

  const mcpUrl = useMemo(() => `${env.apiUrl.replace(/\/$/, "")}/mcp`, [])
  const metadataUrl = useMemo(
    () =>
      `${env.apiUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource/mcp`,
    []
  )

  /** A grant is about an assistant, so show the assistant, not its id. */
  const clientNames = useMemo(
    () =>
      new Map(
        clients.map((client) => [client.client_id, client.client_name ?? ""])
      ),
    [clients]
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
        application_type: "native",
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
      setRegisterOpen(false)
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
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
          <PlugIcon className="size-5 text-muted-foreground" />
          {t("Integrations")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Let an AI assistant read or update your Avermate data, without ever giving it your password."
          )}
        </p>
      </div>

      <SettingsSection
        id="mcp"
        icon={BotIcon}
        title={t("Connect an assistant")}
        description={t(
          "Paste this address into an assistant that speaks MCP. It will ask you to sign in, then to approve exactly what it may do."
        )}
      >
        <CopyField value={mcpUrl} label={t("Avermate MCP server")} />
        <details className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
            {t("My assistant asks for a discovery URL")}
          </summary>
          <div className="mt-2">
            <CopyField
              muted
              value={metadataUrl}
              label={t("Protected-resource metadata")}
            />
          </div>
        </details>
      </SettingsSection>

      <MoodleSyncSection />

      {DRIVE_PROVIDERS.map((provider) => (
        <DriveSyncSection key={provider.id} provider={provider} />
      ))}

      <SchoolServicesSection />

      <ServiceKeysSection />

      <CustomMcpSection />

      <SettingsSection
        id="oauth-clients"
        icon={ShieldCheckIcon}
        title={t("What has access")}
        description={t(
          "Revoking blocks any further use straight away. A token already handed out stops working within minutes."
        )}
      >
        {consents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("Nothing has access to your account right now.")}
          </p>
        ) : (
          <div className="divide-y">
            {consents.map((consent) => {
              const label =
                clientNames.get(consent.clientId) || t("Unnamed assistant")
              return (
                <div
                  key={consent.id}
                  className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BotIcon className="size-4.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{label}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {consent.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">
                          {scopeLabel(scope)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy !== null}
                    onClick={() => void revokeConsent(consent.id)}
                  >
                    {t("Revoke access")}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        id="registered-clients"
        icon={KeyRoundIcon}
        title={t("Registered clients")}
        description={t(
          "Only needed for assistants that cannot register themselves. A client ID is a public identifier — there is no secret to protect."
        )}
        footer={
          registerOpen ? undefined : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRegisterOpen(true)}
            >
              <PlusIcon /> {t("Register a client")}
            </Button>
          )
        }
      >
        {clients.length === 0 && !registerOpen ? (
          <p className="text-sm text-muted-foreground">
            {t("No client registered. Most assistants do not need one.")}
          </p>
        ) : null}

        {clients.length ? (
          <div className="divide-y">
            {clients.map((client) => (
              <article
                key={client.client_id}
                className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {client.client_name || t("Unnamed client")}
                  </p>
                  <button
                    type="button"
                    onClick={() => void copy(client.client_id, t("Copied."))}
                    className="mt-0.5 flex max-w-full items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
                  >
                    <span className="truncate">{client.client_id}</span>
                    <CopyIcon className="size-3 shrink-0" />
                  </button>
                  {client.redirect_uris?.map((uri) => (
                    <p
                      key={uri}
                      className="mt-1 truncate text-xs text-muted-foreground"
                    >
                      {t("Returns to")} {uri}
                    </p>
                  ))}
                  {displayDate(client.client_id_issued_at) ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("Registered {date}", {
                        date: displayDate(client.client_id_issued_at) ?? "",
                      })}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={busy !== null}
                  onClick={() => setClientToRevoke(client.client_id)}
                >
                  <Trash2Icon /> {t("Remove")}
                </Button>
              </article>
            ))}
          </div>
        ) : null}

        {registerOpen ? (
          <form
            className="flex flex-col gap-4 rounded-xl border p-4"
            onSubmit={createClient}
          >
            <div className="grid gap-4 @lg/main:grid-cols-2">
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
            </div>

            <div className="grid gap-2">
              <Label>{t("The most this client may ever ask for")}</Label>
              <div className="grid gap-3 @2xl/main:grid-cols-2">
                {MCP_SCOPE_GROUPS.map((group) => (
                  <section
                    key={group.id}
                    aria-labelledby={`oauth-scope-group-${group.id}`}
                    className="overflow-hidden rounded-lg border"
                  >
                    <h3
                      id={`oauth-scope-group-${group.id}`}
                      className="bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground"
                    >
                      {scopeGroupCopy[group.id]}
                    </h3>
                    <div className="divide-y">
                      {group.scopes.map((option) => {
                        const info = scopeCopy[option.scope]
                        return (
                          <label
                            key={option.scope}
                            className={cn(
                              "flex items-start gap-3 p-3 transition-colors",
                              option.required
                                ? "cursor-default"
                                : "cursor-pointer hover:bg-accent/40"
                            )}
                          >
                            <Checkbox
                              checked={scopes.has(option.scope)}
                              disabled={option.required}
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
                              <span className="flex items-center gap-2 text-sm font-medium">
                                {info.label}
                                {option.required ? (
                                  <Badge variant="outline">{t("Always")}</Badge>
                                ) : null}
                              </span>
                              <span className="block text-xs leading-relaxed text-muted-foreground">
                                {info.description}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t(
                  "This is a ceiling, not a grant. You still approve each connection, and can approve less than this."
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy !== null}>
                <PlusIcon /> {t("Create client")}
              </Button>
              {clients.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setRegisterOpen(false)}
                >
                  {t("Cancel")}
                </Button>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {t("No password or secret is created.")}
              </span>
            </div>
          </form>
        ) : null}
      </SettingsSection>

      <AlertDialog
        open={clientToRevoke !== null}
        onOpenChange={(open) => {
          if (!open && busy === null) setClientToRevoke(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove this client?")}</AlertDialogTitle>
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
              {t("Remove client")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
