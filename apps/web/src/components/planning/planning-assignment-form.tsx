"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { DateField, SelectField, TextField } from "@/components/forms/controls"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { invalidatePlanning } from "./planning-invalidate"
import { asValidDate, type PlanningItem } from "./planning-model"
import { inputDate, useSubjectOptions } from "./planning-form-fields"

/**
 * Homework, created and edited as a screen.
 *
 * The same shell as a task and a calendar entry, and as every other creation
 * form in the app. What is particular to homework stays: the instructions are
 * what a teacher set, the private note is yours alone and survives even on a
 * piece of homework a school service owns.
 */
export function PlanningAssignmentForm({
  yearId,
  mode,
  item,
}: {
  yearId: string
  mode: "create" | "edit"
  item?: PlanningItem | null
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph } = useYear()

  const [title, setTitle] = useState(item?.title ?? "")
  const [instructions, setInstructions] = useState(item?.instructions ?? "")
  const [dueDate, setDueDate] = useState(inputDate(asValidDate(item?.dueAt)))
  const [subjectId, setSubjectId] = useState(item?.subjectId ?? "none")
  const [localNote, setLocalNote] = useState(item?.localNote ?? "")

  const subjectOptions = useSubjectOptions(graph)
  const subjectName = useMemo(
    () =>
      subjectOptions.find((option) => option.value === subjectId)?.label ?? "",
    [subjectId, subjectOptions]
  )

  const done = async () => {
    haptic("success")
    toast.success(
      mode === "edit" ? t("Homework updated.") : t("Homework created.")
    )
    await invalidatePlanning(queryClient)
    router.push("/planning/agenda")
  }
  const failed = (error: Error) => {
    haptic("error")
    toast.error(error.message || t("The homework could not be saved."))
  }

  const create = useMutation({
    ...orpc.planning.assignments.create.mutationOptions(),
    onSuccess: done,
    onError: failed,
  })
  const update = useMutation({
    ...orpc.planning.assignments.update.mutationOptions(),
    onSuccess: done,
    onError: failed,
  })
  const saving = create.isPending || update.isPending

  const submit = () => {
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    const values = {
      title: cleanTitle,
      instructions: instructions.trim() || null,
      dueAt: dueDate ? new Date(`${dueDate}T12:00:00`) : null,
      subjectId: subjectId === "none" ? null : subjectId,
      localNote: localNote.trim() || null,
    }
    if (mode === "edit" && item) {
      update.mutate({ assignmentId: item.id, ...values })
      return
    }
    create.mutate({ yearId, assignedAt: null, ...values })
  }

  const steps: FlowStep[] = [
    {
      id: "title",
      title: t("What is the homework?"),
      content: (
        <TextField
          label={t("Homework title")}
          required
          value={title}
          maxLength={160}
          autoFocus
          placeholder={t("Exercises 4 to 8")}
          onChange={(event) => setTitle(event.target.value)}
        />
      ),
      summary: title.trim() || undefined,
      validate: () => Boolean(title.trim()),
    },
    {
      id: "due",
      title: t("When is it due?"),
      content: (
        <DateField
          label={t("Due date")}
          value={dueDate}
          onValueChange={setDueDate}
        />
      ),
      summary: dueDate || t("No date"),
    },
    {
      id: "subject",
      title: t("Which subject?"),
      content: (
        <SelectField
          label={t("Subject")}
          value={subjectId}
          onValueChange={setSubjectId}
          options={subjectOptions}
        />
      ),
      summary: subjectName,
    },
    {
      id: "instructions",
      title: t("What has to be done?"),
      description: t("The instructions as they were given."),
      content: (
        <Field>
          <FieldLabel htmlFor="assignment-instructions">
            {t("Instructions")}
          </FieldLabel>
          <Textarea
            id="assignment-instructions"
            value={instructions}
            rows={5}
            maxLength={4_000}
            placeholder={t("What needs to be done?")}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
      ),
      summary: instructions.trim() ? t("Written") : t("Nothing written"),
    },
  ]

  return (
    <FormFlow
      title={mode === "edit" ? t("Edit homework") : t("New homework")}
      description={
        mode === "create"
          ? t("This is your own homework entry; you can edit every field.")
          : undefined
      }
      backHref="/planning/agenda"
      steps={steps}
      beforeSave={
        <Field>
          <FieldLabel htmlFor="assignment-note">{t("Private note")}</FieldLabel>
          <Textarea
            id="assignment-note"
            value={localNote}
            rows={3}
            maxLength={4_000}
            placeholder={t("A reminder or your progress…")}
            onChange={(event) => setLocalNote(event.target.value)}
          />
          <FieldDescription>
            {t("Only you can see this, even on shared homework.")}
          </FieldDescription>
        </Field>
      }
      onSubmit={submit}
      submitLabel={mode === "edit" ? t("Save changes") : t("Add homework")}
      submitting={saving}
      disabled={!title.trim()}
    />
  )
}
