"use client"

import Link from "next/link"
import { useCallback, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement } from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  type SortingStrategy,
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
  cardGridCells,
  layoutCardGrid,
  layoutCards,
  planGridReorder,
  resolveGridReorder,
  widgetCapability,
  widgetDefinitionToLegacyProjection,
  widgetMeasureId,
  type CardSpec,
  type WidgetSurface,
} from "@avermate/core"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useYear, type DashboardCardRow } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { cardAccent } from "./card-accent"
import {
  gridPreviewTransforms,
  readGridTracks,
  type GridTracks,
} from "./grid-preview"
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

/**
 * How many columns the grid is actually drawing.
 *
 * Read from the CSS rather than from a parallel breakpoint table in JavaScript.
 * The three steps below are container queries, so the container decides — and a
 * sidebar, a resized pane or a narrow embed all make a viewport-width guess
 * disagree with what is on screen. A drop resolved against the wrong column
 * count is resolved against the wrong rows.
 */
function renderedColumns(grid: HTMLElement | null, fallback: number): number {
  if (!grid) return fallback
  const tracks = getComputedStyle(grid).gridTemplateColumns.trim()
  if (!tracks || tracks === "none") return fallback
  // Counted, not measured — deliberately not routed through `readGridTracks`.
  // That one needs each track's width as a number and gives up if any of them
  // is not one; a browser that answered with the specified value rather than the
  // used one would cost this the column count too, and a drop resolved against
  // the wrong column count is resolved against the wrong rows. Losing the
  // preview there is a blemish; losing the count changes what a drop does.
  return tracks.split(/\s+/).length
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
      // The grid reads this back to measure a row's edge while dragging.
      data-card-id={row.id}
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
      {/* CardHeader is a grid, and CardAction is its second column: the title
          gets the `1fr` and the controls the `auto`, so the two never bargain
          for the same pixels. Laying them out as loose flex siblings is what
          let a long title be squeezed mid-word on the narrowest column, and
          left the handle sitting on a different baseline from the buttons. */}
      <CardHeader className="px-4">
        <CardTitle
          className={cn(
            // Two lines rather than an ellipsis: at the narrowest column
            // "Strongest subject" does not fit on one, and a card whose own
            // title is cut off has stopped saying what it is. `break-words`
            // covers the case the column is narrower than the longest word.
            "line-clamp-2 min-w-0 text-xs leading-tight font-medium tracking-wide break-words uppercase",
            accent ? accent.text : "text-muted-foreground"
          )}
        >
          {spec.title ??
            (resolved.source === "v1" ? defaultTitle : labels[spec.metric])}
        </CardTitle>
        {editing ? (
          <CardAction className="flex items-center gap-0.5">
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
            {/* The same button box as its two neighbours, so the three read as
                one control group rather than two buttons and a loose glyph. */}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Reorder")}
              // Read by the shell's pull-to-refresh, which must not mistake the
              // start of a reorder for a pull. See `data-drag-handle` there.
              data-drag-handle
              className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVerticalIcon className="size-4" />
            </Button>
          </CardAction>
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
  const stored = useMemo(
    () => surfaceCards.filter((card) => editing || !card.hidden),
    [editing, surfaceCards]
  )
  const gridRef = useRef<HTMLDivElement>(null)
  /**
   * The order the drop produced, held until the server's own order arrives.
   *
   * Only ever written on drop, so it is never an input to the resolver — see
   * `onDragEnd` for why that distinction is the whole fix.
   */
  const [pendingIds, setPendingIds] = useState<string[] | null>(null)

  const visible = useMemo(() => {
    if (!pendingIds) return stored
    const byId = new Map(stored.map((card) => [card.id, card]))
    const ordered = pendingIds.flatMap((id) => {
      const card = byId.get(id)
      return card ? [card] : []
    })
    // Any card the pending order does not mention (a refetch added one
    // mid-flight) keeps its stored place rather than vanishing.
    return ordered.length === stored.length ? ordered : stored
  }, [pendingIds, stored])

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
      // Straight from the engine: a second implementation of the packing rules
      // here is a second thing to keep in step with it.
      const rows = layoutCardGrid(specs, step.columns).rows
      const lastRow = rows[rows.length - 1]
      const gap =
        !lastRow || lastRow.remainingColumns === 0
          ? step.columns
          : lastRow.remainingColumns
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
    onError: () => {
      // Snap back to what the server still holds, rather than leaving a layout
      // on screen that was never saved.
      haptic("warning")
      setPendingIds(null)
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
      // Released only once the refetched order is in hand, so the grid never
      // flashes the old arrangement between the drop and the answer.
      setPendingIds(null)
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

  // The same split SortableList uses, and for the same reason: one
  // PointerSensor cannot serve both inputs. A distance constraint asks the
  // browser to hold off on scrolling until the threshold is crossed, which it
  // will not do for a finger — it starts scrolling and cancels the pointer, so
  // the card never picks up. Touch gets a deliberate hold instead, mouse keeps
  // the small distance so a tap on a card link stays a tap.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  /**
   * The order a drop means, resolved against the rows on screen.
   *
   * `arrayMove` onto whichever single card the pointer was nearest is what
   * split a two-card row when a full-width card was dragged past it: landing on
   * the left one produced `[A, M, B]`, whose packing widens A into M's place.
   * `resolveGridReorder` reads the same rows the grid drew and treats a row the
   * dragged card cannot join as one destination, so both halves of that row
   * mean the same thing.
   */
  const resolve = useCallback(
    (activeId: string, overId: string, order: readonly DashboardCardRow[]) => {
      const columns = renderedColumns(gridRef.current, GRID_STEPS[0].columns)
      return resolveGridReorder(order.map(toSpec), columns, activeId, overId)
    },
    []
  )

  // Both keyed off what is on screen, because that is what dnd-kit measured.
  const itemIds = useMemo(() => visible.map((card) => card.id), [visible])
  const specs = useMemo(() => visible.map(toSpec), [visible])

  /**
   * The grid's track sizes and the preview they produce, taken once per drag.
   *
   * Read at `dragStart` rather than inside the strategy: the strategy runs for
   * every card on every pointer move, and `getComputedStyle` there would be a
   * layout read in the middle of rendering. The tracks cannot change mid-drag
   * anyway — nothing is reordered and the container keeps its width.
   */
  const tracksRef = useRef<GridTracks | null>(null)
  const previewRef = useRef<{
    key: string
    deltas: Map<string, { x: number; y: number }>
  } | null>(null)

  /**
   * What the drag is aimed at — the destination row's anchor, when a row is the
   * destination.
   *
   * This is what makes the preview and the drop the same thing. A sortable draws
   * its preview by moving the dragged card to the index of whatever it is told
   * the target is, and `closestCenter` tells it the nearest card. For a move
   * across rows that is the wrong card: drag a full-width card over the left half
   * of a pair and the preview widens that half into its place, while the drop
   * puts the card below the pair intact. Both were right about different things,
   * and releasing looked like the pair swapping.
   *
   * The escape is that the row-atomic answer is *itself* an ordinary move — to
   * the far card of that row. Naming that card here means the sortable's own
   * preview computes the order the drop will produce, so there is one mechanism
   * rather than two to hold in agreement, and the cards keep moving under the
   * finger the way they always did.
   *
   * Nothing is reordered while dragging, so the geometry the pointer is tested
   * against never moves — the runaway rearrangement this once caused cannot come
   * back through here. The mapping is also its own fixed point: resolving the
   * anchor again yields the same anchor, so feeding it back cannot oscillate.
   */
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const collisions = closestCenter(args)
      const nearest = collisions[0]
      if (!nearest) return collisions

      const columns = renderedColumns(gridRef.current, GRID_STEPS[0].columns)
      const { insertion } = planGridReorder(
        specs,
        columns,
        String(args.active.id),
        String(nearest.id)
      )
      if (!insertion || insertion.anchorId === String(nearest.id)) {
        return collisions
      }

      const anchor = collisions.find(
        (collision) => String(collision.id) === insertion.anchorId
      )
      return [anchor ?? { id: insertion.anchorId }, ...collisions]
    },
    [specs]
  )

  /**
   * Where every card moves to while the drag is under way.
   *
   * `rectSortingStrategy` cannot draw this grid. It permutes the rectangles it
   * measured — each card slides into the box another card vacated — which is a
   * reorder only if the boxes are interchangeable. Repacking makes new boxes:
   * rows are composed differently and are different heights, so cards were being
   * translated into boxes the new arrangement does not contain, and they landed
   * on top of one another. Only the *scale* half of its answer was ever
   * discarded here, which is why they overlapped rather than stretched.
   *
   * `cardGridCells` says which cell each card lands in, and the grid's own track
   * sizes turn that into pixels — so the preview is the arrangement the drop
   * produces, computed by the same packer, and the cards still move under the
   * finger the way they always did.
   *
   * The answer is cached per destination: the strategy is called once per card
   * per pointer move, and the plan only changes when the target does.
   */
  const strategy = useCallback<SortingStrategy>(
    ({ rects, activeIndex, overIndex, index }) => {
      const tracks = tracksRef.current
      const rect = rects[index]
      const activeId = itemIds[activeIndex]
      const overId = itemIds[overIndex]
      if (!tracks || !rect || !activeId || !overId) return null

      const columns = tracks.columnWidths.length
      const key = `${activeId}>${overId}@${columns}`
      if (previewRef.current?.key !== key) {
        const order = planGridReorder(specs, columns, activeId, overId).order
        const byId = new Map(specs.map((spec) => [spec.id, spec]))
        const reordered = order.flatMap((id) => {
          const spec = byId.get(id)
          return spec ? [spec] : []
        })
        previewRef.current = {
          key,
          deltas: gridPreviewTransforms({
            ids: itemIds,
            rects,
            cells: cardGridCells(reordered, columns),
            tracks,
          }),
        }
      }

      const id = itemIds[index]
      const delta = id ? previewRef.current.deltas.get(id) : undefined
      return delta ? { ...delta, scaleX: 1, scaleY: 1 } : null
    },
    [itemIds, specs]
  )

  /**
   * The order is resolved once, on the drop, against the order the server
   * holds — never against what the drag is currently showing.
   *
   * Resolving on every `dragover` and rendering the answer fed the resolver its
   * own output: the repack moved the cards, dnd-kit recomputed which card the
   * pointer was over on the *new* geometry, and that resolved to a different
   * order again. On a uniform 2×2 the two answers alternated forever. A move is
   * not idempotent — "put B where A is" applied twice puts them back — so no
   * resolver can be made safe against that loop. The loop has to not exist.
   *
   * So the grid itself does not repack under the finger — the preview is drawn
   * with transforms instead, over geometry measured once. The pointer is always
   * tested against the arrangement the drag started from, which makes the
   * position-to-order mapping a pure function and the loop impossible.
   */
  const onDragStart = () => {
    tracksRef.current = readGridTracks(gridRef.current)
    previewRef.current = null
  }

  const onDragEnd = (event: DragEndEvent) => {
    previewRef.current = null
    const { active, over } = event
    if (!over || active.id === over.id) return

    const next = resolve(String(active.id), String(over.id), stored)
    if (next.join() === stored.map((card) => card.id).join()) return

    haptic("light")
    setPendingIds(next)
    reorder.mutate({ cardIds: next })
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
      collisionDetection={collisionDetection}
      modifiers={[restrictToParentElement]}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        previewRef.current = null
      }}
    >
      <SortableContext items={itemIds} strategy={strategy}>
        <div
          ref={gridRef}
          className="grid grid-cols-2 gap-3 @2xl/main:grid-cols-3 @4xl/main:grid-cols-4"
        >
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
