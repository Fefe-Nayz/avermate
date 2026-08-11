"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { BookMarkedIcon, PinIcon, SigmaIcon, TargetIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { planGoal } from "@avermate/core"
import { Field, FieldLabel } from "@/components/ui/field"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { FormPage } from "@/components/forms/form-page"
import {
  ChoiceField,
  FormSection,
  TextField,
} from "@/components/forms/controls"
import { PickerField, type PickerOption } from "@/components/forms/picker"
import { AverageValue } from "@/components/data/value"
import { GoalPlanView } from "./goal-plan-view"
import { useYear } from "@/components/year/year-provider"
import { useGoalPlans } from "@/hooks/use-goal-plans"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"

export interface GoalFormValues {
  id?: string
  name: string
  kind: "general" | "subject" | "custom"
  referenceId: string | null
  targetRatio: number
  periodId: string | null
  dueAt: Date | string | null
  isPinned: boolean
}

function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

/**
 * Setting a goal.
 *
 * The target is a slider rather than a number field because the decision is
 * comparative — "a bit above where I am" — and the plan underneath updates as
 * it moves, so the trade-off between ambition and reachability is visible
 * before anything is saved.
 */
export function GoalForm({
  initial,
  mode,
}: {
  initial?: Partial<GoalFormValues>
  mode: "create" | "edit"
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph, customAverages, periods, yearId, scale, resolve } = useYear()
  const { remaining } = useGoalPlans()

  const [kind, setKind] = useState<GoalFormValues["kind"]>(
    initial?.kind ?? "general"
  )
  const [referenceId, setReferenceId] = useState<string | null>(
    initial?.referenceId ?? null
  )
  const current = useMemo(() => {
    const resolved = resolve({ kind, referenceId })
    return resolved
      ? resolved.graph.ratio(resolved.subjectId, resolved.scope)
      : null
  }, [resolve, kind, referenceId])

  const [name, setName] = useState(initial?.name ?? "")
  const [targetRatio, setTargetRatio] = useState(
    initial?.targetRatio ?? Math.min(0.95, (current ?? 0.5) + 0.05)
  )
  const [periodId, setPeriodId] = useState(initial?.periodId ?? null)
  const [dueAt, setDueAt] = useState(() => toDateInput(initial?.dueAt))
  const [isPinned, setIsPinned] = useState(initial?.isPinned ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const subjectOptions: PickerOption[] = useMemo(
    () =>
      graph.flatten().map((subject) => ({
        value: subject.id,
        label: subject.name,
        depth: graph.depthOf(subject.id),
      })),
    [graph]
  )

  const averageOptions: PickerOption[] = useMemo(
    () =>
      customAverages.map((average) => ({
        value: average.id,
        label: average.name,
      })),
    [customAverages]
  )

  const periodOptions: PickerOption[] = useMemo(
    () =>
      periods.map((period) => ({
        value: period.id,
        label: period.name,
      })),
    [periods]
  )

  const preview = useMemo(() => {
    const resolved = resolve({ kind, referenceId })
    if (!resolved) return null
    return planGoal(
      {
        id: initial?.id ?? "__preview__",
        name: name || t("New goal"),
        kind,
        referenceId,
        targetRatio,
        periodId,
        dueAt: dueAt ? new Date(`${dueAt}T23:59:59`) : null,
        createdAt: new Date(),
        achievedAt: null,
      },
      resolved.graph,
      resolved.subjectId,
      resolved.scope,
      { remaining }
    )
  }, [
    resolve,
    kind,
    referenceId,
    targetRatio,
    name,
    initial,
    periodId,
    dueAt,
    t,
    remaining,
  ])

  const onSaved = {
    onSuccess: () => {
      haptic("success")
      toast.success(mode === "create" ? t("Goal created") : t("Goal updated"))
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
      router.push("/goals")
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The goal could not be saved."))
    },
  }

  const create = useMutation({
    ...orpc.goals.create.mutationOptions(),
    ...onSaved,
  })
  const update = useMutation({
    ...orpc.goals.update.mutationOptions(),
    ...onSaved,
  })
  const saving = create.isPending || update.isPending

  const remove = useMutation({
    ...orpc.goals.delete.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Goal deleted"))
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
      router.push("/goals")
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = t("Give this goal a name.")
    if (kind !== "general" && !referenceId) {
      next.referenceId = t("Pick what this goal is about.")
    }
    setErrors(next)
    if (Object.keys(next).length > 0) {
      haptic("warning")
      return
    }

    const payload = {
      name: name.trim(),
      kind,
      referenceId: kind === "general" ? null : referenceId,
      targetRatio,
      periodId: periodId === "__full_year__" ? null : periodId,
      dueAt: dueAt ? new Date(`${dueAt}T23:59:59`) : null,
      isPinned,
    }

    if (mode === "create") {
      create.mutate({ yearId: yearId as string, ...payload })
    } else {
      update.mutate({ goalId: initial?.id as string, ...payload })
    }
  }

  return (
    <FormPage
      title={mode === "create" ? t("New goal") : t("Edit goal")}
      description={t("Set a target and the app works out how to get there.")}
      backHref="/goals"
      onSubmit={submit}
      submitLabel={mode === "create" ? t("Create goal") : t("Save changes")}
      submitting={saving}
      destructive={
        mode === "edit" && initial?.id
          ? {
              label: t("Delete"),
              onClick: () => remove.mutate({ goalId: initial.id as string }),
            }
          : undefined
      }
    >
      <FormSection>
        <TextField
          label={t("Name")}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("Pass the year, get honours, 14 in maths…")}
          error={errors.name}
          autoFocus={mode === "create"}
        />

        <ChoiceField
          label={t("What is it about?")}
          choices={[
            {
              value: "general",
              label: t("The general average"),
              icon: <TargetIcon className="size-4" />,
            },
            {
              value: "subject",
              label: t("One subject"),
              icon: <BookMarkedIcon className="size-4" />,
            },
            ...(averageOptions.length > 0
              ? [
                  {
                    value: "custom" as const,
                    label: t("A custom average"),
                    icon: <SigmaIcon className="size-4" />,
                  },
                ]
              : []),
          ]}
          value={kind}
          onValueChange={(value) => {
            setKind(value)
            setReferenceId(null)
          }}
        />

        {kind === "subject" ? (
          <PickerField
            label={t("Subject")}
            required
            options={subjectOptions}
            value={referenceId}
            onValueChange={setReferenceId}
            error={errors.referenceId}
          />
        ) : null}

        {kind === "custom" ? (
          <PickerField
            label={t("Custom average")}
            required
            options={averageOptions}
            value={referenceId}
            onValueChange={setReferenceId}
            error={errors.referenceId}
          />
        ) : null}
      </FormSection>

      <FormSection title={t("Target")}>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-baseline justify-between">
            <AverageValue
              ratio={targetRatio}
              showScale
              className="text-3xl font-semibold"
              animate={false}
            />
            <span className="text-sm text-muted-foreground">
              {t("now")}{" "}
              <AverageValue
                ratio={current}
                animate={false}
                className="font-medium text-foreground"
              />
            </span>
          </div>
          <Slider
            value={[targetRatio * scale]}
            min={0}
            max={scale}
            step={scale / 200}
            onValueChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value
              if (typeof next === "number") setTargetRatio(next / scale)
            }}
            onValueCommitted={() => haptic("selection")}
            className="mt-4"
          />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>0</span>
            <span className="numeric">{scale}</span>
          </div>
        </div>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="goal-pinned" className="flex-1">
            <span className="flex items-center gap-1.5">
              <PinIcon className="size-4" />
              {t("Show on the dashboard")}
            </span>
          </FieldLabel>
          <Switch
            id="goal-pinned"
            checked={isPinned}
            onCheckedChange={(checked) => {
              haptic("selection")
              setIsPinned(checked)
            }}
          />
        </Field>
      </FormSection>

      <FormSection
        title={t("Planning")}
        description={t(
          "Tie the target to a period or a deadline when timing matters."
        )}
      >
        <PickerField
          label={t("Period")}
          options={periodOptions}
          value={periodId ?? "__full_year__"}
          onValueChange={(value) =>
            setPeriodId(value === "__full_year__" ? null : value)
          }
        />
        <TextField
          label={t("Deadline (optional)")}
          type="date"
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
        />
      </FormSection>

      {preview ? (
        <FormSection
          title={t("What this would take")}
          description={t("Updated live as you move the target.")}
        >
          <GoalPlanView plan={preview} />
        </FormSection>
      ) : null}
    </FormPage>
  )
}
