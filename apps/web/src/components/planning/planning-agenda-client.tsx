"use client"

import Link from "next/link"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BookOpenCheckIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  Clock3Icon,
  EllipsisIcon,
  NotebookPenIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { SelectControl } from "@/components/forms/controls"
import { dayKey } from "@/components/calendar/month-grid"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
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
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { planningAssignmentsInput } from "@/lib/route-query-inputs"
import { cn } from "@/lib/utils"
import { PlanningEmpty } from "./planning-empty"
import {
  ManagedItemActions,
  PlanningManagementBadges,
} from "./planning-management"
import {
  groupAssignmentsByDueDay,
  normalizePlanningItems,
  planningItemIsComplete,
  planningItemIsManaged,
  planningItemStart,
  type PlanningItem,
} from "./planning-model"

type AssignmentFilter = "open" | "all" | "completed"

export function PlanningAgendaClient({
  initialYearId,
}: {
  initialYearId: string
}) {
  const t = useExtracted()
  const { yearId, graph } = useYear()
  const activeYearId = yearId ?? initialYearId
  const [filter, setFilter] = useState<AssignmentFilter>("open")
  const [subjectId, setSubjectId] = useState("all")
  const input = planningAssignmentsInput(activeYearId)
  const query = useQuery(
    orpc.planning.assignments.list.queryOptions({
      input,
      staleTime: 30_000,
    })
  )
  const assignments = useMemo(
    () => normalizePlanningItems(query.data, "assignment"),
    [query.data]
  )
  const visible = useMemo(
    () =>
      assignments.filter((assignment) => {
        if (subjectId !== "all" && assignment.subjectId !== subjectId) {
          return false
        }
        const completed = planningItemIsComplete(assignment)
        if (filter === "open") return !completed
        if (filter === "completed") return completed
        return true
      }),
    [assignments, filter, subjectId]
  )
  const groups = useMemo(() => groupAssignmentsByDueDay(visible), [visible])
  const subjectOptions = useMemo(
    () => [
      { value: "all", label: t("All subjects") },
      ...graph
        .flatten()
        .filter((subject) => subject.kind !== "category")
        .map((subject) => ({ value: subject.id, label: subject.name })),
    ],
    [graph, t]
  )

  return (
    <>
      <PageMeta
        title={t("Class agenda")}
        subtitle={t("Homework and instructions from every subject")}
      />
      <PageActions>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("New homework")}
          render={<Link href="/planning/agenda/new" />}
        >
          <PlusIcon />
        </Button>
      </PageActions>
      <div className="flex flex-col gap-4">
        <header className="hidden items-start justify-between gap-4 md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Class agenda")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Homework stays separate from your personal tasks, with its school source and due date intact."
              )}
            </p>
          </div>
          <Button size="sm" render={<Link href="/planning/agenda/new" />}>
            <PlusIcon /> {t("New homework")}
          </Button>
        </header>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="group"
            aria-label={t("Homework status")}
            className="flex rounded-lg border bg-muted/35 p-0.5"
          >
            {(["open", "all", "completed"] as const).map((value) => {
              const labels = {
                open: t("To do"),
                all: t("All"),
                completed: t("Completed"),
              }
              return (
                <Button
                  key={value}
                  size="sm"
                  variant={filter === value ? "secondary" : "ghost"}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className="flex-1 sm:flex-none"
                >
                  {labels[value]}
                </Button>
              )
            })}
          </div>
          <SelectControl
            aria-label={t("Filter homework by subject")}
            value={subjectId}
            onValueChange={setSubjectId}
            options={subjectOptions}
            className="h-9 w-full sm:w-56"
            contentClassName="min-w-56"
          />
        </div>

        {query.isPending ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted/50" />
        ) : query.isError ? (
          <p role="alert" className="rounded-xl border p-4 text-destructive">
            {query.error.message}
          </p>
        ) : groups.length === 0 ? (
          <PlanningEmpty
            icon={BookOpenCheckIcon}
            title={t("No homework in this view")}
            description={t(
              "Assignments from your school services and the ones you add yourself will appear here."
            )}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <AssignmentGroup key={group.key} group={group} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function AssignmentGroup({
  group,
}: {
  group: ReturnType<typeof groupAssignmentsByDueDay>[number]
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { now } = useYear()
  const overdue = group.date
    ? group.items.some((item) => !planningItemIsComplete(item)) &&
      dayKey(group.date) < dayKey(new Date(now))
    : false
  const title = group.date
    ? format.dateTime(group.date, {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : t("Without a due date")

  return (
    <section aria-labelledby={`planning-assignment-${group.key}`}>
      <div className="mb-2 flex items-center gap-2">
        <h2
          id={`planning-assignment-${group.key}`}
          className="text-sm font-semibold capitalize"
        >
          {title}
        </h2>
        {overdue ? (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
            {t("Overdue")}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {t("{count} assignments", { count: String(group.items.length) })}
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {group.items.map((assignment) => (
          <AssignmentRow key={assignment.id} assignment={assignment} />
        ))}
      </div>
    </section>
  )
}

function AssignmentRow({ assignment }: { assignment: PlanningItem }) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const { graph } = useYear()
  const [expanded, setExpanded] = useState(false)
  const [note, setNote] = useState(assignment.localNote ?? "")
  const subject = assignment.subjectId
    ? graph.byId(assignment.subjectId)?.name
    : null
  const dueAt = planningItemStart(assignment)
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.planning.assignments.list.key(),
      }),
      queryClient.invalidateQueries({ queryKey: orpc.planning.calendar.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.planning.day.key() }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.tasks.list.key(),
      }),
    ])
  }
  const completion = useMutation({
    ...orpc.planning.assignments.setCompleted.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const updateLocal = useMutation({
    ...orpc.planning.assignments.updateLocal.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Personal note saved."))
      await invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const dismiss = useMutation({
    ...orpc.planning.assignments.dismiss.mutationOptions(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })
  const detach = useMutation({
    ...orpc.planning.assignments.detach.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Editable task created."))
      await invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const completed = planningItemIsComplete(assignment)
  const noteChanged = note.trim() !== (assignment.localNote ?? "").trim()
  const busy =
    completion.isPending ||
    updateLocal.isPending ||
    dismiss.isPending ||
    detach.isPending

  return (
    <article
      className={cn(
        "border-b px-3 py-3 last:border-b-0 sm:px-4",
        completed && "bg-muted/25"
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Checkbox
          checked={completed}
          disabled={completion.isPending}
          aria-label={
            completed
              ? t("Mark {title} as not completed", { title: assignment.title })
              : t("Mark {title} as completed", { title: assignment.title })
          }
          onCheckedChange={(checked) =>
            completion.mutate({
              assignmentId: assignment.id,
              completed: checked === true,
            })
          }
          className="mt-1"
        />
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              "block text-sm font-medium",
              completed && "text-muted-foreground line-through"
            )}
          >
            {assignment.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {subject ? <span>{subject}</span> : null}
            {dueAt && !assignment.allDay ? (
              <span className="inline-flex items-center gap-1">
                <Clock3Icon className="size-3" />
                {format.dateTime(dueAt, { timeStyle: "short" })}
              </span>
            ) : null}
            {assignment.localNote ? (
              <span className="inline-flex items-center gap-1">
                <NotebookPenIcon className="size-3" /> {t("Personal note")}
              </span>
            ) : null}
          </span>
          <span className="mt-2 block">
            <PlanningManagementBadges item={assignment} />
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? t("Collapse details") : t("Expand details")}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
        <ManagedItemActions
          item={assignment}
          pending={busy}
          onDismiss={() => dismiss.mutate({ assignmentId: assignment.id })}
          onDetach={() => detach.mutate({ assignmentId: assignment.id })}
        />
        {!planningItemIsManaged(assignment) ? (
          <LocalAssignmentActions assignment={assignment} />
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-4 ml-7 grid gap-4 border-t pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.7fr)]">
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("Teacher instructions")}
            </h3>
            <p className="mt-1 text-sm whitespace-pre-wrap">
              {assignment.instructions?.trim() ||
                t("No instructions provided.")}
            </p>
          </div>
          <div>
            <label
              htmlFor={`planning-note-${assignment.id}`}
              className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            >
              {t("My private note")}
            </label>
            <Textarea
              id={`planning-note-${assignment.id}`}
              value={note}
              maxLength={2_000}
              disabled={updateLocal.isPending}
              placeholder={t("Add a reminder, a question, or your progress…")}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 min-h-20 resize-y"
            />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                disabled={!noteChanged || updateLocal.isPending}
                onClick={() =>
                  updateLocal.mutate({
                    assignmentId: assignment.id,
                    localNote: note.trim() || null,
                  })
                }
              >
                <CheckCircle2Icon /> {t("Save note")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function LocalAssignmentActions({ assignment }: { assignment: PlanningItem }) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const remove = useMutation({
    ...orpc.planning.assignments.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Homework deleted."))
      setConfirmOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.planning.assignments.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.planning.calendar.key(),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.planning.day.key() }),
      ])
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={remove.isPending}
              aria-label={t("Actions for {title}", {
                title: assignment.title,
              })}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={<Link href={`/planning/agenda/${assignment.id}/edit`} />}
          >
            <PencilIcon /> {t("Edit homework")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2Icon /> {t("Delete homework")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Delete {title}?", { title: assignment.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("This local homework entry will be permanently deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("Keep")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ assignmentId: assignment.id })}
            >
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
