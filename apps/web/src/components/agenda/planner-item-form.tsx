"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CalendarClockIcon, CheckSquare2Icon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import {
  ChoiceField,
  DateField,
  DateTimeField,
  TextField,
} from "@/components/forms/controls"
import { PickerField, type PickerOption } from "@/components/forms/picker"
import { useYear } from "@/components/year/year-provider"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import {
  localDateTimeValue,
  parseLocalDateTime,
  type PlannerItem,
} from "./agenda-model"

type PlannerKind = "task" | "event"

export function PlannerItemForm({
  mode,
  initial,
}: {
  mode: "create" | "edit"
  initial?: PlannerItem
}) {
  const t = useExtracted()
  const format = useFormatter()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { graph, yearId } = useYear()
  const [kind, setKind] = useState<PlannerKind>(initial?.kind ?? "task")
  const [title, setTitle] = useState(initial?.title ?? "")
  const [notes, setNotes] = useState(initial?.notes ?? "")
  const [allDay, setAllDay] = useState(initial?.allDay ?? true)
  const [startsAt, setStartsAt] = useState(() =>
    initial?.startsAt ? momentInput(initial.startsAt, initial.allDay) : ""
  )
  const [endsAt, setEndsAt] = useState(() =>
    initial?.endsAt ? momentInput(initial.endsAt, initial.allDay) : ""
  )
  const [subjectId, setSubjectId] = useState<string | null>(
    initial?.subjectId ?? null
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const subjectOptions: PickerOption[] = useMemo(
    () => [
      { value: "__none__", label: t("No subject") },
      ...graph.flatten().map((subject) => ({
        value: subject.id,
        label: subject.name,
        depth: graph.depthOf(subject.id),
        hint: subject.kind === "category" ? t("group") : undefined,
        disabled: subject.kind === "category",
        keywords: subject.shortName ?? "",
      })),
    ],
    [graph, t]
  )

  const problems = useMemo(() => {
    const next: Record<string, string> = {}
    const cleanTitle = title.trim()
    if (!cleanTitle) next.title = t("Give this item a title.")
    else if (cleanTitle.length > 160) {
      next.title = t("Keep the title under 160 characters.")
    }
    if (notes.trim().length > 2_000) {
      next.notes = t("Keep notes under 2000 characters.")
    }
    const start = plannerMoment(startsAt, allDay)
    const end = plannerMoment(endsAt, allDay)
    if (kind === "event" && !start) {
      next.startsAt = t("Choose when the event starts.")
    }
    if (kind === "event" && start && end && end < start) {
      next.endsAt = t("The end must be after the start.")
    }
    return next
  }, [allDay, endsAt, kind, notes, startsAt, t, title])

  const reveal = (fields: string[]) => {
    const next = Object.fromEntries(
      fields.flatMap((field) =>
        problems[field] ? [[field, problems[field]]] : []
      )
    )
    setErrors((current) => {
      const updated = { ...current }
      for (const field of fields) {
        if (next[field]) updated[field] = next[field]
        else delete updated[field]
      }
      return updated
    })
    return Object.keys(next).length === 0
  }

  const invalidatePlanner = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.planner.agenda.key(),
        refetchType: "all",
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.planner.list.key(),
        refetchType: "all",
      }),
    ])
  }

  const onSaved = {
    onSuccess: async () => {
      haptic("success")
      toast.success(
        mode === "create" ? t("Agenda item added") : t("Agenda item updated")
      )
      await invalidatePlanner()
      router.push("/agenda")
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The agenda item could not be saved."))
    },
  }
  const create = useMutation({
    ...orpc.planner.create.mutationOptions(),
    ...onSaved,
  })
  const update = useMutation({
    ...orpc.planner.update.mutationOptions(),
    ...onSaved,
  })
  const remove = useMutation({
    ...orpc.planner.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Agenda item deleted"))
      await invalidatePlanner()
      router.push("/agenda")
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const saving = create.isPending || update.isPending || remove.isPending

  const submit = () => {
    const fields = ["title", "notes", "startsAt", "endsAt"]
    if (!reveal(fields) || !yearId) return
    const payload = {
      kind,
      title: title.trim(),
      notes: notes.trim() || null,
      startsAt: plannerMoment(startsAt, allDay),
      endsAt: kind === "event" ? plannerMoment(endsAt, allDay) : null,
      allDay,
      subjectId,
    }
    if (mode === "edit" && initial) {
      update.mutate({ itemId: initial.id, ...payload })
    } else {
      create.mutate({ yearId, ...payload })
    }
  }

  const switchAllDay = (checked: boolean) => {
    setAllDay(checked)
    setStartsAt((value) => convertMomentInput(value, checked))
    setEndsAt((value) => convertMomentInput(value, checked))
  }

  const momentLabel = (value: string) => {
    const date = plannerMoment(value, allDay)
    if (!date) return t("Not scheduled")
    return format.dateTime(
      date,
      allDay
        ? { day: "numeric", month: "long", year: "numeric" }
        : { dateStyle: "long", timeStyle: "short" }
    )
  }

  const steps: FlowStep[] = [
    {
      id: "details",
      title: t("What are you planning?"),
      summary: (
        <span>
          {kind === "task" ? t("Task") : t("Event")} · {title || t("Untitled")}
        </span>
      ),
      validate: () => reveal(["title"]),
      content: (
        <div className="flex flex-col gap-4">
          <ChoiceField
            label={t("Type")}
            value={kind}
            onValueChange={(value) => {
              setKind(value)
              if (value === "task") setEndsAt("")
            }}
            columns={2}
            choices={[
              {
                value: "task",
                label: t("Task"),
                description: t("Something to complete"),
                icon: <CheckSquare2Icon className="size-4" />,
              },
              {
                value: "event",
                label: t("Event"),
                description: t("A date or appointment"),
                icon: <CalendarClockIcon className="size-4" />,
              },
            ]}
          />
          <TextField
            label={t("Title")}
            required
            value={title}
            maxLength={160}
            error={errors.title}
            onChange={(event) => {
              setTitle(event.target.value)
              setErrors((current) => ({ ...current, title: "" }))
            }}
            placeholder={
              kind === "task" ? t("Finish the assignment") : t("Study group")
            }
          />
        </div>
      ),
    },
    {
      id: "when",
      title: kind === "task" ? t("When is it due?") : t("When is it?"),
      description:
        kind === "task"
          ? t("Leave it empty to keep the task in your backlog.")
          : undefined,
      summary: (
        <span>
          {momentLabel(startsAt)}
          {kind === "event" && endsAt ? ` – ${momentLabel(endsAt)}` : ""}
        </span>
      ),
      validate: () => reveal(["startsAt", "endsAt"]),
      content: (
        <div className="flex flex-col gap-4">
          <Field>
            <div className="flex items-center justify-between gap-4 rounded-xl border bg-card p-3">
              <div>
                <FieldLabel htmlFor="planner-all-day">
                  {t("All day")}
                </FieldLabel>
                <FieldDescription>
                  {t("Turn this off to choose an exact time.")}
                </FieldDescription>
              </div>
              <Switch
                id="planner-all-day"
                checked={allDay}
                onCheckedChange={switchAllDay}
              />
            </div>
          </Field>
          <MomentField
            label={kind === "task" ? t("Due date") : t("Starts")}
            value={startsAt}
            onValueChange={(value) => {
              setStartsAt(value)
              setErrors((current) => ({ ...current, startsAt: "" }))
            }}
            allDay={allDay}
            required={kind === "event"}
            error={errors.startsAt}
          />
          {kind === "event" ? (
            <MomentField
              label={t("Ends (optional)")}
              value={endsAt}
              min={startsAt || undefined}
              onValueChange={(value) => {
                setEndsAt(value)
                setErrors((current) => ({ ...current, endsAt: "" }))
              }}
              allDay={allDay}
              error={errors.endsAt}
            />
          ) : null}
        </div>
      ),
    },
    {
      id: "subject",
      title: t("Is it linked to a subject?"),
      description: t("Optional, but useful when several classes share a date."),
      summary:
        subjectOptions.find(
          (option) => option.value === (subjectId ?? "__none__")
        )?.label ?? t("No subject"),
      content: (
        <PickerField
          layout="page"
          label={t("Subject")}
          value={subjectId ?? "__none__"}
          options={subjectOptions}
          onValueChange={(value) =>
            setSubjectId(value === "__none__" ? null : value)
          }
        />
      ),
    },
  ]

  return (
    <FormFlow
      title={mode === "create" ? t("New agenda item") : t("Edit agenda item")}
      backHref="/agenda"
      steps={steps}
      beforeSave={
        <Field data-invalid={errors.notes ? true : undefined}>
          <FieldLabel htmlFor="planner-notes">{t("Notes")}</FieldLabel>
          <Textarea
            id="planner-notes"
            rows={4}
            maxLength={2_000}
            value={notes}
            aria-invalid={errors.notes ? true : undefined}
            placeholder={t("Details, room, or instructions")}
            onChange={(event) => {
              setNotes(event.target.value)
              setErrors((current) => ({ ...current, notes: "" }))
            }}
          />
          {errors.notes ? (
            <p className="text-sm text-destructive">{errors.notes}</p>
          ) : null}
        </Field>
      }
      onSubmit={submit}
      submitLabel={mode === "create" ? t("Add to agenda") : t("Save changes")}
      submitting={saving}
      disabled={!yearId}
      destructive={
        mode === "edit" && initial
          ? {
              label: t("Delete"),
              onClick: () => remove.mutate({ itemId: initial.id }),
            }
          : undefined
      }
    />
  )
}

function MomentField({
  allDay,
  ...props
}: {
  allDay: boolean
  label: string
  value: string
  onValueChange: (value: string) => void
  min?: string
  required?: boolean
  error?: string
}) {
  if (allDay) {
    return <DateField layout="page" {...props} />
  }
  return <DateTimeField {...props} />
}

function momentInput(value: Date, allDay: boolean): string {
  const local = localDateTimeValue(value)
  return allDay ? local.slice(0, 10) : local
}

function convertMomentInput(value: string, allDay: boolean): string {
  if (!value) return ""
  const date = value.split("T")[0] ?? ""
  return allDay ? date : `${date}T${value.split("T")[1] ?? "09:00"}`
}

function plannerMoment(value: string, allDay: boolean): Date | null {
  if (!value) return null
  return parseLocalDateTime(allDay ? `${value}T00:00` : value)
}
