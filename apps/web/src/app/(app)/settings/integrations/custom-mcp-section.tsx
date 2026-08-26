"use client"

import { useState, type FormEvent } from "react"
import type {
  CustomMcpAuthKind,
  CustomMcpDataCategory,
  CustomMcpSourceSummary,
} from "@avermate/agent-contracts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CableIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { SettingsSection } from "@/components/settings/settings-section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { orpc } from "@/lib/orpc"

const DATA_CATEGORIES = [
  "prompt",
  "academic-metadata",
  "retrieved-snippets",
  "attachment-metadata",
  "attachment-content",
] as const satisfies readonly CustomMcpDataCategory[]

type ToolDraft = {
  enabled: boolean
  allowedDataCategories: Set<CustomMcpDataCategory>
}

type ReviewDrafts = Record<string, Record<string, ToolDraft>>

function draftForTool(
  sourceId: string,
  tool: CustomMcpSourceSummary["tools"][number],
  drafts: ReviewDrafts
): ToolDraft {
  return (
    drafts[sourceId]?.[tool.remoteToolId] ?? {
      enabled: tool.enabled,
      allowedDataCategories: new Set(tool.allowedDataCategories),
    }
  )
}

function canEnableTool(tool: CustomMcpSourceSummary["tools"][number]): boolean {
  return tool.readOnlyHint && !tool.destructiveHint
}

export function CustomMcpSection() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const sources = useQuery(orpc.assistant.toolSources.list.queryOptions())
  const [name, setName] = useState("")
  const [endpointUrl, setEndpointUrl] = useState("")
  const [authKind, setAuthKind] = useState<CustomMcpAuthKind>("none")
  const [credential, setCredential] = useState("")
  const [drafts, setDrafts] = useState<ReviewDrafts>({})

  const refreshList = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.assistant.toolSources.list.queryKey(),
    })

  const create = useMutation({
    ...orpc.assistant.toolSources.create.mutationOptions(),
    onSuccess: async (source) => {
      setName("")
      setEndpointUrl("")
      setAuthKind("none")
      setCredential("")
      toast.success(
        t("Server connected. Review every tool before enabling it.")
      )
      setDrafts((current) => ({
        ...current,
        [source.id]: Object.fromEntries(
          source.tools.map((tool) => [
            tool.remoteToolId,
            {
              enabled: false,
              allowedDataCategories: new Set<CustomMcpDataCategory>(["prompt"]),
            },
          ])
        ),
      }))
      await refreshList()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const refresh = useMutation({
    ...orpc.assistant.toolSources.refresh.mutationOptions(),
    onSuccess: async (source) => {
      setDrafts((current) => {
        const next = { ...current }
        delete next[source.id]
        return next
      })
      toast.success(
        source.status === "review-required"
          ? t("Catalogue refreshed. Review is required.")
          : t("Catalogue refreshed.")
      )
      await refreshList()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const review = useMutation({
    ...orpc.assistant.toolSources.review.mutationOptions(),
    onSuccess: async (source) => {
      setDrafts((current) => {
        const next = { ...current }
        delete next[source.id]
        return next
      })
      toast.success(t("Tool permissions saved."))
      await refreshList()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const remove = useMutation({
    ...orpc.assistant.toolSources.remove.mutationOptions(),
    onSuccess: async (_result, variables) => {
      setDrafts((current) => {
        const next = { ...current }
        delete next[variables.sourceId]
        return next
      })
      toast.success(t("MCP server removed."))
      await refreshList()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const busy =
    create.isPending ||
    refresh.isPending ||
    review.isPending ||
    remove.isPending

  const categoryCopy: Record<CustomMcpDataCategory, string> = {
    prompt: t("Your request"),
    "academic-metadata": t("Academic names and metadata"),
    "retrieved-snippets": t("Retrieved course excerpts"),
    "attachment-metadata": t("Attachment names and metadata"),
    "attachment-content": t("Attachment contents"),
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    create.mutate({
      name: name.trim(),
      endpointUrl: endpointUrl.trim(),
      placement: "hosted-core",
      authKind,
      credential: authKind === "none" ? null : credential.trim(),
    })
  }

  function updateToolDraft(
    source: CustomMcpSourceSummary,
    remoteToolId: string,
    update: (draft: ToolDraft) => ToolDraft
  ) {
    const tool = source.tools.find(
      (candidate) => candidate.remoteToolId === remoteToolId
    )
    if (!tool) return
    setDrafts((current) => ({
      ...current,
      [source.id]: {
        ...current[source.id],
        [remoteToolId]: update(draftForTool(source.id, tool, current)),
      },
    }))
  }

  function saveReview(source: CustomMcpSourceSummary) {
    review.mutate({
      sourceId: source.id,
      expectedCatalogDigest: source.catalogDigest,
      tools: source.tools.map((tool) => {
        const draft = draftForTool(source.id, tool, drafts)
        const enabled = canEnableTool(tool) && draft.enabled
        const allowedDataCategories = enabled
          ? Array.from(draft.allowedDataCategories)
          : []
        return {
          remoteToolId: tool.remoteToolId,
          classification: enabled
            ? ("read-only" as const)
            : ("blocked" as const),
          enabled,
          allowedDataCategories:
            allowedDataCategories.length > 0
              ? allowedDataCategories
              : enabled
                ? (["prompt"] satisfies CustomMcpDataCategory[])
                : [],
        }
      }),
    })
  }

  return (
    <SettingsSection
      id="custom-mcp"
      icon={CableIcon}
      title={t("External MCP tools")}
      description={t(
        "Connect a read-only MCP server to the Avermate assistant. Its tools stay disabled until you review them."
      )}
    >
      <Alert>
        <ShieldAlertIcon />
        <AlertTitle>{t("This sends data outside Avermate")}</AlertTitle>
        <AlertDescription>
          {t(
            "Enable only servers you trust. For every tool, choose the exact kinds of data it may receive. Credentials are encrypted and are never shown again."
          )}
        </AlertDescription>
      </Alert>

      <form className="grid gap-4 rounded-xl border p-4" onSubmit={submit}>
        <div className="grid grid-cols-1 gap-4 @lg/main:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="custom-mcp-name">{t("Server name")}</Label>
            <Input
              id="custom-mcp-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("My study tools")}
              maxLength={120}
              disabled={busy}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="custom-mcp-url">{t("HTTPS MCP endpoint")}</Label>
            <Input
              id="custom-mcp-url"
              type="url"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              placeholder="https://tools.example.com/mcp"
              maxLength={2048}
              disabled={busy}
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 @lg/main:grid-cols-[minmax(12rem,0.55fr)_minmax(16rem,1fr)]">
          <div className="grid gap-1.5">
            <Label htmlFor="custom-mcp-auth">{t("Authentication")}</Label>
            <Select
              value={authKind}
              onValueChange={(value) => {
                if (value) setAuthKind(value as CustomMcpAuthKind)
              }}
              disabled={busy}
            >
              <SelectTrigger id="custom-mcp-auth" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("No credential")}</SelectItem>
                <SelectItem value="bearer">{t("Bearer token")}</SelectItem>
                <SelectItem value="api-key">{t("API key")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authKind !== "none" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="custom-mcp-credential">{t("Credential")}</Label>
              <Input
                id="custom-mcp-credential"
                type="password"
                autoComplete="new-password"
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
                placeholder={
                  authKind === "bearer"
                    ? t("Paste a token")
                    : t("Paste an API key")
                }
                maxLength={8192}
                disabled={busy}
                required
              />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            disabled={
              busy ||
              !name.trim() ||
              !endpointUrl.trim() ||
              (authKind !== "none" && !credential.trim())
            }
          >
            <CableIcon /> {t("Inspect server")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t(
              "Avermate first reads the catalogue; no tool is enabled automatically."
            )}
          </span>
        </div>
      </form>

      {sources.isPending ? (
        <p className="text-sm text-muted-foreground">
          {t("Loading MCP servers…")}
        </p>
      ) : sources.data?.length ? (
        <div className="grid gap-3">
          {sources.data.map((source) => (
            <article key={source.id} className="rounded-xl border">
              <div className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{source.name}</h3>
                    <Badge
                      variant={
                        source.status === "unavailable"
                          ? "destructive"
                          : source.status === "enabled"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {source.status === "enabled"
                        ? t("Enabled")
                        : source.status === "review-required"
                          ? t("Review required")
                          : source.status === "unavailable"
                            ? t("Unavailable")
                            : t("Disabled")}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {source.endpointUrl}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {source.credentialHint
                      ? t("Credential saved · ending in {hint}", {
                          hint: source.credentialHint,
                        })
                      : t("No credential saved")}
                  </p>
                  {source.lastError ? (
                    <p className="mt-2 text-xs text-destructive">
                      {source.lastError}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => refresh.mutate({ sourceId: source.id })}
                  >
                    <RefreshCwIcon /> {t("Refresh")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => remove.mutate({ sourceId: source.id })}
                  >
                    <Trash2Icon /> {t("Remove")}
                  </Button>
                </div>
              </div>

              <details
                className="group border-t"
                open={source.status === "review-required"}
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-accent/30">
                  <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
                  {t("Review {count} tools", {
                    count: String(source.tools.length),
                  })}
                </summary>
                <div className="grid gap-3 border-t p-4">
                  {source.tools.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("This server exposes no tools.")}
                    </p>
                  ) : (
                    source.tools.map((tool) => {
                      const eligible = canEnableTool(tool)
                      const draft = draftForTool(source.id, tool, drafts)
                      return (
                        <section
                          key={tool.remoteToolId}
                          className="grid gap-3 rounded-lg border p-3"
                        >
                          <label className="flex items-start gap-3">
                            <Checkbox
                              checked={eligible && draft.enabled}
                              disabled={!eligible || busy}
                              onCheckedChange={(checked) =>
                                updateToolDraft(
                                  source,
                                  tool.remoteToolId,
                                  (current) => ({
                                    ...current,
                                    enabled: checked === true,
                                    allowedDataCategories:
                                      current.allowedDataCategories.size > 0
                                        ? current.allowedDataCategories
                                        : new Set<CustomMcpDataCategory>([
                                            "prompt",
                                          ]),
                                  })
                                )
                              }
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                {tool.title}
                                {!eligible ? (
                                  <Badge variant="destructive">
                                    {t("Blocked: not declared read-only")}
                                  </Badge>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                                {tool.remoteToolId}
                              </span>
                              {tool.description ? (
                                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                                  {tool.description}
                                </span>
                              ) : null}
                            </span>
                          </label>

                          {eligible && draft.enabled ? (
                            <fieldset className="grid gap-2 border-t pt-3">
                              <legend className="text-xs font-medium">
                                {t("Data this tool may receive")}
                              </legend>
                              <div className="flex flex-wrap gap-x-4 gap-y-2">
                                {DATA_CATEGORIES.map((category) => (
                                  <label
                                    key={category}
                                    className="flex items-center gap-2 text-xs"
                                  >
                                    <Checkbox
                                      checked={draft.allowedDataCategories.has(
                                        category
                                      )}
                                      disabled={busy}
                                      onCheckedChange={(checked) =>
                                        updateToolDraft(
                                          source,
                                          tool.remoteToolId,
                                          (current) => {
                                            const next = new Set(
                                              current.allowedDataCategories
                                            )
                                            if (checked) next.add(category)
                                            else next.delete(category)
                                            return {
                                              ...current,
                                              allowedDataCategories: next,
                                            }
                                          }
                                        )
                                      }
                                    />
                                    {categoryCopy[category]}
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          ) : null}
                        </section>
                      )
                    })
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      disabled={busy || source.status === "unavailable"}
                      onClick={() => saveReview(source)}
                    >
                      {t("Save reviewed permissions")}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        "A changed catalogue disables every tool until you review it again."
                      )}
                    </span>
                  </div>
                </div>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("No external MCP server connected.")}
        </p>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(
          "Private-network MCP servers will be available through a paired Avermate Node. Hosted Avermate deliberately cannot reach your local network."
        )}
      </p>
    </SettingsSection>
  )
}
