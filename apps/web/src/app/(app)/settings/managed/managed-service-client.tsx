"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  BoxesIcon,
  CloudCogIcon,
  DownloadIcon,
  HardDriveIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  PowerIcon,
  ServerIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  SettingsSection,
  SettingsRow,
} from "@/components/settings/settings-section"
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
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress, ProgressLabel } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { orpc, rpc } from "@/lib/orpc"

const ALL_CATEGORIES = [
  "files",
  "conversations",
  "retrieval",
  "inference",
  "sandbox-artifacts",
] as const

type ManagedCategory = (typeof ALL_CATEGORIES)[number]
type MutationState<T> = {
  isPending: boolean
  mutate: (input: T) => void
}
type ManagedUsageReservation = {
  id: unknown
  capability: unknown
  unit: unknown
  reservedQuantity: unknown
  consumedQuantity: unknown
  releasedQuantity: unknown
  status: unknown
  runId: unknown
  jobId: unknown
  createdAt: unknown
  settledAt: unknown
}

function finiteNumber(value: string | null | undefined) {
  const numeric = Number(value ?? 0)
  return Number.isSafeInteger(numeric) ? numeric : null
}

function ledgerTimestamp(value: unknown) {
  if (typeof value === "number") {
    return value < 1_000_000_000_000 ? value * 1_000 : value
  }
  const parsed = new Date(String(value ?? "")).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function stateVariant(state: string | null | undefined) {
  if (state === "active" || state === "healthy" || state === "completed") {
    return "secondary" as const
  }
  if (state === "suspended" || state === "failed" || state === "offline") {
    return "destructive" as const
  }
  return "outline" as const
}

export function ManagedServiceClient() {
  const t = useExtracted()
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()
  const [inviteToken, setInviteToken] = useState("")
  const [waitlistRegion, setWaitlistRegion] = useState("eu-west")
  const [categories, setCategories] = useState<string[]>([...ALL_CATEGORIES])
  const [deletionOpen, setDeletionOpen] = useState(false)
  const [deletionPhrase, setDeletionPhrase] = useState("")

  const status = useQuery(orpc.managed.beta.status.queryOptions())
  const deletionPreview = useQuery({
    ...orpc.managed.privacy.previewDeletion.queryOptions(),
    enabled: deletionOpen,
  })
  const data = status.data

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orpc.managed.beta.status.key() })

  const joinWaitlist = useMutation({
    ...orpc.managed.beta.joinWaitlist.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("You are on the managed beta waitlist."))
      await refresh()
    },
    onError: () => toast.error(t("The waitlist could not be updated.")),
  })
  const withdrawWaitlist = useMutation({
    ...orpc.managed.beta.withdrawWaitlist.mutationOptions(),
    onSuccess: refresh,
  })
  const redeem = useMutation({
    ...orpc.managed.beta.redeemInvite.mutationOptions(),
    onSuccess: async () => {
      setInviteToken("")
      toast.success(t("Managed beta activated."))
      await refresh()
    },
    onError: (error: Error) =>
      toast.error(
        error.message || t("This invitation could not be activated.")
      ),
  })
  const consent = useMutation({
    ...orpc.managed.beta.updateConsent.mutationOptions(),
    onSuccess: refresh,
    onError: () => toast.error(t("The consent choice could not be saved.")),
  })
  const execution = useMutation({
    ...orpc.managed.controls.setPaidExecutionDisabled.mutationOptions(),
    onSuccess: refresh,
    onError: () => toast.error(t("The execution control could not be saved.")),
  })
  const exportMetadata = useMutation({
    ...orpc.managed.privacy.exportManagedMetadata.mutationOptions(),
    onSuccess: (result) => {
      const blob = new Blob([JSON.stringify(result.manifest, null, 2)], {
        type: "application/json",
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `avermate-managed-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success(t("Managed metadata exported."))
      void refresh()
    },
  })
  const deletion = useMutation({
    ...orpc.managed.privacy.requestManagedDeletion.mutationOptions(),
    onSuccess: async () => {
      setDeletionOpen(false)
      setDeletionPhrase("")
      toast.success(
        t(
          "Deletion started. Remote data remains pending until a verified receipt arrives."
        )
      )
      await refresh()
    },
    onError: () => toast.error(t("Managed deletion could not be started.")),
  })

  return (
    <>
      <PageMeta title={t("AI & managed storage")} backHref="/more" />
      <div className="flex flex-col gap-4">
        <div className="hidden md:block">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("AI & managed storage")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Optional, and hosted by Avermate. Grades, exports, your own API keys, your Node and self-hosting never need it."
            )}
          </p>
        </div>

        {status.isLoading ? <ManagedSkeleton /> : null}
        {!isOnline ? (
          <Alert role="status">
            <AlertTriangleIcon />
            <AlertTitle>{t("You are offline")}</AlertTitle>
            <AlertDescription>
              {t(
                "Academic features remain available. Managed usage, consent and privacy operations refresh after reconnection."
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        {status.isError ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("Managed status is unavailable")}</AlertTitle>
            <AlertDescription>
              {t(
                "Academic features remain available. Try this page again later."
              )}
            </AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                variant="outline"
                disabled={!isOnline || status.isFetching}
                onClick={() => void status.refetch()}
              >
                {status.isFetching ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                {t("Try again")}
              </Button>
            </AlertAction>
          </Alert>
        ) : null}

        {data ? (
          <>
            <ModeSummary data={data} />
            {data.incidents
              .filter((incident) => incident.status !== "resolved")
              .map((incident) => (
                <Alert key={incident.id} variant="destructive">
                  <AlertTriangleIcon />
                  <AlertTitle>{incident.title}</AlertTitle>
                  <AlertDescription>{incident.safeSummary}</AlertDescription>
                </Alert>
              ))}

            {!data.account ? (
              <fieldset
                className="contents"
                disabled={!isOnline}
                aria-disabled={!isOnline}
              >
                <EnrollmentPanel
                  data={data}
                  inviteToken={inviteToken}
                  setInviteToken={setInviteToken}
                  categories={categories}
                  setCategories={setCategories}
                  waitlistRegion={waitlistRegion}
                  setWaitlistRegion={setWaitlistRegion}
                  joinWaitlist={joinWaitlist}
                  withdrawWaitlist={{
                    isPending: withdrawWaitlist.isPending,
                    mutate: () => withdrawWaitlist.mutate(undefined),
                  }}
                  redeem={redeem}
                />
              </fieldset>
            ) : (
              <Tabs defaultValue="usage" className="gap-4">
                <TabsList className="max-w-full overflow-x-auto">
                  <TabsTrigger value="usage">{t("Usage & limits")}</TabsTrigger>
                  <TabsTrigger value="providers">
                    {t("Providers & data")}
                  </TabsTrigger>
                  <TabsTrigger value="privacy">
                    {t("Privacy & lifecycle")}
                  </TabsTrigger>
                  <TabsTrigger value="plan">{t("Plan")}</TabsTrigger>
                </TabsList>

                <TabsContent value="usage" className="flex flex-col gap-4">
                  <fieldset
                    className="contents"
                    disabled={!isOnline}
                    aria-disabled={!isOnline}
                  >
                    <SettingsSection
                      id="managed-execution"
                      icon={PowerIcon}
                      title={t("Managed execution")}
                      description={t(
                        "The emergency stop cancels queued reservations and blocks new managed spend."
                      )}
                    >
                      <SettingsRow
                        label={t("Allow managed execution")}
                        description={t(
                          "Your own API keys and your Node are unaffected."
                        )}
                      >
                        <Switch
                          aria-label={t("Allow managed execution")}
                          checked={!data.paidExecutionDisabled}
                          disabled={
                            execution.isPending ||
                            !data.account.managedDataConsent
                          }
                          onCheckedChange={(checked) =>
                            execution.mutate({
                              disabled: !checked,
                              justification: checked
                                ? "User re-enabled managed execution"
                                : "User emergency stop",
                            })
                          }
                        />
                      </SettingsRow>
                    </SettingsSection>
                  </fieldset>
                  <UsageGrid usage={data.usage} />
                </TabsContent>

                <TabsContent value="providers" className="flex flex-col gap-4">
                  <ProviderDisclosure data={data} />
                  <fieldset
                    className="contents"
                    disabled={!isOnline}
                    aria-disabled={!isOnline}
                  >
                    <ConsentPanel
                      key={`${data.account.updatedAt}-${data.account.consentedCategories.join(",")}`}
                      account={data.account}
                      consent={consent}
                    />
                  </fieldset>
                </TabsContent>

                <TabsContent value="privacy" className="flex flex-col gap-4">
                  <fieldset
                    className="contents"
                    disabled={!isOnline}
                    aria-disabled={!isOnline}
                  >
                    <PrivacyPanel
                      operations={data.privacyOperations}
                      exportMetadata={{
                        isPending: exportMetadata.isPending,
                        mutate: () => exportMetadata.mutate(undefined),
                      }}
                      deletionOpen={deletionOpen}
                      setDeletionOpen={setDeletionOpen}
                      deletionPhrase={deletionPhrase}
                      setDeletionPhrase={setDeletionPhrase}
                      deletion={deletion}
                      preview={deletionPreview.data}
                      previewPending={deletionPreview.isLoading}
                    />
                  </fieldset>
                </TabsContent>

                <TabsContent value="plan">
                  <PlanPanel data={data} />
                </TabsContent>
              </Tabs>
            )}
          </>
        ) : null}
      </div>
    </>
  )
}

function ManagedSkeleton() {
  const t = useExtracted()
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      role="status"
      aria-label={t("Loading managed service status")}
      aria-busy="true"
    >
      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-64 rounded-xl sm:col-span-2" />
    </div>
  )
}

function ModeSummary({ data }: { data: ManagedData }) {
  const t = useExtracted()
  const active =
    data.account?.state === "active" && data.account.managedDataConsent
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("Current mode")}</CardTitle>
          <CardAction>
            <Badge variant={active ? "secondary" : "outline"}>
              {active ? t("Managed beta") : t("Core / BYOK / Node")}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {active
            ? t("Invite-only processing in {region}.", {
                region: data.account?.region ?? data.disclosure.region,
              })
            : t("No Avermate-funded processing is active.")}
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("Service status")}</CardTitle>
          <CardAction>
            <Badge
              variant={data.mode.adaptersEnabled ? "secondary" : "outline"}
            >
              {data.mode.adaptersEnabled ? t("Configured") : t("Unavailable")}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {data.mode.adaptersEnabled
            ? t("Provider health is shown before every operation.")
            : t("Managed adapters are disabled by the operator.")}
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("Billing")}</CardTitle>
          <CardAction>
            <Badge variant="outline">{t("Checkout off")}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t("The current beta never initiates a payment or invents a charge.")}
        </CardContent>
      </Card>
    </div>
  )
}

type ManagedData = Awaited<ReturnType<typeof rpc.managed.beta.status>>

function EnrollmentPanel({
  data,
  inviteToken,
  setInviteToken,
  categories,
  setCategories,
  waitlistRegion,
  setWaitlistRegion,
  joinWaitlist,
  withdrawWaitlist,
  redeem,
}: {
  data: ManagedData
  inviteToken: string
  setInviteToken: (value: string) => void
  categories: string[]
  setCategories: (value: string[]) => void
  waitlistRegion: string
  setWaitlistRegion: (value: string) => void
  joinWaitlist: MutationState<{ preferredRegion: string }>
  withdrawWaitlist: { isPending: boolean; mutate: () => void }
  redeem: MutationState<{
    token: string
    termsRevision: string
    privacyRevision: string
    consentedCategories: ManagedCategory[]
  }>
}) {
  const t = useExtracted()
  return (
    <div className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2">
      <SettingsSection
        icon={KeyRoundIcon}
        title={t("Activate an invitation")}
        description={t(
          "The token is one-time, account-bound when an email was selected, and expires automatically."
        )}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="managed-invite-token">
              {t("Invitation token")}
            </FieldLabel>
            <Input
              id="managed-invite-token"
              type="password"
              autoComplete="off"
              value={inviteToken}
              onChange={(event) => setInviteToken(event.target.value)}
            />
            <FieldDescription>
              {t("Avermate stores only a cryptographic digest of this token.")}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t("Data categories allowed")}</FieldLabel>
            {ALL_CATEGORIES.map((category) => (
              <Field key={category} orientation="horizontal">
                <Checkbox
                  id={`enroll-${category}`}
                  checked={categories.includes(category)}
                  onCheckedChange={(checked) =>
                    setCategories(
                      checked
                        ? [...new Set([...categories, category])]
                        : categories.filter((value) => value !== category)
                    )
                  }
                />
                <FieldLabel htmlFor={`enroll-${category}`}>
                  {category}
                </FieldLabel>
              </Field>
            ))}
          </Field>
        </FieldGroup>
        <Alert>
          <LockKeyholeIcon />
          <AlertTitle>{t("Explicit agreement")}</AlertTitle>
          <AlertDescription>
            {t(
              "Activating accepts terms {terms} and privacy notice {privacy}.",
              {
                terms: data.disclosure.termsRevision,
                privacy: data.disclosure.privacyRevision,
              }
            )}
          </AlertDescription>
        </Alert>
        <Button
          disabled={
            redeem.isPending ||
            inviteToken.trim().length < 20 ||
            categories.length === 0
          }
          onClick={() =>
            redeem.mutate({
              token: inviteToken.trim(),
              termsRevision: data.disclosure.termsRevision,
              privacyRevision: data.disclosure.privacyRevision,
              consentedCategories: categories as ManagedCategory[],
            })
          }
        >
          {redeem.isPending ? <Spinner data-icon="inline-start" /> : null}
          {t("Activate managed beta")}
        </Button>
      </SettingsSection>

      <SettingsSection
        icon={CloudCogIcon}
        title={t("Invite-only waitlist")}
        description={t(
          "Joining does not enable a provider or reserve any paid resource."
        )}
      >
        <Field>
          <FieldLabel htmlFor="managed-waitlist-region">
            {t("Preferred region")}
          </FieldLabel>
          <Input
            id="managed-waitlist-region"
            value={waitlistRegion}
            onChange={(event) => setWaitlistRegion(event.target.value)}
          />
        </Field>
        {data.waitlist?.status === "waiting" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t("Waiting")}</Badge>
            <Button
              size="sm"
              variant="outline"
              disabled={withdrawWaitlist.isPending}
              onClick={() => withdrawWaitlist.mutate()}
            >
              {t("Leave the waitlist")}
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={joinWaitlist.isPending || !waitlistRegion.trim()}
            onClick={() =>
              joinWaitlist.mutate({ preferredRegion: waitlistRegion.trim() })
            }
          >
            {joinWaitlist.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            {t("Join the waitlist")}
          </Button>
        )}
      </SettingsSection>
    </div>
  )
}

function UsageGrid({ usage }: { usage: ManagedData["usage"] }) {
  const t = useExtracted()
  const isOnline = useOnlineStatus()
  const [periodAnchor] = useState(() => Date.now())
  const [period, setPeriod] = useState<"7" | "30" | "all">("30")
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const reservations = useQuery({
    ...orpc.managed.usage.reservations.queryOptions({ input: { limit: 100 } }),
    enabled: isOnline,
  })
  const runUsage = useQuery({
    ...orpc.managed.usage.run.queryOptions({
      input: { runId: selectedRunId ?? "_" },
    }),
    enabled: isOnline && Boolean(selectedRunId),
  })
  const capabilityLabels: Record<string, string> = {
    "storage.bytes": t("Storage"),
    "ocr.pages": t("OCR pages"),
    "transcription.seconds": t("Transcription"),
    "model.inputTokens": t("Model input"),
    "model.outputTokens": t("Model output"),
    "model.cachedInputTokens": t("Cached model input"),
    "embedding.units": t("Embeddings"),
    "tts.characters": t("Text to speech"),
    "sandbox.cpuMillis": t("Sandbox CPU"),
    "sandbox.memoryByteSeconds": t("Sandbox memory"),
    "sandbox.egressBytes": t("Sandbox egress"),
    "video.outputSeconds": t("Generated video"),
  }
  const format = useFormatter()
  const periodStart =
    period === "all" ? 0 : periodAnchor - Number(period) * 24 * 60 * 60 * 1_000
  const reservationRows = (reservations.data ??
    []) as unknown as ManagedUsageReservation[]
  const visibleReservations = reservationRows.filter(
    (reservation) => ledgerTimestamp(reservation.createdAt) >= periodStart
  )
  return (
    <SettingsSection
      icon={BoxesIcon}
      title={t("Authoritative usage")}
      description={t(
        "These figures come from Avermate's own ledger, not from a counter in your browser."
      )}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {usage.map(({ capability, totals, entitlement }) => {
          const used = finiteNumber(totals.netConsumed) ?? 0
          const reserved = finiteNumber(totals.reserved) ?? 0
          const limit = finiteNumber(totals.hardLimit)
          const percentage =
            limit && limit > 0
              ? Math.min(100, ((used + reserved) / limit) * 100)
              : 0
          return (
            <Card key={capability} size="sm">
              <CardHeader>
                <CardTitle>
                  {capabilityLabels[capability] ?? capability}
                </CardTitle>
                <CardAction>
                  <Badge
                    variant={entitlement.enabled ? "secondary" : "outline"}
                  >
                    {entitlement.enabled ? t("Enabled") : t("Locked")}
                  </Badge>
                </CardAction>
                <CardDescription>{totals.unit ?? t("No unit")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={percentage}>
                  <ProgressLabel>{t("Used + reserved")}</ProgressLabel>
                  <span className="ml-auto text-sm text-muted-foreground tabular-nums">
                    {limit === null
                      ? `${totals.netConsumed} + ${totals.reserved}`
                      : `${format.number(used)} + ${format.number(reserved)} / ${format.number(limit)}`}
                  </span>
                </Progress>
                {totals.adjusted !== "0" ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("Includes an audited adjustment of {quantity}.", {
                      quantity: totals.adjusted,
                    })}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          )
        })}
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("Reservation ledger")}</CardTitle>
          <CardDescription>
            {t(
              "Reserved quantities are estimates while work is in flight; settled usage is final provider evidence. No row is a user charge."
            )}
          </CardDescription>
          <CardAction className="flex gap-1">
            {(["7", "30", "all"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="xs"
                variant={period === value ? "secondary" : "ghost"}
                onClick={() => setPeriod(value)}
              >
                {value === "all" ? t("All") : t("{days}d", { days: value })}
              </Button>
            ))}
          </CardAction>
        </CardHeader>
        <CardContent>
          {reservations.isPending ? (
            <div className="grid gap-2" role="status">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : reservations.isError ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{t("Reservation history is unavailable")}</AlertTitle>
              <AlertDescription>
                {t("The totals above are the ones that count.")}
              </AlertDescription>
            </Alert>
          ) : visibleReservations.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("No reservation in this period")}</EmptyTitle>
                <EmptyDescription>
                  {t("Choose a longer period or run a managed operation.")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("State")}</TableHead>
                    <TableHead>{t("Capability")}</TableHead>
                    <TableHead>{t("Estimated")}</TableHead>
                    <TableHead>{t("Settled")}</TableHead>
                    <TableHead>{t("Created")}</TableHead>
                    <TableHead className="text-right">{t("Details")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleReservations.map((reservation) => {
                    const runId =
                      typeof reservation.runId === "string"
                        ? reservation.runId
                        : null
                    const settled = reservation.status !== "reserved"
                    return (
                      <TableRow key={String(reservation.id)}>
                        <TableCell>
                          <Badge variant={settled ? "secondary" : "outline"}>
                            {settled ? t("Settled") : t("Estimated")}
                          </Badge>
                        </TableCell>
                        <TableCell>{String(reservation.capability)}</TableCell>
                        <TableCell className="tabular-nums">
                          {String(reservation.reservedQuantity)}{" "}
                          {String(reservation.unit)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {settled
                            ? `${String(reservation.consumedQuantity)} ${String(reservation.unit)}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {format.dateTime(
                            new Date(ledgerTimestamp(reservation.createdAt)),
                            { dateStyle: "medium", timeStyle: "short" }
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={!runId}
                            onClick={() => setSelectedRunId(runId)}
                          >
                            {t("Inspect")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRunId ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("Run usage details")}</CardTitle>
            <CardDescription className="font-mono">
              {selectedRunId}
            </CardDescription>
            <CardAction>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setSelectedRunId(null)}
              >
                {t("Close")}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {runUsage.isPending ? (
              <Skeleton className="h-24" />
            ) : runUsage.isError ? (
              <Alert variant="destructive">
                <AlertTitle>{t("Run details are unavailable")}</AlertTitle>
              </Alert>
            ) : !runUsage.data?.length ? (
              <p className="text-sm text-muted-foreground">
                {t("No settled usage event is recorded for this run yet.")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Capability")}</TableHead>
                    <TableHead>{t("Quantity")}</TableHead>
                    <TableHead>{t("Provider")}</TableHead>
                    <TableHead>{t("Evidence")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runUsage.data.map((event) => (
                    <TableRow key={event.eventId}>
                      <TableCell>{event.capability}</TableCell>
                      <TableCell className="tabular-nums">
                        {event.quantity} {event.unit}
                      </TableCell>
                      <TableCell>
                        {[event.provider, event.model]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={event.final ? "secondary" : "outline"}>
                          {event.final ? t("Settled") : t("Estimated")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </SettingsSection>
  )
}

function ProviderDisclosure({ data }: { data: ManagedData }) {
  const t = useExtracted()
  return (
    <SettingsSection
      icon={ServerIcon}
      title={t("Region, processors and availability")}
      description={t(
        "A provider sees only the scoped content required for the selected operation. School passwords are never sent."
      )}
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          {data.account?.region ?? data.disclosure.region}
        </Badge>
        <Badge variant="outline">
          {data.account?.cohort ?? t("No cohort")}
        </Badge>
        <Badge variant="outline">
          {data.account?.policyRevision ?? t("No policy")}
        </Badge>
      </div>
      {data.providers.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>{t("No managed provider is advertised")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Managed features stay unavailable. Everything else keeps working."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Capability")}</TableHead>
              <TableHead>{t("Processor")}</TableHead>
              <TableHead>{t("Region")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.providers.map((provider, index) => (
              <TableRow
                key={`${provider.pool}-${provider.capability}-${index}`}
              >
                <TableCell>{String(provider.capability)}</TableCell>
                <TableCell>{String(provider.providerId)}</TableCell>
                <TableCell>{String(provider.region)}</TableCell>
                <TableCell>
                  <Badge variant={stateVariant(String(provider.status))}>
                    {String(provider.status)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SettingsSection>
  )
}

function ConsentPanel({
  account,
  consent,
}: {
  account: NonNullable<ManagedData["account"]>
  consent: MutationState<{
    enabled: boolean
    categories: ManagedCategory[]
  }>
}) {
  const t = useExtracted()
  const [selected, setSelected] = useState<ManagedCategory[]>(() =>
    account.consentedCategories.filter(
      (category): category is ManagedCategory =>
        ALL_CATEGORIES.includes(category as ManagedCategory)
    )
  )
  const selectedCategories = new Set(selected)

  return (
    <SettingsSection
      icon={ShieldCheckIcon}
      title={t("Managed processing consent")}
      description={t(
        "Revoking consent immediately blocks new managed processing and cancels queued reservations."
      )}
    >
      <FieldGroup>
        {ALL_CATEGORIES.map((category) => (
          <Field key={category} orientation="horizontal">
            <Checkbox
              id={`managed-category-${category}`}
              checked={selectedCategories.has(category)}
              disabled={consent.isPending}
              onCheckedChange={(checked) => {
                const next = new Set(selectedCategories)
                if (checked) next.add(category)
                else next.delete(category)
                setSelected([...next])
              }}
            />
            <FieldLabel htmlFor={`managed-category-${category}`}>
              {category}
            </FieldLabel>
          </Field>
        ))}
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={consent.isPending || selected.length === 0}
          onClick={() =>
            consent.mutate({ enabled: true, categories: selected })
          }
        >
          {consent.isPending ? <Spinner data-icon="inline-start" /> : null}
          {t("Save consent")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={consent.isPending || !account.managedDataConsent}
          onClick={() => consent.mutate({ enabled: false, categories: [] })}
        >
          {t("Revoke consent")}
        </Button>
      </div>
    </SettingsSection>
  )
}

function PrivacyPanel({
  operations,
  exportMetadata,
  deletionOpen,
  setDeletionOpen,
  deletionPhrase,
  setDeletionPhrase,
  deletion,
  preview,
  previewPending,
}: {
  operations: ManagedData["privacyOperations"]
  exportMetadata: { isPending: boolean; mutate: () => void }
  deletionOpen: boolean
  setDeletionOpen: (open: boolean) => void
  deletionPhrase: string
  setDeletionPhrase: (value: string) => void
  deletion: MutationState<{ confirmation: "DELETE MANAGED DATA" }>
  preview:
    Awaited<ReturnType<typeof rpc.managed.privacy.previewDeletion>> | undefined
  previewPending: boolean
}) {
  const t = useExtracted()
  return (
    <>
      <SettingsSection
        icon={DownloadIcon}
        title={t("Export and migration away")}
        description={t(
          "Managed metadata export is separate from the complete academic export in Account settings. Both remain available without a subscription."
        )}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={exportMetadata.isPending}
            onClick={() => exportMetadata.mutate()}
          >
            {exportMetadata.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            {t("Export managed metadata")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setDeletionOpen(true)}
          >
            <Trash2Icon data-icon="inline-start" />
            {t("Delete managed data")}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={HardDriveIcon}
        title={t("Lifecycle receipts")}
        description={t(
          "Nothing is called deleted until the service confirms it."
        )}
      >
        {operations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HardDriveIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No managed privacy operation")}</EmptyTitle>
              <EmptyDescription>
                {t("Exports and deletion receipts will appear here.")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {operations.map((operation) => (
              <Card key={operation.id} size="sm">
                <CardHeader>
                  <CardTitle>{operation.kind}</CardTitle>
                  <CardAction>
                    <Badge variant={stateVariant(operation.state)}>
                      {operation.state}
                    </Badge>
                  </CardAction>
                  <CardDescription>{operation.id}</CardDescription>
                </CardHeader>
                {operation.targets.length > 0 ? (
                  <CardContent className="flex flex-wrap gap-2">
                    {operation.targets.map((target) => (
                      <Badge
                        key={target.placementKey}
                        variant={stateVariant(target.state)}
                      >
                        {target.placementKey} · {target.state}
                      </Badge>
                    ))}
                  </CardContent>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </SettingsSection>

      <AlertDialog open={deletionOpen} onOpenChange={setDeletionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Delete managed-plane data?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Managed execution is disabled immediately. Academic data stays in Core. Remote bytes remain visibly pending until a verified deletion receipt arrives."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="managed-delete-confirmation">
              {t("Type DELETE MANAGED DATA")}
            </FieldLabel>
            <Input
              id="managed-delete-confirmation"
              value={deletionPhrase}
              onChange={(event) => setDeletionPhrase(event.target.value)}
            />
          </Field>
          {previewPending ? (
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          ) : preview ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  {t("Active reservations")}
                </p>
                <p className="font-medium tabular-nums">
                  {preview.activeReservations}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  {t("Managed storage groups")}
                </p>
                <p className="font-medium tabular-nums">
                  {preview.storage.length}
                </p>
              </div>
              <Alert className="col-span-2">
                <ShieldCheckIcon />
                <AlertTitle>{t("Academic Core is unaffected")}</AlertTitle>
                <AlertDescription>
                  {t(
                    "Managed access is tombstoned immediately; provider bytes remain pending until receipts are verified."
                  )}
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                deletionPhrase !== "DELETE MANAGED DATA" || deletion.isPending
              }
              onClick={() =>
                deletion.mutate({ confirmation: "DELETE MANAGED DATA" })
              }
            >
              {deletion.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t("Start deletion")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function PlanPanel({ data }: { data: ManagedData }) {
  const t = useExtracted()
  return (
    <SettingsSection
      icon={ShieldCheckIcon}
      title={t("Free academic Core, optional convenience")}
      description={t("Checkout remains disabled during this invite beta.")}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("Always available")}</CardTitle>
            <CardDescription>
              {t("Never placed behind a managed plan")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc ps-5 text-sm text-muted-foreground">
              <li>{t("Grades, years, subjects, averages and planning")}</li>
              <li>{t("Export and account deletion")}</li>
              <li>
                {t("Your own API keys, your Node, MCP and full self-hosting")}
              </li>
            </ul>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("Managed convenience")}</CardTitle>
            <CardDescription>
              {t("Measured provider-funded resources only")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc ps-5 text-sm text-muted-foreground">
              <li>{t("Storage, OCR, transcription and embeddings")}</li>
              <li>{t("Model, reranking, speech and sandbox compute")}</li>
              <li>
                {t(
                  "Usage is counted in fixed units that cannot be changed afterwards"
                )}
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>{t("No checkout")}</AlertTitle>
        <AlertDescription>
          {data.billing
            ? t(
                "A test-mode billing observation exists, but it does not authorize a capability."
              )
            : t("No billing subscription is attached to this account.")}
        </AlertDescription>
      </Alert>
    </SettingsSection>
  )
}
