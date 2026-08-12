"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { SubjectGraph, gradeRatio } from "@avermate/core"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldLabel } from "@/components/ui/field"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import {
  DateField,
  NumberField,
  TextField,
} from "@/components/forms/controls"
import { PickerField, type PickerOption } from "@/components/forms/picker"
import { AverageValue, DeltaValue } from "@/components/data/value"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

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
  name: string
  subjectId: string | null
  value: string
  outOf: string
  coefficient: string
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

export function GradeForm({
  initial,
  mode,
}: {
  initial?: Partial<GradeFormValues>
  mode: "create" | "edit"
}) {
  const t = useExtracted()
  const format = useFormatter()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph, year, yearId, period } = useYear()
  const initialId = initial?.id

  const [name, setName] = useState(initial?.name ?? "")
  const [subjectId, setSubjectId] = useState<string | null>(
    initial?.subjectId ?? null
  )
  const [value, setValue] = useState(initial?.value ?? "")
  const [outOf, setOutOf] = useState(
    initial?.outOf ?? String(year?.defaultOutOf ?? 20)
  )
  const [coefficient, setCoefficient] = useState(initial?.coefficient ?? "1")
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

  /**
   * What this grade does to the general average, simulated locally: add it to
   * a copy of the graph and read the difference.
   */
  const impact = useMemo(() => {
    if (!subjectId || effectiveValue === null || outOfNumber <= 0) return null
    const before = graph.ratio(null)
    const simulated = new SubjectGraph(
      graph.subjects.map((subject) => {
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
              passedAt: new Date(passedAt),
              createdAt: new Date(),
              subjectId,
              periodId: null,
              components: [],
            },
          ],
        }
      })
    )
    const after = simulated.ratio(null)
    if (before === null || after === null) return { before, after, delta: null }
    return { before, after, delta: after - before }
  }, [
    graph,
    subjectId,
    effectiveValue,
    outOfNumber,
    coefficient,
    passedAt,
    name,
    initialId,
  ])

  const ratio =
    effectiveValue !== null && outOfNumber > 0
      ? gradeRatio({ value: effectiveValue, outOf: outOfNumber })
      : null

  // Two hooks rather than one on a conditional: the create and update inputs
  // differ by an id, and merging their option objects erases that difference.
  const onSaved = {
    onSuccess: () => {
      haptic("success")
      toast.success(mode === "create" ? t("Grade added") : t("Grade updated"))
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
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
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
      router.push("/grades")
    },
  })

  /**
   * Validation, per field, in one place.
   *
   * A step checks the subset it owns and a submit checks everything, so the
   * phone can stop someone walking past a missing subject without the rules
   * being written twice and drifting apart.
   */
  const problems = useMemo(() => {
    const found: Record<string, string> = {}
    if (!name.trim()) found.name = t("Give this grade a name.")
    if (!subjectId) found.subjectId = t("Pick the subject it belongs to.")
    if (outOfNumber <= 0) found.outOf = t("The maximum must be above zero.")
    if (!composite && effectiveValue === null) {
      found.value = t("Enter the result you were given.")
    }
    if (composite && components.length === 0) {
      found.components = t("Add at least one part.")
    }
    if (effectiveValue !== null && effectiveValue > outOfNumber) {
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
      passedAt: new Date(`${passedAt}T12:00:00`),
      note: note.trim() ? note.trim() : null,
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
    else update.mutate({ gradeId: initial?.id as string, ...payload })
  }

  const quickScales = [10, 20, 100].filter(
    (candidate) => candidate !== outOfNumber
  )

  const resultSummary =
    effectiveValue === null
      ? null
      : `${effectiveValue.toFixed(2).replace(/\.00$/, "")} / ${outOf}`

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

  const steps: FlowStep[] = [
    {
      id: "subject",
      title: t("Which subject?"),
      summary: subjectId ? (graph.byId(subjectId)?.name ?? null) : null,
      validate: () => check(["subjectId"]),
      content: (
        <PickerField
          layout="page"
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
    {
      id: "result",
      title: t("The result"),
      description: t("What to call it, what you got, and how much it counts."),
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
          />

          <Field orientation="horizontal">
            <FieldLabel htmlFor="composite-toggle" className="flex-1">
              {t("Made of several parts")}
              <span className="block text-xs font-normal text-muted-foreground">
                {t(
                  "Written and oral, or several exercises with their own weights"
                )}
              </span>
            </FieldLabel>
            <Switch
              id="composite-toggle"
              checked={composite}
              onCheckedChange={(checked) => {
                haptic("selection")
                setComposite(checked)
                if (checked && components.length === 0) {
                  setComponents([
                    {
                      key: crypto.randomUUID(),
                      name: "",
                      value: "",
                      outOf: outOf,
                      coefficient: "1",
                    },
                  ])
                }
              }}
            />
          </Field>

          {composite ? (
            <div className="flex flex-col gap-3">
              {components.map((component, index) => (
                <div
                  key={component.key}
                  className="rounded-xl border bg-card p-3"
                >
                  <div className="flex items-center gap-2 pb-2">
                    <input
                      value={component.name}
                      onChange={(event) =>
                        setComponents((current) =>
                          current.map((item, position) =>
                            position === index
                              ? { ...item, name: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder={t("Part {number}", {
                        number: String(index + 1),
                      })}
                      className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Remove")}
                      onClick={() => {
                        haptic("light")
                        setComponents((current) =>
                          current.filter((_, position) => position !== index)
                        )
                      }}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <NumberField
                      label={t("Result")}
                      value={component.value}
                      onValueChange={(next) =>
                        setComponents((current) =>
                          current.map((item, position) =>
                            position === index ? { ...item, value: next } : item
                          )
                        )
                      }
                    />
                    <NumberField
                      label={t("Out of")}
                      value={component.outOf}
                      onValueChange={(next) =>
                        setComponents((current) =>
                          current.map((item, position) =>
                            position === index ? { ...item, outOf: next } : item
                          )
                        )
                      }
                    />
                    <NumberField
                      label={t("Weight")}
                      value={component.coefficient}
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
              ))}

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  haptic("light")
                  setComponents((current) => [
                    ...current,
                    {
                      key: crypto.randomUUID(),
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
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            {composite ? (
              <Field>
                <FieldLabel>{t("Result")}</FieldLabel>
                <div className="flex h-12 items-center rounded-md border bg-muted/40 px-3 text-sm md:h-9">
                  <span className="numeric">
                    {effectiveValue === null
                      ? "—"
                      : effectiveValue.toFixed(2).replace(/\.00$/, "")}
                  </span>
                  <span className="ms-1 text-muted-foreground">
                    {t("computed from the parts")}
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
              />
            )}

            <NumberField
              label={t("Out of")}
              required
              value={outOf}
              onValueChange={setOutOf}
              error={errors.outOf}
              min={0.01}
            />
          </div>

          {quickScales.length > 0 ? (
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
          />

          {errors.components ? (
            <p className="text-sm text-destructive">{errors.components}</p>
          ) : null}

          {impactCard}
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
          label={t("Date")}
          value={passedAt}
          onValueChange={setPassedAt}
        />
      ),
    },
    {
      id: "note",
      title: t("Anything to remember?"),
      description: t("Optional. What went well, what to revise."),
      summary: note.trim() || null,
      content: (
        <Field>
          <FieldLabel htmlFor="grade-note">{t("Note")}</FieldLabel>
          <Textarea
            id="grade-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            maxLength={500}
            placeholder={t("Anything worth remembering about this result")}
          />
        </Field>
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
      onSubmit={submit}
      submitLabel={mode === "create" ? t("Add grade") : t("Save changes")}
      submitting={saving}
      destructive={
        mode === "edit" && initial?.id
          ? {
              label: t("Delete"),
              onClick: () => remove.mutate({ gradeId: initial.id as string }),
            }
          : undefined
      }
    />
  )
}
