"use client"

import {
  useCallback,
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react"
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DraggableAttributes,
  type DragEndEvent,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers"
import {
  SortableContext,
  arrayMove,
  hasSortableData,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVerticalIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * Reordering a list by dragging it.
 *
 * Five screens each had a pair of up/down buttons per row, which is four taps
 * to move something four places and gives no sense of where an item will land.
 * Dragging says both at once.
 *
 * The buttons did have one virtue worth keeping: they worked from a keyboard.
 * So the handle is a real focusable button and the keyboard sensor is wired —
 * focus it, press space to lift, arrow to move, space to drop — and the moves
 * are announced, in the reader's language rather than dnd-kit's English
 * defaults. A drag-only list would have quietly locked people out.
 */

interface HandleValue {
  attributes: DraggableAttributes
  listeners: Record<string, unknown> | undefined
  disabled: boolean
}

const HandleContext = createContext<HandleValue | null>(null)
const DropTargetContext = createContext<
  ((element: HTMLElement | null) => void) | null
>(null)

function useReorderSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // A short deliberate hold separates reordering from touch scrolling. The
    // tolerance still lets a thumb settle naturally before the drag starts.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: siblingKeyboardCoordinates,
    })
  )
}

function sortableItems(
  entry: Parameters<typeof hasSortableData>[0],
  fallback: UniqueIdentifier[] = []
): UniqueIdentifier[] {
  return hasSortableData(entry) ? entry.data.current.sortable.items : fallback
}

/** Keep tree collision candidates inside the dragged item's sibling group. */
export function sameSortableGroup(
  active: Parameters<typeof hasSortableData>[0],
  containers: DroppableContainer[]
): DroppableContainer[] {
  if (!hasSortableData(active)) return containers
  const { containerId } = active.data.current.sortable
  return containers.filter(
    (container) =>
      hasSortableData(container) &&
      container.data.current.sortable.containerId === containerId
  )
}

const siblingCollisionDetection: CollisionDetection = (args) => {
  const droppableContainers = sameSortableGroup(
    args.active,
    args.droppableContainers
  )
  const scopedArgs = { ...args, droppableContainers }
  const pointerCollisions = pointerWithin(scopedArgs)

  // A subject row owns its visible subtree. Pointer hits therefore feel most
  // direct on touch, while closest-center remains the keyboard/gap fallback.
  return pointerCollisions.length > 0
    ? pointerCollisions
    : closestCenter(scopedArgs)
}

export function adjacentSortableItem(
  items: UniqueIdentifier[],
  currentId: UniqueIdentifier,
  direction: -1 | 1
): UniqueIdentifier | undefined {
  const currentIndex = items.indexOf(currentId)
  return currentIndex < 0 ? undefined : items[currentIndex + direction]
}

interface RectGeometry {
  left: number
  top: number
  width: number
  height: number
}

/** Align the dragged subtree's centre with the destination row's centre. */
export function keyboardTargetCoordinates(
  activeRect: RectGeometry,
  targetRect: RectGeometry
) {
  return {
    x: targetRect.left + (targetRect.width - activeRect.width) / 2,
    y: targetRect.top + (targetRect.height - activeRect.height) / 2,
  }
}

/** Arrow keys only visit siblings; left/right never imply reparenting. */
const siblingKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context }
) => {
  if (event.code !== "ArrowUp" && event.code !== "ArrowDown") {
    return undefined
  }

  const active = context.active
  if (!active || !hasSortableData(active)) return undefined
  event.preventDefault()

  const items = active.data.current.sortable.items
  const currentId =
    context.over && items.includes(context.over.id)
      ? context.over.id
      : active.id
  const nextId = adjacentSortableItem(
    items,
    currentId,
    event.code === "ArrowDown" ? 1 : -1
  )
  if (nextId === undefined) return undefined

  const next = context.droppableContainers.get(nextId)
  const rect = next ? context.droppableRects.get(next.id) : undefined
  return rect && context.collisionRect
    ? keyboardTargetCoordinates(context.collisionRect, rect)
    : undefined
}

const autoScroll = {
  acceleration: 8,
  threshold: { x: 0.1, y: 0.15 },
} as const

const measuring = {
  droppable: { strategy: MeasuringStrategy.WhileDragging },
} as const

/**
 * The drag surface on its own, for trees.
 *
 * A subject list is a hierarchy and an order only means something among
 * siblings, so each level needs its own sortable group — but dnd-kit does not
 * nest `DndContext`. One context wraps everything and each level supplies a
 * `SortableGroup`; the handler is given both ends of the drag and decides.
 */
export function SortableRoot({
  ids,
  onDrop,
  disabled = false,
  restrictToParent = true,
  children,
}: {
  /** Every draggable id, in visual order. Used only for announcements. */
  ids: string[]
  onDrop: (activeId: string, overId: string) => void
  disabled?: boolean
  /**
   * Keep the dragged row inside its parent element. Right for a flat list,
   * wrong for a tree: a nested row's parent element is the row that contains
   * it, so the clamp pins the child roughly where it already is.
   */
  restrictToParent?: boolean
  children: ReactNode
}) {
  const t = useExtracted()

  const sensors = useReorderSensors()

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const group = sortableItems(active, ids)
        return t("Picked up item {position} of {total}.", {
          position: String(group.indexOf(active.id) + 1),
          total: String(group.length),
        })
      },
      onDragOver: ({ active, over }) => {
        if (!over) return undefined
        const group = sortableItems(active, ids)
        return t("Now at position {position} of {total}.", {
          position: String(group.indexOf(over.id) + 1),
          total: String(group.length),
        })
      },
      onDragEnd: ({ active, over }) => {
        if (!over) return t("Dropped. The order is unchanged.")
        const group = sortableItems(active, ids)
        return t("Dropped at position {position} of {total}.", {
          position: String(group.indexOf(over.id) + 1),
          total: String(group.length),
        })
      },
      onDragCancel: () => t("Cancelled. The order is unchanged."),
    }),
    [ids, t]
  )

  return (
    <DndContext
      accessibility={{ announcements }}
      autoScroll={autoScroll}
      sensors={sensors}
      collisionDetection={siblingCollisionDetection}
      measuring={measuring}
      modifiers={
        restrictToParent
          ? [restrictToVerticalAxis, restrictToParentElement]
          : [restrictToVerticalAxis]
      }
      onDragStart={() => haptic("selection")}
      onDragEnd={({ active, over }) => {
        if (disabled || !over || active.id === over.id) return
        haptic("light")
        onDrop(String(active.id), String(over.id))
      }}
    >
      {children}
    </DndContext>
  )
}

/** One sortable level inside a `SortableRoot`. */
export function SortableGroup({
  ids,
  children,
}: {
  ids: string[]
  children: ReactNode
}) {
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  )
}

export function SortableList({
  ids,
  onReorder,
  disabled = false,
  children,
}: {
  ids: string[]
  /** The complete new order. Callers persist it however they already do. */
  onReorder: (ids: string[]) => void
  disabled?: boolean
  children: ReactNode
}) {
  const t = useExtracted()

  const sensors = useReorderSensors()

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const position = ids.indexOf(String(active.id)) + 1
        return t("Picked up item {position} of {total}.", {
          position: String(position),
          total: String(ids.length),
        })
      },
      onDragOver: ({ over }) => {
        if (!over) return undefined
        const position = ids.indexOf(String(over.id)) + 1
        return t("Now at position {position} of {total}.", {
          position: String(position),
          total: String(ids.length),
        })
      },
      onDragEnd: ({ over }) => {
        if (!over) return t("Dropped. The order is unchanged.")
        const position = ids.indexOf(String(over.id)) + 1
        return t("Dropped at position {position} of {total}.", {
          position: String(position),
          total: String(ids.length),
        })
      },
      onDragCancel: () => t("Cancelled. The order is unchanged."),
    }),
    [ids, t]
  )

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (disabled || !over || active.id === over.id) return

    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return

    haptic("light")
    onReorder(arrayMove(ids, from, to))
  }

  return (
    <DndContext
      accessibility={{ announcements }}
      autoScroll={autoScroll}
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={measuring}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={() => haptic("selection")}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

/**
 * One draggable row. Renders an `li` by default; the handle is placed by the
 * caller with `<DragHandle />` so a row keeps whatever shape it already had.
 */
export function SortableRow({
  id,
  disabled = false,
  separateDropTarget = false,
  className,
  style,
  as: Element = "li",
  children,
}: {
  id: string
  disabled?: boolean
  /** Measure an explicit immediate child instead of the whole nested subtree. */
  separateDropTarget?: boolean
  className?: string
  /** Merged under the drag transform — indentation, mostly. */
  style?: CSSProperties
  as?: "li" | "div"
  children: ReactNode
}) {
  const {
    attributes,
    listeners,
    setDraggableNodeRef,
    setDroppableNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({ id, disabled })

  const setOuterNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDraggableNodeRef(node)
      if (!separateDropTarget) setDroppableNodeRef(node)
    },
    [separateDropTarget, setDraggableNodeRef, setDroppableNodeRef]
  )

  const handle = useMemo<HandleValue>(
    () => ({ attributes, listeners, disabled }),
    [attributes, listeners, disabled]
  )

  return (
    <HandleContext.Provider value={handle}>
      <DropTargetContext.Provider
        value={separateDropTarget ? setDroppableNodeRef : null}
      >
        <Element
          ref={setOuterNodeRef as never}
          style={{
            ...style,
            transform: CSS.Translate.toString(transform),
            transition,
          }}
          className={cn(
            (isSorting || isDragging) && "will-change-transform",
            isDragging &&
              "relative z-10 bg-card opacity-95 shadow-lg ring-1 ring-primary/25",
            className
          )}
        >
          {children}
        </Element>
      </DropTargetContext.Provider>
    </HandleContext.Provider>
  )
}

/** The visible row used for collision measurement inside a nested subtree. */
export function SortableDropTarget({
  className,
  style,
  children,
}: {
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const setNodeRef = useContext(DropTargetContext)

  return (
    <div ref={setNodeRef} className={className} style={style}>
      {children}
    </div>
  )
}

/** The grip. Focusable, so the list stays operable without a pointer. */
export function DragHandle({ className }: { className?: string }) {
  const t = useExtracted()
  const handle = useContext(HandleContext)
  if (!handle) return null

  return (
    <button
      type="button"
      aria-label={t("Reorder")}
      disabled={handle.disabled}
      className={cn(
        "flex size-11 shrink-0 cursor-grab touch-manipulation items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing disabled:opacity-40 md:size-8 md:rounded-md",
        className
      )}
      {...handle.attributes}
      {...handle.listeners}
    >
      <GripVerticalIcon className="size-5 md:size-4" />
    </button>
  )
}
