"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CloudIcon,
  CopyPlusIcon,
  EyeOffIcon,
  LockKeyholeIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { gradeRatio } from "@avermate/core"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { DateField, NumberField, TextField } from "@/components/forms/controls"
import { PickerField, type PickerOption } from "@/components/forms/picker"
import { AverageValue, DeltaValue } from "@/components/data/value"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { randomId } from "@/lib/id"
import {
  gradeFieldIsLocked,
  gradeFieldNeedsValidation,
  gradeUpdateInput,
  type GradeManagement,
} from "./grade-management-model"

/**
 * Recording a result.
 *
 * The screen answers the question people actually have while typing — "what
 * does this do to my average?" — by simulating the grade against the live
 * graph on every keystroke. No save, no round trip.
 */

interface Component {
  key: string
  name: string
  value: string
  outOf: string
  coefficient: string
}

export interface GradeFormValues {
  id?: string
  /** The kind of assessment this was, where the year defines any. */
  typeId?: string | null
  name: string
  subjectId: string | null
  value: string
  outOf: string
  coefficient: string
  /** Extra points on this result's own scale. "0" or empty means none. */
  bonus: string
  /** Kept visible while opting it out of every average. */
  excludedFromAverage: boolean
  passedAt: string
  note: string
  components: Component[]
}

function toDateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function parseNumber(input: string): number | null {
  const value = Number.parseFloat(input.replace(",", "."))
  return Number.isFinite(value) ? value : null
}

function rollUp(components: Component[], outOf: number): number | null {
  let weighted = 0
  let total = 0
  for (const component of components) {
    const value = parseNumber(component.value)
    const max = parseNumber(component.outOf)
    const coefficient = parseNumber(component.coefficient) ?? 1
    if (value === null || max === null || max <= 0 || coefficient <= 0) continue
    weighted += (value / max) * coefficient
    total += coefficient
  }
  if (total === 0) return null
  return (weighted / total) * outOf
}

function LockedValue({
  label,
  value,
  description,
}: {
  label: string
  value: ReactNode
  description?: string
}) {
  return (
    <Field data-disabled>
      <FieldLabel>
        {label}
        <LockKeyholeIcon className="size-3.5 text-muted-foreground" />
      </FieldLabel>
      <div
        aria-readonly="true"
        className="flex min-h-(--control-h-form) items-center rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
      >
        {value}
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

export function GradeForm({
  initial,
  mode,
  management,
}: {
  initial?: Partial<GradeFormValues>
  mode: "create" | "edit"
  management?: GradeManagement
}) {
  const t = useExtracted()
  const format = useFormatter()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph, year, yearId, period, gradeTypes } = useYear()
  const initialId = initial?.id

  const [typeId, setTypeId] = useState<string | null>(initial?.typeId ?? null)
  const [name, setName] = useState(initial?.name ?? "")
  const [subjectId, setSubjectId] = useState<string | null>(
    initial?.subjectId ?? null
  )
  const [value, setValue] = useState(initial?.value ?? "")
  const [outOf, setOutOf] = useState(
    initial?.outOf ?? String(year?.defaultOutOf ?? 20)
  )
  const [coefficient, setCoefficient] = useState(initial?.coefficient ?? "1")
  const [bonus, setBonus] = useState(initial?.bonus ?? "")
  const [excludedFromAverage, setExcludedFromAverage] = useState(
    initial?.excludedFromAverage ?? false
  )
  /**
   * Shown only where there is one.
   *
   * Most results are a mark and nothing else, so the bonus is a line the form offers
   * rather than a field it asks — no step of its own, and no empty box in the way of the
   * ordinary path. Editing a result that has one opens with it already there.
   */
  const [showBonus, setShowBonus] = useState(
    Boolean(initial?.bonus && parseNumber(initial.bonus))
  )
  const bonusPoints = parseNumber(bonus) ?? 0
  const [passedAt, setPassedAt] = useState(
    initial?.passedAt ?? toDateInput(new Date())
  )
  const [note, setNote] = useState(initial?.note ?? "")
  const [composite, setComposite] = useState(
    (initial?.components?.length ?? 0) > 0
  )
  const [components, setComponents] = useState<Component[]>(
    initial?.components ?? []
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [managedAction, setManagedAction] = useState<
    "dismiss" | "restore" | "detach" | null
  >(null)
  const providerManaged = mode === "edit" && management?.mode === "provider"
  const locked = (field: string) => gradeFieldIsLocked(management, field)

  // Categories are groups, not places a result can live.
  const options: PickerOption[] = useMemo(
    () =>
      graph.flatten().map((subject) => ({
        value: subject.id,
        label: subject.name,
        depth: graph.depthOf(subject.id),
        hint: subject.kind === "category" ? t("group") : undefined,
        disabled: subject.kind === "category",
        keywords: subject.shortName ?? "",
      })),
    [graph, t]
  )

  const outOfNumber = parseNumber(outOf) ?? 0
  const effectiveValue = composite
    ? rollUp(components, outOfNumber)
    : parseNumber(value)
  const excludedFromCalculation =
    excludedFromAverage ||
    Boolean(
      providerManaged &&
      (management.syncState !== "managed" || !management.gradesAuthority)
    )

  /**
   * What this grade does to the general average, simulated locally: add it to
   * a copy of the graph and read the difference.
   */
  const impact = useMemo(() => {
    if (!subjectId || effectiveValue === null || outOfNumber <= 0) return null
    const before = graph.ratio(null)
    // `withSubjects` rather than a bare constructor: the year's scale, its bonus points
    // and any nominated general average ride on the graph, and a simulation that dropped
    // them would preview a number the dashboard never shows.
    const simulated = graph.withSubjects((subject) => {
      // When editing, the grade being changed must not count twice — drop it
      // wherever it currently sits, then add the edited version to the
      // subject now selected, which may not be the one it came from.
      const kept = initialId
        ? subject.grades.filter((grade) => grade.id !== initialId)
        : subject.grades

      if (subject.id !== subjectId) return { ...subject, grades: kept }

      return {
        ...subject,
        grades: [
          ...kept,
          {
            id: "__preview__",
            name,
            value: effectiveValue,
            outOf: outOfNumber,
            coefficient: parseNumber(coefficient) ?? 1,
            bonus: bonusPoints,
            excludedFromAverage: excludedFromCalculation,
            passedAt: new Date(passedAt),
            createdAt: new Date(),
            subjectId,
            periodId: null,
            components: [],
          },
        ],
      }
    })
    const after = simulated.ratio(null)
    if (before === null || after === null) return { before, after, delta: null }
    return { before, after, delta: after - before }
  }, [
    graph,
    subjectId,
    effectiveValue,
    outOfNumber,
    coefficient,
    bonusPoints,
    excludedFromCalculation,
    passedAt,
    name,
    initialId,
  ])

  const ratio =
    effectiveValue !== null && outOfNumber > 0
      ? gradeRatio({
          value: effectiveValue,
          outOf: outOfNumber,
          excludedFromAverage: excludedFromCalculation,
        })
      : null

  const invalidateGradeQueries = async (gradeId = initialId) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      }),
      ...(gradeId
        ? [
            queryClient.invalidateQueries({
              queryKey: orpc.grades.get.queryKey({ input: { gradeId } }),
            }),
          ]
        : []),
    ])
  }

  // Two hooks rather than one on a conditional: the create and update inputs
  // differ by an id, and merging their option objects erases that difference.
  const onSaved = {
    onSuccess: () => {
      haptic("success")
      toast.success(mode === "create" ? t("Grade added") : t("Grade updated"))
      void invalidateGradeQueries()
      router.back()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The grade could not be saved."))
    },
  }

  const create = useMutation({
    ...orpc.grades.create.mutationOptions(),
    ...onSaved,
  })
  const update = useMutation({
    ...orpc.grades.update.mutationOptions(),
    ...onSaved,
  })
  const saving = create.isPending || update.isPending

  const remove = useMutation({
    ...orpc.grades.delete.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Grade deleted"))
      void invalidateGradeQueries()
      router.push("/grades")
    },
  })

  const dismissManaged = useMutation({
    ...orpc.grades.dismissManaged.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Synced grade ignored."))
      setManagedAction(null)
      await invalidateGradeQueries()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The synced grade could not be changed."))
    },
  })
  const restoreManaged = useMutation({
    ...orpc.grades.restoreManaged.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Synced grade restored."))
      setManagedAction(null)
      await invalidateGradeQueries()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The synced grade could not be changed."))
    },
  })
  const detachManaged = useMutation({
    ...orpc.grades.detachManaged.mutationOptions(),
    onSuccess: async (detached) => {
      haptic("success")
      toast.success(t("Editable copy created."))
      setManagedAction(null)
      await invalidateGradeQueries()
      router.replace(`/grades/${detached.id}/edit`)
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The synced grade could not be detached."))
    },
  })
  const managedActionPending =
    dismissManaged.isPending ||
    restoreManaged.isPending ||
    detachManaged.isPending

  /**
   * Validation, per field, in one place.
   *
   * A step checks the subset it owns and a submit checks everything, so the
   * phone can stop someone walking past a missing subject without the rules
   * being written twice and drifting apart.
   */
  const problems = useMemo(() => {
    const found: Record<string, string> = {}
    const validates = (field: string) =>
      gradeFieldNeedsValidation(management, field)
    if (validates("name") && !name.trim()) {
      found.name = t("Give this grade a name.")
    }
    if (validates("subjectId") && !subjectId) {
      found.subjectId = t("Pick the subject it belongs to.")
    }
    if (validates("outOf") && outOfNumber <= 0) {
      found.outOf = t("The maximum must be above zero.")
    }
    if (validates("value") && !composite && effectiveValue === null) {
      found.value = t("Enter the result you were given.")
    }
    if (validates("components") && composite && components.length === 0) {
      found.components = t("Add at least one part.")
    }
    // `rollUp` has nothing to roll up when every part is blank, and the
    // payload would have fallen back to a zero — a grade of 0/20 nobody typed.
    if (
      validates("components") &&
      composite &&
      components.length > 0 &&
      effectiveValue === null
    ) {
      found.components = t("Fill in the result of at least one part.")
    }
    if (
      (validates("value") || validates("outOf")) &&
      effectiveValue !== null &&
      effectiveValue > outOfNumber
    ) {
      found.value = t("A grade cannot be worth more than its maximum.")
    }
    return found
  }, [
    components.length,
    composite,
    effectiveValue,
    name,
    outOfNumber,
    subjectId,
    management,
    t,
  ])

  /** Show only what this step is responsible for, and report whether it passed. */
  const check = (keys: string[]) => {
    const shown: Record<string, string> = {}
    for (const key of keys) {
      const problem = problems[key]
      if (problem) shown[key] = problem
    }
    setErrors(shown)
    return Object.keys(shown).length === 0
  }

  const submit = () => {
    setErrors(problems)
    if (Object.keys(problems).length > 0) {
      haptic("warning")
      return
    }

    const payload = {
      name: name.trim(),
      subjectId: subjectId as string,
      value: effectiveValue ?? 0,
      outOf: outOfNumber,
      coefficient: parseNumber(coefficient) ?? 1,
      bonus: bonusPoints,
      passedAt: new Date(`${passedAt}T12:00:00`),
      typeId,
      note: note.trim() ? note.trim() : null,
      excludedFromAverage,
      components: composite
        ? components.map((component) => ({
            name: component.name.trim() || t("Part"),
            value: parseNumber(component.value) ?? 0,
            outOf: parseNumber(component.outOf) ?? 20,
            coefficient: parseNumber(component.coefficient) ?? 1,
          }))
        : [],
    }

    if (mode === "create") create.mutate(payload)
    else {
      update.mutate(
        gradeUpdateInput(initial?.id as string, management, payload)
      )
    }
  }

  const quickScales = [10, 20, 100].filter(
    (candidate) => candidate !== outOfNumber
  )

  const trim = (value: number) => value.toFixed(2).replace(/\.00$/, "")
  const resultSummary =
    effectiveValue === null
      ? null
      : `${trim(effectiveValue)} / ${outOf}${
          bonusPoints
            ? ` ${bonusPoints > 0 ? "+" : "−"}${trim(Math.abs(bonusPoints))}`
            : ""
        }`

  const impactCard =
    impact && ratio !== null ? (
      <div
        className={cn(
          "rounded-xl border bg-card p-4",
          impact.delta !== null && impact.delta > 0 && "border-positive/40",
          impact.delta !== null && impact.delta < 0 && "border-negative/40"
        )}
      >
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t("If you save this")}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <AverageValue
            ratio={ratio}
            showScale
            colored
            className="text-2xl font-semibold"
          />
          <span className="text-sm text-muted-foreground">
            {t("general average")}
          </span>
          <AverageValue ratio={impact.after} className="text-sm font-medium" />
          <DeltaValue delta={impact.delta} className="text-sm font-medium" />
        </div>
      </div>
    ) : null

  const providerName =
    management?.providerLabel?.trim() ||
    management?.provider?.trim() ||
    t("School service")
  const sourceDisconnected =
    management?.connectionStatus === "disconnected" ||
    management?.connectionStatus === "revoked"
  const managementStateLabel = sourceDisconnected
    ? t("Disconnected")
    : management?.syncState === "dismissed"
      ? t("Ignored")
      : management?.syncState === "missing"
        ? t("Missing from source")
        : t("Synced")
  const managementExplanation = sourceDisconnected
    ? t("School service disconnected. Imported data was kept.")
    : management?.syncState === "dismissed"
      ? t(
          "This result stays linked to {provider}, but it is currently ignored by your averages.",
          { provider: providerName }
        )
      : management?.syncState === "missing"
        ? t(
            "{provider} no longer reports this result. It is kept for reference and excluded from averages.",
            { provider: providerName }
          )
        : management?.gradesAuthority
          ? t(
              "The result, scale, subject, weight and date come from {provider}. You can still add a bonus, a type, a note, or exclude it from averages.",
              { provider: providerName }
            )
          : t(
              "This result comes from {provider}, a secondary source, so it stays out of your average until you make that source the main one.",
              { provider: providerName }
            )
  const managementAside = providerManaged ? (
    <section className="rounded-xl border bg-card p-4" aria-label={t("Source")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          <CloudIcon /> {providerName}
        </Badge>
        <Badge variant="outline">
          <LockKeyholeIcon /> {managementStateLabel}
        </Badge>
        <Badge variant="outline">
          {sourceDisconnected
            ? t("Disconnected")
            : management?.gradesAuthority
              ? t("Primary grade source")
              : t("Secondary source")}
        </Badge>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {managementExplanation}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {management?.syncState === "dismissed" ? (
          <Button
            type="button"
            variant="outline"
            disabled={managedActionPending}
            onClick={() => setManagedAction("restore")}
          >
            <RotateCcwIcon />
            {t("Restore synced grade")}
          </Button>
        ) : management?.syncState === "managed" ? (
          <Button
            type="button"
            variant="outline"
            disabled={managedActionPending}
            className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setManagedAction("dismiss")}
          >
            <EyeOffIcon />
            {t("Ignore synced grade")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={managedActionPending}
          onClick={() => setManagedAction("detach")}
        >
          <CopyPlusIcon />
          {t("Detach as editable copy")}
        </Button>
      </div>
    </section>
  ) : undefined

  const runManagedAction = () => {
    if (!initialId || !managedAction) return
    if (managedAction === "dismiss") {
      dismissManaged.mutate({ gradeId: initialId })
    } else if (managedAction === "restore") {
      restoreManaged.mutate({ gradeId: initialId })
    } else {
      detachManaged.mutate({ gradeId: initialId })
    }
  }

  const managedActionDialog = providerManaged ? (
    <AlertDialog
      open={managedAction !== null}
      onOpenChange={(open) => {
        if (!open && !managedActionPending) setManagedAction(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {managedAction === "dismiss"
              ? t("Ignore this synced grade?")
              : managedAction === "restore"
                ? t("Restore this synced grade?")
                : t("Detach this grade from {provider}?", {
                    provider: providerName,
                  })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {managedAction === "dismiss"
              ? t(
                  "It will remain linked to the school service, stay visible for reference, and stop counting in averages. You can restore it later."
                )
              : managedAction === "restore"
                ? t(
                    "The synchronized result will count again when this connection is the primary grade source."
                  )
                : t(
                    "A personal, fully editable copy will replace this result. Future changes from the school service will no longer update that copy."
                  )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={managedActionPending}>
            {t("Cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={managedAction === "dismiss" ? "destructive" : "default"}
            disabled={managedActionPending}
            onClick={runManagedAction}
          >
            {managedAction === "dismiss"
              ? t("Ignore grade")
              : managedAction === "restore"
                ? t("Restore grade")
                : t("Create editable copy")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : undefined

  /**
   * Choosing a kind fills the form in, and never over what somebody typed.
   *
   * A template is there to save typing, so it writes into a field only while that field
   * still holds what the *previous* type suggested — or nothing at all. Change your mind
   * about the kind before typing and the suggestions follow; change it after, and your
   * own words stay.
   */
  const applyType = (next: string | null) => {
    const previous = gradeTypes.find((type) => type.id === typeId)
    const chosen = gradeTypes.find((type) => type.id === next)
    setTypeId(next)
    if (mode !== "create") return
    if (name === (previous?.titlePrefix ?? "")) {
      setName(chosen?.titlePrefix ?? "")
    }
    if (coefficient === String(previous?.coefficient ?? 1)) {
      setCoefficient(String(chosen?.coefficient ?? 1))
    }
    const yearDefault = String(year?.defaultOutOf ?? 20)
    if (outOf === String(previous?.outOf ?? yearDefault)) {
      setOutOf(String(chosen?.outOf ?? yearDefault))
    }
  }

  const steps: FlowStep[] = [
    {
      id: "subject",
      title: locked("subjectId") ? t("Subject") : t("Which subject?"),
      summary: subjectId ? (graph.byId(subjectId)?.name ?? null) : null,
      validate: () => check(["subjectId"]),
      content: locked("subjectId") ? (
        <LockedValue
          label={t("Subject")}
          value={
            subjectId
              ? (graph.byId(subjectId)?.name ?? t("Unknown subject"))
              : t("No subject")
          }
          description={t("Managed by {provider}", {
            provider: providerName,
          })}
        />
      ) : (
        <PickerField
          layout="page"
          advanceOnSelect
          label={t("Subject")}
          required
          options={options}
          value={subjectId}
          onValueChange={setSubjectId}
          error={errors.subjectId}
          emptyHint={t("No subject matches. Add one first.")}
        />
      ),
    },
    /**
     * Only where the year has kinds of assessment.
     *
     * A step that offers one choice — "no type" — is a step that costs a tap and answers
     * nothing, and a year that has never defined a kind should not be told it has a
     * concept it does not use.
     */
    ...(gradeTypes.length > 0
      ? [
          {
            id: "type",
            title: t("What kind of assessment?"),
            description: providerManaged
              ? t(
                  "This is your local label. It does not change the school service's result."
                )
              : t(
                  "Fills in the name, the coefficient and the scale. All still editable."
                ),
            summary:
              gradeTypes.find((type) => type.id === typeId)?.name ??
              t("No type"),
            validate: () => true,
            content: (
              <PickerField
                layout="page"
                advanceOnSelect
                label={t("Kind")}
                options={[
                  // Always offered, and first: a result that belongs to no kind is
                  // ordinary, not a failure to choose.
                  { value: "", label: t("No type") },
                  ...gradeTypes.map((type) => ({
                    value: type.id,
                    label: type.name,
                  })),
                ]}
                value={typeId ?? ""}
                onValueChange={(next) => applyType(next ? next : null)}
              />
            ),
          } satisfies FlowStep,
        ]
      : []),
    {
      id: "result",
      title: t("The result"),
      description: providerManaged
        ? t(
            "The synchronized values are read-only. Your bonus remains editable."
          )
        : t("What to call it, what you got, and how much it counts."),
      summary: [name.trim(), resultSummary].filter(Boolean).join(" · "),
      validate: () => check(["name", "value", "outOf", "components"]),
      content: (
        <div className="flex flex-col gap-4">
          <TextField
            label={t("Name")}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("Mock exam, chapter 4, oral…")}
            error={errors.name}
            disabled={locked("name")}
          />

          <div className="grid grid-cols-2 gap-3">
            {composite ? (
              <Field>
                <FieldLabel>{t("Result")}</FieldLabel>
                {/* Same height as the input it stands in for, or the row it
                    shares with "Out of" comes out uneven — and it has to be
                    the same *token*. `h-12 md:h-9` switches on width while
                    `NumberField` switches on the pointer, so the two agreed on
                    a desktop and drifted 8px apart on a wide touch screen and
                    12px in a narrow desktop window. */}
                <div className="flex h-(--control-h-form) items-center gap-1.5 rounded-md border border-input bg-muted/40 px-3 py-1 text-base shadow-xs md:text-sm">
                  <span className="numeric font-medium">
                    {effectiveValue === null
                      ? "—"
                      : effectiveValue.toFixed(2).replace(/\.00$/, "")}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t("from the parts")}
                  </span>
                </div>
              </Field>
            ) : (
              <NumberField
                label={t("Result")}
                required
                value={value}
                onValueChange={setValue}
                error={errors.value}
                min={0}
                placeholder="14"
                disabled={locked("value")}
              />
            )}

            <NumberField
              label={t("Out of")}
              required
              value={outOf}
              onValueChange={setOutOf}
              error={errors.outOf}
              min={0.01}
              disabled={locked("outOf")}
            />
          </div>

          {quickScales.length > 0 && !locked("outOf") ? (
            <div className="-mt-1 flex gap-2">
              {quickScales.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => {
                    haptic("selection")
                    setOutOf(String(candidate))
                  }}
                  className="min-h-9 rounded-full border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent"
                >
                  {t("/ {scale}", { scale: String(candidate) })}
                </button>
              ))}
            </div>
          ) : null}

          <NumberField
            label={t("Weight")}
            description={t(
              "How much this counts inside the subject. 1 is a normal result."
            )}
            value={coefficient}
            onValueChange={setCoefficient}
            min={0}
            disabled={locked("coefficient")}
          />

          {/* A line the form offers, not a field it asks. Most results are a mark and
              nothing else, and a permanent empty box would put a question in the way of
              every one of them. */}
          {showBonus ? (
            <NumberField
              label={t("Bonus points")}
              description={t(
                "Added on top of the result — 14 with a bonus of 1 counts as 15."
              )}
              value={bonus}
              onValueChange={setBonus}
              step={0.5}
              suffix={t("pts")}
            />
          ) : (
            <button
              type="button"
              className="-mt-1 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => {
                haptic("selection")
                setShowBonus(true)
              }}
            >
              {t("Add bonus points")}
            </button>
          )}

          {impactCard}

          {/* Below everything and behind a rule: most grades are one mark, so
              this is a departure from the normal shape rather than part of it.
              The label owns the full width — squeezed into a column beside the
              switch, its explanation wrapped into a two-word ribbon. */}
          <div className="mt-1 border-t pt-4">
            <div className="rounded-xl border bg-card">
              <div className="flex items-start gap-3 p-3">
                <label
                  htmlFor="composite-toggle"
                  className={cn(
                    "min-w-0 flex-1",
                    locked("components") ? "cursor-default" : "cursor-pointer"
                  )}
                >
                  <span className="block text-sm font-medium">
                    {t("Made of several parts")}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t(
                      "Written and oral, or several exercises with their own weights"
                    )}
                  </span>
                </label>
                <Switch
                  id="composite-toggle"
                  checked={composite}
                  disabled={locked("components")}
                  onCheckedChange={(checked) => {
                    haptic("selection")
                    setComposite(checked)
                    if (checked && components.length === 0) {
                      setComponents([
                        {
                          key: randomId(),
                          name: "",
                          value: "",
                          outOf: outOf,
                          coefficient: "1",
                        },
                      ])
                    }
                  }}
                />
              </div>

              {composite ? (
                <div className="flex flex-col gap-3 border-t p-3">
                  {components.map((component, index) => (
                    <div
                      key={component.key}
                      className="rounded-lg border bg-background p-3"
                    >
                      <div className="flex items-center gap-2 pb-2">
                        <input
                          value={component.name}
                          disabled={locked("components")}
                          onChange={(event) =>
                            setComponents((current) =>
                              current.map((item, position) =>
                                position === index
                                  ? { ...item, name: event.target.value }
                                  : item
                              )
                            )
                          }
                          enterKeyHint="next"
                          placeholder={t("Part {number}", {
                            number: String(index + 1),
                          })}
                          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
                        />
                        {!locked("components") ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("Remove")}
                            onClick={() => {
                              haptic("light")
                              setComponents((current) =>
                                current.filter(
                                  (_, position) => position !== index
                                )
                              )
                            }}
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        ) : null}
                      </div>

                      {/* Three number fields side by side leaves each one
                          about forty pixels wide on a phone. Two, then one. */}
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                        <NumberField
                          label={t("Result")}
                          value={component.value}
                          disabled={locked("components")}
                          onValueChange={(next) =>
                            setComponents((current) =>
                              current.map((item, position) =>
                                position === index
                                  ? { ...item, value: next }
                                  : item
                              )
                            )
                          }
                        />
                        <NumberField
                          label={t("Out of")}
                          value={component.outOf}
                          disabled={locked("components")}
                          onValueChange={(next) =>
                            setComponents((current) =>
                              current.map((item, position) =>
                                position === index
                                  ? { ...item, outOf: next }
                                  : item
                              )
                            )
                          }
                        />
                        <div className="col-span-2 md:col-span-1">
                          <NumberField
                            label={t("Weight")}
                            value={component.coefficient}
                            disabled={locked("components")}
                            onValueChange={(next) =>
                              setComponents((current) =>
                                current.map((item, position) =>
                                  position === index
                                    ? { ...item, coefficient: next }
                                    : item
                                )
                              )
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  {!locked("components") ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        haptic("light")
                        setComponents((current) => [
                          ...current,
                          {
                            key: randomId(),
                            name: "",
                            value: "",
                            outOf,
                            coefficient: "1",
                          },
                        ])
                      }}
                    >
                      <PlusIcon className="size-4" />
                      {t("Add a part")}
                    </Button>
                  ) : null}

                  {errors.components ? (
                    <p className="text-sm text-destructive">
                      {errors.components}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "when",
      title: t("When was it?"),
      description: t("It is filed into whichever period this date falls in."),
      summary: format.dateTime(new Date(`${passedAt}T12:00:00`), {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      content: (
        <DateField
          layout={locked("passedAt") ? "field" : "page"}
          label={t("Date")}
          value={passedAt}
          onValueChange={setPassedAt}
          disabled={locked("passedAt")}
          description={
            locked("passedAt")
              ? t("Managed by {provider}", { provider: providerName })
              : undefined
          }
        />
      ),
    },
  ]

  return (
    <FormFlow
      title={mode === "create" ? t("New grade") : t("Edit grade")}
      description={
        mode === "create"
          ? t("It will be filed into {period} automatically.", {
              period: period.name,
            })
          : undefined
      }
      backHref="/grades"
      steps={steps}
      aside={managementAside}
      beforeSave={
        <div className="flex flex-col gap-4">
          <Field>
            <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
              <label
                htmlFor="grade-excluded-from-average"
                className="min-w-0 flex-1 cursor-pointer"
              >
                <span className="block text-sm font-medium">
                  {t("Exclude from averages")}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {providerManaged && management?.syncState !== "managed"
                    ? t(
                        "The school source already excludes this result. This preference will also be kept if it is restored."
                      )
                    : t(
                        "Keep the result visible without letting it change subject or general averages."
                      )}
                </span>
              </label>
              <Switch
                id="grade-excluded-from-average"
                checked={excludedFromAverage}
                onCheckedChange={(checked) => {
                  haptic("selection")
                  setExcludedFromAverage(checked)
                }}
              />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="grade-note">
              {t("Anything to remember?")}
            </FieldLabel>
            <Textarea
              id="grade-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("Anything worth remembering about this result")}
            />
          </Field>
        </div>
      }
      overlays={managedActionDialog}
      onSubmit={submit}
      submitLabel={mode === "create" ? t("Add grade") : t("Save changes")}
      submitting={saving}
      destructive={
        mode === "edit" && initial?.id && !providerManaged
          ? {
              label: t("Delete"),
              onClick: () => remove.mutate({ gradeId: initial.id as string }),
            }
          : undefined
      }
    />
  )
}
