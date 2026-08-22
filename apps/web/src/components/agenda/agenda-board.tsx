"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { CheckCircle2Icon, CircleIcon, GripVerticalIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import {
  boardDropBeforeId,
  moveBoardTask,
  plannerTasksByLane,
  type PlannerItem,
  type PlannerTaskStatus,
} from "./agenda-model"

const STATUSES = ["todo", "doing", "done"] as const
const laneId = (status: PlannerTaskStatus) => `agenda-lane:${status}`

export function AgendaBoard({ yearId }: { yearId: string }) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const query = useQuery(
    orpc.planner.list.queryOptions({
      input: { yearId, includeCompleted: true },
      staleTime: 30_000,
    })
  )
  const serverItems = (query.data ?? []) as PlannerItem[]
  const [optimistic, setOptimistic] = useState<PlannerItem[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const items = optimistic ?? serverItems
  const lanes = useMemo(() => plannerTasksByLane(items), [items])
  const active = activeId
    ? (items.find((item) => item.id === activeId) ?? null)
    : null
  const announcements = useMemo<Announcements>(() => {
    const laneLabels: Record<PlannerTaskStatus, string> = {
      todo: t("To do"),
      doing: t("In progress"),
      done: t("Done"),
    }
    const location = (draggedId: string, overId: string) => {
      const target = items.find((item) => item.id === overId)
      const status = target?.status ?? statusFromLaneId(overId)
      if (!status) return null
      const lane = lanes[status]
      const source = items.find((item) => item.id === draggedId)
      const targetIndex = target
        ? lane.findIndex((item) => item.id === target.id)
        : -1
      const total = lane.length + (source?.status === status ? 0 : 1)
      return {
        lane: laneLabels[status],
        position: targetIndex >= 0 ? targetIndex + 1 : total,
        total,
      }
    }
    const titleOf = (id: string) =>
      items.find((item) => item.id === id)?.title ?? t("Task")
    return {
      onDragStart: ({ active: dragged }) =>
        t("Picked up {title}. Use the arrow keys to move it.", {
          title: titleOf(String(dragged.id)),
        }),
      onDragOver: ({ active: dragged, over }) => {
        if (!over) return undefined
        const next = location(String(dragged.id), String(over.id))
        return next
          ? t("{title}: {lane}, position {position} of {total}.", {
              title: titleOf(String(dragged.id)),
              lane: next.lane,
              position: String(next.position),
              total: String(next.total),
            })
          : undefined
      },
      onDragEnd: ({ active: dragged, over }) => {
        if (!over) return t("Dropped. The board is unchanged.")
        const next = location(String(dragged.id), String(over.id))
        return next
          ? t("Dropped {title} in {lane}.", {
              title: titleOf(String(dragged.id)),
              lane: next.lane,
            })
          : t("Dropped. The board is unchanged.")
      },
      onDragCancel: () => t("Cancelled. The board is unchanged."),
    }
  }, [items, lanes, t])

  const move = useMutation({
    ...orpc.planner.moveInBoard.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.planner.list.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.planner.agenda.key() }),
      ])
      setOptimistic(null)
    },
    onError: (error: Error) => {
      setOptimistic(null)
      haptic("error")
      toast.error(error.message || t("The task could not be moved."))
    },
  })

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const onDragStart = ({ active: dragged }: DragStartEvent) => {
    setActiveId(String(dragged.id))
    haptic("selection")
  }

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActiveId(null)
    if (!over || move.isPending) return
    const itemId = String(dragged.id)
    const overId = String(over.id)
    const targetItem = items.find((item) => item.id === overId)
    const targetStatus = targetItem?.status ?? statusFromLaneId(overId)
    if (!targetStatus) return
    const beforeId = boardDropBeforeId(
      items,
      itemId,
      targetStatus,
      targetItem?.id ?? null
    )
    const next = moveBoardTask(items, itemId, targetStatus, beforeId)
    const currentOrder = plannerTasksByLane(items)[targetStatus].map(
      (item) => item.id
    )
    const nextOrder = plannerTasksByLane(next)[targetStatus].map(
      (item) => item.id
    )
    const current = items.find((item) => item.id === itemId)
    if (
      current?.status === targetStatus &&
      currentOrder.every((id, index) => id === nextOrder[index])
    ) {
      return
    }
    setOptimistic(next)
    move.mutate({ itemId, status: targetStatus, beforeId })
  }

  if (query.isPending) {
    return <div className="h-72 animate-pulse rounded-xl bg-muted/50" />
  }

  if (query.isError) {
    return (
      <p
        role="alert"
        className="rounded-xl border p-4 text-sm text-destructive"
      >
        {query.error.message || t("The agenda could not be loaded.")}
      </p>
    )
  }

  return (
    <DndContext
      accessibility={{ announcements }}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="grid gap-3 @4xl/main:grid-cols-3">
        {STATUSES.map((status) => (
          <BoardLane key={status} status={status} items={lanes[status]} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="w-72" inert>
            <TaskCard item={active} overlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function statusFromLaneId(id: string): PlannerTaskStatus | null {
  if (!id.startsWith("agenda-lane:")) return null
  const status = id.slice("agenda-lane:".length)
  return STATUSES.includes(status as PlannerTaskStatus)
    ? (status as PlannerTaskStatus)
    : null
}

function BoardLane({
  status,
  items,
}: {
  status: PlannerTaskStatus
  items: PlannerItem[]
}) {
  const t = useExtracted()
  const { isOver, setNodeRef } = useDroppable({ id: laneId(status) })
  const labels: Record<PlannerTaskStatus, string> = {
    todo: t("To do"),
    doing: t("In progress"),
    done: t("Done"),
  }

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`agenda-board-${status}`}
      className={cn(
        "min-h-44 rounded-xl border bg-muted/25 p-3 transition-colors",
        isOver && "border-primary bg-primary/5"
      )}
    >
      <h3
        id={`agenda-board-${status}`}
        className="mb-3 flex items-center justify-between text-sm font-semibold"
      >
        <span>{labels[status]}</span>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
          {items.length}
        </span>
      </h3>
      <SortableContext
        items={items.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <SortableTask key={item.id} item={item} />
          ))}
          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
              {t("Drop a task here")}
            </p>
          ) : null}
        </div>
      </SortableContext>
    </section>
  )
}

function SortableTask({ item }: { item: PlannerItem }) {
  const t = useExtracted()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, data: { status: item.status } })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-30")}
    >
      <TaskCard
        item={item}
        handle={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-drag-handle
            aria-label={t("Move {title}", { title: item.title })}
            className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon className="size-4" />
          </Button>
        }
      />
    </div>
  )
}

function TaskCard({
  item,
  handle,
  overlay = false,
}: {
  item: PlannerItem
  handle?: React.ReactNode
  overlay?: boolean
}) {
  const t = useExtracted()
  const format = useFormatter()
  const done = item.status === "done"
  return (
    <article
      className={cn(
        "rounded-lg border bg-card p-3 shadow-xs",
        overlay && "shadow-lg",
        done && "bg-muted/40"
      )}
    >
      <div className="flex items-start gap-2">
        {done ? (
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-band-good" />
        ) : (
          <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <Link
          href={`/agenda/${item.id}/edit`}
          tabIndex={overlay ? -1 : undefined}
          className={cn(
            "min-w-0 flex-1 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
            done && "text-muted-foreground line-through"
          )}
        >
          {item.title}
        </Link>
        {handle}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-2 pl-6 text-xs text-muted-foreground">
        <span>
          {item.startsAt
            ? format.dateTime(
                item.startsAt,
                item.allDay
                  ? { day: "numeric", month: "short" }
                  : { dateStyle: "medium", timeStyle: "short" }
              )
            : t("Backlog")}
        </span>
        {item.notes ? <span className="truncate">{item.notes}</span> : null}
      </div>
    </article>
  )
}
