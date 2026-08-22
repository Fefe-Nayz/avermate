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
 * A personal task, created and edited as a screen.
 *
 * It was a panel that unfolded inside the task board — one shape on this
 * screen, a different one for homework, a third for a calendar entry, none of
 * them linkable and none of them the shape every other creation form in the app
 * already has. This is `FormFlow`, like a grade or a goal: the whole form at
 * once on a laptop, one decision at a time on a phone, with a review screen at
 * the end and the save pinned where a thumb reaches it.
 */
export function PlanningTaskForm({
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
  const [dueAt, setDueAt] = useState(inputDate(asValidDate(item?.dueAt)))
  const [subjectId, setSubjectId] = useState(item?.subjectId ?? "none")
  const [notes, setNotes] = useState(item?.notes ?? "")

  const subjectOptions = useSubjectOptions(graph)
  const subjectName = useMemo(
    () =>
      subjectOptions.find((option) => option.value === subjectId)?.label ?? "",
    [subjectId, subjectOptions]
  )

  const done = async () => {
    haptic("success")
    toast.success(mode === "edit" ? t("Task saved.") : t("Task created."))
    await invalidatePlanning(queryClient)
    router.push("/planning/tasks")
  }
  const failed = (error: Error) => {
    haptic("error")
    toast.error(error.message || t("The task could not be saved."))
  }

  const create = useMutation({
    ...orpc.planning.tasks.create.mutationOptions(),
    onSuccess: done,
    onError: failed,
  })
  const update = useMutation({
    ...orpc.planning.tasks.update.mutationOptions(),
    onSuccess: done,
    onError: failed,
  })
  const saving = create.isPending || update.isPending

  const submit = () => {
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    const values = {
      title: cleanTitle,
      notes: notes.trim() || null,
      dueAt: dueAt ? new Date(`${dueAt}T12:00:00`) : null,
      subjectId: subjectId === "none" ? null : subjectId,
    }
    if (mode === "edit" && item) {
      update.mutate({ taskId: item.id, ...values })
      return
    }
    create.mutate({ yearId, ...values })
  }

  const steps: FlowStep[] = [
    {
      id: "task",
      title: t("What do you have to do?"),
      content: (
        <TextField
          label={t("Task")}
          required
          value={title}
          maxLength={160}
          autoFocus
          placeholder={t("Review chapter 4")}
          onChange={(event) => setTitle(event.target.value)}
        />
      ),
      summary: title.trim() || undefined,
      validate: () => Boolean(title.trim()),
    },
    {
      id: "when",
      title: t("When is it for?"),
      description: t("Leave it empty for something with no deadline."),
      content: (
        <DateField
          label={t("Due date")}
          value={dueAt}
          onValueChange={setDueAt}
        />
      ),
      summary: dueAt || t("No date"),
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
  ]

  return (
    <FormFlow
      title={mode === "edit" ? t("Edit task") : t("New task")}
      backHref="/planning/tasks"
      steps={steps}
      beforeSave={
        <Field>
          <FieldLabel htmlFor="planning-task-notes">{t("Notes")}</FieldLabel>
          <Textarea
            id="planning-task-notes"
            value={notes}
            rows={3}
            maxLength={4_000}
            placeholder={t("Anything worth remembering")}
            onChange={(event) => setNotes(event.target.value)}
          />
          <FieldDescription>{t("Only you can see this.")}</FieldDescription>
        </Field>
      }
      onSubmit={submit}
      submitLabel={mode === "edit" ? t("Save changes") : t("Add task")}
      submitting={saving}
      disabled={!title.trim()}
    />
  )
}
