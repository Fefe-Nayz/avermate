"use client"

import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ArchiveRestoreIcon,
  BanIcon,
  CheckCircle2Icon,
  ClipboardIcon,
  CloudCogIcon,
  Clock3Icon,
  FileSearchIcon,
  GaugeIcon,
  KeyRoundIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  ServerCogIcon,
  ShieldAlertIcon,
  SirenIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { SelectControl } from "@/components/forms/controls"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
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
import { Textarea } from "@/components/ui/textarea"
import { orpc, rpc } from "@/lib/orpc"

const CAPABILITIES = [
  "storage.bytes",
  "ocr.pages",
  "transcription.seconds",
  "model.inputTokens",
  "model.outputTokens",
  "model.cachedInputTokens",
  "embedding.units",
  "tts.characters",
  "sandbox.cpuMillis",
  "sandbox.memoryByteSeconds",
  "sandbox.egressBytes",
  "video.outputSeconds",
] as const

type ManagedCapability = (typeof CAPABILITIES)[number]

type ManagedOperationsData = Awaited<
  ReturnType<typeof rpc.managed.admin.beta.overview>
>

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 16)

function variantForState(state: string) {
  if (["active", "healthy", "passed", "closed", "resolved"].includes(state)) {
    return "secondary" as const
  }
  if (
    ["failed", "open", "critical", "suspended", "blocked", "stale"].includes(
      state
    )
  ) {
    return "destructive" as const
  }
  return "outline" as const
}

function scalar(value: unknown) {
  if (value === null || value === undefined) return "—"
  return String(value)
}

export function ManagedOperationsClient() {
  const t = useExtracted()
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()
  const overview = useQuery(orpc.managed.admin.beta.overview.queryOptions())
  const data = overview.data
  const [issuedToken, setIssuedToken] = useState<string | null>(null)
  const [correlationResult, setCorrelationResult] = useState<{
    operationId: string
    reservations: Record<string, unknown>[]
    usageEvents: Record<string, unknown>[]
    auditEvents: Record<string, unknown>[]
    contentIncluded: boolean
  } | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.managed.admin.beta.overview.key(),
    })

  const issueInvite = useMutation({
    ...orpc.managed.admin.beta.issueInvite.mutationOptions(),
    onSuccess: async (result) => {
      setIssuedToken(result.token)
      toast.success(t("Invitation created. Copy the token now."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const revokeInvite = useMutation({
    ...orpc.managed.admin.beta.revokeInvite.mutationOptions(),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  })
  const setAccountPolicy = useMutation({
    ...orpc.managed.admin.beta.setAccountPolicy.mutationOptions(),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  })
  const quota = useMutation({
    ...orpc.managed.admin.beta.upsertQuotaPolicy.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Quota policy saved."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const breaker = useMutation({
    ...orpc.managed.admin.circuitBreaker.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Circuit breaker updated."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const reconcile = useMutation({
    ...orpc.managed.admin.reconcileExpiredReservations.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        t("Released {count} expired holds.", {
          count: String(result.settled.length),
        })
      )
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const evidence = useMutation({
    ...orpc.managed.admin.operations.recordEvidence.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Operational evidence recorded."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const gate = useMutation({
    ...orpc.managed.admin.operations.setLaunchGate.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Launch gate updated."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const incident = useMutation({
    ...orpc.managed.admin.operations.createIncident.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Incident status published."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const correlate = useMutation({
    ...orpc.managed.admin.operations.correlate.mutationOptions(),
    onSuccess: (result) =>
      setCorrelationResult({
        ...result,
        reservations: result.reservations as Record<string, unknown>[],
        usageEvents: result.usageEvents as Record<string, unknown>[],
        auditEvents: result.auditEvents as Record<string, unknown>[],
      }),
    onError: (error: Error) => toast.error(error.message),
  })

  if (overview.isLoading) {
    return (
      <div
        className="flex min-h-64 items-center justify-center"
        role="status"
        aria-label={t("Loading managed operations")}
        aria-busy="true"
      >
        <Spinner className="size-6" />
      </div>
    )
  }

  if (!data || overview.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>{t("Managed operations are unavailable")}</AlertTitle>
        <AlertDescription>
          {t("Nothing can be confirmed while the service is unreachable.")}
        </AlertDescription>
        <AlertAction>
          <Button
            size="sm"
            variant="outline"
            disabled={!isOnline || overview.isFetching}
            onClick={() => void overview.refetch()}
          >
            {overview.isFetching ? <Spinner data-icon="inline-start" /> : null}
            {t("Try again")}
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  const openBreakers = data.circuitBreakers.filter(
    (item) => String(item.state) !== "closed"
  ).length
  const liveEvidence = data.controlPlane.evidence.filter(
    (item) =>
      String(item.status) === "passed" &&
      String(item.source) !== "repository-fixture"
  ).length
  const queuedJobs = data.pools.reduce(
    (total, item) => total + Number(item.queued ?? 0),
    0
  )
  const activeReservations = data.reservations
    .filter((item) => String(item.status) === "reserved")
    .reduce((total, item) => total + Number(item.count ?? 0), 0)
  const deletionBacklog = data.deletionBacklog
    .filter(
      (item) => !["verified_deleted", "completed"].includes(String(item.state))
    )
    .reduce((total, item) => total + Number(item.count ?? 0), 0)
  const managedStorageBytes = data.storage.reduce(
    (total, item) => total + Number(item.bytes ?? 0),
    0
  )

  return (
    <>
      <PageMeta title={t("Managed service operations")} backHref="/admin" />
      <div className="flex flex-col gap-4">
        <div className="hidden md:block">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Managed service operations")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Invite-only admission, quotas, privacy operations and redacted release evidence. No customer content is exposed here."
            )}
          </p>
        </div>

        {!isOnline ? (
          <Alert role="status">
            <AlertTriangleIcon />
            <AlertTitle>{t("You are offline")}</AlertTitle>
            <AlertDescription>
              {t(
                "The last loaded redacted status remains visible. Operator changes and correlation searches resume after reconnection."
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <Alert variant="destructive">
          <ShieldAlertIcon />
          <AlertTitle>{t("Production checkout is hard-disabled")}</AlertTitle>
          <AlertDescription>
            {data.commercial.note}{" "}
            {t("Test-mode billing state never grants an entitlement.")}
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 @4xl/main:grid-cols-4">
          <SummaryCard
            title={t("Managed readiness")}
            value={data.readiness.ready ? t("Ready") : t("Blocked")}
            detail={t("{count} schema gaps", {
              count: String(data.readiness.checks.missingManagedTables.length),
            })}
            icon={ServerCogIcon}
            state={data.readiness.ready ? "passed" : "blocked"}
          />
          <SummaryCard
            title={t("Beta accounts")}
            value={String(data.controlPlane.accounts.length)}
            detail={t("{count} waiting", {
              count: String(data.controlPlane.waitlist.length),
            })}
            icon={UsersIcon}
            state="active"
          />
          <SummaryCard
            title={t("Breakers requiring attention")}
            value={String(openBreakers)}
            detail={t("The server has the final say")}
            icon={BanIcon}
            state={openBreakers ? "open" : "closed"}
          />
          <SummaryCard
            title={t("Deployed evidence")}
            value={String(liveEvidence)}
            detail={t("Repository fixtures are excluded")}
            icon={ArchiveRestoreIcon}
            state={liveEvidence ? "passed" : "blocked"}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 @4xl/main:grid-cols-4">
          <SummaryCard
            title={t("Queued worker jobs")}
            value={String(queuedJobs)}
            detail={t("Across every advertised managed pool")}
            icon={GaugeIcon}
            state={queuedJobs > 0 ? "active" : "closed"}
          />
          <SummaryCard
            title={t("Active reservations")}
            value={String(activeReservations)}
            detail={t("Estimated capacity awaiting settlement")}
            icon={Clock3Icon}
            state={activeReservations > 0 ? "active" : "closed"}
          />
          <SummaryCard
            title={t("Deletion backlog")}
            value={String(deletionBacklog)}
            detail={t("Targets without a verified completion state")}
            icon={Trash2Icon}
            state={deletionBacklog > 0 ? "open" : "closed"}
          />
          <SummaryCard
            title={t("Managed storage")}
            value={String(managedStorageBytes)}
            detail={t("Total stored, across everything active")}
            icon={CloudCogIcon}
            state="active"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("Operational queues and capacity")}</CardTitle>
            <CardDescription>
              {t(
                "Worker saturation, reservation settlement, privacy deletion and storage remain visible as separate ledgers."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
            <CompactRows
              title={t("Worker pools")}
              rows={data.pools}
              primary="pool"
              secondary="capability"
              state="status"
            />
            <CompactRows
              title={t("Reservation states")}
              rows={data.reservations}
              primary="status"
              secondary="oldestExpiry"
              state="status"
            />
            <CompactRows
              title={t("Deletion backlog")}
              rows={data.deletionBacklog}
              primary="state"
              secondary="oldestUpdate"
              state="state"
            />
            <CompactRows
              title={t("Storage categories")}
              rows={data.storage}
              primary="category"
              secondary="bytes"
            />
          </CardContent>
        </Card>

        <Tabs defaultValue="access" className="gap-4">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="access">{t("Access & cohorts")}</TabsTrigger>
            <TabsTrigger value="limits">{t("Limits & breakers")}</TabsTrigger>
            <TabsTrigger value="operations">
              {t("Operations & evidence")}
            </TabsTrigger>
            <TabsTrigger value="billing">{t("Billing test mode")}</TabsTrigger>
            <TabsTrigger value="correlation">{t("Correlation")}</TabsTrigger>
          </TabsList>

          <TabsContent value="access" className="flex flex-col gap-4">
            <fieldset
              className="contents"
              disabled={!isOnline}
              aria-disabled={!isOnline}
            >
              <InvitePanel
                data={data}
                pending={issueInvite.isPending}
                issuedToken={issuedToken}
                dismissToken={() => setIssuedToken(null)}
                issue={(input) => issueInvite.mutate(input)}
              />
              <AccessTables
                data={data}
                revoke={(inviteId) =>
                  revokeInvite.mutate({
                    inviteId,
                    justification: "Operator revoked unused beta invitation",
                  })
                }
                revokePending={revokeInvite.isPending}
                setState={(account, state) =>
                  setAccountPolicy.mutate({
                    accountId: account.accountId,
                    state,
                    capabilities: account.capabilities,
                    policyRevision: `${account.policyRevision}-operator`,
                    justification: `Operator changed managed beta state to ${state}`,
                  })
                }
                statePending={setAccountPolicy.isPending}
              />
            </fieldset>
          </TabsContent>

          <TabsContent value="limits" className="flex flex-col gap-4">
            <fieldset
              className="contents"
              disabled={!isOnline}
              aria-disabled={!isOnline}
            >
              <LimitForms
                data={data}
                quotaPending={quota.isPending}
                breakerPending={breaker.isPending}
                reconcilePending={reconcile.isPending}
                setQuota={(input) => quota.mutate(input)}
                setBreaker={(input) => breaker.mutate(input)}
                reconcile={() =>
                  reconcile.mutate({
                    limit: 250,
                    justification: "Manual cleanup from the admin console",
                  })
                }
              />
            </fieldset>
          </TabsContent>

          <TabsContent value="operations" className="flex flex-col gap-4">
            <fieldset
              className="contents"
              disabled={!isOnline}
              aria-disabled={!isOnline}
            >
              <OperationsPanel
                data={data}
                evidencePending={evidence.isPending}
                gatePending={gate.isPending}
                incidentPending={incident.isPending}
                recordEvidence={(input) => evidence.mutate(input)}
                setGate={(input) => gate.mutate(input)}
                createIncident={(input) => incident.mutate(input)}
              />
            </fieldset>
          </TabsContent>

          <TabsContent value="billing">
            <BillingPanel data={data} />
          </TabsContent>

          <TabsContent value="correlation">
            <fieldset
              className="contents"
              disabled={!isOnline}
              aria-disabled={!isOnline}
            >
              <CorrelationPanel
                pending={correlate.isPending}
                result={correlationResult}
                search={(operationId) => correlate.mutate({ operationId })}
              />
            </fieldset>
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

function SummaryCard({
  title,
  value,
  detail,
  icon: Icon,
  state,
}: {
  title: string
  value: string
  detail: string
  icon: typeof CloudCogIcon
  state: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4" />
          {title}
        </CardTitle>
        <CardAction>
          <Badge variant={variantForState(state)}>{value}</Badge>
        </CardAction>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
    </Card>
  )
}

type InviteInput = {
  email?: string
  cohort: string
  region: string
  capabilities: ManagedCapability[]
  termsRevision: string
  privacyRevision: string
  expiresAt: Date
}

function InvitePanel({
  data,
  pending,
  issuedToken,
  dismissToken,
  issue,
}: {
  data: ManagedOperationsData
  pending: boolean
  issuedToken: string | null
  dismissToken: () => void
  issue: (input: InviteInput) => void
}) {
  const t = useExtracted()
  const [email, setEmail] = useState("")
  const [cohort, setCohort] = useState("beta-b")
  const [region, setRegion] = useState("eu-west")
  const [expiresAt, setExpiresAt] = useState(inDays(7))
  const [capabilities, setCapabilities] = useState<ManagedCapability[]>([
    "storage.bytes",
    "ocr.pages",
    "model.inputTokens",
    "model.outputTokens",
  ])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    issue({
      ...(email.trim() ? { email: email.trim() } : {}),
      cohort: cohort.trim(),
      region: region.trim(),
      capabilities,
      termsRevision: data.readiness.mode.betaEnforcementEnabled
        ? "managed-beta/1"
        : "managed-beta/1",
      privacyRevision: "managed-privacy/1",
      expiresAt: new Date(expiresAt),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Issue a one-time invitation")}</CardTitle>
        <CardDescription>
          {t(
            "Optional email binding is stored as a digest. The plaintext token is returned once."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {issuedToken ? (
          <Alert className="mb-4">
            <KeyRoundIcon />
            <AlertTitle>{t("Copy this invitation token now")}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <code className="rounded bg-muted p-2 text-xs break-all">
                {issuedToken}
              </code>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(issuedToken)
                    toast.success(t("Invitation token copied."))
                  }}
                >
                  <ClipboardIcon data-icon="inline-start" />
                  {t("Copy")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={dismissToken}
                >
                  {t("I stored it")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup className="grid grid-cols-1 gap-4 @2xl/main:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="managed-invite-email">
                {t("Bound email (optional)")}
              </FieldLabel>
              <Input
                id="managed-invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="managed-invite-cohort">
                {t("Cohort")}
              </FieldLabel>
              <Input
                id="managed-invite-cohort"
                value={cohort}
                onChange={(event) => setCohort(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="managed-invite-region">
                {t("Region")}
              </FieldLabel>
              <Input
                id="managed-invite-region"
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="managed-invite-expiry">
                {t("Expires at")}
              </FieldLabel>
              <Input
                id="managed-invite-expiry"
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                required
              />
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel>{t("Eligible capabilities")}</FieldLabel>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 @4xl/main:grid-cols-3">
              {CAPABILITIES.map((capability) => (
                <Field key={capability} orientation="horizontal">
                  <Checkbox
                    id={`invite-${capability}`}
                    checked={capabilities.includes(capability)}
                    onCheckedChange={(checked) =>
                      setCapabilities((current) =>
                        checked
                          ? [...new Set([...current, capability])]
                          : current.filter((item) => item !== capability)
                      )
                    }
                  />
                  <FieldLabel htmlFor={`invite-${capability}`}>
                    {capability}
                  </FieldLabel>
                </Field>
              ))}
            </div>
          </Field>
          <Button
            type="submit"
            className="self-start"
            disabled={pending || capabilities.length === 0}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <KeyRoundIcon data-icon="inline-start" />
            )}
            {t("Issue invitation")}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function AccessTables({
  data,
  revoke,
  revokePending,
  setState,
  statePending,
}: {
  data: ManagedOperationsData
  revoke: (inviteId: string) => void
  revokePending: boolean
  setState: (
    account: ManagedOperationsData["controlPlane"]["accounts"][number],
    state: "active" | "suspended" | "left"
  ) => void
  statePending: boolean
}) {
  const t = useExtracted()
  return (
    <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("Invitations")}</CardTitle>
          <CardDescription>
            {t("Tokens are never recoverable from this table.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Cohort")}</TableHead>
                <TableHead>{t("Region")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead className="text-right">{t("Action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.controlPlane.invites.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell>{invite.cohort}</TableCell>
                  <TableCell>{invite.region}</TableCell>
                  <TableCell>
                    <Badge variant={variantForState(invite.status)}>
                      {invite.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {invite.status === "issued" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={revokePending}
                        onClick={() => revoke(invite.id)}
                      >
                        {t("Revoke")}
                      </Button>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Beta accounts")}</CardTitle>
          <CardDescription>
            {t(
              "Suspension blocks managed dispatch only; academic Core remains available."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Account")}</TableHead>
                <TableHead>{t("Cohort")}</TableHead>
                <TableHead>{t("State")}</TableHead>
                <TableHead className="text-right">{t("Action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.controlPlane.accounts.map((account) => (
                <TableRow key={account.accountId}>
                  <TableCell className="max-w-36 truncate font-mono text-xs">
                    {account.accountId}
                  </TableCell>
                  <TableCell>{account.cohort}</TableCell>
                  <TableCell>
                    <Badge variant={variantForState(account.state)}>
                      {account.state}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={statePending || account.state === "left"}
                      onClick={() =>
                        setState(
                          account,
                          account.state === "suspended" ? "active" : "suspended"
                        )
                      }
                    >
                      {account.state === "suspended"
                        ? t("Resume")
                        : t("Suspend")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

type QuotaInput = {
  scope: "global" | "account" | "cohort" | "provider" | "capability"
  scopeId: string
  capability: "*" | ManagedCapability
  period: "daily" | "monthly"
  hardLimit: string
  concurrency: number
  enabled: boolean
  revision: string
  justification: string
}

type BreakerInput = {
  scope: "global" | "account" | "provider" | "capability"
  scopeId: string
  state: "open" | "closed" | "half-open"
  reasonCode: string
  expiresAt: Date | null
  justification: string
}

function LimitForms({
  data,
  quotaPending,
  breakerPending,
  reconcilePending,
  setQuota,
  setBreaker,
  reconcile,
}: {
  data: ManagedOperationsData
  quotaPending: boolean
  breakerPending: boolean
  reconcilePending: boolean
  setQuota: (input: QuotaInput) => void
  setBreaker: (input: BreakerInput) => void
  reconcile: () => void
}) {
  const t = useExtracted()
  const [scope, setScope] = useState<QuotaInput["scope"]>("global")
  const [scopeId, setScopeId] = useState("managed")
  const [capability, setCapability] = useState<QuotaInput["capability"]>("*")
  const [period, setPeriod] = useState<QuotaInput["period"]>("daily")
  const [hardLimit, setHardLimit] = useState("10000")
  const [concurrency, setConcurrency] = useState("5")
  const [breakerScope, setBreakerScope] =
    useState<BreakerInput["scope"]>("global")
  const [breakerScopeId, setBreakerScopeId] = useState("managed")
  const [breakerState, setBreakerState] =
    useState<BreakerInput["state"]>("open")

  return (
    <>
      <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("Revisioned quota policy")}</CardTitle>
            <CardDescription>
              {t(
                "Daily or monthly caps are checked before every costly dispatch."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                setQuota({
                  scope,
                  scopeId,
                  capability,
                  period,
                  hardLimit,
                  concurrency: Number(concurrency),
                  enabled: true,
                  revision: `operator-${Date.now()}`,
                  justification: "Operator quota policy update",
                })
              }}
            >
              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{t("Scope")}</FieldLabel>
                  <SelectControl
                    value={scope}
                    onValueChange={(value) =>
                      setScope(value as QuotaInput["scope"])
                    }
                    options={[
                      "global",
                      "account",
                      "cohort",
                      "provider",
                      "capability",
                    ].map((value) => ({ value, label: value }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="quota-scope-id">
                    {t("Scope ID")}
                  </FieldLabel>
                  <Input
                    id="quota-scope-id"
                    value={scopeId}
                    onChange={(event) => setScopeId(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("Capability")}</FieldLabel>
                  <SelectControl
                    value={capability}
                    onValueChange={(value) =>
                      setCapability(value as QuotaInput["capability"])
                    }
                    options={["*", ...CAPABILITIES].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("Period")}</FieldLabel>
                  <SelectControl
                    value={period}
                    onValueChange={(value) =>
                      setPeriod(value as QuotaInput["period"])
                    }
                    options={["daily", "monthly"].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="quota-hard-limit">
                    {t("Hard limit")}
                  </FieldLabel>
                  <Input
                    id="quota-hard-limit"
                    inputMode="numeric"
                    value={hardLimit}
                    onChange={(event) => setHardLimit(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="quota-concurrency">
                    {t("Concurrency")}
                  </FieldLabel>
                  <Input
                    id="quota-concurrency"
                    inputMode="numeric"
                    value={concurrency}
                    onChange={(event) => setConcurrency(event.target.value)}
                    required
                  />
                </Field>
              </FieldGroup>
              <Button
                type="submit"
                className="self-start"
                disabled={quotaPending}
              >
                {quotaPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <GaugeIcon data-icon="inline-start" />
                )}
                {t("Save quota")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Circuit breaker")}</CardTitle>
            <CardDescription>
              {t(
                "Open a global, account, provider or capability breaker without changing academic access."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                setBreaker({
                  scope: breakerScope,
                  scopeId: breakerScopeId,
                  state: breakerState,
                  reasonCode: "OPERATOR_CONSOLE",
                  expiresAt: null,
                  justification: `Operator set ${breakerScope}:${breakerScopeId} to ${breakerState}`,
                })
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel>{t("Scope")}</FieldLabel>
                  <SelectControl
                    value={breakerScope}
                    onValueChange={(value) =>
                      setBreakerScope(value as BreakerInput["scope"])
                    }
                    options={[
                      "global",
                      "account",
                      "provider",
                      "capability",
                    ].map((value) => ({ value, label: value }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="breaker-scope-id">
                    {t("Scope ID")}
                  </FieldLabel>
                  <Input
                    id="breaker-scope-id"
                    value={breakerScopeId}
                    onChange={(event) => setBreakerScopeId(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("Target state")}</FieldLabel>
                  <SelectControl
                    value={breakerState}
                    onValueChange={(value) =>
                      setBreakerState(value as BreakerInput["state"])
                    }
                    options={["open", "half-open", "closed"].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Field>
              </FieldGroup>
              <Button
                type="submit"
                variant={breakerState === "open" ? "destructive" : "default"}
                className="self-start"
                disabled={breakerPending}
              >
                {breakerPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <BanIcon data-icon="inline-start" />
                )}
                {t("Update breaker")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("Enforcement state")}</CardTitle>
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              disabled={reconcilePending}
              onClick={reconcile}
            >
              {reconcilePending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              {t("Reconcile expired")}
            </Button>
          </CardAction>
          <CardDescription>
            {t("Running this again changes nothing and erases nothing.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
          <CompactRows
            title={t("Quota policies")}
            rows={data.controlPlane.quotas}
            primary="scopeId"
            secondary="capability"
            state="enabled"
          />
          <CompactRows
            title={t("Circuit breakers")}
            rows={data.circuitBreakers}
            primary="scopeId"
            secondary="scope"
            state="state"
          />
        </CardContent>
      </Card>
    </>
  )
}

type EvidenceInput = {
  kind:
    | "provider"
    | "isolation"
    | "backup"
    | "restore"
    | "load"
    | "privacy"
    | "alert"
    | "billing-test"
    | "airgap"
  environment: string
  region?: string
  provider?: string
  releaseRevision: string
  status: "unverified" | "blocked" | "running" | "passed" | "failed" | "stale"
  source:
    | "repository-fixture"
    | "deployed-drill"
    | "external-attestation"
    | "operator-observation"
  safeSummary: string
  metrics: Record<string, string | number | boolean | null>
  observedAt: Date
  expiresAt?: Date
}

type GateInput = {
  key: string
  phase: "A" | "B" | "C" | "D" | "E"
  status: "blocked" | "pending" | "passed"
  evidenceId?: string
  justification: string
}

type IncidentInput = {
  title: string
  safeSummary: string
  severity: "minor" | "major" | "critical"
  status: "investigating" | "identified" | "monitoring" | "resolved"
  affectedCapabilities: ManagedCapability[]
  provider?: string
  publiclyVisible: boolean
  startedAt: Date
}

function OperationsPanel({
  data,
  evidencePending,
  gatePending,
  incidentPending,
  recordEvidence,
  setGate,
  createIncident,
}: {
  data: ManagedOperationsData
  evidencePending: boolean
  gatePending: boolean
  incidentPending: boolean
  recordEvidence: (input: EvidenceInput) => void
  setGate: (input: GateInput) => void
  createIncident: (input: IncidentInput) => void
}) {
  const t = useExtracted()
  const [evidenceKind, setEvidenceKind] =
    useState<EvidenceInput["kind"]>("backup")
  const [evidenceStatus, setEvidenceStatus] =
    useState<EvidenceInput["status"]>("blocked")
  const [evidenceSource, setEvidenceSource] =
    useState<EvidenceInput["source"]>("repository-fixture")
  const [environment, setEnvironment] = useState("staging")
  const [revision, setRevision] = useState("unrecorded")
  const [summary, setSummary] = useState(
    "No deployed drill evidence has been attached."
  )
  const [metrics, setMetrics] = useState("{}")
  const [gateKey, setGateKey] = useState("phase-a.providers")
  const [phase, setPhase] = useState<GateInput["phase"]>("A")
  const [gateStatus, setGateStatus] = useState<GateInput["status"]>("blocked")
  const [gateEvidence, setGateEvidence] = useState("")
  const [incidentTitle, setIncidentTitle] = useState("")
  const [incidentSummary, setIncidentSummary] = useState("")
  const [incidentSeverity, setIncidentSeverity] =
    useState<IncidentInput["severity"]>("minor")
  const [incidentStatus, setIncidentStatus] =
    useState<IncidentInput["status"]>("investigating")
  const [incidentCapability, setIncidentCapability] =
    useState<ManagedCapability>("storage.bytes")

  const backupEvidence = data.controlPlane.evidence.filter((item) =>
    ["backup", "restore"].includes(String(item.kind))
  )
  const latestRestore = backupEvidence.find(
    (item) => String(item.kind) === "restore"
  )

  return (
    <>
      <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-3">
        <SummaryCard
          title={t("Backup freshness")}
          value={
            backupEvidence[0] ? scalar(backupEvidence[0].status) : t("Blocked")
          }
          detail={
            backupEvidence[0]
              ? scalar(backupEvidence[0].safeSummary)
              : t("No deployed backup evidence")
          }
          icon={ArchiveRestoreIcon}
          state={
            backupEvidence[0] ? scalar(backupEvidence[0].status) : "blocked"
          }
        />
        <SummaryCard
          title={t("Restore drill")}
          value={latestRestore ? scalar(latestRestore.status) : t("Blocked")}
          detail={
            latestRestore
              ? scalar(latestRestore.source)
              : t("No deployed restore drill")
          }
          icon={CheckCircle2Icon}
          state={latestRestore ? scalar(latestRestore.status) : "blocked"}
        />
        <SummaryCard
          title={t("Public incidents")}
          value={String(
            data.controlPlane.incidents.filter(
              (item) =>
                Number(item.publiclyVisible) === 1 &&
                String(item.status) !== "resolved"
            ).length
          )}
          detail={t("Only redacted summaries are public")}
          icon={SirenIcon}
          state="active"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("Record redacted evidence")}</CardTitle>
            <CardDescription>
              {t(
                "A repository fixture can be useful evidence but can never pass a launch gate."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                let parsedMetrics: Record<
                  string,
                  string | number | boolean | null
                >
                try {
                  parsedMetrics = JSON.parse(metrics) as Record<
                    string,
                    string | number | boolean | null
                  >
                } catch {
                  toast.error(t("Metrics must be valid JSON."))
                  return
                }
                recordEvidence({
                  kind: evidenceKind,
                  environment,
                  releaseRevision: revision,
                  status: evidenceStatus,
                  source: evidenceSource,
                  safeSummary: summary,
                  metrics: parsedMetrics,
                  observedAt: new Date(),
                })
              }}
            >
              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{t("Kind")}</FieldLabel>
                  <SelectControl
                    value={evidenceKind}
                    onValueChange={(value) =>
                      setEvidenceKind(value as EvidenceInput["kind"])
                    }
                    options={[
                      "provider",
                      "isolation",
                      "backup",
                      "restore",
                      "load",
                      "privacy",
                      "alert",
                      "billing-test",
                      "airgap",
                    ].map((value) => ({ value, label: value }))}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("Status")}</FieldLabel>
                  <SelectControl
                    value={evidenceStatus}
                    onValueChange={(value) =>
                      setEvidenceStatus(value as EvidenceInput["status"])
                    }
                    options={[
                      "unverified",
                      "blocked",
                      "running",
                      "passed",
                      "failed",
                      "stale",
                    ].map((value) => ({ value, label: value }))}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("Evidence source")}</FieldLabel>
                  <SelectControl
                    value={evidenceSource}
                    onValueChange={(value) =>
                      setEvidenceSource(value as EvidenceInput["source"])
                    }
                    options={[
                      "repository-fixture",
                      "deployed-drill",
                      "external-attestation",
                      "operator-observation",
                    ].map((value) => ({ value, label: value }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="evidence-environment">
                    {t("Environment")}
                  </FieldLabel>
                  <Input
                    id="evidence-environment"
                    value={environment}
                    onChange={(event) => setEnvironment(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="evidence-revision">
                    {t("Release revision")}
                  </FieldLabel>
                  <Input
                    id="evidence-revision"
                    value={revision}
                    onChange={(event) => setRevision(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="evidence-metrics">
                    {t("Safe metrics JSON")}
                  </FieldLabel>
                  <Input
                    id="evidence-metrics"
                    value={metrics}
                    onChange={(event) => setMetrics(event.target.value)}
                    required
                  />
                </Field>
              </FieldGroup>
              <Field>
                <FieldLabel htmlFor="evidence-summary">
                  {t("Redacted summary")}
                </FieldLabel>
                <Textarea
                  id="evidence-summary"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  required
                />
                <FieldDescription>
                  {t(
                    "Do not paste prompts, files, chat content, credentials or personal data."
                  )}
                </FieldDescription>
              </Field>
              <Button
                type="submit"
                className="self-start"
                disabled={evidencePending}
              >
                {evidencePending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <ArchiveRestoreIcon data-icon="inline-start" />
                )}
                {t("Record evidence")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Evidence-bound launch gate")}</CardTitle>
            <CardDescription>
              {t(
                "Passing requires current deployed-drill or external-attestation evidence."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                setGate({
                  key: gateKey,
                  phase,
                  status: gateStatus,
                  ...(gateEvidence.trim()
                    ? { evidenceId: gateEvidence.trim() }
                    : {}),
                  justification: `Operator set ${gateKey} to ${gateStatus}`,
                })
              }}
            >
              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="gate-key">{t("Gate key")}</FieldLabel>
                  <Input
                    id="gate-key"
                    value={gateKey}
                    onChange={(event) => setGateKey(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("Phase")}</FieldLabel>
                  <SelectControl
                    value={phase}
                    onValueChange={(value) =>
                      setPhase(value as GateInput["phase"])
                    }
                    options={["A", "B", "C", "D", "E"].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("Status")}</FieldLabel>
                  <SelectControl
                    value={gateStatus}
                    onValueChange={(value) =>
                      setGateStatus(value as GateInput["status"])
                    }
                    options={["blocked", "pending", "passed"].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="gate-evidence">
                    {t("Evidence ID")}
                  </FieldLabel>
                  <Input
                    id="gate-evidence"
                    value={gateEvidence}
                    onChange={(event) => setGateEvidence(event.target.value)}
                    placeholder={t("Required to pass")}
                  />
                </Field>
              </FieldGroup>
              <Button
                type="submit"
                className="self-start"
                disabled={gatePending}
              >
                {gatePending ? <Spinner data-icon="inline-start" /> : null}
                {t("Update gate")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("Publish a redacted incident")}</CardTitle>
          <CardDescription>
            {t(
              "This screen never accepts customer content; only a safe status summary."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              createIncident({
                title: incidentTitle,
                safeSummary: incidentSummary,
                severity: incidentSeverity,
                status: incidentStatus,
                affectedCapabilities: [incidentCapability],
                publiclyVisible: true,
                startedAt: new Date(),
              })
            }}
          >
            <Field>
              <FieldLabel htmlFor="incident-title">{t("Title")}</FieldLabel>
              <Input
                id="incident-title"
                value={incidentTitle}
                onChange={(event) => setIncidentTitle(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel>{t("Capability")}</FieldLabel>
              <SelectControl
                value={incidentCapability}
                onValueChange={(value) =>
                  setIncidentCapability(value as ManagedCapability)
                }
                options={CAPABILITIES.map((value) => ({ value, label: value }))}
              />
            </Field>
            <Field>
              <FieldLabel>{t("Severity")}</FieldLabel>
              <SelectControl
                value={incidentSeverity}
                onValueChange={(value) =>
                  setIncidentSeverity(value as IncidentInput["severity"])
                }
                options={["minor", "major", "critical"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Field>
            <Field>
              <FieldLabel>{t("Status")}</FieldLabel>
              <SelectControl
                value={incidentStatus}
                onValueChange={(value) =>
                  setIncidentStatus(value as IncidentInput["status"])
                }
                options={[
                  "investigating",
                  "identified",
                  "monitoring",
                  "resolved",
                ].map((value) => ({ value, label: value }))}
              />
            </Field>
            <Field className="@4xl/main:col-span-2">
              <FieldLabel htmlFor="incident-summary">
                {t("Public safe summary")}
              </FieldLabel>
              <Textarea
                id="incident-summary"
                value={incidentSummary}
                onChange={(event) => setIncidentSummary(event.target.value)}
                required
              />
            </Field>
            <Button
              type="submit"
              className="self-start"
              disabled={incidentPending}
            >
              {incidentPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SirenIcon data-icon="inline-start" />
              )}
              {t("Publish incident status")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Operational evidence and gates")}</CardTitle>
          <CardDescription>
            {t(
              "Sources and statuses are shown verbatim so blocked evidence cannot look green."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
          <CompactRows
            title={t("Evidence")}
            rows={data.controlPlane.evidence}
            primary="kind"
            secondary="source"
            state="status"
          />
          <CompactRows
            title={t("Launch gates")}
            rows={data.controlPlane.gates}
            primary="key"
            secondary="phase"
            state="status"
          />
        </CardContent>
      </Card>
    </>
  )
}

function BillingPanel({ data }: { data: ManagedOperationsData }) {
  const t = useExtracted()
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <ReceiptTextIcon />
        <AlertTitle>{t("Test-mode boundary only")}</AlertTitle>
        <AlertDescription>
          {t(
            "Checkout and portal routes are absent. Subscription observations and webhooks are evidence, never entitlement authority."
          )}
        </AlertDescription>
      </Alert>
      <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("Webhook inbox")}</CardTitle>
            <CardDescription>
              {t(
                "Duplicate callbacks are dropped before anything is recorded."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompactRows
              title={t("Inbox states")}
              rows={data.billingInbox}
              primary="status"
              secondary="oldestReceived"
              state="status"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("External price mappings")}</CardTitle>
            <CardDescription>
              {t(
                "These links cannot be edited, and they grant no access on their own."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompactRows
              title={t("Mappings")}
              rows={data.priceMappings}
              primary="planRevision"
              secondary="provider"
              state="active"
            />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("Commercial gates")}</CardTitle>
          <CardDescription>{data.commercial.note}</CardDescription>
          <CardAction>
            <Badge variant="destructive">{t("Checkout off")}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatusFact
            label={t("Checkout enabled")}
            value={data.commercial.checkoutEnabled}
          />
          <StatusFact
            label={t("Billing enabled")}
            value={data.commercial.billingEnabled}
          />
          <StatusFact
            label={t("Launch ready")}
            value={data.commercial.launchReady}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function CorrelationPanel({
  pending,
  result,
  search,
}: {
  pending: boolean
  result: {
    operationId: string
    reservations: Record<string, unknown>[]
    usageEvents: Record<string, unknown>[]
    auditEvents: Record<string, unknown>[]
    contentIncluded: boolean
  } | null
  search: (operationId: string) => void
}) {
  const t = useExtracted()
  const [operationId, setOperationId] = useState("")
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Redacted operation correlation")}</CardTitle>
        <CardDescription>
          {t(
            "Track what was reserved, used and logged, by operation ID. The contents themselves are never included."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            search(operationId.trim())
          }}
        >
          <Input
            aria-label={t("Operation ID")}
            value={operationId}
            onChange={(event) => setOperationId(event.target.value)}
            placeholder="run_… / job_… / urv_…"
            required
          />
          <Button type="submit" disabled={pending || !operationId.trim()}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <FileSearchIcon data-icon="inline-start" />
            )}
            {t("Search")}
          </Button>
        </form>
        {result ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatusFact
              label={t("Reservations")}
              value={result.reservations.length}
            />
            <StatusFact
              label={t("Usage events")}
              value={result.usageEvents.length}
            />
            <StatusFact
              label={t("Audit events")}
              value={result.auditEvents.length}
            />
            <Alert className="sm:col-span-3">
              <ShieldAlertIcon />
              <AlertTitle>{t("Content access")}</AlertTitle>
              <AlertDescription>
                {result.contentIncluded
                  ? t("Unexpected content included")
                  : t("No content included")}
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileSearchIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No operation selected")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Paste an ID shown to the user; no document or prompt text will be returned."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}

function StatusFact({ label, value }: { label: string; value: unknown }) {
  const t = useExtracted()
  const boolean = typeof value === "boolean"
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium tabular-nums">
        {boolean ? (value ? t("Yes") : t("No")) : scalar(value)}
      </p>
    </div>
  )
}

function CompactRows({
  title,
  rows,
  primary,
  secondary,
  state,
}: {
  title: string
  rows: readonly Record<string, unknown>[]
  primary: string
  secondary: string
  state?: string
}) {
  const t = useExtracted()
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{t("No recorded state")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{title}</p>
      {rows.slice(0, 20).map((row, index) => (
        <div
          key={`${scalar(row[primary])}-${index}`}
          className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
        >
          <div className="min-w-0">
            <p className="truncate font-medium">{scalar(row[primary])}</p>
            <p className="truncate text-xs text-muted-foreground">
              {scalar(row[secondary])}
            </p>
          </div>
          {state ? (
            <Badge variant={variantForState(scalar(row[state]))}>
              {scalar(row[state])}
            </Badge>
          ) : null}
        </div>
      ))}
    </div>
  )
}
