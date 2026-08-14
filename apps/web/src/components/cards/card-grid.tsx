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
import {
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import {
  layoutCards,
  widgetCapability,
  widgetDefinitionToLegacyProjection,
  widgetMeasureId,
  type CardSpec,
  type WidgetSurface,
} from "@avermate/core"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useYear, type DashboardCardRow } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { cardAccent } from "./card-accent"
import {
  legacyCardSpec,
  resolveWidgetRow,
  widgetEvaluationMode,
} from "./widget-row"
import { useWidgetMessages } from "./use-widget-messages"
import { useWidgetResult } from "./use-widget-result"
import { WidgetBody } from "./widget-view"
import {
  CardBody,
  cardSurface,
  useCardResult,
  useMetricLabels,
} from "./card-view"

/**
 * The dashboard grid.
 *
 * Cards are rows in the database, so the layout a student builds is theirs on
 * every device. Reordering is drag-and-drop with a keyboard path, and editing
 * happens on its own screen rather than in a popover — same rule as every
 * other form in the app.
 */

export function toSpec(row: DashboardCardRow): CardSpec {
  const resolved = resolveWidgetRow(row)
  if (resolved.source === "legacy") return legacyCardSpec(row)
  const projection =
    resolved.source === "v1"
      ? widgetDefinitionToLegacyProjection(resolved.definition)
      : null
  return {
    id: row.id,
    metric: projection?.metric ?? "average",
    target: {
      kind: projection?.targetKind ?? "general",
      referenceId: projection?.targetId ?? row.targetId,
    },
    display: projection?.display ?? (row.display as CardSpec["display"]),
    span: Math.min(4, Math.max(1, row.span)) as CardSpec["span"],
    title: row.title,
    accent: row.accent,
    goalId: projection?.goalId ?? row.goalId,
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
  surface,
}: {
  row: DashboardCardRow
  editing: boolean
  spanClasses: string
  surface: WidgetSurface
}) {
  const t = useExtracted()
  const { yearId } = useYear()
  const message = useWidgetMessages()
  const labels = useMetricLabels()
  const resolved = useMemo(() => resolveWidgetRow(row), [row])
  const evaluation = widgetEvaluationMode(resolved.source)
  const spec = useMemo(() => toSpec(row), [row])
  const legacyResult = useCardResult(spec, evaluation.legacy)
  const widgetResult = useWidgetResult(
    resolved.definition,
    surface,
    evaluation.v1
  )
  const defaultTitle = message(
    widgetCapability(widgetMeasureId(resolved.definition.analysis.measure))
      .messageKey
  )
  const accent = cardAccent(spec.accent)
  const route = surface === "insights" ? "/insights/cards" : "/dashboard/cards"
  const queryClient = useQueryClient()
  const visibility = useMutation({
    ...orpc.cards.update.mutationOptions(),
    onSuccess: () => {
      haptic("light")
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
    },
  })
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
        // Its own query container: the body scales its type to the width the
        // grid actually gave this card, not to the viewport.
        "@container/card relative gap-2 overflow-hidden py-4",
        cardSurface(resolved.source === "legacy" ? legacyResult : widgetResult),
        spanClasses,
        row.hidden && "opacity-55",
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
          {spec.title ??
            (resolved.source === "v1" ? defaultTitle : labels[spec.metric])}
        </CardTitle>
        {editing ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={visibility.isPending}
              aria-label={row.hidden ? t("Show card") : t("Hide card")}
              onClick={() =>
                visibility.mutate({ cardId: row.id, hidden: !row.hidden })
              }
            >
              {row.hidden ? (
                <EyeIcon className="size-3.5" />
              ) : (
                <EyeOffIcon className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Edit card")}
              render={<Link href={`${route}/${row.id}`} />}
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
      {/* The row's height is set by its tallest card; `flex-1` hands the
          difference to the body so charts can drink it. Bodies that keep
          their natural height simply leave it. */}
      <CardContent className="min-h-0 flex-1 px-4">
        {resolved.source === "v1" ? (
          <WidgetBody
            definition={resolved.definition}
            result={widgetResult}
            expanded={surface === "insights"}
          />
        ) : (
          <CardBody spec={spec} result={legacyResult} />
        )}
      </CardContent>
    </Card>
  )
}

export function CardGrid({
  editing,
  surface = "overview",
}: {
  editing: boolean
  surface?: Extract<WidgetSurface, "overview" | "insights">
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { cards, yearId } = useYear()

  const surfaceCards = useMemo(
    () =>
      cards
        .filter((card) => card.surface === surface)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [cards, surface]
  )
  const visible = useMemo(
    () => surfaceCards.filter((card) => editing || !card.hidden),
    [editing, surfaceCards]
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
  const reset = useMutation({
    ...orpc.cards.reset.mutationOptions(),
    onSuccess: () => {
      haptic("success")
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
    const allHidden = surfaceCards.length > 0
    const addHref =
      surface === "insights" ? "/insights/cards/new" : "/dashboard/cards/new"
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {allHidden
            ? t("All cards are hidden. Customise this page to show them again.")
            : surface === "insights"
              ? t("You have not added any insights yet.")
              : t("Your dashboard is empty.")}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {!allHidden ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={addHref} />}
            >
              <PlusIcon className="size-4" />
              {surface === "insights" ? t("Add an insight") : t("Add a card")}
            </Button>
          ) : null}
          {surface === "insights" && !allHidden ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!yearId || reset.isPending}
              onClick={() =>
                reset.mutate({ yearId: yearId as string, surface: "insights" })
              }
            >
              {t("Restore recommended insights")}
            </Button>
          ) : null}
        </div>
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
              surface={surface}
            />
          ))}
          {editing ? (
            // It takes whatever the last row has left, so the hole the layout
            // deliberately kept reads as an invitation rather than a mistake.
            <Button
              variant="outline"
              className={cn("h-full min-h-24 border-dashed", placement.gap)}
              render={
                <Link
                  href={
                    surface === "insights"
                      ? "/insights/cards/new"
                      : "/dashboard/cards/new"
                  }
                />
              }
            >
              <PlusIcon className="size-4" />
              {surface === "insights" ? t("Add an insight") : t("Add a card")}
            </Button>
          ) : null}
        </div>
      </SortableContext>
    </DndContext>
  )
}
