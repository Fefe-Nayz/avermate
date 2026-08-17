"use client"

import Link from "next/link"
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  type SortingStrategy,
} from "@dnd-kit/sortable"
import { motion } from "motion/react"
import {
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import {
  layoutCardGrid,
  layoutCards,
  planGridReorder,
  widgetCapability,
  cardSemanticsFromDefinition,
  widgetMeasureId,
  type CardSpec,
  type WidgetSurface,
} from "@avermate/core"
import { Button } from "@/components/ui/button"
import { CardAction } from "@/components/ui/card"
import { useYear, type DashboardCardRow } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { CardShell, cardSurface } from "./card-shell"
import {
  captureGridSlots,
  gridColumnCount,
  nearestGridSlot,
  overlayGrabShift,
  sameCardOrder,
  type GridSlot,
} from "./grid-drag-model"
import { resolveWidgetRow } from "./widget-row"
import { useWidgetMessages } from "./use-widget-messages"
import { useWidgetResult } from "./use-widget-result"
import { WidgetBody } from "./widget-view"

/**
 * The dashboard grid.
 *
 * Cards are rows in the database, so the layout a student builds is theirs on
 * every device. Reordering is drag-and-drop with a keyboard path, and editing
 * happens on its own screen rather than in a popover — same rule as every
 * other form in the app.
 */

/**
 * A card, as the *layout* sees it.
 *
 * The packer needs a width, and a width depends on more than the stored span: a
 * list needs room for its columns, a ranking needs room for its names. Those come
 * out of the definition, which is the card's only representation — a row that
 * cannot be read is laid out as a plain value card, since that is the least it
 * could be.
 */
export function toSpec(row: DashboardCardRow): CardSpec {
  const { definition } = resolveWidgetRow(row)
  const projection = definition ? cardSemanticsFromDefinition(definition) : null
  return {
    id: row.id,
    metric: projection?.metric ?? "average",
    target: {
      kind: projection?.targetKind ?? "general",
      referenceId: projection?.targetId ?? null,
    },
    display: projection?.display ?? "value",
    span: Math.min(4, Math.max(1, row.span)) as CardSpec["span"],
    title: row.title,
    accent: row.accent,
    goalId: projection?.goalId ?? null,
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
 * dnd-kit must not draw a second layout.
 *
 * A sorting strategy previews a reorder by translating the rectangles it
 * measured — every card slides into the box another card vacated. That is only a
 * reorder if the boxes are interchangeable, and ours are not: cards span one to
 * four columns and the packer *repacks*, so a different order means different
 * rows, different widths and different heights. Translating cards into boxes the
 * new arrangement does not contain is what put them on top of each other.
 *
 * The grid now renders the candidate order itself, so CSS does the arranging and
 * there is nothing left for a strategy to add. Anything it returned here would
 * displace cards that are already in the right place.
 */
const staticStrategy: SortingStrategy = () => null

/** Springy enough to read as motion, short enough not to lag the finger. */
const REORDER_TRANSITION = {
  layout: { type: "spring", stiffness: 520, damping: 42, mass: 0.75 },
} as const

/**
 * Everything a drag is decided against, captured before anything moves.
 *
 * `ids`, `specs` and `columns` are the arrangement the drag *started* from, and
 * they are what every target is resolved against — never the arrangement
 * currently on screen. That is the whole reason the preview can now reflow for
 * real: resolving against what is displayed feeds the resolver its own output,
 * and on a uniform 2×2 the two answers alternated forever. Resolving against a
 * fixed base makes "this pointer position means this order" a pure function, so
 * the same position always yields the same preview however many times it is
 * asked.
 */
interface DragSession {
  activeId: string
  ids: string[]
  specs: CardSpec[]
  columns: number
  slots: GridSlot[]
  /** Where inside the card the pointer took hold; `null` for a keyboard drag. */
  grab: { x: number; y: number } | null
  source: { width: number; height: number } | null
}

/** The pointer position a drag started from, whichever input started it. */
function activatorPoint(event: Event): { x: number; y: number } | null {
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0]
    return touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  // PointerEvent extends MouseEvent, so this covers both.
  if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY }
  return null
}

function rowsInOrder(
  rows: readonly DashboardCardRow[],
  ids: readonly string[] | null
): DashboardCardRow[] {
  if (!ids) return [...rows]
  const byId = new Map(rows.map((row) => [row.id, row]))
  const ordered = ids.flatMap((id) => {
    const row = byId.get(id)
    return row ? [row] : []
  })
  // Any card the order does not mention (a refetch added one mid-flight) keeps
  // its stored place rather than vanishing.
  return ordered.length === rows.length ? ordered : [...rows]
}

/**
 * One card, drawn.
 *
 * Deliberately knows nothing about dragging: it is rendered both in the grid and
 * again inside the `DragOverlay`, and those two have to be the same picture.
 */
function DashboardCardView({
  row,
  spec,
  editing,
  surface,
  className,
  handle,
}: {
  row: DashboardCardRow
  spec: CardSpec
  editing: boolean
  surface: WidgetSurface
  className?: string
  /** The reorder grip, with its listeners in the grid and without in the overlay. */
  handle?: ReactNode
}) {
  const t = useExtracted()
  const { yearId } = useYear()
  const message = useWidgetMessages()
  const { definition } = useMemo(() => resolveWidgetRow(row), [row])
  const result = useWidgetResult(definition, surface)
  const defaultTitle = definition
    ? message(
        widgetCapability(widgetMeasureId(definition.analysis.measure))
          .messageKey
      )
    : t("Unavailable card")
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

  return (
    <CardShell
      accent={spec.accent}
      surface={cardSurface(result)}
      className={cn(row.hidden && "opacity-55", className)}
      title={spec.title ?? defaultTitle}
      action={
        editing ? (
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
            {handle}
          </CardAction>
        ) : null
      }
    >
      {definition ? (
        <WidgetBody
          definition={definition}
          result={result}
          expanded={surface === "insights"}
        />
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("This card could not be read.")}
        </p>
      )}
    </CardShell>
  )
}

/**
 * The card in the grid — a real grid item at its candidate span.
 *
 * While this card is the one being dragged it becomes its own placeholder: the
 * body is hidden but still laid out, so the row keeps the height the card will
 * have, and an outline marks the cell the drop will land in. The card the person
 * is actually moving is the `DragOverlay`, which follows the pointer.
 *
 * That split is what the video was missing. With no overlay, dnd-kit gives the
 * dragged card the raw pointer displacement and only asks the sorting strategy
 * about the *others* — so every card but the dragged one went to its candidate
 * cell, and the dragged one floated over whichever card had moved into its
 * destination. There was no second thing on screen showing where it would land.
 */
function SortableDashboardCard({
  row,
  spec,
  editing,
  spanClasses,
  surface,
  dragging,
  animateLayout,
}: {
  row: DashboardCardRow
  spec: CardSpec
  editing: boolean
  spanClasses: string
  surface: WidgetSurface
  dragging: boolean
  animateLayout: boolean
}) {
  const t = useExtracted()
  const { attributes, listeners, setNodeRef } = useSortable({
    id: row.id,
    disabled: !editing,
  })

  return (
    <motion.div
      ref={setNodeRef}
      // Read back by `captureGridSlots` and by the overlay's own measurement.
      data-card-id={row.id}
      // Position only, never size: a card that changes span must be *re-laid
      // out* at its new width, not scaled into it. Animating size would stretch
      // its type and its charts and would leave `@container/card` reading a
      // width the card does not have.
      layout={animateLayout ? "position" : false}
      transition={REORDER_TRANSITION}
      className={cn("relative min-w-0", spanClasses)}
    >
      <DashboardCardView
        row={row}
        spec={spec}
        editing={editing}
        surface={surface}
        className={cn("h-full", dragging && "invisible")}
        handle={
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
        }
      />
      {dragging ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl border-2 border-dashed border-muted-foreground/40 bg-muted/30"
        />
      ) : null}
    </motion.div>
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
   */
  const [pendingIds, setPendingIds] = useState<string[] | null>(null)

  /**
   * The candidate order the drag is currently showing.
   *
   * Held in a ref as well as in state: the ref is what `dragOver` and `dragEnd`
   * read, so the order that is saved is exactly the order that was last drawn,
   * with no dependence on when React chose to re-render.
   */
  const previewRef = useRef<string[] | null>(null)
  const [previewIds, setPreviewIds] = useState<string[] | null>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const [session, setSession] = useState<DragSession | null>(null)
  const [overlayBox, setOverlayBox] = useState<{
    width: number
    height: number
  } | null>(null)

  const visible = useMemo(
    () => rowsInOrder(stored, previewIds ?? pendingIds),
    [stored, previewIds, pendingIds]
  )

  // Compiled once per card rather than once per arrangement: a drag changes the
  // order many times a second, and re-reading every definition on each of those
  // is the one thing here that would be felt as lag.
  const specsById = useMemo(
    () => new Map(stored.map((row) => [row.id, toSpec(row)])),
    [stored]
  )
  const orderedSpecs = useCallback(
    (rows: readonly DashboardCardRow[]) =>
      rows.flatMap((row) => {
        const spec = specsById.get(row.id)
        return spec ? [spec] : []
      }),
    [specsById]
  )

  /**
   * The real spans, for the order currently on screen.
   *
   * Keyed off `visible`, which during a drag is the *candidate* order — so the
   * classes below are the candidate arrangement's own classes and the browser
   * reflows the grid for real. Every width, height, container query and line
   * wrap is then correct because none of them is being predicted.
   */
  const placement = useMemo(() => {
    const specs = orderedSpecs(visible)
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
  }, [orderedSpecs, visible])

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

  const itemIds = useMemo(() => visible.map((card) => card.id), [visible])

  /**
   * Which card the drag is aimed at, judged against the frozen slots.
   *
   * Two translations happen here, and both matter:
   *
   * 1. The *pointer* picks the slot, not the centre of the dragged card's
   *    rectangle. `closestCenter` compares that centre, and the handle sits at
   *    the card's top-right corner — on a full-width card the two are hundreds
   *    of pixels apart, so the target flipped before the handle had reached the
   *    row it was flipping to.
   * 2. A row the dragged card cannot join becomes *one* destination, via
   *    `planGridReorder`. Landing on the left half of a pair otherwise splits it:
   *    the packer widens that half into the dragged card's place, which is a
   *    rearrangement nobody asked for.
   *
   * The slots never move, so this is a pure function of the pointer position —
   * which is what lets the grid below reflow without the two feeding each other.
   */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const active = sessionRef.current
    const grid = gridRef.current
    if (!active || !grid) return closestCenter(args)

    // A keyboard drag has no pointer, and dnd-kit's own answer over the rects it
    // measured at drag start is the right one there: each keypress is a discrete
    // step through the arrangement the drag began in, which is this snapshot.
    const aimed = args.pointerCoordinates
      ? nearestGridSlot(
          active.slots,
          args.pointerCoordinates,
          grid.getBoundingClientRect()
        )?.id
      : closestCenter(args)[0]?.id
    if (aimed === undefined) return []

    const { insertion } = planGridReorder(
      active.specs,
      active.columns,
      active.activeId,
      String(aimed)
    )
    return [{ id: insertion?.anchorId ?? String(aimed) }]
  }, [])

  const clearDrag = useCallback(() => {
    sessionRef.current = null
    previewRef.current = null
    setSession(null)
    setPreviewIds(null)
    setOverlayBox(null)
  }, [])

  const onDragStart = (event: DragStartEvent) => {
    const grid = gridRef.current
    if (!grid) return
    const ids = visible.map((row) => row.id)
    const activeId = String(event.active.id)
    // Measured from the DOM rather than taken from `active.rect.current.initial`,
    // which dnd-kit has not filled in yet when this fires — leaving the overlay
    // with no idea how big the card was and so nothing to hold the grab ratio
    // against.
    const rect = grid
      .querySelector(`[data-card-id="${CSS.escape(activeId)}"]`)
      ?.getBoundingClientRect()
    const pointer = activatorPoint(event.activatorEvent)
    const next: DragSession = {
      activeId,
      ids,
      specs: orderedSpecs(visible),
      columns: gridColumnCount(grid, GRID_STEPS[0].columns),
      slots: captureGridSlots(grid),
      grab:
        rect && pointer
          ? { x: pointer.x - rect.left, y: pointer.y - rect.top }
          : null,
      source: rect ? { width: rect.width, height: rect.height } : null,
    }
    sessionRef.current = next
    previewRef.current = ids
    setSession(next)
    setPreviewIds(ids)
  }

  const onDragOver = (event: DragOverEvent) => {
    const active = sessionRef.current
    if (!active || !event.over) return
    const next = planGridReorder(
      active.specs,
      active.columns,
      active.activeId,
      String(event.over.id)
    ).order
    if (sameCardOrder(previewRef.current, next)) return
    previewRef.current = next
    setPreviewIds(next)
  }

  /**
   * The drop saves the order that was on screen — it does not resolve a new one.
   *
   * Resolving again here is how the preview and the drop used to disagree: two
   * computations, two chances to be right about different things, and the person
   * dragging saw the layout change on release. There is now one order, drawn and
   * then saved.
   */
  const onDragEnd = () => {
    const active = sessionRef.current
    const next = previewRef.current
    // Batched with the clear below, so the candidate arrangement is replaced by
    // the identical pending one without a frame of the old order in between.
    if (active && next && !sameCardOrder(active.ids, next)) {
      haptic("light")
      setPendingIds(next)
      reorder.mutate({ cardIds: next })
    }
    clearDrag()
  }

  /**
   * The overlay wears the size of the cell it is about to land in.
   *
   * Measured off the placeholder rather than computed, so it inherits the real
   * reflow: a card that has just become a full row is measured as a full row,
   * including the height its own contents took at that width. Re-measured
   * whenever the candidate order changes, and observed in between because a
   * card's height can settle a frame later — a chart resizing, a title
   * re-wrapping.
   */
  const activeId = session?.activeId
  useLayoutEffect(() => {
    if (!activeId) return
    const node = gridRef.current?.querySelector<HTMLElement>(
      `[data-card-id="${CSS.escape(activeId)}"]`
    )
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      setOverlayBox({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [activeId, previewIds])

  const activeRow = useMemo(
    () => visible.find((row) => row.id === activeId) ?? null,
    [activeId, visible]
  )
  const overlayStyle = useMemo(() => {
    if (!overlayBox) return undefined
    const { grab, source } = session ?? { grab: null, source: null }
    const shift =
      grab && source
        ? overlayGrabShift(grab, source, overlayBox)
        : { x: 0, y: 0 }
    return {
      width: overlayBox.width,
      height: overlayBox.height,
      transform: `translate(${shift.x}px, ${shift.y}px)`,
    }
  }, [overlayBox, session])

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
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={clearDrag}
    >
      <SortableContext items={itemIds} strategy={staticStrategy}>
        <div
          ref={gridRef}
          className="grid grid-cols-2 gap-3 @2xl/main:grid-cols-3 @4xl/main:grid-cols-4"
        >
          {visible.map((row) => {
            const spec = specsById.get(row.id)
            if (!spec) return null
            return (
              <SortableDashboardCard
                key={row.id}
                row={row}
                spec={spec}
                editing={editing}
                spanClasses={placement.spans.get(row.id) ?? ""}
                surface={surface}
                dragging={activeId === row.id}
                // Measured only while a drag is under way. Left on, Motion would
                // measure every card on every unrelated render — and the grid
                // re-renders on each step of the timeline scrubber.
                animateLayout={activeId !== undefined}
              />
            )
          })}
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
      {/* No drop animation: the grid already holds the final arrangement, so
          flying the overlay back into it would animate towards a card that is
          finished. */}
      <DragOverlay dropAnimation={null}>
        {activeRow && overlayStyle ? (
          <div className="pointer-events-none" style={overlayStyle}>
            <DashboardCardView
              row={activeRow}
              spec={specsById.get(activeRow.id) ?? toSpec(activeRow)}
              editing={editing}
              surface={surface}
              className="h-full shadow-lg"
              handle={
                <span className="inline-flex size-7 items-center justify-center text-muted-foreground">
                  <GripVerticalIcon className="size-4" />
                </span>
              }
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
