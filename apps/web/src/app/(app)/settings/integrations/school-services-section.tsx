"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  CalendarRangeIcon,
  DatabaseIcon,
  GraduationCapIcon,
  Link2OffIcon,
  LockKeyholeIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"
import { FULL_YEAR_PERIOD_ID } from "@avermate/core"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { SettingsSection } from "@/components/settings/settings-section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  ChoiceField,
  DateField,
  NumberField,
  SelectControl,
} from "@/components/forms/controls"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { syncConnectionsInput } from "@/lib/route-query-inputs"
import { isActiveSyncJob, isTerminalSyncJob } from "./moodle-sync-model"
import {
  linkedSubjectMappings,
  localSubjectSelectOptions,
  subjectMappingReviewCounts,
  subjectMappingsNeedingReview,
} from "./school-subject-mapping-model"
import {
  linkedPeriodMappings,
  periodMappingReviewCounts,
  periodMappingsNeedingReview,
} from "./school-period-mapping-model"
import {
  academicYearBoundary,
  academicYearDateValue,
  gradeRecordCounts,
  schoolConnectionState,
} from "./school-sync-onboarding-model"

type SchoolProviderId = "ecoledirecte" | "pronote" | "skolengo"

interface SchoolConnectionSummary {
  id: string
  provider: SchoolProviderId
  label: string
  status: "pending" | "active" | "error" | "revoked" | "disconnected"
  yearId: string | null
  gradesAuthority: boolean
  lastSyncAt: Date | null
  lastError: string | null
  capabilities: string[]
}

interface PendingSchoolConnection {
  id: string
  provider: SchoolProviderId
  label: string
}

interface EcoleDirecteChallenge {
  challengeId: string
  kind: "totp" | "question"
  question: string | null
  choices: string[]
  expiresAt: Date
}

interface LocalSubjectOption {
  id: string
  name: string
  shortName: string | null
  parentId: string | null
  kind: "subject" | "category"
}

interface LocalPeriodOption {
  id: string
  name: string
  startAt: Date
  endAt: Date
}

function providerName(provider: SchoolProviderId) {
  if (provider === "ecoledirecte") return "ÉcoleDirecte"
  if (provider === "pronote") return "PRONOTE"
  return "Skolengo"
}

function isSchoolProviderId(value: string): value is SchoolProviderId {
  return value === "ecoledirecte" || value === "pronote" || value === "skolengo"
}

function EcoleDirecteDialog({
  open,
  pending,
  error,
  challenge,
  onClose,
  onSubmit,
  onConfirm,
}: {
  open: boolean
  pending: boolean
  error: string | null
  challenge: EcoleDirecteChallenge | null
  onClose: () => void
  onSubmit: (input: {
    username: string
    password: string
    accountIndex: number
    timezone: string
  }) => void
  onConfirm: (response: string) => void
}) {
  const t = useExtracted()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [accountNumber, setAccountNumber] = useState("1")
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris"
    } catch {
      return "Europe/Paris"
    }
  })
  const [verificationResponse, setVerificationResponse] = useState("")

  const close = () => {
    if (pending) return
    setUsername("")
    setPassword("")
    setAccountNumber("1")
    setVerificationResponse("")
    onClose()
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (challenge) {
      if (!verificationResponse) return
      onConfirm(verificationResponse)
      return
    }
    const accountIndex = Number(accountNumber) - 1
    if (!username.trim() || !password || !Number.isInteger(accountIndex)) return
    if (!timezone.trim()) return
    onSubmit({
      username: username.trim(),
      password,
      accountIndex,
      timezone: timezone.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {challenge
                ? t("Verify the ÉcoleDirecte connection")
                : t("Connect ÉcoleDirecte")}
            </DialogTitle>
            <DialogDescription>
              {challenge
                ? t(
                    "The short-lived challenge stays on the server. Only your answer is sent to complete the connection."
                  )
                : t(
                    "Avermate checks the account directly with ÉcoleDirecte, then encrypts the credentials on the server. They are never returned to this browser."
                  )}
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-4">
            {challenge ? (
              <Field>
                <FieldLabel>
                  {challenge.kind === "totp"
                    ? t("Verification code")
                    : challenge.question || t("Choose the correct answer")}
                </FieldLabel>
                {challenge.kind === "totp" ? (
                  <Input
                    id="ecoledirecte-verification-code"
                    value={verificationResponse}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6,8}"
                    required
                    maxLength={8}
                    onChange={(event) =>
                      setVerificationResponse(event.target.value)
                    }
                  />
                ) : (
                  <div className="grid gap-2">
                    {challenge.choices.map((choice, index) => (
                      <label
                        key={`${index}:${choice}`}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <input
                          type="radio"
                          name="ecoledirecte-verification-answer"
                          value={index}
                          checked={verificationResponse === String(index)}
                          onChange={(event) =>
                            setVerificationResponse(event.target.value)
                          }
                        />
                        <span>{choice}</span>
                      </label>
                    ))}
                  </div>
                )}
                <FieldDescription>
                  {t("This verification request expires after five minutes.")}
                </FieldDescription>
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="ecoledirecte-username">
                    {t("Username")}
                  </FieldLabel>
                  <Input
                    id="ecoledirecte-username"
                    value={username}
                    autoComplete="username"
                    required
                    maxLength={320}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ecoledirecte-timezone">
                    {t("School time zone")}
                  </FieldLabel>
                  <Input
                    id="ecoledirecte-timezone"
                    value={timezone}
                    required
                    maxLength={100}
                    spellCheck={false}
                    placeholder="Europe/Paris"
                    onChange={(event) => setTimezone(event.target.value)}
                  />
                  <FieldDescription>
                    {t(
                      "Use an IANA time zone such as Indian/Reunion or America/Guadeloupe so school wall times stay correct."
                    )}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ecoledirecte-password">
                    {t("Password")}
                  </FieldLabel>
                  <Input
                    id="ecoledirecte-password"
                    type="password"
                    value={password}
                    autoComplete="current-password"
                    required
                    maxLength={1_024}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <FieldDescription>
                    {t(
                      "If ÉcoleDirecte asks for two-factor authentication, Avermate keeps its short-lived challenge token encrypted on the server."
                    )}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ecoledirecte-account">
                    {t("Student account number")}
                  </FieldLabel>
                  <Input
                    id="ecoledirecte-account"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={101}
                    value={accountNumber}
                    required
                    onChange={(event) => setAccountNumber(event.target.value)}
                  />
                  <FieldDescription>
                    {t(
                      "Keep 1 unless the same login gives access to several student accounts."
                    )}
                  </FieldDescription>
                </Field>
              </>
            )}
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
              disabled={
                pending ||
                (challenge ? !verificationResponse : !username || !password)
              }
            >
              {pending ? <Spinner /> : <LockKeyholeIcon />}
              {pending
                ? t("Checking ÉcoleDirecte")
                : challenge
                  ? t("Verify and connect")
                  : t("Connect securely")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PronoteDialog({
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
    username: string
    password: string
    kind: "student" | "parent" | "teacher"
    resourceIndex: number
    pin?: string
    timezone: string
  }) => void
}) {
  const t = useExtracted()
  const [baseUrl, setBaseUrl] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [kind, setKind] = useState<"student" | "parent" | "teacher">("student")
  const [resourceNumber, setResourceNumber] = useState("1")
  const [pin, setPin] = useState("")
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris"
    } catch {
      return "Europe/Paris"
    }
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const resourceIndex = Number(resourceNumber) - 1
    if (
      !baseUrl.trim() ||
      !username.trim() ||
      !password ||
      !timezone.trim() ||
      !Number.isInteger(resourceIndex)
    )
      return
    onSubmit({
      baseUrl: baseUrl.trim(),
      username: username.trim(),
      password,
      kind,
      resourceIndex,
      ...(pin.trim() ? { pin: pin.trim() } : {}),
      timezone: timezone.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("Connect PRONOTE")}</DialogTitle>
            <DialogDescription>
              {t(
                "Avermate exchanges the password for a device-bound PRONOTE token, encrypts that token on the server, and never stores the password or PIN."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="pronote-url">{t("PRONOTE URL")}</FieldLabel>
              <Input
                id="pronote-url"
                type="url"
                value={baseUrl}
                required
                placeholder="https://lycee.example/pronote/eleve.html"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
              <FieldDescription>
                {t("Paste the address of your school’s PRONOTE portal.")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="pronote-username">
                {t("Username")}
              </FieldLabel>
              <Input
                id="pronote-username"
                value={username}
                autoComplete="username"
                required
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pronote-password">
                {t("Password")}
              </FieldLabel>
              <Input
                id="pronote-password"
                type="password"
                value={password}
                autoComplete="current-password"
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pronote-account-kind">
                {t("Account type")}
              </FieldLabel>
              <select
                id="pronote-account-kind"
                value={kind}
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
                onChange={(event) =>
                  setKind(
                    event.target.value as "student" | "parent" | "teacher"
                  )
                }
              >
                <option value="student">{t("Student")}</option>
                <option value="parent">{t("Parent")}</option>
                <option value="teacher">{t("Teacher")}</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="pronote-resource">
                {t("Student account number")}
              </FieldLabel>
              <Input
                id="pronote-resource"
                type="number"
                min={1}
                max={101}
                value={resourceNumber}
                required
                onChange={(event) => setResourceNumber(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pronote-pin">
                {t("Device PIN (optional)")}
              </FieldLabel>
              <Input
                id="pronote-pin"
                type="password"
                value={pin}
                minLength={4}
                maxLength={64}
                autoComplete="one-time-code"
                onChange={(event) => setPin(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pronote-timezone">
                {t("School time zone")}
              </FieldLabel>
              <Input
                id="pronote-timezone"
                value={timezone}
                required
                placeholder="Europe/Paris"
                onChange={(event) => setTimezone(event.target.value)}
              />
            </Field>
            {error ? (
              <p
                role="alert"
                className="text-sm text-destructive sm:col-span-2"
              >
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              disabled={pending || !baseUrl || !username || !password}
            >
              {pending ? <Spinner /> : <LockKeyholeIcon />}
              {pending ? t("Checking PRONOTE") : t("Connect securely")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SkolengoDialog({
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
  onSubmit: (bundle: string) => void
}) {
  const t = useExtracted()
  const [bundle, setBundle] = useState("")
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (bundle.trim()) onSubmit(bundle.trim())
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("Connect Skolengo")}</DialogTitle>
            <DialogDescription>
              {t(
                "Paste the JSON bundle exported by scolengo-token. Avermate verifies the school and student against the official Skolengo API before encrypting the refresh material."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-4">
            <Field>
              <FieldLabel htmlFor="skolengo-token-bundle">
                {t("scolengo-token JSON bundle")}
              </FieldLabel>
              <Textarea
                id="skolengo-token-bundle"
                value={bundle}
                required
                rows={12}
                spellCheck={false}
                autoComplete="off"
                className="font-mono text-xs"
                placeholder={'{"tokenSet": {…}, "school": {…}}'}
                onChange={(event) => setBundle(event.target.value)}
              />
              <FieldDescription>
                {t(
                  "The official API address is pinned by Avermate and cannot be changed by the bundle."
                )}
              </FieldDescription>
            </Field>
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
              onClick={onClose}
            >
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={pending || !bundle.trim()}>
              {pending ? <Spinner /> : <LockKeyholeIcon />}
              {pending ? t("Checking Skolengo") : t("Connect securely")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SubjectMappingReview({
  connectionId,
  subjects,
  disabled,
}: {
  connectionId: string
  subjects: readonly LocalSubjectOption[]
  disabled: boolean
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const input = { connectionId }
  const [selections, setSelections] = useState<Record<string, string>>({})
  const mappings = useQuery({
    ...orpc.sync.subjectMappings.list.queryOptions({ input }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const resolve = useMutation(
    orpc.sync.subjectMappings.resolve.mutationOptions()
  )
  const review = subjectMappingsNeedingReview(mappings.data ?? [])
  const linked = linkedSubjectMappings(mappings.data ?? [])
  const counts = subjectMappingReviewCounts(mappings.data ?? [])
  const subjectOptions = localSubjectSelectOptions(subjects)

  const resolveMapping = async (
    providerSubjectExternalId: string,
    currentSubjectId: string | null
  ) => {
    const subjectId = selections[providerSubjectExternalId] ?? currentSubjectId
    if (!subjectId) return
    try {
      await resolve.mutateAsync({
        connectionId,
        providerSubjectExternalId,
        subjectId,
      })
      haptic("success")
      setSelections((current) => {
        const next = { ...current }
        delete next[providerSubjectExternalId]
        return next
      })
      await queryClient.invalidateQueries({
        queryKey: orpc.sync.subjectMappings.list.queryKey({ input }),
        exact: true,
      })
      toast.success(
        t("Subject linked. Synchronize once more to update managed items.")
      )
    } catch (error) {
      haptic("error")
      toast.error(
        error instanceof Error
          ? error.message
          : t("The subject could not be linked.")
      )
    }
  }

  type MappingRow = NonNullable<typeof mappings.data>[number]
  const mappingEditor = (mapping: MappingRow, mode: "link" | "update") => {
    const selected =
      selections[mapping.providerSubjectExternalId] ?? mapping.subjectId ?? ""
    const resolving =
      resolve.isPending &&
      resolve.variables?.providerSubjectExternalId ===
        mapping.providerSubjectExternalId
    const unchanged = mode === "update" && selected === mapping.subjectId
    return (
      <div
        key={mapping.providerSubjectExternalId}
        className="grid gap-2 rounded-md bg-muted/40 p-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium">
            {mapping.providerSubjectName}
          </span>
          <Badge variant="outline">
            {mode === "update"
              ? mapping.subjectName || t("Matched")
              : mapping.matchStatus === "ambiguous"
                ? t("Ambiguous")
                : t("Unmatched")}
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <SelectControl
            value={selected}
            options={subjectOptions}
            placeholder={t("Choose an Avermate subject")}
            aria-label={t("Avermate subject for {subject}", {
              subject: mapping.providerSubjectName,
            })}
            disabled={disabled || resolve.isPending}
            onValueChange={(subjectId) =>
              setSelections((current) => ({
                ...current,
                [mapping.providerSubjectExternalId]: subjectId,
              }))
            }
          />
          <Button
            type="button"
            size="sm"
            disabled={disabled || resolve.isPending || !selected || unchanged}
            onClick={() =>
              void resolveMapping(
                mapping.providerSubjectExternalId,
                mapping.subjectId
              )
            }
          >
            {resolving ? <Spinner /> : null}
            {mode === "update" ? t("Update link") : t("Link")}
          </Button>
        </div>
      </div>
    )
  }

  if (mappings.isPending) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner /> {t("Checking subject matches")}
      </div>
    )
  }
  if (mappings.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {mappings.error.message || t("Subject matches could not be loaded.")}
      </p>
    )
  }
  if ((mappings.data?.length ?? 0) === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("Subject matches will appear after the first synchronization.")}
      </p>
    )
  }
  return (
    <section className="grid gap-2 rounded-lg border border-dashed p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium">
            {review.length > 0
              ? t("Match imported subjects")
              : t("All provider subjects are linked.")}
          </p>
          <p className="text-xs text-muted-foreground">
            {review.length > 0
              ? t(
                  "Choose the Avermate subject for each unresolved provider subject, then synchronize once after finishing."
                )
              : t("You can review and change an existing link below.")}
          </p>
        </div>
        <Badge variant={review.length > 0 ? "outline" : "secondary"}>
          {review.length > 0
            ? t("{count} to review", { count: String(review.length) })
            : t("Matched")}
        </Badge>
      </div>
      {review.length > 0 ? (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("{unmatched} unmatched · {ambiguous} ambiguous", {
              unmatched: String(counts.unmatched),
              ambiguous: String(counts.ambiguous),
            })}
          </p>
          {review.map((mapping) => mappingEditor(mapping, "link"))}
        </>
      ) : null}
      {linked.length > 0 ? (
        <details open={review.length === 0} className="grid gap-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {t("Review {count} linked subjects", {
              count: String(linked.length),
            })}
          </summary>
          <div className="mt-2 grid gap-2">
            {linked.map((mapping) => mappingEditor(mapping, "update"))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

function PeriodMappingReview({
  connectionId,
  periods,
  disabled,
}: {
  connectionId: string
  periods: readonly LocalPeriodOption[]
  disabled: boolean
}) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const input = { connectionId }
  const [selections, setSelections] = useState<Record<string, string>>({})
  const mappings = useQuery({
    ...orpc.sync.periodMappings.list.queryOptions({ input }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const resolve = useMutation(
    orpc.sync.periodMappings.resolve.mutationOptions()
  )
  const review = periodMappingsNeedingReview(mappings.data ?? [])
  const linked = linkedPeriodMappings(mappings.data ?? [])
  const counts = periodMappingReviewCounts(mappings.data ?? [])
  const options = periods
    .filter((period) => period.id !== FULL_YEAR_PERIOD_ID)
    .map((period) => ({
      value: period.id,
      label: period.name,
      description: `${format.dateTime(new Date(period.startAt), {
        dateStyle: "medium",
      })} – ${format.dateTime(new Date(period.endAt), {
        dateStyle: "medium",
      })}`,
    }))

  const resolveMapping = async (
    providerPeriodExternalId: string,
    currentPeriodId: string | null
  ) => {
    const periodId = selections[providerPeriodExternalId] ?? currentPeriodId
    if (!periodId) return
    try {
      await resolve.mutateAsync({
        connectionId,
        providerPeriodExternalId,
        periodId,
      })
      haptic("success")
      setSelections((current) => {
        const next = { ...current }
        delete next[providerPeriodExternalId]
        return next
      })
      await queryClient.invalidateQueries({
        queryKey: orpc.sync.periodMappings.list.queryKey({ input }),
        exact: true,
      })
      toast.success(
        t("Period linked. Synchronize once more to update managed grades.")
      )
    } catch (error) {
      haptic("error")
      toast.error(
        error instanceof Error
          ? error.message
          : t("The period could not be linked.")
      )
    }
  }

  type MappingRow = NonNullable<typeof mappings.data>[number]
  const editor = (mapping: MappingRow, mode: "link" | "update") => {
    const selected =
      selections[mapping.providerPeriodExternalId] ?? mapping.periodId ?? ""
    const resolving =
      resolve.isPending &&
      resolve.variables?.providerPeriodExternalId ===
        mapping.providerPeriodExternalId
    const unchanged = mode === "update" && selected === mapping.periodId
    return (
      <div
        key={mapping.providerPeriodExternalId}
        className="grid gap-2 rounded-md bg-muted/40 p-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium">
            {mapping.providerPeriodName}
          </span>
          <Badge variant="outline">
            {mode === "update"
              ? mapping.periodName || t("Matched")
              : mapping.matchStatus === "ambiguous"
                ? t("Ambiguous")
                : t("Unmatched")}
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <SelectControl
            value={selected}
            options={options}
            placeholder={t("Choose an Avermate period")}
            aria-label={t("Avermate period for {period}", {
              period: mapping.providerPeriodName,
            })}
            disabled={disabled || resolve.isPending}
            onValueChange={(periodId) =>
              setSelections((current) => ({
                ...current,
                [mapping.providerPeriodExternalId]: periodId,
              }))
            }
          />
          <Button
            type="button"
            size="sm"
            disabled={disabled || resolve.isPending || !selected || unchanged}
            onClick={() =>
              void resolveMapping(
                mapping.providerPeriodExternalId,
                mapping.periodId
              )
            }
          >
            {resolving ? <Spinner /> : null}
            {mode === "update" ? t("Update link") : t("Link")}
          </Button>
        </div>
      </div>
    )
  }

  if (mappings.isPending) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner /> {t("Checking period matches")}
      </div>
    )
  }
  if (mappings.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {mappings.error.message || t("Period matches could not be loaded.")}
      </p>
    )
  }
  if ((mappings.data?.length ?? 0) === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("Period matches will appear after grades are discovered.")}
      </p>
    )
  }

  return (
    <section className="grid gap-2 rounded-lg border border-dashed p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium">
            {review.length > 0
              ? t("Match imported periods")
              : t("All provider periods are linked.")}
          </p>
          <p className="text-xs text-muted-foreground">
            {review.length > 0
              ? t(
                  "A grade is imported only after both its subject and period are linked."
                )
              : t("You can review and change an existing period link below.")}
          </p>
        </div>
        <Badge variant={review.length > 0 ? "outline" : "secondary"}>
          {review.length > 0
            ? t("{count} to review", { count: String(review.length) })
            : t("Matched")}
        </Badge>
      </div>
      {review.length > 0 ? (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("{unmatched} unmatched · {ambiguous} ambiguous", {
              unmatched: String(counts.unmatched),
              ambiguous: String(counts.ambiguous),
            })}
          </p>
          {review.map((mapping) => editor(mapping, "link"))}
        </>
      ) : null}
      {linked.length > 0 ? (
        <details open={review.length === 0} className="grid gap-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {t("Review {count} linked periods", {
              count: String(linked.length),
            })}
          </summary>
          <div className="mt-2 grid gap-2">
            {linked.map((mapping) => editor(mapping, "update"))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

function GradeSyncSummary({ connectionId }: { connectionId: string }) {
  const t = useExtracted()
  const records = useQuery({
    ...orpc.sync.gradeRecords.list.queryOptions({ input: { connectionId } }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  if (records.isPending) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner /> {t("Loading grade source")}
      </div>
    )
  }
  if (records.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {records.error.message || t("The grade source could not be loaded.")}
      </p>
    )
  }
  const counts = gradeRecordCounts(records.data ?? [])
  if ((records.data?.length ?? 0) === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("Provider grades will appear after the first synchronization.")}
      </p>
    )
  }
  return (
    <div
      className="flex flex-wrap gap-1.5"
      aria-label={t("Grade import state")}
    >
      <Badge variant="secondary">
        {t("{count} managed", { count: String(counts.managed) })}
      </Badge>
      {counts.missing > 0 ? (
        <Badge variant="outline">
          {t("{count} missing at source", { count: String(counts.missing) })}
        </Badge>
      ) : null}
      {counts.dismissed > 0 ? (
        <Badge variant="outline">
          {t("{count} hidden", { count: String(counts.dismissed) })}
        </Badge>
      ) : null}
      {counts.nonNumeric > 0 ? (
        <Badge variant="outline">
          {t("{count} non-numeric", { count: String(counts.nonNumeric) })}
        </Badge>
      ) : null}
    </div>
  )
}

function AcademicBindingDialog({
  connection,
  activeYear,
  cancelPending,
  onCancel,
  onBound,
}: {
  connection: PendingSchoolConnection
  activeYear: {
    id: string
    name: string
    startsAt: Date
    endsAt: Date
  } | null
  cancelPending: boolean
  onCancel: () => void
  onBound: (yearId: string) => void | Promise<void>
}) {
  const t = useExtracted()
  const format = useFormatter()
  const [mode, setMode] = useState<"create" | "existing">("create")
  const [name, setName] = useState<string | null>(null)
  const [startsAt, setStartsAt] = useState<string | null>(null)
  const [endsAt, setEndsAt] = useState<string | null>(null)
  const [scale, setScale] = useState<string | null>(null)
  const [defaultOutOf, setDefaultOutOf] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input =
    mode === "existing" && activeYear
      ? {
          connectionId: connection.id,
          startsAt: new Date(activeYear.startsAt),
          endsAt: new Date(activeYear.endsAt),
        }
      : { connectionId: connection.id }
  const preview = useQuery({
    ...orpc.sync.academic.preview.queryOptions({ input }),
    staleTime: 0,
    retry: false,
  })
  const bind = useMutation(orpc.sync.academic.bind.mutationOptions())
  const suggested = preview.data?.suggestedYear
  const resolvedName = name ?? suggested?.name ?? ""
  const resolvedStartsAt =
    startsAt ??
    (suggested
      ? academicYearDateValue(new Date(suggested.startsAt), suggested.timezone)
      : "")
  const resolvedEndsAt =
    endsAt ??
    (suggested
      ? academicYearDateValue(new Date(suggested.endsAt), suggested.timezone)
      : "")
  const resolvedScale = scale ?? String(suggested?.scale ?? 20)
  const resolvedDefaultOutOf =
    defaultOutOf ?? String(suggested?.defaultOutOf ?? 20)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    try {
      const result =
        mode === "existing"
          ? activeYear
            ? await bind.mutateAsync({
                mode: "existing",
                connectionId: connection.id,
                yearId: activeYear.id,
              })
            : null
          : await (() => {
              const timezone = suggested?.timezone ?? "Europe/Paris"
              const start = academicYearBoundary(
                resolvedStartsAt,
                "start",
                timezone
              )
              const end = academicYearBoundary(resolvedEndsAt, "end", timezone)
              const parsedScale = Number(resolvedScale)
              const parsedDefaultOutOf = Number(resolvedDefaultOutOf)
              if (
                !resolvedName.trim() ||
                !start ||
                !end ||
                start >= end ||
                !Number.isFinite(parsedScale) ||
                parsedScale <= 0 ||
                !Number.isFinite(parsedDefaultOutOf) ||
                parsedDefaultOutOf <= 0
              ) {
                throw new Error(t("Check the academic year settings."))
              }
              return bind.mutateAsync({
                mode: "create",
                connectionId: connection.id,
                name: resolvedName.trim(),
                startsAt: start,
                endsAt: end,
                timezone,
                scale: parsedScale,
                defaultOutOf: parsedDefaultOutOf,
              })
            })()
      if (!result) return
      haptic("success")
      await onBound(result.yearId)
    } catch (reason) {
      haptic("error")
      setError(
        reason instanceof Error
          ? reason.message
          : t("The academic year could not be prepared.")
      )
    }
  }

  const busy = bind.isPending || cancelPending
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("Choose where school data belongs")}</DialogTitle>
            <DialogDescription>
              {t(
                "Credentials for {provider} are verified. Review what Avermate found before creating or linking an academic year.",
                { provider: providerName(connection.provider) }
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="my-5 grid gap-5">
            {preview.isPending ? (
              <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spinner /> {t("Reading subjects, periods and grades")}
              </div>
            ) : preview.isError ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>
                  {t("School data could not be previewed")}
                </AlertTitle>
                <AlertDescription>
                  <p>{preview.error.message}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => void preview.refetch()}
                  >
                    <RefreshCwIcon /> {t("Try again")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : preview.data ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-semibold tabular-nums">
                      {preview.data.grades.total}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("Grades")}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-semibold tabular-nums">
                      {preview.data.subjects.length}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("Subjects")}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-semibold tabular-nums">
                      {preview.data.periods.length}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("Periods")}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-semibold tabular-nums">
                      {preview.data.grades.numeric}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("Numeric grades")}
                    </p>
                  </div>
                </div>

                {preview.data.grades.nonNumeric > 0 ? (
                  <Alert>
                    <AlertTriangleIcon />
                    <AlertTitle>
                      {t("{count} non-numeric results", {
                        count: String(preview.data.grades.nonNumeric),
                      })}
                    </AlertTitle>
                    <AlertDescription>
                      {t(
                        "Absent, exempt and text-only results stay visible in the provider snapshot but never change an average."
                      )}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <ChoiceField
                  label={t("Academic year destination")}
                  value={mode}
                  onValueChange={setMode}
                  columns={2}
                  choices={[
                    {
                      value: "create",
                      label: t("Create a provider year"),
                      description: t(
                        "Recommended: keep the source structure intact and add personal grades alongside it."
                      ),
                      icon: <DatabaseIcon className="size-4" />,
                    },
                    {
                      value: "existing",
                      label: activeYear
                        ? t("Link to {year}", { year: activeYear.name })
                        : t("Link to the active year"),
                      description: activeYear
                        ? t(
                            "Reuse its subjects and periods; ambiguous matches will wait for your review."
                          )
                        : t("No active academic year is available."),
                      disabled: !activeYear,
                      icon: <CalendarRangeIcon className="size-4" />,
                    },
                  ]}
                />

                {mode === "create" ? (
                  <div className="grid gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor="school-year-name">
                        {t("Academic year name")}
                      </FieldLabel>
                      <Input
                        id="school-year-name"
                        value={resolvedName}
                        required
                        maxLength={100}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </Field>
                    <DateField
                      label={t("Starts on")}
                      value={resolvedStartsAt}
                      onValueChange={setStartsAt}
                      required
                    />
                    <DateField
                      label={t("Ends on")}
                      value={resolvedEndsAt}
                      min={resolvedStartsAt || undefined}
                      onValueChange={setEndsAt}
                      required
                    />
                    <NumberField
                      label={t("Average scale")}
                      value={resolvedScale}
                      onValueChange={setScale}
                      min={1}
                      max={10_000}
                      required
                    />
                    <NumberField
                      label={t("Default grade denominator")}
                      value={resolvedDefaultOutOf}
                      onValueChange={setDefaultOutOf}
                      min={1}
                      max={10_000}
                      required
                    />
                  </div>
                ) : activeYear ? (
                  <Alert>
                    <ShieldCheckIcon />
                    <AlertTitle>{activeYear.name}</AlertTitle>
                    <AlertDescription>
                      <p>
                        {t("From {start} to {end}.", {
                          start: format.dateTime(
                            new Date(activeYear.startsAt),
                            {
                              dateStyle: "medium",
                            }
                          ),
                          end: format.dateTime(new Date(activeYear.endsAt), {
                            dateStyle: "medium",
                          }),
                        })}
                      </p>
                      <p>
                        {t(
                          "Provider-owned grade fields stay locked. Personal grades and local note fields remain editable."
                        )}
                      </p>
                    </AlertDescription>
                  </Alert>
                ) : null}
              </>
            ) : null}

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
              disabled={busy}
              onClick={onCancel}
            >
              {cancelPending ? <Spinner /> : null}
              {t("Cancel and remove connection")}
            </Button>
            <Button
              type="submit"
              disabled={
                busy || !preview.data || (mode === "existing" && !activeYear)
              }
            >
              {bind.isPending ? <Spinner /> : <ShieldCheckIcon />}
              {bind.isPending
                ? t("Preparing academic year")
                : t("Confirm and import")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SchoolServicesSection() {
  const t = useExtracted()
  const format = useFormatter()
  const { yearId, year, subjects, periods, selectYear } = useYear()
  const queryClient = useQueryClient()
  const [connectProvider, setConnectProvider] =
    useState<SchoolProviderId | null>(null)
  const [challenge, setChallenge] = useState<EcoleDirecteChallenge | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [pendingConnection, setPendingConnection] =
    useState<PendingSchoolConnection | null>(null)
  const [disconnectTarget, setDisconnectTarget] =
    useState<SchoolConnectionSummary | null>(null)
  const [purgeTarget, setPurgeTarget] =
    useState<SchoolConnectionSummary | null>(null)
  const [reconnectTarget, setReconnectTarget] =
    useState<SchoolConnectionSummary | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const reportedJobId = useRef<string | null>(null)
  const listInput = syncConnectionsInput(yearId ?? "")
  const providers = useQuery({
    ...orpc.sync.providers.queryOptions(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const connections = useQuery({
    ...orpc.sync.connections.list.queryOptions({ input: listInput }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const allConnections = useQuery({
    ...orpc.sync.connections.list.queryOptions({ input: {} }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const job = useQuery({
    ...orpc.jobs.get.queryOptions({ input: { jobId: jobId ?? "" } }),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      isActiveSyncJob(query.state.data?.status) ? 1_500 : false,
  })
  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.sync.connections.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.sync.subjectMappings.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.sync.periodMappings.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.sync.gradeRecords.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.snapshot.get.key(),
        }),
      ]),
    [queryClient]
  )
  const begin = useMutation(orpc.sync.ecoledirecte.begin.mutationOptions())
  const confirm = useMutation(orpc.sync.ecoledirecte.confirm.mutationOptions())
  const create = useMutation(orpc.sync.connections.create.mutationOptions())
  const run = useMutation(orpc.sync.run.mutationOptions())
  const setGradesAuthority = useMutation(
    orpc.sync.connections.setGradesAuthority.mutationOptions()
  )
  const resetCredentialMutations = () => {
    begin.reset()
    confirm.reset()
    create.reset()
  }
  const remove = useMutation({
    ...orpc.sync.connections.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setDisconnectTarget(null)
      toast.success(t("School service disconnected. Imported data was kept."))
      await refresh()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(
        error.message || t("The school service could not be disconnected.")
      )
    },
  })
  const purge = useMutation(orpc.sync.connections.purge.mutationOptions())

  const schoolConnections: SchoolConnectionSummary[] = (
    connections.data ?? []
  ).filter(
    (connection): connection is typeof connection & SchoolConnectionSummary =>
      connection.provider === "ecoledirecte" ||
      connection.provider === "pronote" ||
      connection.provider === "skolengo"
  )
  const unfinishedConnections: SchoolConnectionSummary[] = (
    allConnections.data ?? []
  ).filter(
    (connection): connection is typeof connection & SchoolConnectionSummary =>
      connection.yearId === null &&
      connection.status === "pending" &&
      (connection.provider === "ecoledirecte" ||
        connection.provider === "pronote" ||
        connection.provider === "skolengo") &&
      connection.id !== pendingConnection?.id
  )
  const descriptors = (providers.data ?? []).filter(
    (provider): provider is typeof provider & { id: SchoolProviderId } =>
      isSchoolProviderId(provider.id)
  )
  const synchronizationBusy = Boolean(syncingId || jobId || run.isPending)

  useEffect(() => {
    const status = job.data?.status
    if (!jobId || reportedJobId.current === jobId || !isTerminalSyncJob(status))
      return
    reportedJobId.current = jobId
    const report = () => {
      setJobId((current) => (current === jobId ? null : current))
      setSyncingId(null)
      if (status === "succeeded") {
        haptic("success")
        toast.success(t("School synchronization finished."))
      } else {
        haptic("error")
        toast.error(
          job.data?.error || t("School synchronization did not finish.")
        )
      }
    }
    void refresh().then(report, report)
  }, [job.data?.error, job.data?.status, jobId, refresh, t])

  const finishCredentialConnection = async (
    connection: { id: string; label: string },
    provider: SchoolProviderId
  ) => {
    haptic("success")
    setChallenge(null)
    setConnectProvider(null)
    if (reconnectTarget) {
      setReconnectTarget(null)
      toast.success(
        t("{provider} reconnected. Existing imported data was preserved.", {
          provider: providerName(provider),
        })
      )
      await refresh()
      return
    }
    setPendingConnection({ ...connection, provider })
    toast.success(
      t("Credentials verified. Review the academic data before importing it.")
    )
  }

  const credentialDestination = () => {
    if (!reconnectTarget) {
      return { yearId: null as string | null }
    }
    if (!reconnectTarget.yearId) {
      throw new Error(t("This connection is not attached to an academic year."))
    }
    return {
      yearId: reconnectTarget.yearId,
      reconnectConnectionId: reconnectTarget.id,
    }
  }

  const connect = async (input: {
    username: string
    password: string
    accountIndex: number
    timezone: string
  }) => {
    setConnectionError(null)
    try {
      const result = await begin.mutateAsync({
        ...credentialDestination(),
        credentialInput: JSON.stringify({
          ...input,
          deviceUuid: crypto.randomUUID(),
        }),
      })
      begin.reset()
      if (result.status === "challenge") {
        setChallenge(result)
        return
      }
      await finishCredentialConnection(result.connection, "ecoledirecte")
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("ÉcoleDirecte could not be connected.")
      begin.reset()
      setConnectionError(message)
      haptic("error")
      toast.error(message)
    }
  }

  const completeChallenge = async (response: string) => {
    if (!challenge) return
    setConnectionError(null)
    try {
      const result = await confirm.mutateAsync({
        ...credentialDestination(),
        challengeId: challenge.challengeId,
        response,
      })
      confirm.reset()
      await finishCredentialConnection(result.connection, "ecoledirecte")
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("ÉcoleDirecte could not be connected.")
      confirm.reset()
      setChallenge(null)
      setConnectionError(message)
      haptic("error")
      toast.error(message)
    }
  }

  const connectPronote = async (input: {
    baseUrl: string
    username: string
    password: string
    kind: "student" | "parent" | "teacher"
    resourceIndex: number
    pin?: string
    timezone: string
  }) => {
    setConnectionError(null)
    try {
      const result = await create.mutateAsync({
        provider: "pronote",
        ...credentialDestination(),
        baseUrl: input.baseUrl,
        credentialInput: JSON.stringify({
          username: input.username,
          password: input.password,
          kind: input.kind,
          resourceIndex: input.resourceIndex,
          deviceUuid: crypto.randomUUID(),
          deviceName: "Avermate",
          ...(input.pin ? { pin: input.pin } : {}),
          timezone: input.timezone,
        }),
      })
      create.reset()
      await finishCredentialConnection(result, "pronote")
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("PRONOTE could not be connected.")
      create.reset()
      setConnectionError(message)
      haptic("error")
      toast.error(message)
    }
  }

  const connectSkolengo = async (credentialInput: string) => {
    setConnectionError(null)
    try {
      const result = await create.mutateAsync({
        provider: "skolengo",
        ...credentialDestination(),
        baseUrl: "https://api.skolengo.com/api/v1/bff-sko-app",
        credentialInput,
      })
      create.reset()
      await finishCredentialConnection(result, "skolengo")
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("Skolengo could not be connected.")
      create.reset()
      setConnectionError(message)
      haptic("error")
      toast.error(message)
    }
  }

  const synchronize = async (connectionId: string) => {
    setSyncingId(connectionId)
    try {
      const result = await run.mutateAsync({ connectionId })
      haptic("success")
      if (isActiveSyncJob(result.status)) {
        reportedJobId.current = null
        setJobId(result.jobId)
        toast.success(t("School synchronization queued."))
      } else if (result.status === "succeeded") {
        setSyncingId(null)
        reportedJobId.current = result.jobId
        toast.info(t("This synchronization is already complete."))
        await refresh()
      } else {
        setSyncingId(null)
        reportedJobId.current = result.jobId
        toast.error(t("The previous synchronization did not finish."))
        await refresh()
      }
    } catch (error) {
      setSyncingId(null)
      haptic("error")
      toast.error(
        error instanceof Error
          ? error.message
          : t("School synchronization could not start.")
      )
    }
  }

  const openConnectionDialog = (
    provider: SchoolProviderId,
    target: SchoolConnectionSummary | null = null
  ) => {
    resetCredentialMutations()
    setConnectionError(null)
    setChallenge(null)
    setReconnectTarget(target)
    setConnectProvider(provider)
  }

  const abandonPendingConnection = async () => {
    if (!pendingConnection) return
    try {
      await purge.mutateAsync({ connectionId: pendingConnection.id })
      haptic("success")
      setPendingConnection(null)
      toast.info(t("The unconfigured school connection was removed."))
      await refresh()
    } catch (error) {
      haptic("error")
      toast.error(
        error instanceof Error
          ? error.message
          : t("The unconfigured connection could not be removed.")
      )
    }
  }

  const finishAcademicBinding = async (boundYearId: string) => {
    const connection = pendingConnection
    if (!connection) return
    setPendingConnection(null)
    await queryClient.invalidateQueries({
      queryKey: orpc.years.list.key(),
    })
    selectYear(boundYearId)
    await refresh()
    toast.success(
      t("Academic year prepared. The first synchronization is starting.")
    )
    await synchronize(connection.id)
  }

  const chooseGradesAuthority = async (connectionId: string) => {
    try {
      await setGradesAuthority.mutateAsync({ connectionId })
      haptic("success")
      toast.success(
        t("Grade source selected. Other provider grades no longer count twice.")
      )
      await refresh()
      await synchronize(connectionId)
    } catch (error) {
      haptic("error")
      toast.error(
        error instanceof Error
          ? error.message
          : t("The grade source could not be selected.")
      )
    }
  }

  const permanentlyPurge = async () => {
    if (!purgeTarget) return
    try {
      const result = await purge.mutateAsync({
        connectionId: purgeTarget.id,
      })
      haptic("success")
      setPurgeTarget(null)
      toast.success(
        t("Connection and {count} imported grades permanently deleted.", {
          count: String(result.removedGrades),
        })
      )
      await refresh()
    } catch (error) {
      haptic("error")
      toast.error(
        error instanceof Error
          ? error.message
          : t("The school data could not be permanently deleted.")
      )
    }
  }

  return (
    <>
      <SettingsSection
        id="school-services"
        icon={GraduationCapIcon}
        title={t("School services")}
        description={t(
          "Synchronize subjects, periods, grades, homework and timetable data. Provider-owned facts stay locked while personal notes and grades remain yours."
        )}
      >
        <div className="grid grid-cols-1 gap-3 @lg/main:grid-cols-3">
          {descriptors.map((provider) => (
            <article key={provider.id} className="rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{provider.label}</h3>
                <Badge
                  variant={
                    provider.availability.status === "ready"
                      ? "secondary"
                      : "outline"
                  }
                >
                  {provider.availability.status === "ready"
                    ? provider.developmentOnly
                      ? t("Development only")
                      : t("Available")
                    : t("Locked")}
                </Badge>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {provider.availability.status === "ready"
                  ? provider.developmentOnly
                    ? t(
                        "Enabled by the local development server with subjects, periods, grades, homework, timetable and school calendar synchronization."
                      )
                    : t(
                        "Subjects, periods, grades, homework, timetable and school calendar can be reviewed before import."
                      )
                  : provider.id === "pronote"
                    ? t(
                        "Blocksnote is unpublished with conflicting license metadata. The tested Pawnote fallback remains locked because its GPL-3.0-or-later dependency is not compatible with an unresolved project distribution license."
                      )
                    : t(
                        "The tested technical adapter remains locked because its GPL-3.0-or-later dependency is not compatible with an unresolved project distribution license."
                      )}
              </p>
              {provider.availability.status === "ready" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => openConnectionDialog(provider.id)}
                >
                  <PlusIcon />
                  {t("Connect {provider}", { provider: provider.label })}
                </Button>
              ) : null}
            </article>
          ))}
        </div>

        {unfinishedConnections.length > 0 ? (
          <div className="grid gap-2 rounded-xl border border-dashed p-3">
            <div>
              <h3 className="text-sm font-medium">
                {t("Connections waiting for an academic year")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Continue a verified import after a reload, or remove credentials you no longer want to keep."
                )}
              </p>
            </div>
            {unfinishedConnections.map((connection) => (
              <div
                key={connection.id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {connection.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {providerName(connection.provider)}
                  </p>
                </div>
                <Badge variant="outline">
                  {connection.status === "pending"
                    ? t("Awaiting review")
                    : t("Disconnected")}
                </Badge>
                {connection.status === "pending" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPendingConnection({
                        id: connection.id,
                        provider: connection.provider,
                        label: connection.label,
                      })
                    }
                  >
                    {t("Review import")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={purge.isPending}
                  onClick={() => setPurgeTarget(connection)}
                >
                  <Trash2Icon />
                  <span className="sr-only">{t("Delete permanently")}</span>
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {schoolConnections.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 @lg/main:grid-cols-2">
            {schoolConnections.map((connection) => {
              const active = syncingId === connection.id
              const providerAvailable = descriptors.some(
                (provider) =>
                  provider.id === connection.provider &&
                  provider.availability.status === "ready"
              )
              const state = schoolConnectionState(
                connection.status,
                providerAvailable
              )
              const connected =
                connection.status === "active" || connection.status === "error"
              const reconnect = state === "reconnect"
              const stateLabel =
                state === "unavailable"
                  ? t("Unavailable")
                  : state === "attention"
                    ? t("Needs attention")
                    : state === "pending"
                      ? t("Finishing setup")
                      : state === "reconnect"
                        ? connection.status === "revoked"
                          ? t("Access revoked")
                          : t("Disconnected")
                        : t("Connected")
              return (
                <article
                  key={connection.id}
                  className="flex flex-col gap-3 rounded-xl border bg-background p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium">
                        {connection.label}
                      </h3>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant="outline">
                          {providerName(connection.provider)}
                        </Badge>
                        {connection.gradesAuthority ? (
                          <Badge variant="secondary">
                            <ShieldCheckIcon /> {t("Grade source")}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <Badge
                      variant={
                        state === "attention"
                          ? "destructive"
                          : state === "connected"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {stateLabel}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <LockKeyholeIcon className="size-3.5" aria-hidden />
                    {t("Provider fields locked · local notes stay editable")}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {connection.lastSyncAt
                      ? t("Last synchronized {date}", {
                          date: format.dateTime(
                            new Date(connection.lastSyncAt),
                            { dateStyle: "medium", timeStyle: "short" }
                          ),
                        })
                      : t("Not synchronized yet")}
                  </p>
                  {connection.lastError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {connection.lastError}
                    </p>
                  ) : null}
                  {connection.capabilities.includes("grades") ? (
                    <GradeSyncSummary connectionId={connection.id} />
                  ) : null}
                  <SubjectMappingReview
                    connectionId={connection.id}
                    subjects={subjects}
                    disabled={
                      synchronizationBusy ||
                      remove.isPending ||
                      !providerAvailable
                    }
                  />
                  {connection.capabilities.includes("grades") ? (
                    <PeriodMappingReview
                      connectionId={connection.id}
                      periods={periods}
                      disabled={
                        synchronizationBusy ||
                        remove.isPending ||
                        !providerAvailable
                      }
                    />
                  ) : null}
                  {connection.capabilities.includes("grades") &&
                  !connection.gradesAuthority &&
                  connected ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        synchronizationBusy ||
                        setGradesAuthority.isPending ||
                        !providerAvailable
                      }
                      onClick={() => void chooseGradesAuthority(connection.id)}
                    >
                      {setGradesAuthority.isPending &&
                      setGradesAuthority.variables?.connectionId ===
                        connection.id ? (
                        <Spinner />
                      ) : (
                        <ShieldCheckIcon />
                      )}
                      {t("Use as grade source")}
                    </Button>
                  ) : null}
                  <div className="mt-auto flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="flex-1"
                      disabled={
                        synchronizationBusy ||
                        remove.isPending ||
                        !providerAvailable ||
                        state === "pending"
                      }
                      onClick={() => {
                        if (reconnect) {
                          openConnectionDialog(connection.provider, connection)
                          return
                        }
                        void synchronize(connection.id)
                      }}
                    >
                      {active ? (
                        <Spinner />
                      ) : reconnect ? (
                        <PlusIcon />
                      ) : (
                        <RefreshCwIcon />
                      )}
                      {active
                        ? t("Synchronizing")
                        : state === "unavailable"
                          ? t("Unavailable")
                          : reconnect
                            ? t("Reconnect")
                            : t("Synchronize now")}
                    </Button>
                    {connected ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={active || remove.isPending}
                        onClick={() => setDisconnectTarget(connection)}
                      >
                        <Link2OffIcon />
                        <span className="sr-only">{t("Disconnect")}</span>
                      </Button>
                    ) : reconnect ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={active || purge.isPending}
                        onClick={() => setPurgeTarget(connection)}
                      >
                        <Trash2Icon />
                        <span className="sr-only">
                          {t("Delete imported data permanently")}
                        </span>
                      </Button>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}
      </SettingsSection>

      {connectProvider === "ecoledirecte" ? (
        <EcoleDirecteDialog
          key={challenge?.challengeId ?? "credentials"}
          open
          pending={begin.isPending || confirm.isPending}
          error={connectionError}
          challenge={challenge}
          onClose={() => {
            resetCredentialMutations()
            setConnectionError(null)
            setChallenge(null)
            setReconnectTarget(null)
            setConnectProvider(null)
          }}
          onSubmit={(input) => void connect(input)}
          onConfirm={(response) => void completeChallenge(response)}
        />
      ) : null}

      {connectProvider === "pronote" ? (
        <PronoteDialog
          open
          pending={create.isPending}
          error={connectionError}
          onClose={() => {
            resetCredentialMutations()
            setConnectionError(null)
            setReconnectTarget(null)
            setConnectProvider(null)
          }}
          onSubmit={(input) => void connectPronote(input)}
        />
      ) : null}

      {connectProvider === "skolengo" ? (
        <SkolengoDialog
          open
          pending={create.isPending}
          error={connectionError}
          onClose={() => {
            resetCredentialMutations()
            setConnectionError(null)
            setReconnectTarget(null)
            setConnectProvider(null)
          }}
          onSubmit={(bundle) => void connectSkolengo(bundle)}
        />
      ) : null}

      {pendingConnection ? (
        <AcademicBindingDialog
          key={pendingConnection.id}
          connection={pendingConnection}
          activeYear={
            year
              ? {
                  id: year.id,
                  name: year.name,
                  startsAt: year.startsAt,
                  endsAt: year.endsAt,
                }
              : null
          }
          cancelPending={purge.isPending}
          onCancel={() => void abandonPendingConnection()}
          onBound={(boundYearId) => finishAcademicBinding(boundYearId)}
        />
      ) : null}

      <AlertDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) {
            setDisconnectTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Disconnect school service?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Encrypted credentials will be removed and synchronization will stop. Imported grades, mappings and personal changes stay in Avermate, so reconnecting later is non-destructive."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending || !disconnectTarget}
              onClick={(event) => {
                event.preventDefault()
                if (disconnectTarget) {
                  remove.mutate({ connectionId: disconnectTarget.id })
                }
              }}
            >
              {remove.isPending ? <Spinner /> : <Link2OffIcon />}
              {t("Disconnect and keep data")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !purge.isPending) setPurgeTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Permanently delete imported school data?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "This deletes the connection, its provider snapshots and every grade still managed by it. Personal grades are kept. This action cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purge.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={purge.isPending || !purgeTarget}
              onClick={(event) => {
                event.preventDefault()
                void permanentlyPurge()
              }}
            >
              {purge.isPending ? <Spinner /> : <Trash2Icon />}
              {t("Delete permanently")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
