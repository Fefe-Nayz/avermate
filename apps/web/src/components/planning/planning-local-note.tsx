"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { NotebookPenIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { orpc } from "@/lib/orpc"
import type { PlanningItem } from "./planning-model"

export function PlanningLocalNote({ item }: { item: PlanningItem }) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(item.localNote ?? "")
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.planning.calendar.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.planning.day.key() }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.tasks.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.assignments.list.key(),
      }),
    ])
  }
  const saved = async () => {
    await invalidate()
    toast.success(t("Personal note saved."))
    setOpen(false)
  }
  const task = useMutation({
    ...orpc.planning.tasks.update.mutationOptions(),
    onSuccess: saved,
    onError: (error: Error) => toast.error(error.message),
  })
  const assignment = useMutation({
    ...orpc.planning.assignments.updateLocal.mutationOptions(),
    onSuccess: saved,
    onError: (error: Error) => toast.error(error.message),
  })
  const event = useMutation({
    ...orpc.planning.events.update.mutationOptions(),
    onSuccess: saved,
    onError: (error: Error) => toast.error(error.message),
  })
  const occurrence = useMutation({
    ...orpc.planning.timetable.updateOccurrence.mutationOptions(),
    onSuccess: saved,
    onError: (error: Error) => toast.error(error.message),
  })
  const virtualOccurrence = useMutation({
    ...orpc.planning.timetable.createOccurrence.mutationOptions(),
    onSuccess: saved,
    onError: (error: Error) => toast.error(error.message),
  })
  const pending = [task, assignment, event, occurrence, virtualOccurrence].some(
    (mutation) => mutation.isPending
  )
  const changed = note.trim() !== (item.localNote ?? "").trim()
  const supportsNote =
    item.kind !== "recording" &&
    item.kind !== "legacy" &&
    item.management.editableFields.includes("localNote")

  if (!supportsNote) return null

  const save = () => {
    const localNote = note.trim() || null
    if (item.kind === "task") task.mutate({ taskId: item.id, localNote })
    else if (item.kind === "assignment") {
      assignment.mutate({ assignmentId: item.id, localNote })
    } else if (item.kind === "event") {
      event.mutate({ eventId: item.id, localNote })
    } else if (item.kind === "lesson" && item.virtual) {
      if (!item.seriesId || !item.occurrenceDate) return
      virtualOccurrence.mutate({
        seriesId: item.seriesId,
        occurrenceDate: item.occurrenceDate,
        localNote,
      })
    } else if (item.kind === "lesson") {
      occurrence.mutate({
        occurrenceId: item.occurrenceId ?? item.id,
        localNote,
      })
    }
  }

  return (
    <div className="mt-2">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="-ml-2"
      >
        <NotebookPenIcon />
        {item.localNote ? t("Personal note added") : t("Add a personal note")}
      </Button>
      {open ? (
        <div className="mt-2 rounded-lg border bg-background p-2">
          <label
            htmlFor={`planning-local-note-${item.kind}-${item.id}`}
            className="sr-only"
          >
            {t("Personal note for {title}", { title: item.title })}
          </label>
          <Textarea
            id={`planning-local-note-${item.kind}-${item.id}`}
            value={note}
            maxLength={4_000}
            disabled={pending}
            placeholder={t("Only you can edit this note…")}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-20 resize-y"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={!changed || pending} onClick={save}>
              {t("Save note")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
