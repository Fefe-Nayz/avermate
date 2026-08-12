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
import { layoutCards, type CardSpec } from "@avermate/core"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useYear, type DashboardCardRow } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { cardAccent } from "./card-accent"
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

/**
 * Three grids, one stored layout.
 *
 * A column has to stay wide enough to hold a title and a number, so the grid
 * gains columns as the dashboard gains width rather than at some fixed idea of
 * "phone" and "desktop" — four columns at 448px gave 112px tiles, which is
 * where "STRONGEST SUBJECT" became "STRONGE…". Every width below comes out of
 * `layoutCards`, the same function the editor previews with.
 */
const GRID_STEPS = [
  { columns: 2, container: "" },
  { columns: 3, container: "@2xl/main:" },
  { columns: 4, container: "@4xl/main:" },
] as const

const SPAN_CLASS: Record<string, string> = {
  "1": "col-span-1",
  "2": "col-span-2",
  "@2xl/main:1": "@2xl/main:col-span-1",
  "@2xl/main:2": "@2xl/main:col-span-2",
  "@2xl/main:3": "@2xl/main:col-span-3",
  "@4xl/main:1": "@4xl/main:col-span-1",
  "@4xl/main:2": "@4xl/main:col-span-2",
  "@4xl/main:3": "@4xl/main:col-span-3",
  "@4xl/main:4": "@4xl/main:col-span-4",
}

/** What is left of the last row, which is where "Add a card" belongs. */
function trailingGap(widths: number[], columns: number): number {
  let used = 0
  for (const width of widths) {
    if (used + width > columns) used = width
    else used += width
    if (used === columns) used = 0
  }
  return used === 0 ? columns : columns - used
}

function DashboardCard({
  row,
  editing,
  spanClasses,
}: {
  row: DashboardCardRow
  editing: boolean
  spanClasses: string
}) {
  const t = useExtracted()
  const labels = useMetricLabels()
  const spec = useMemo(() => toSpec(row), [row])
  const result = useCardResult(spec)
  const accent = cardAccent(spec.accent)
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
        "relative gap-2 overflow-hidden py-4",
        spanClasses,
        isDragging && "z-10 opacity-80 shadow-lg"
      )}
    >
      {accent ? (
        <span
          aria-hidden
          className={cn("absolute inset-x-0 top-0 h-0.5", accent.bar)}
        />
      ) : null}
      <CardHeader className="flex items-start gap-1 px-4">
        <CardTitle
          className={cn(
            // Two lines rather than an ellipsis: at the narrowest column
            // "Strongest subject" does not fit on one, and a card whose own
            // title is cut off has stopped saying what it is.
            "line-clamp-2 min-w-0 flex-1 text-xs leading-tight font-medium tracking-wide uppercase",
            accent ? accent.text : "text-muted-foreground"
          )}
        >
          {spec.title ?? labels[spec.metric]}
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

  // The same stored spans, read once for every grid this page can become.
  const placement = useMemo(() => {
    const specs = visible.map(toSpec)
    const perCard = new Map<string, string[]>()
    const gaps: string[] = []

    for (const step of GRID_STEPS) {
      const placed = layoutCards(specs, step.columns)
      for (const item of placed) {
        const classes = perCard.get(item.spec.id) ?? []
        classes.push(SPAN_CLASS[`${step.container}${item.columns}`] ?? "")
        perCard.set(item.spec.id, classes)
      }
      const gap = trailingGap(
        placed.map((item) => item.columns),
        step.columns
      )
      gaps.push(SPAN_CLASS[`${step.container}${gap}`] ?? "")
    }

    return {
      spans: new Map(
        [...perCard].map(([id, classes]) => [id, classes.join(" ")])
      ),
      gap: gaps.join(" "),
    }
  }, [visible])

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
        <div className="grid grid-cols-2 gap-3 @2xl/main:grid-cols-3 @4xl/main:grid-cols-4">
          {visible.map((row) => (
            <DashboardCard
              key={row.id}
              row={row}
              editing={editing}
              spanClasses={placement.spans.get(row.id) ?? ""}
            />
          ))}
          {editing ? (
            // It takes whatever the last row has left, so the hole the layout
            // deliberately kept reads as an invitation rather than a mistake.
            <Button
              variant="outline"
              className={cn(
                "h-full min-h-24 border-dashed",
                placement.gap
              )}
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
