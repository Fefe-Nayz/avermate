"use client"

import Link from "next/link"

import { useMemo, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  CheckSquare2Icon,
  Columns3Icon,
  ListIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { SelectControl } from "@/components/forms/controls"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useYear } from "@/components/year/year-provider"
import { useStickyState } from "@/hooks/use-sticky-state"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { planningTasksInput } from "@/lib/route-query-inputs"
import { cn } from "@/lib/utils"
import { PlanningEmpty } from "./planning-empty"
import {
  ManagedItemActions,
  PlanningManagementBadges,
} from "./planning-management"
import { PlanningLocalNote } from "./planning-local-note"
import {
  normalizePlanningItems,
  planningItemIsComplete,
  planningItemIsManaged,
  planningItemStart,
  tasksByStatus,
  type PlanningItem,
  type PlanningTaskStatus,
} from "./planning-model"

type TaskView = "list" | "board"
const STATUSES = ["todo", "doing", "done"] as const

export function PlanningTasksClient({
  initialYearId,
}: {
  initialYearId: string
}) {
  const t = useExtracted()
  const { yearId } = useYear()
  const activeYearId = yearId ?? initialYearId
  const [view, setView] = useStickyState<TaskView>(
    "avermate:planning-task-view",
    "list"
  )
  const query = useQuery(
    orpc.planning.tasks.list.queryOptions({
      input: planningTasksInput(activeYearId),
      staleTime: 30_000,
    })
  )
  const tasks = useMemo(
    () => normalizePlanningItems(query.data, "task"),
    [query.data]
  )

  return (
    <>
      <PageMeta
        title={t("Tasks")}
        subtitle={t("Your personal to-do list and Kanban board")}
      />
      <PageActions>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("New task")}
          render={<Link href="/planning/tasks/new" />}
        >
          <PlusIcon />
        </Button>
      </PageActions>
      <div className="flex flex-col gap-4">
        <header className="hidden items-start justify-between gap-4 md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Tasks")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Plan your own work here. School assignments stay in the class agenda."
              )}
            </p>
          </div>
          <Button size="sm" render={<Link href="/planning/tasks/new" />}>
            <PlusIcon /> {t("New task")}
          </Button>
        </header>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t("{count} personal tasks", { count: String(tasks.length) })}
          </p>
          <div
            role="group"
            aria-label={t("Task view")}
            className="flex rounded-lg border bg-muted/35 p-0.5"
          >
            <Button
              size="sm"
              variant={view === "list" ? "secondary" : "ghost"}
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <ListIcon /> {t("List")}
            </Button>
            <Button
              size="sm"
              variant={view === "board" ? "secondary" : "ghost"}
              aria-pressed={view === "board"}
              onClick={() => setView("board")}
            >
              <Columns3Icon /> {t("Kanban")}
            </Button>
          </div>
        </div>

        {query.isPending ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted/50" />
        ) : query.isError ? (
          <p role="alert" className="rounded-xl border p-4 text-destructive">
            {query.error.message}
          </p>
        ) : tasks.length === 0 ? (
          <PlanningEmpty
            icon={CheckSquare2Icon}
            title={t("Your task list is clear")}
            description={t(
              "Add a personal task here, or detach school homework when you need an editable copy."
            )}
          />
        ) : view === "list" ? (
          <TaskList tasks={tasks} />
        ) : (
          <TaskBoard tasks={tasks} />
        )}
      </div>
    </>
  )
}

function TaskList({ tasks }: { tasks: PlanningItem[] }) {
  const lanes = tasksByStatus(tasks)
  return (
    <div className="flex flex-col gap-5">
      {STATUSES.map((status) => (
        <TaskLane key={status} status={status} tasks={lanes[status]} list />
      ))}
    </div>
  )
}

/**
 * A board a card can actually be moved on.
 *
 * The three columns were already here and a card could not leave the one it was in:
 * changing a task's state meant opening its menu and picking the state by name, which is
 * a form with columns drawn around it rather than a board. Dragging is the one gesture a
 * board exists for.
 *
 * dnd-kit, the same machinery the dashboard grid and every sortable list already use, so
 * a drag feels the same everywhere and the keyboard support comes with it: the sensors
 * below give a card `space` to lift, arrows to move and `space` to drop.
 *
 * The drop mutates and lets the query invalidate. An optimistic lane would have to be
 * unwound on failure, and a task that silently slid back to its old column is worse than
 * one that takes a moment to arrive.
 */
function TaskBoard({ tasks }: { tasks: PlanningItem[] }) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const lanes = tasksByStatus(tasks)
  const [dragging, setDragging] = useState<PlanningItem | null>(null)
  const sensors = useSensors(
    // A few pixels of travel before a drag begins, so tapping a card still opens it.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )
  const setStatus = useMutation({
    ...orpc.planning.tasks.setStatus.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await invalidatePlanningTasks(queryClient)
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The task could not be moved."))
    },
  })

  const laneLabels: Record<PlanningTaskStatus, string> = {
    todo: t("To do"),
    doing: t("In progress"),
    done: t("Done"),
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            t("Picked up {task}", { task: String(active.id) }),
          onDragOver: ({ over }) =>
            over
              ? t("Over {lane}", {
                  lane: laneLabels[over.id as PlanningTaskStatus] ?? "",
                })
              : undefined,
          onDragEnd: ({ over }) =>
            over
              ? t("Moved to {lane}", {
                  lane: laneLabels[over.id as PlanningTaskStatus] ?? "",
                })
              : t("Left where it was"),
          onDragCancel: () => t("Left where it was"),
        },
      }}
      onDragStart={(event) => {
        haptic("selection")
        setDragging(tasks.find((task) => task.id === event.active.id) ?? null)
      }}
      onDragCancel={() => setDragging(null)}
      onDragEnd={(event) => {
        setDragging(null)
        const taskId = String(event.active.id)
        const target = event.over?.id as PlanningTaskStatus | undefined
        if (!target || !STATUSES.includes(target)) return
        const task = tasks.find((entry) => entry.id === taskId)
        const current =
          task?.status === "doing" || task?.status === "done"
            ? task.status
            : "todo"
        if (current === target) return
        setStatus.mutate({ taskId, status: target })
      }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {STATUSES.map((status) => (
          <TaskLane
            key={status}
            status={status}
            tasks={lanes[status]}
            draggable
          />
        ))}
      </div>
      <DragOverlay>
        {dragging ? (
          <div className="w-64 rotate-2 opacity-95">
            <TaskCard task={dragging} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/** A lane, as somewhere a card can be dropped. */
function TaskLaneDropZone({
  status,
  children,
  className,
}: {
  status: PlanningTaskStatus
  children: ReactNode
  className?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        "rounded-xl transition-colors",
        isOver && "bg-primary/5 ring-2 ring-primary/40 ring-inset"
      )}
    >
      {children}
    </div>
  )
}

/** A card, as something that can be picked up. */
function DraggableTask({ task }: { task: PlanningItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      className={cn(
        "touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        // The original stays in place while the overlay follows the pointer, so the
        // column keeps its height and the other cards do not jump.
        isDragging && "opacity-40"
      )}
    >
      <TaskCard task={task} />
    </div>
  )
}

function TaskLane({
  status,
  tasks,
  list = false,
  draggable = false,
}: {
  status: PlanningTaskStatus
  tasks: PlanningItem[]
  list?: boolean
  draggable?: boolean
}) {
  const t = useExtracted()
  const labels = {
    todo: t("To do"),
    doing: t("In progress"),
    done: t("Done"),
  }
  if (list && tasks.length === 0) return null
  const lane = (
    <section
      aria-labelledby={`planning-task-lane-${status}-${list ? "list" : "board"}`}
      className={cn(!list && "min-h-44 rounded-xl border bg-muted/25 p-3")}
    >
      <h2
        id={`planning-task-lane-${status}-${list ? "list" : "board"}`}
        className="mb-2 flex items-center justify-between text-sm font-semibold"
      >
        <span>{labels[status]}</span>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
          {tasks.length}
        </span>
      </h2>
      <div
        className={cn(
          list
            ? "overflow-hidden rounded-xl border bg-card"
            : "flex flex-col gap-2"
        )}
      >
        {tasks.map((task) =>
          draggable ? (
            <DraggableTask key={task.id} task={task} />
          ) : (
            <TaskCard key={task.id} task={task} row={list} />
          )
        )}
        {!list && tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
            {t("No tasks in this column")}
          </p>
        ) : null}
      </div>
    </section>
  )
  return draggable ? (
    <TaskLaneDropZone status={status}>{lane}</TaskLaneDropZone>
  ) : (
    lane
  )
}

function TaskCard({ task, row }: { task: PlanningItem; row?: boolean }) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const { graph } = useYear()
  const managed = planningItemIsManaged(task)
  const status: PlanningTaskStatus =
    task.status === "doing" || task.status === "done" ? task.status : "todo"
  const due = planningItemStart(task)
  const subject = task.subjectId ? graph.byId(task.subjectId)?.name : null
  const setStatus = useMutation({
    ...orpc.planning.tasks.setStatus.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await invalidatePlanningTasks(queryClient)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const remove = useMutation({
    ...orpc.planning.tasks.delete.mutationOptions(),
    onSuccess: () => invalidatePlanningTasks(queryClient),
    onError: (error: Error) => toast.error(error.message),
  })
  const dismiss = useMutation({
    ...orpc.planning.tasks.dismiss.mutationOptions(),
    onSuccess: () => invalidatePlanningTasks(queryClient),
    onError: (error: Error) => toast.error(error.message),
  })
  const detach = useMutation({
    ...orpc.planning.tasks.detach.mutationOptions(),
    onSuccess: () => invalidatePlanningTasks(queryClient),
    onError: (error: Error) => toast.error(error.message),
  })
  const busy =
    setStatus.isPending ||
    remove.isPending ||
    dismiss.isPending ||
    detach.isPending

  return (
    <article
      className={cn(
        "bg-card p-3",
        row ? "border-b last:border-b-0" : "rounded-lg border shadow-xs"
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Checkbox
          checked={planningItemIsComplete(task)}
          disabled={setStatus.isPending}
          aria-label={t("Toggle completion for {title}", { title: task.title })}
          onCheckedChange={(checked) =>
            setStatus.mutate({
              taskId: task.id,
              status: checked === true ? "done" : "todo",
            })
          }
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "font-medium",
              status === "done" && "text-muted-foreground line-through"
            )}
          >
            {task.title}
          </h3>
          {task.notes ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {task.notes}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {subject ? <span>{subject}</span> : null}
            {due ? (
              <time dateTime={due.toISOString()}>
                {format.dateTime(due, { dateStyle: "medium" })}
              </time>
            ) : null}
          </div>
          <div className="mt-2">
            <PlanningManagementBadges item={task} />
          </div>
          <PlanningLocalNote item={task} />
        </div>
        <ManagedItemActions
          item={task}
          pending={busy}
          onDismiss={() => dismiss.mutate({ taskId: task.id })}
          onDetach={() => detach.mutate({ taskId: task.id })}
        />
        {!managed ? (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={remove.isPending}
            aria-label={t("Delete {title}", { title: task.title })}
            onClick={() => remove.mutate({ taskId: task.id })}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </div>
      <SelectControl
        aria-label={t("Status for {title}", { title: task.title })}
        value={
          setStatus.isPending ? (setStatus.variables?.status ?? status) : status
        }
        disabled={setStatus.isPending}
        onValueChange={(value) =>
          setStatus.mutate({
            taskId: task.id,
            status: value as PlanningTaskStatus,
          })
        }
        className="mt-3 h-8 text-xs"
        options={[
          { value: "todo", label: t("To do") },
          { value: "doing", label: t("In progress") },
          { value: "done", label: t("Done") },
        ]}
      />
    </article>
  )
}

async function invalidatePlanningTasks(
  queryClient: ReturnType<typeof useQueryClient>
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.planning.tasks.list.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.planning.calendar.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.planning.day.key() }),
    queryClient.invalidateQueries({
      queryKey: orpc.planning.assignments.list.key(),
    }),
  ])
}
