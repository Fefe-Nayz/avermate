"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement } from "@dnd-kit/modifiers"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVerticalIcon, PencilIcon, PlusIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import type { CardSpec } from "@avermate/core"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useYear, type DashboardCardRow } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { CardBody, useCardResult, useMetricLabels } from "./card-view"

/**
 * The dashboard grid.
 *
 * Cards are rows in the database, so the layout a student builds is theirs on
 * every device. Reordering is drag-and-drop with a keyboard path, and editing
 * happens on its own screen rather than in a popover — same rule as every
 * other form in the app.
 */

export function toSpec(row: DashboardCardRow): CardSpec {
  return {
    id: row.id,
    metric: row.metric as CardSpec["metric"],
    target: {
      kind: row.targetKind as CardSpec["target"]["kind"],
      referenceId: row.targetId,
    },
    display: row.display as CardSpec["display"],
    span: Math.min(4, Math.max(1, row.span)) as CardSpec["span"],
    title: row.title,
    accent: row.accent,
    goalId: row.goalId,
    sortOrder: row.sortOrder,
    hidden: row.hidden,
  }
}

const SPAN_CLASS: Record<number, string> = {
  1: "@md/main:col-span-1",
  2: "@md/main:col-span-2",
  3: "@md/main:col-span-3",
  4: "@md/main:col-span-4",
}

function DashboardCard({
  row,
  editing,
}: {
  row: DashboardCardRow
  editing: boolean
}) {
  const t = useExtracted()
  const labels = useMetricLabels()
  const { headlineAverage } = useYear()
  const spec = useMemo(() => toSpec(row), [row])
  const result = useCardResult(spec)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, disabled: !editing })

  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "col-span-2 gap-2 py-4",
        SPAN_CLASS[spec.span],
        isDragging && "z-10 opacity-80 shadow-lg"
      )}
    >
      <CardHeader className="flex items-center gap-1 px-4">
        <CardTitle className="min-w-0 flex-1 truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {spec.title ??
            (headlineAverage &&
            spec.metric === "average" &&
            spec.target.kind === "general"
              ? headlineAverage.name
              : labels[spec.metric])}
        </CardTitle>
        {editing ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Edit card")}
              render={<Link href={`/dashboard/cards/${row.id}`} />}
            >
              <PencilIcon className="size-3.5" />
            </Button>
            <button
              type="button"
              aria-label={t("Reorder")}
              className="cursor-grab touch-none rounded p-1 text-muted-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVerticalIcon className="size-4" />
            </button>
          </>
        ) : null}
      </CardHeader>
      <CardContent className="px-4">
        <CardBody spec={spec} result={result} />
      </CardContent>
    </Card>
  )
}

export function CardGrid({ editing }: { editing: boolean }) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { cards, yearId } = useYear()

  const visible = useMemo(
    () =>
      cards
        .filter((card) => card.surface === "overview" && !card.hidden)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [cards]
  )

  const reorder = useMutation({
    ...orpc.cards.reorder.mutationOptions(),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
    },
  })

  const sensors = useSensors(
    // A small distance before a drag starts, so a tap on a card link is still
    // a tap and not the beginning of a reorder.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const ids = visible.map((card) => card.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return

    haptic("light")
    reorder.mutate({ cardIds: arrayMove(ids, from, to) })
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {t("Your dashboard is empty.")}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          render={<Link href="/dashboard/cards/new" />}
        >
          <PlusIcon className="size-4" />
          {t("Add a card")}
        </Button>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={visible.map((card) => card.id)}
        strategy={rectSortingStrategy}
      >
        <div className="grid grid-cols-2 gap-3 @md/main:grid-cols-4">
          {visible.map((row) => (
            <DashboardCard key={row.id} row={row} editing={editing} />
          ))}
          {editing ? (
            <Button
              variant="outline"
              className="col-span-2 h-full min-h-24 border-dashed @md/main:col-span-1"
              render={<Link href="/dashboard/cards/new" />}
            >
              <PlusIcon className="size-4" />
              {t("Add a card")}
            </Button>
          ) : null}
        </div>
      </SortableContext>
    </DndContext>
  )
}
