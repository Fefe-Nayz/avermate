"use client"

import { useState } from "react"
import type {
  CapabilityKind,
  CapabilityOffering,
  CapabilityPolicy,
} from "@avermate/agent-contracts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ActivityIcon,
  AlertTriangleIcon,
  BoxesIcon,
  CheckCircle2Icon,
  CircleDollarSignIcon,
  CloudCogIcon,
  EyeIcon,
  GaugeIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  RouteIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UnplugIcon,
  XCircleIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
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
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useProcessingLabels } from "./processing-labels"
import { orpc, rpc } from "@/lib/orpc"
import {
  CAPABILITY_KINDS,
  CAPABILITY_PURPOSES,
  capabilityStatusTone,
} from "./capability-settings-model"
import { ConnectionWizard } from "./connection-wizard"
import { ConnectionEditor } from "./connection-editor"
import { CapabilityPolicyEditor } from "./policy-editor"

type ConnectionsData = Awaited<
  ReturnType<typeof rpc.capabilities.connections.list>
>
type ConnectionRecord = ConnectionsData["connections"][number]
type OfferingsData = Awaited<ReturnType<typeof rpc.capabilities.offerings.list>>
type OperationsData = Awaited<
  ReturnType<typeof rpc.capabilities.operations.list>
>
type OperationRecord = OperationsData["operations"][number]

function statusVariant(status: string) {
  const tone = capabilityStatusTone(status)
  if (tone === "negative") return "destructive" as const
  if (tone === "positive") return "secondary" as const
  return "outline" as const
}

function shortDigest(value: string | null | undefined) {
  if (!value) return "—"
  return value.length > 22 ? `${value.slice(0, 14)}…${value.slice(-6)}` : value
}

function capabilityTitle(kind: CapabilityKind) {
  switch (kind) {
    case "language.generate":
      return "Language generation"
    case "embedding.generate":
      return "Embeddings"
    case "rerank.score":
      return "Reranking"
    case "speech.transcribe":
      return "Speech transcription"
    case "speech.synthesize":
      return "Speech synthesis"
    case "document.ocr":
      return "Document OCR"
    case "document.extract":
      return "Document extraction"
    case "image.generate":
      return "Image generation"
    case "video.generate":
      return "Video generation"
  }
}

function connectionSnapshot(record: ConnectionRecord) {
  return record.connection
}

export function CapabilitySettingsClient() {
  const t = useExtracted()
  const processingLabel = useProcessingLabels()
  const catalogue = useQuery(orpc.capabilities.catalogue.queryOptions())
  const readiness = useQuery(orpc.capabilities.readiness.queryOptions())
  const connections = useQuery(
    orpc.capabilities.connections.list.queryOptions()
  )
  const offerings = useQuery(orpc.capabilities.offerings.list.queryOptions())
  const policies = useQuery(orpc.capabilities.policies.list.queryOptions())
  const consents = useQuery(orpc.capabilities.consents.list.queryOptions())
  const operations = useQuery(
    orpc.capabilities.operations.list.queryOptions({ input: { limit: 50 } })
  )
  const usage = useQuery(orpc.capabilities.usage.summary.queryOptions())
  const mismatches = useQuery(
    orpc.capabilities.diagnostics.shadowMismatches.queryOptions({
      input: { limit: 50 },
    })
  )

  const queries = [
    catalogue,
    readiness,
    connections,
    offerings,
    policies,
    consents,
    operations,
    usage,
    mismatches,
  ]
  const loading = queries.some((query) => query.isLoading)
  const error = queries.some((query) => query.isError)
  const refresh = () => Promise.all(queries.map((query) => query.refetch()))

  const readyConnections =
    connections.data?.connections.filter(
      (record) => connectionSnapshot(record).status === "ready"
    ).length ?? 0
  const readyCapabilities =
    readiness.data?.capabilities.filter((item) => item.readyOfferings > 0)
      .length ?? 0

  return (
    <>
      <PageMeta title={t("AI & processing")} backHref="/more" />
      <div className="flex flex-col gap-4">
        <div className="hidden md:flex md:items-start md:justify-between md:gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("AI & processing")}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t(
                "Choose where each capability runs, which credential pays for it and whether a fallback may cross a privacy boundary."
              )}
            </p>
          </div>
          {catalogue.data && offerings.data ? (
            <ConnectionWizard
              plugins={catalogue.data.plugins}
              offerings={offerings.data.offerings}
            />
          ) : null}
        </div>

        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>
            {t("One policy plane, multiple execution boundaries")}
          </AlertTitle>
          <AlertDescription>
            {t(
              "Avermate Core authorizes the operation. Processing may remain on your Node, use your own key, use an explicitly enabled managed pool or run inside a complete self-host."
            )}
          </AlertDescription>
        </Alert>

        {loading ? <SettingsSkeleton /> : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>
              {t("Some capability settings are unavailable")}
            </AlertTitle>
            <AlertDescription>
              {t(
                "No route is changed while this page is incomplete. Try loading the read models again."
              )}
            </AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
              >
                <RefreshCwIcon data-icon="inline-start" />
                {t("Try again")}
              </Button>
            </AlertAction>
          </Alert>
        ) : null}

        {!loading ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SummaryCard
                title={t("Ready connections")}
                value={readyConnections}
                description={t("Validated and eligible for discovery")}
                icon={KeyRoundIcon}
              />
              <SummaryCard
                title={t("Healthy capabilities")}
                value={`${readyCapabilities}/${CAPABILITY_KINDS.length}`}
                description={t("At least one healthy offering")}
                icon={GaugeIcon}
              />
              <SummaryCard
                title={t("Routing policies")}
                value={policies.data?.policies.length ?? 0}
                description={t("Purpose-scoped, revision-fenced")}
                icon={RouteIcon}
              />
            </div>

            <nav
              aria-label={t("AI and processing sections")}
              className="flex max-w-full gap-1 overflow-x-auto rounded-xl border bg-card p-1"
            >
              {[
                ["connections", "Connections"],
                ["capabilities", "Capabilities"],
                ["policies", "Policies"],
                ["usage", "Usage"],
                ["privacy", "Privacy"],
                ["diagnostics", "Diagnostics"],
              ].map(([id, label]) => (
                <Button
                  key={id}
                  variant="ghost"
                  size="sm"
                  render={<a href={`#${id}`} />}
                >
                  {processingLabel(label ?? "")}
                </Button>
              ))}
            </nav>

            <ConnectionsSection
              data={connections.data}
              plugins={catalogue.data?.plugins ?? []}
              offerings={offerings.data?.offerings ?? []}
            />
            <CapabilitiesSection
              readiness={readiness.data?.capabilities ?? []}
              data={offerings.data}
            />
            <PoliciesSection
              policies={policies.data?.policies ?? []}
              offerings={offerings.data?.offerings ?? []}
            />
            <UsageSection data={usage.data} />
            <PrivacySection data={consents.data} />
            <DiagnosticsSection
              operations={operations.data}
              mismatches={mismatches.data}
            />
          </>
        ) : null}
      </div>
    </>
  )
}

function SettingsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy="true">
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-64 rounded-xl sm:col-span-3" />
    </div>
  )
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string
  value: string | number
  description: string
  icon: typeof GaugeIcon
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function ConnectionsSection({
  data,
  plugins,
  offerings,
}: {
  data: ConnectionsData | undefined
  plugins: Awaited<ReturnType<typeof rpc.capabilities.catalogue>>["plugins"]
  offerings: CapabilityOffering[]
}) {
  const t = useExtracted()
  return (
    <SettingsSection
      id="connections"
      icon={CloudCogIcon}
      title={t("Provider connections")}
      description={t(
        "A connection owns public configuration and versioned credential slots. Secret values are never readable from this page."
      )}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {t(
              "Updating a connection creates a new revision; past routes stay reproducible."
            )}
          </p>
          <ConnectionWizard plugins={plugins} offerings={offerings} />
        </div>
      }
    >
      {data && data.connections.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {data.connections.map((record) => (
            <ConnectionCard
              key={record.connection.id}
              record={record}
              plugin={
                plugins.find(
                  (candidate) => candidate.id === record.connection.pluginId
                ) ?? null
              }
            />
          ))}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>{t("No provider connection")}</EmptyTitle>
            <EmptyDescription>
              {t("Add a personal API key or connect a paired Node.")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {data && data.legacyConnections.length > 0 ? (
        <Alert>
          <UnplugIcon />
          <AlertTitle>
            {t("{count} legacy service-key connection(s)", {
              count: String(data.legacyConnections.length),
            })}
          </AlertTitle>
          <AlertDescription>
            {t(
              "They remain available through the compatibility bridge. Migrate them here before legacy cleanup."
            )}
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              render={<a href="/settings/integrations#ai-keys" />}
            >
              {t("Review old keys")}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
    </SettingsSection>
  )
}

function ConnectionCard({
  record,
  plugin,
}: {
  record: ConnectionRecord
  plugin:
    | Awaited<ReturnType<typeof rpc.capabilities.catalogue>>["plugins"][number]
    | null
}) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const connection = record.connection
  const [deleteOpen, setDeleteOpen] = useState(false)

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.capabilities.connections.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.capabilities.offerings.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.capabilities.readiness.key(),
      }),
    ])
  }
  const validate = useMutation({
    ...orpc.capabilities.connections.validate.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Connection validated."))
      await invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const discover = useMutation({
    ...orpc.capabilities.connections.discover.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Offerings refreshed."))
      await invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const disable = useMutation({
    ...orpc.capabilities.connections.disable.mutationOptions(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })
  const remove = useMutation({
    ...orpc.capabilities.connections.delete.mutationOptions(),
    onSuccess: async () => {
      setDeleteOpen(false)
      toast.success(t("Connection deleted."))
      await invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const busy =
    validate.isPending ||
    discover.isPending ||
    disable.isPending ||
    remove.isPending

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{connection.displayName}</CardTitle>
        <CardDescription>
          {connection.pluginId} · {connection.placement.kind}
        </CardDescription>
        <CardAction className="flex items-center gap-1">
          <Badge variant={statusVariant(connection.status)}>
            {connection.status}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <MoreHorizontalIcon />
              <span className="sr-only">{t("Connection actions")}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={busy}
                onClick={() =>
                  validate.mutate({
                    connectionId: connection.id,
                    expectedRevision: connection.revision,
                  })
                }
              >
                <SearchCheckIcon />
                {t("Validate")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy || connection.status !== "ready"}
                onClick={() =>
                  discover.mutate({
                    connectionId: connection.id,
                    expectedRevision: connection.revision,
                  })
                }
              >
                <RefreshCwIcon />
                {t("Discover offerings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy || connection.status === "disabled"}
                onClick={() =>
                  disable.mutate({
                    connectionId: connection.id,
                    expectedRevision: connection.revision,
                    reason: "Disabled by account owner",
                  })
                }
              >
                <UnplugIcon />
                {t("Disable")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon />
                {t("Delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t("Revision")}</p>
            <p className="mt-0.5 font-medium tabular-nums">
              {connection.revision}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              {t("Last validation")}
            </p>
            <p className="mt-0.5 font-medium">
              {connection.lastValidatedAt
                ? format.dateTime(new Date(connection.lastValidatedAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : t("Never")}
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("Credentials")}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {record.credentialSlots.length > 0 ? (
              record.credentialSlots.map((slot) => (
                <Badge key={slot.slot} variant={statusVariant(slot.status)}>
                  {slot.slot} · {slot.status}
                  {slot.hint ? ` · ${slot.hint}` : ""}
                </Badge>
              ))
            ) : (
              <Badge variant="outline">{t("No Core-held secret")}</Badge>
            )}
          </div>
        </div>
      </CardContent>
      {busy || plugin ? (
        <CardFooter className="justify-between">
          {plugin ? (
            <ConnectionEditor connection={connection} plugin={plugin} />
          ) : (
            <span />
          )}
          {busy ? (
            <span className="flex items-center gap-2">
              <Spinner data-icon="inline-start" />
              <span className="text-xs text-muted-foreground">
                {t("Updating connection…")}
              </span>
            </span>
          ) : null}
        </CardFooter>
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this connection?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Deletion is refused while an active policy snapshot still references it. Past operation metadata stays auditable."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate({
                  connectionId: connection.id,
                  expectedRevision: connection.revision,
                })
              }
            >
              {t("Delete connection")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function CapabilitiesSection({
  readiness,
  data,
}: {
  readiness: Array<{
    capability: CapabilityKind
    executionMode: "legacy" | "shadow" | "registry"
    configuredOfferings: number
    readyOfferings: number
    unhealthyOfferings: number
  }>
  data: OfferingsData | undefined
}) {
  const t = useExtracted()
  const processingLabel = useProcessingLabels()
  const healthByOffering = new Map(
    (data?.health ?? []).map((health) => [health.offeringId, health])
  )
  return (
    <SettingsSection
      id="capabilities"
      icon={BoxesIcon}
      title={t("Available capabilities")}
      description={t(
        "Offerings are immutable snapshots of a provider model, placement, limits and data-handling contract."
      )}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {CAPABILITY_KINDS.map((kind) => {
          const state = readiness.find((item) => item.capability === kind)
          const candidates =
            data?.offerings.filter(
              (offering) => offering.capability === kind
            ) ?? []
          return (
            <Card key={kind} size="sm">
              <CardHeader>
                <CardTitle>{processingLabel(capabilityTitle(kind))}</CardTitle>
                <CardDescription>
                  {kind} ·{" "}
                  {state?.executionMode === "registry"
                    ? t("Registry active")
                    : state?.executionMode === "shadow"
                      ? t("Shadow comparison")
                      : t("Legacy execution")}
                </CardDescription>
                <CardAction>
                  <Badge
                    variant={state?.readyOfferings ? "secondary" : "outline"}
                  >
                    {state?.readyOfferings
                      ? t("{count} healthy", {
                          count: String(state.readyOfferings),
                        })
                      : t("Unavailable")}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  {state?.executionMode === "registry"
                    ? t(
                        "Consent and routing policy are checked again before each execution."
                      )
                    : t(
                        "Saved registry policies do not replace legacy execution until the operator activates this capability."
                      )}
                </p>
                {candidates.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {candidates.slice(0, 5).map((offering) => {
                      const health = healthByOffering.get(offering.id)
                      return (
                        <div
                          key={offering.id}
                          className="flex items-start justify-between gap-3 rounded-lg border p-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {offering.modelId}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {offering.provider} · {offering.placement.kind} ·{" "}
                              {offering.dataHandling.egress}
                            </p>
                          </div>
                          <Badge
                            variant={statusVariant(health?.state ?? "unknown")}
                          >
                            {health?.state ?? t("Unknown")}
                          </Badge>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("No discovered offering for this capability.")}
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </SettingsSection>
  )
}

function PoliciesSection({
  policies,
  offerings,
}: {
  policies: CapabilityPolicy[]
  offerings: CapabilityOffering[]
}) {
  const t = useExtracted()
  const processingLabel = useProcessingLabels()
  return (
    <SettingsSection
      id="policies"
      icon={RouteIcon}
      title={t("Capability policies")}
      description={t(
        "Routes are configured by school use case. No provider becomes a hidden global default."
      )}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {CAPABILITY_PURPOSES.map((purpose) => {
          const policy =
            policies.find(
              (candidate) =>
                candidate.capability === purpose.capability &&
                candidate.purposePattern === purpose.id
            ) ?? null
          const primary = offerings.find(
            (offering) => offering.id === policy?.primaryOfferingId
          )
          const fallbacks = offerings.filter((offering) =>
            policy?.fallbackOfferingIds.includes(offering.id)
          )
          return (
            <Card key={purpose.id} size="sm">
              <CardHeader>
                <CardTitle>{processingLabel(purpose.title)}</CardTitle>
                <CardDescription>{purpose.capability}</CardDescription>
                <CardAction>
                  <Badge
                    variant={
                      policy?.mode === "disabled" ? "destructive" : "outline"
                    }
                  >
                    {policy?.mode ?? t("Not configured")}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {primary ? (
                  <RouteLine label={t("Primary")} offering={primary} />
                ) : (
                  <p className="text-muted-foreground">
                    {policy?.mode === "automatic"
                      ? t(
                          "A compatible healthy offering is selected at operation start."
                        )
                      : t("No primary route selected.")}
                  </p>
                )}
                {fallbacks.map((fallback, index) => (
                  <RouteLine
                    key={fallback.id}
                    label={t("Fallback {position}", {
                      position: String(index + 1),
                    })}
                    offering={fallback}
                  />
                ))}
              </CardContent>
              <CardFooter className="justify-between">
                <span className="text-xs text-muted-foreground">
                  {policy
                    ? t("Revision {revision}", {
                        revision: String(policy.revision),
                      })
                    : t("User scope")}
                </span>
                <CapabilityPolicyEditor
                  purposeId={purpose.id}
                  policy={policy}
                  offerings={offerings}
                />
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </SettingsSection>
  )
}

function RouteLine({
  label,
  offering,
}: {
  label: string
  offering: CapabilityOffering
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-2.5">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-medium">
          {offering.provider} · {offering.modelId}
        </p>
      </div>
      <Badge variant="outline">{offering.placement.kind}</Badge>
    </div>
  )
}

function UsageSection({
  data,
}: {
  data: Awaited<ReturnType<typeof rpc.capabilities.usage.summary>> | undefined
}) {
  const t = useExtracted()
  const processingLabel = useProcessingLabels()
  const summary = data?.summary
  const rows = summary?.byUnit ?? []
  return (
    <SettingsSection
      id="usage"
      icon={CircleDollarSignIcon}
      title={t("Usage and cost")}
      description={t(
        "Normalized provider usage is append-only. Estimated and billed costs remain visibly distinct."
      )}
    >
      {summary && rows.length > 0 ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <UsageMetric
              label={t("Operations")}
              value={summary.operations.total}
            />
            <UsageMetric
              label={t("Completed")}
              value={summary.operations.completed}
            />
            <UsageMetric
              label={t("Failed")}
              value={summary.operations.failed}
            />
            <UsageMetric
              label={t("Cancelled")}
              value={summary.operations.cancelled}
            />
          </div>
          {summary.byCapability.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {summary.byCapability.map((entry) => (
                <Card key={entry.capability} size="sm">
                  <CardHeader>
                    <CardTitle>
                      {processingLabel(capabilityTitle(entry.capability))}
                    </CardTitle>
                    <CardDescription>{entry.capability}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-1.5">
                    {entry.byUnit.map((unit) => (
                      <Badge key={unit.unit} variant="outline">
                        {unit.quantity} {unit.unit}
                      </Badge>
                    ))}
                    {entry.costByCurrency.map((cost) => (
                      <Badge
                        key={`${cost.currency}:${cost.authoritative}`}
                        variant={cost.authoritative ? "secondary" : "outline"}
                      >
                        {cost.amountMinor} {cost.currency} ·{" "}
                        {cost.authoritative ? t("billed") : t("estimated")}
                      </Badge>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Unit")}</TableHead>
                  <TableHead className="text-right">{t("Quantity")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.unit}>
                    <TableCell>{row.unit}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.quantity}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Currency")}</TableHead>
                  <TableHead>{t("Evidence")}</TableHead>
                  <TableHead className="text-right">
                    {t("Cost, minor units")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.costByCurrency.length > 0 ? (
                  summary.costByCurrency.map((cost) => (
                    <TableRow key={`${cost.currency}:${cost.authoritative}`}>
                      <TableCell>{cost.currency}</TableCell>
                      <TableCell>
                        <Badge
                          variant={cost.authoritative ? "secondary" : "outline"}
                        >
                          {cost.authoritative ? t("Billed") : t("Estimated")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {cost.amountMinor}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center text-muted-foreground"
                    >
                      {t("No provider cost reported")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleDollarSignIcon />
            </EmptyMedia>
            <EmptyTitle>{t("No capability usage yet")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Successful attempts will add normalized usage without exposing request content."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </SettingsSection>
  )
}

function UsageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function PrivacySection({
  data,
}: {
  data: Awaited<ReturnType<typeof rpc.capabilities.consents.list>> | undefined
}) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const revoke = useMutation({
    ...orpc.capabilities.consents.revoke.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.capabilities.consents.list.key(),
      })
      toast.success(t("Consent revoked."))
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const grants = data?.consents ?? []
  return (
    <SettingsSection
      id="privacy"
      icon={LockKeyholeIcon}
      title={t("Privacy and consent")}
      description={t(
        "Every external data transfer requires a published disclosure revision. Revocation blocks new dispatches immediately."
      )}
    >
      {grants.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {grants.map((grant) => (
            <Card key={grant.id} size="sm">
              <CardHeader>
                <CardTitle>{grant.capability}</CardTitle>
                <CardDescription>{grant.connectionId}</CardDescription>
                <CardAction>
                  <Badge
                    variant={grant.revokedAt ? "destructive" : "secondary"}
                  >
                    {grant.revokedAt ? t("Revoked") : t("Active")}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <p>
                  {t("Disclosure revision: {revision}", {
                    revision: grant.disclosureRevision,
                  })}
                </p>
                <p>
                  {t("Granted {date}", {
                    date: format.dateTime(new Date(grant.grantedAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                </p>
              </CardContent>
              {!grant.revokedAt ? (
                <CardFooter>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revoke.isPending}
                    onClick={() =>
                      revoke.mutate({
                        consentId: grant.id,
                        expectedRevision: grant.revision,
                        reason: "Revoked by account owner",
                      })
                    }
                  >
                    <XCircleIcon data-icon="inline-start" />
                    {t("Revoke")}
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          ))}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldCheckIcon />
            </EmptyMedia>
            <EmptyTitle>{t("No external-processing consent")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Local and Node-only processing can remain available without one."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </SettingsSection>
  )
}

function DiagnosticsSection({
  operations,
  mismatches,
}: {
  operations: OperationsData | undefined
  mismatches:
    | Awaited<ReturnType<typeof rpc.capabilities.diagnostics.shadowMismatches>>
    | undefined
}) {
  const t = useExtracted()
  const format = useFormatter()
  const [selected, setSelected] = useState<string | null>(null)
  const rows = operations?.operations ?? []
  const mismatchRows = mismatches?.mismatches ?? []
  return (
    <SettingsSection
      id="diagnostics"
      icon={ActivityIcon}
      title={t("Advanced diagnostics")}
      description={t(
        "Inspect frozen routes, attempts, safe errors and the legacy-to-registry shadow comparison without exposing payloads or secrets."
      )}
    >
      <Tabs defaultValue="operations">
        <TabsList>
          <TabsTrigger value="operations">{t("Operations")}</TabsTrigger>
          <TabsTrigger value="shadow">
            {t("Shadow mismatches")}
            {mismatchRows.length > 0 ? (
              <Badge variant="destructive">{mismatchRows.length}</Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="operations" className="mt-3">
          {rows.length > 0 ? (
            <OperationsTable operations={rows} onSelect={setSelected} />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ActivityIcon />
                </EmptyMedia>
                <EmptyTitle>{t("No capability operation")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "Registry-mode operations appear here. Shadow comparisons are shown separately."
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="shadow" className="mt-3">
          {mismatchRows.length > 0 ? (
            <div className="space-y-2">
              {mismatchRows.map((mismatch) => (
                <Alert key={mismatch.id} variant="destructive">
                  <AlertTriangleIcon />
                  <AlertTitle>
                    {mismatch.capability} · {mismatch.purpose}
                  </AlertTitle>
                  <AlertDescription>
                    {mismatch.safeErrorCode
                      ? t("Shadow resolution failed: {code}.", {
                          code: mismatch.safeErrorCode,
                        })
                      : t(
                          "Legacy selected {legacy}; registry selected {registry}.",
                          {
                            legacy: routeSelectionLabel(mismatch.legacy),
                            registry: routeSelectionLabel(mismatch.registry),
                          }
                        )}{" "}
                    {format.dateTime(new Date(mismatch.occurredAt), {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          ) : (
            <Alert>
              <CheckCircle2Icon />
              <AlertTitle>{t("No recorded shadow mismatch")}</AlertTitle>
              <AlertDescription>
                {t(
                  "Legacy and registry routing decisions agree in the retained diagnostic window."
                )}
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>
      </Tabs>
      <OperationDialog
        operationId={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </SettingsSection>
  )
}

function routeSelectionLabel(
  selection: {
    offeringId: string | null
    routeKey: string | null
    provider: string | null
    modelId: string | null
    reason: string
  } | null
) {
  if (!selection) return "none"
  return [selection.provider, selection.modelId, selection.routeKey]
    .filter(Boolean)
    .join(" · ")
}

function OperationsTable({
  operations,
  onSelect,
}: {
  operations: OperationRecord[]
  onSelect: (id: string) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("Capability")}</TableHead>
          <TableHead>{t("Purpose")}</TableHead>
          <TableHead>{t("State")}</TableHead>
          <TableHead>{t("Created")}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{t("Open")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {operations.map((operation) => (
          <TableRow key={operation.id}>
            <TableCell className="font-medium">
              {operation.capability}
            </TableCell>
            <TableCell>{operation.purpose}</TableCell>
            <TableCell>
              <Badge variant={statusVariant(operation.state)}>
                {operation.state}
              </Badge>
            </TableCell>
            <TableCell>
              {format.dateTime(new Date(operation.createdAt), {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onSelect(operation.id)}
              >
                <EyeIcon />
                <span className="sr-only">{t("Inspect operation")}</span>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function OperationDialog({
  operationId,
  onOpenChange,
}: {
  operationId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const detail = useQuery({
    ...orpc.capabilities.operations.detail.queryOptions({
      input: { operationId: operationId ?? "__disabled__" },
    }),
    enabled: Boolean(operationId),
  })
  const cancel = useMutation({
    ...orpc.capabilities.operations.cancel.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.capabilities.operations.list.key(),
      })
      await detail.refetch()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const data = detail.data
  return (
    <Dialog open={Boolean(operationId)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={t("Close")}>
        <DialogHeader>
          <DialogTitle>{t("Capability operation")}</DialogTitle>
          <DialogDescription>{operationId}</DialogDescription>
        </DialogHeader>
        {detail.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl border p-4 text-sm">
              <DiagnosticValue
                label={t("Capability")}
                value={data.operation.capability}
              />
              <DiagnosticValue
                label={t("Purpose")}
                value={data.operation.purpose}
              />
              <DiagnosticValue
                label={t("State")}
                value={data.operation.state}
              />
              <DiagnosticValue
                label={t("Revision")}
                value={String(data.operation.revision)}
              />
              <DiagnosticValue
                label={t("Input digest")}
                value={shortDigest(data.operation.inputDigest)}
              />
              <DiagnosticValue
                label={t("Route digest")}
                value={shortDigest(data.operation.routePlan?.digest)}
              />
            </div>
            {data.operation.routePlan ? (
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  {t("Frozen route")}
                </h3>
                <div className="space-y-2">
                  {[
                    data.operation.routePlan.primary,
                    ...data.operation.routePlan.fallbacks,
                  ].map((route, index) => (
                    <div
                      key={route.offeringId}
                      className="flex items-start justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {index === 0
                            ? t("Primary")
                            : t("Fallback {position}", {
                                position: String(index),
                              })}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {route.pluginId} · {route.modelId}@
                          {route.modelRevision}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {route.placement.kind} · {route.dataEgress}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <h3 className="mb-2 text-sm font-medium">{t("Attempts")}</h3>
              <div className="space-y-2">
                {data.attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="flex items-start justify-between gap-3 rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {t("Attempt {number}", {
                          number: String(attempt.ordinal + 1),
                        })}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {attempt.offeringId} ·{" "}
                        {attempt.errorClass ?? t("No safe error")}
                      </p>
                    </div>
                    <Badge variant={statusVariant(attempt.state)}>
                      {attempt.state}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  cancel.isPending ||
                  ![
                    "reserved",
                    "routing",
                    "ready",
                    "dispatching",
                    "waiting-provider",
                  ].includes(data.operation.state)
                }
                onClick={() =>
                  cancel.mutate({
                    operationId: data.operation.id,
                    expectedRevision: data.operation.revision,
                    reason: "Cancelled by account owner",
                  })
                }
              >
                <XCircleIcon data-icon="inline-start" />
                {t("Cancel operation")}
              </Button>
              {data.operation.state === "failed" ? (
                <p className="self-center text-xs text-muted-foreground">
                  {t(
                    "Relaunch this work from its original screen so the input and route are frozen in a new operation."
                  )}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("Operation details unavailable")}</AlertTitle>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DiagnosticValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-medium">{value}</p>
    </div>
  )
}
