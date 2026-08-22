"use client"

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2Icon,
  CloudDownloadIcon,
  CopyIcon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { SelectField } from "@/components/forms/controls"
import { SettingsSection } from "@/components/settings/settings-section"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useYear } from "@/components/year/year-provider"
import { copyText } from "@/lib/clipboard"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { syncConnectionsInput, syncStatusInput } from "@/lib/route-query-inputs"
import {
  isActiveSyncJob,
  isTerminalSyncJob,
  moodleMobileLaunchUrl,
  readSyncRunSummary,
} from "./moodle-sync-model"

interface MoodleConnectionSummary {
  id: string
  provider: "moodle" | "ecoledirecte" | "pronote" | "skolengo"
  label: string
  baseUrl: string
  status: "pending" | "active" | "error" | "revoked" | "disconnected"
  lastSyncAt: Date | null
  lastError: string | null
  hasCustomCa: boolean
}

function MoodleConnectionCard({
  connection,
  yearId,
  disconnecting,
  onDisconnect,
  onReconnect,
}: {
  connection: MoodleConnectionSummary
  yearId: string
  disconnecting: boolean
  onDisconnect: (connection: MoodleConnectionSummary) => void
  onReconnect: (connection: MoodleConnectionSummary) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)
  const reportedJobId = useRef<string | null>(null)
  const statusInput = syncStatusInput(connection.id)
  const status = useQuery({
    ...orpc.sync.status.queryOptions({ input: statusInput }),
    staleTime: 10_000,
    refetchInterval: (query) =>
      isActiveSyncJob(query.state.data?.lastJob?.status) ? 1_500 : false,
  })
  const job = useQuery({
    ...orpc.jobs.get.queryOptions({ input: { jobId: jobId ?? "" } }),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      isActiveSyncJob(query.state.data?.status) ? 1_500 : false,
  })

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.sync.status.queryKey({
          input: syncStatusInput(connection.id),
        }),
        exact: true,
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.sync.connections.list.queryKey({
          input: syncConnectionsInput(yearId),
        }),
        exact: true,
      }),
    ])
  }, [connection.id, queryClient, yearId])
  const run = useMutation({
    ...orpc.sync.run.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      const queued = isActiveSyncJob(result.status)
      const alreadySucceeded = result.status === "succeeded"
      reportedJobId.current = alreadySucceeded ? result.jobId : null
      setJobId(alreadySucceeded ? null : result.jobId)
      if (queued) {
        toast.success(t("Moodle synchronization queued."))
      } else if (alreadySucceeded) {
        toast.info(t("This hour's Moodle synchronization is already complete."))
      }
      await queryClient.invalidateQueries({
        queryKey: orpc.sync.status.queryKey({ input: statusInput }),
        exact: true,
      })
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("Moodle synchronization could not start."))
    },
  })

  const polledStatus = job.data?.status
  useEffect(() => {
    if (
      !jobId ||
      reportedJobId.current === jobId ||
      !isTerminalSyncJob(polledStatus)
    ) {
      return
    }
    reportedJobId.current = jobId
    const report = () => {
      setJobId((current) => (current === jobId ? null : current))
      if (polledStatus === "succeeded") {
        haptic("success")
        toast.success(t("Moodle synchronization finished."))
      } else {
        haptic("error")
        toast.error(
          job.data?.error || t("Moodle synchronization did not finish.")
        )
      }
    }
    void refresh().then(report, report)
  }, [job.data?.error, jobId, polledStatus, refresh, t])

  const current = status.data?.connection ?? connection
  const lastJob = job.data ?? status.data?.lastJob
  const result = readSyncRunSummary(lastJob?.result)
  const active = run.isPending || isActiveSyncJob(lastJob?.status)
  const reconnectRequired =
    current.status === "revoked" || current.status === "disconnected"
  const runnable = current.status === "active" || current.status === "error"
  const error = !active
    ? (run.error?.message ??
      job.error?.message ??
      lastJob?.error ??
      current.lastError)
    : null
  const badge = active
    ? { label: t("Synchronizing"), variant: "secondary" as const }
    : current.status === "error"
      ? { label: t("Needs attention"), variant: "destructive" as const }
      : reconnectRequired
        ? { label: t("Disconnected"), variant: "outline" as const }
        : current.status === "pending"
          ? { label: t("Setup required"), variant: "outline" as const }
          : { label: t("Connected"), variant: "secondary" as const }

  return (
    <article
      aria-busy={active}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-background p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <CloudDownloadIcon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium">{current.label}</h3>
            <Badge variant={badge.variant} role="status" aria-live="polite">
              {active ? <Spinner className="size-3" /> : null}
              {badge.label}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {current.baseUrl}
          </p>
        </div>
      </div>

      <div className="grid gap-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {t("Last synchronization")}
          </span>
          <span>
            {current.lastSyncAt
              ? format.dateTime(new Date(current.lastSyncAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : t("Never")}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">{t("Imported data")}</span>
          <span>{t("Course files")}</span>
        </div>
        {current.hasCustomCa ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheckIcon className="size-4 text-positive" aria-hidden />
            {t(
              "A custom certificate authority is trusted for this connection."
            )}
          </div>
        ) : null}
      </div>

      {result ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "Last run: {downloaded} downloaded, {updated} updated, {skipped} unchanged, {failed} failed.",
            {
              downloaded: String(result.downloaded),
              updated: String(result.updated),
              skipped: String(result.skipped),
              failed: String(result.errors.length),
            }
          )}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs leading-relaxed text-destructive">
          {error}
        </p>
      ) : status.error ? (
        <p role="alert" className="text-xs leading-relaxed text-destructive">
          {t("The latest Moodle status could not be loaded.")}
        </p>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 sm:flex-row">
        {reconnectRequired ? (
          <Button
            type="button"
            size="sm"
            className="flex-1"
            disabled={disconnecting}
            onClick={() => onReconnect(current)}
          >
            <RefreshCwIcon />
            {t("Reconnect")}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              className="flex-1"
              disabled={active || !runnable || disconnecting}
              onClick={() => run.mutate(statusInput)}
            >
              {active ? <Spinner /> : <RefreshCwIcon />}
              {active ? t("Synchronizing") : t("Synchronize now")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={active || disconnecting}
              onClick={() => onDisconnect(current)}
            >
              {disconnecting ? <Spinner /> : <Trash2Icon />}
              {t("Disconnect")}
            </Button>
          </>
        )}
      </div>
    </article>
  )
}

function MoodleConnectionDialog({
  open,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean
  pending: boolean
  error: string | null
  onClose: () => void
  onSubmit: (input: {
    baseUrl: string
    credentialInput: string
    caCertPem: string | null
  }) => void
}) {
  const t = useExtracted()
  const baseDescriptionId = useId()
  const tokenId = useId()
  const tokenDescriptionId = useId()
  const caId = useId()
  const caDescriptionId = useId()
  const [baseUrl, setBaseUrl] = useState("")
  const [credentialInput, setCredentialInput] = useState("")
  const [caCertPem, setCaCertPem] = useState("")
  const launchUrl = moodleMobileLaunchUrl(baseUrl)
  const invalidBaseUrl = Boolean(baseUrl && !launchUrl)

  const close = () => {
    if (pending) return
    setCredentialInput("")
    setCaCertPem("")
    setBaseUrl("")
    onClose()
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!launchUrl || !credentialInput.trim()) return
    onSubmit({
      baseUrl: baseUrl.trim(),
      credentialInput: credentialInput.trim(),
      caCertPem: caCertPem.trim() || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("Connect Moodle")}</DialogTitle>
            <DialogDescription>
              {t(
                "Sign in through Moodle's mobile hand-off. Avermate verifies the account before saving, then stores the token encrypted and never sends it back to this browser."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="my-5 flex flex-col gap-4">
            <SelectField
              label={t("Provider")}
              value="moodle"
              disabled
              onValueChange={() => undefined}
              options={[{ value: "moodle", label: "Moodle" }]}
            />
            <Field data-invalid={invalidBaseUrl || undefined}>
              <FieldLabel htmlFor="moodle-base-url">
                {t("Moodle site address")}
              </FieldLabel>
              <Input
                id="moodle-base-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                required
                aria-describedby={baseDescriptionId}
                aria-invalid={invalidBaseUrl || undefined}
                value={baseUrl}
                maxLength={2_048}
                placeholder="https://moodle.school.example"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
              <FieldDescription id={baseDescriptionId}>
                {t("Use the HTTPS address you normally open to reach Moodle.")}
              </FieldDescription>
            </Field>

            <ol className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm">
              <li className="flex gap-3">
                <span className="numeric grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs text-primary">
                  1
                </span>
                <span>
                  {t("Open Moodle's secure mobile sign-in for this site.")}
                </span>
              </li>
              <li className="flex gap-3">
                <span className="numeric grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs text-primary">
                  2
                </span>
                <span>
                  {t(
                    "After signing in, copy the entire address beginning with moodlemobile://token=."
                  )}
                </span>
              </li>
              <li className="flex gap-3">
                <span className="numeric grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs text-primary">
                  3
                </span>
                <span>{t("Return here and paste that address below.")}</span>
              </li>
            </ol>

            {launchUrl ? (
              <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
                <a
                  href={launchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm text-primary underline-offset-4 hover:underline"
                >
                  {launchUrl}
                </a>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void copyText(launchUrl).then((copied) => {
                        if (copied) toast.success(t("Sign-in link copied."))
                      })
                    }}
                  >
                    <CopyIcon /> {t("Copy link")}
                  </Button>
                  <Button
                    size="sm"
                    render={
                      <a href={launchUrl} target="_blank" rel="noreferrer" />
                    }
                  >
                    <ExternalLinkIcon /> {t("Open sign-in")}
                  </Button>
                </div>
              </div>
            ) : baseUrl ? (
              <p role="alert" className="text-sm text-destructive">
                {t("Enter a valid HTTPS Moodle address to continue.")}
              </p>
            ) : null}

            <Field>
              <FieldLabel htmlFor={tokenId}>
                {t("Mobile token redirect")}
              </FieldLabel>
              <Textarea
                id={tokenId}
                value={credentialInput}
                rows={3}
                required
                autoComplete="off"
                aria-describedby={tokenDescriptionId}
                spellCheck={false}
                maxLength={16_384}
                placeholder="moodlemobile://token=…"
                onChange={(event) => setCredentialInput(event.target.value)}
              />
              <FieldDescription id={tokenDescriptionId}>
                {t(
                  "This value is cleared from the form as soon as it is saved."
                )}
              </FieldDescription>
            </Field>

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("Private certificate authority (optional)")}
              </summary>
              <Field className="mt-3">
                <FieldLabel htmlFor={caId}>
                  {t("PEM certificate chain")}
                </FieldLabel>
                <Textarea
                  id={caId}
                  value={caCertPem}
                  rows={5}
                  autoComplete="off"
                  aria-describedby={caDescriptionId}
                  spellCheck={false}
                  maxLength={128 * 1_024}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  onChange={(event) => setCaCertPem(event.target.value)}
                />
                <FieldDescription id={caDescriptionId}>
                  {t(
                    "Only use this when your school requires its own trusted CA. TLS verification always stays enabled."
                  )}
                </FieldDescription>
              </Field>
            </details>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={close}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              disabled={pending || !launchUrl || !credentialInput.trim()}
            >
              {pending ? <Spinner /> : <CheckCircle2Icon />}
              {pending ? t("Checking Moodle") : t("Connect securely")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function MoodleSyncSection() {
  const t = useExtracted()
  const { yearId } = useYear()
  const queryClient = useQueryClient()
  const [connectOpen, setConnectOpen] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [disconnectTarget, setDisconnectTarget] =
    useState<MoodleConnectionSummary | null>(null)
  const [reconnectTarget, setReconnectTarget] =
    useState<MoodleConnectionSummary | null>(null)
  const activeYearId = yearId ?? ""
  const listInput = syncConnectionsInput(activeYearId)
  const connections = useQuery({
    ...orpc.sync.connections.list.queryOptions({ input: listInput }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  const refreshConnections = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.sync.connections.list.queryKey({ input: listInput }),
      exact: true,
    })
  const create = useMutation(orpc.sync.connections.create.mutationOptions())
  const remove = useMutation({
    ...orpc.sync.connections.delete.mutationOptions(),
    onSuccess: async (_result, input) => {
      haptic("success")
      setDisconnectTarget(null)
      queryClient.removeQueries({
        queryKey: orpc.sync.status.queryKey({ input }),
        exact: true,
      })
      toast.success(t("Moodle disconnected."))
      await refreshConnections()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("Moodle could not be disconnected."))
    },
  })

  const connect = async (input: {
    baseUrl: string
    credentialInput: string
    caCertPem: string | null
  }) => {
    if (!yearId) return
    setConnectError(null)
    try {
      await create.mutateAsync({
        provider: "moodle",
        yearId,
        reconnectConnectionId: reconnectTarget?.id,
        ...input,
      })
      create.reset()
      haptic("success")
      setConnectOpen(false)
      setReconnectTarget(null)
      toast.success(t("Moodle connected."))
      await refreshConnections()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("Moodle could not be connected.")
      create.reset()
      setConnectError(message)
      haptic("error")
      toast.error(message)
    }
  }

  const rows: MoodleConnectionSummary[] = (connections.data ?? []).filter(
    (connection) => connection.provider === "moodle"
  )
  const openConnectionDialog = (
    connection: MoodleConnectionSummary | null = null
  ) => {
    create.reset()
    setConnectError(null)
    setReconnectTarget(connection)
    setConnectOpen(true)
  }

  return (
    <>
      <SettingsSection
        id="moodle"
        icon={CloudDownloadIcon}
        title={t("Connected services")}
        description={t(
          "Bring course files from school services into Materials. Credentials stay encrypted on the server."
        )}
        footer={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!yearId}
            onClick={() => openConnectionDialog()}
          >
            <PlusIcon /> {t("Connect Moodle")}
          </Button>
        }
      >
        {connections.isLoading ? (
          <div role="status" className="grid min-h-28 place-items-center">
            <Spinner />
            <span className="sr-only">{t("Loading connected services")}</span>
          </div>
        ) : connections.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t("Connected services could not be loaded.")}
          </p>
        ) : rows.length === 0 ? (
          <Empty className="min-h-36 border">
            <EmptyHeader>
              <EmptyTitle>{t("No school service connected")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Connect Moodle to import PDFs and course images into Materials."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-3 @lg/main:grid-cols-2">
            {rows.map((connection) => (
              <MoodleConnectionCard
                key={connection.id}
                connection={connection}
                yearId={activeYearId}
                disconnecting={
                  remove.isPending && disconnectTarget?.id === connection.id
                }
                onDisconnect={setDisconnectTarget}
                onReconnect={(target) => openConnectionDialog(target)}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      {connectOpen ? (
        <MoodleConnectionDialog
          open
          pending={create.isPending}
          error={connectError}
          onClose={() => {
            create.reset()
            setConnectError(null)
            setConnectOpen(false)
            setReconnectTarget(null)
          }}
          onSubmit={(input) => void connect(input)}
        />
      ) : null}

      <AlertDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDisconnectTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Disconnect Moodle?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Imported materials stay in Avermate, but this connection will no longer be able to update them."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending || disconnectTarget === null}
              onClick={(event) => {
                event.preventDefault()
                if (disconnectTarget) {
                  remove.mutate({ connectionId: disconnectTarget.id })
                }
              }}
            >
              {remove.isPending ? <Spinner /> : <Trash2Icon />}
              {t("Disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
