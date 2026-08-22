"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  AccentField,
  NumberField,
  TextField,
} from "@/components/forms/controls"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"

/**
 * Defining a kind of assessment.
 *
 * Small on purpose: a type is a name and three suggestions, and every one of the three is
 * a thing the person would otherwise retype for every DS of the year. What it is *not* is
 * a rule — nothing here constrains a result, and the form says so rather than leaving the
 * reader to discover it.
 *
 * Editing one never touches results already written. Fixing a typo in "DS" names the
 * results still to come; a coefficient that propagated backwards would move an average
 * somebody had already read.
 */

export interface GradeTypeFormValues {
  id?: string
  name: string
  titlePrefix: string
  coefficient: string
  outOf: string
  accent: string | null
}

function parseNumber(input: string): number | null {
  const value = Number.parseFloat(input.replace(",", "."))
  return Number.isFinite(value) ? value : null
}

export function GradeTypeForm({
  initial,
  mode,
}: {
  initial?: Partial<GradeTypeFormValues>
  mode: "create" | "edit"
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { yearId, year } = useYear()

  const [name, setName] = useState(initial?.name ?? "")
  const [titlePrefix, setTitlePrefix] = useState(initial?.titlePrefix ?? "")
  const [coefficient, setCoefficient] = useState(initial?.coefficient ?? "1")
  const [outOf, setOutOf] = useState(
    initial?.outOf ?? String(year?.defaultOutOf ?? 20)
  )
  const [accent, setAccent] = useState<string | null>(initial?.accent ?? null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: orpc.snapshot.get.queryKey({ input: { yearId: yearId ?? "" } }),
    })
  }
  const onSaved = {
    onSuccess: () => {
      haptic("success")
      toast.success(mode === "create" ? t("Type added") : t("Type updated"))
      refresh()
      router.back()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The type could not be saved."))
    },
  }
  const create = useMutation({
    ...orpc.gradeTypes.create.mutationOptions(),
    ...onSaved,
  })
  const update = useMutation({
    ...orpc.gradeTypes.update.mutationOptions(),
    ...onSaved,
  })
  const remove = useMutation({
    ...orpc.gradeTypes.delete.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Type deleted"))
      refresh()
      router.push("/settings/grade-types")
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The type could not be deleted."))
    },
  })

  const check = () => {
    const found: Record<string, string> = {}
    if (!name.trim()) found.name = t("Give this type a name.")
    const scale = parseNumber(outOf)
    if (scale === null || scale <= 0) {
      found.outOf = t("The maximum must be above zero.")
    }
    const weight = parseNumber(coefficient)
    if (weight === null || weight < 0) {
      found.coefficient = t("Enter a coefficient of zero or more.")
    }
    setErrors(found)
    return Object.keys(found).length === 0
  }

  const submit = () => {
    if (!check()) {
      haptic("warning")
      return
    }
    const payload = {
      name: name.trim(),
      // Kept as typed: the trailing space of "DS " is what the field is for.
      titlePrefix,
      coefficient: parseNumber(coefficient) ?? 1,
      outOf: parseNumber(outOf) ?? 20,
      accent,
    }
    if (mode === "create") create.mutate({ yearId: yearId ?? "", ...payload })
    else update.mutate({ typeId: initial?.id as string, ...payload })
  }

  const steps: FlowStep[] = [
    {
      id: "type",
      title: t("The kind of assessment"),
      description: t(
        "A name for it, and what it should fill in. Everything it fills in stays editable on the result itself."
      ),
      summary: name.trim(),
      validate: check,
      content: (
        <div className="flex flex-col gap-4">
          <TextField
            label={t("Name")}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("Test, oral, lab report…")}
            error={errors.name}
          />
          <TextField
            label={t("Name results like")}
            description={t(
              "Offered as the start of a result's name, so you finish it — “DS ” becomes “DS 3”."
            )}
            value={titlePrefix}
            onChange={(event) => setTitlePrefix(event.target.value)}
            placeholder={t("DS ")}
          />

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label={t("Coefficient")}
              value={coefficient}
              onValueChange={setCoefficient}
              min={0}
              step={0.5}
              error={errors.coefficient}
            />
            <NumberField
              label={t("Out of")}
              value={outOf}
              onValueChange={setOutOf}
              min={1}
              error={errors.outOf}
            />
          </div>

          <AccentField value={accent} onValueChange={setAccent} />
        </div>
      ),
    },
  ]

  return (
    <FormFlow
      title={mode === "create" ? t("New assessment type") : t("Edit type")}
      description={t(
        "Fills in a result for you, and lets a card compare one kind against another."
      )}
      backHref="/settings/grade-types"
      steps={steps}
      onSubmit={submit}
      submitLabel={mode === "create" ? t("Create") : t("Save changes")}
      submitting={create.isPending || update.isPending}
      destructive={
        mode === "edit" && initial?.id
          ? {
              label: t("Delete"),
              onClick: () => remove.mutate({ typeId: initial.id as string }),
            }
          : undefined
      }
    />
  )
}
