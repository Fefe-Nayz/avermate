"use client"

import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DraggableAttributes,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
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
  children,
}: {
  /** Every draggable id, in visual order. Used only for announcements. */
  ids: string[]
  onDrop: (activeId: string, overId: string) => void
  disabled?: boolean
  children: ReactNode
}) {
  const t = useExtracted()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) =>
        t("Picked up item {position} of {total}.", {
          position: String(ids.indexOf(String(active.id)) + 1),
          total: String(ids.length),
        }),
      onDragOver: ({ over }) =>
        over
          ? t("Now at position {position} of {total}.", {
              position: String(ids.indexOf(String(over.id)) + 1),
              total: String(ids.length),
            })
          : undefined,
      onDragEnd: ({ over }) =>
        over
          ? t("Dropped at position {position} of {total}.", {
              position: String(ids.indexOf(String(over.id)) + 1),
              total: String(ids.length),
            })
          : t("Dropped. The order is unchanged."),
      onDragCancel: () => t("Cancelled. The order is unchanged."),
    }),
    [ids, t]
  )

  if (disabled) return <>{children}</>

  return (
    <DndContext
      accessibility={{ announcements }}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return
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

  const sensors = useSensors(
    // A few pixels before a drag begins, so a tap on a row is still a tap.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

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
    if (!over || active.id === over.id) return

    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return

    haptic("light")
    onReorder(arrayMove(ids, from, to))
  }

  if (disabled) return <>{children}</>

  return (
    <DndContext
      accessibility={{ announcements }}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
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
  className,
  style,
  as: Element = "li",
  children,
}: {
  id: string
  disabled?: boolean
  className?: string
  /** Merged under the drag transform — indentation, mostly. */
  style?: CSSProperties
  as?: "li" | "div"
  children: ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled })

  const handle = useMemo<HandleValue>(
    () => ({ attributes, listeners, disabled }),
    [attributes, listeners, disabled]
  )

  return (
    <HandleContext.Provider value={handle}>
      <Element
        ref={setNodeRef as never}
        style={{
          ...style,
          transform: CSS.Translate.toString(transform),
          transition,
        }}
        className={cn(
          isDragging && "relative z-10 bg-card opacity-90 shadow-lg",
          className
        )}
      >
        {children}
      </Element>
    </HandleContext.Provider>
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
        "flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing disabled:opacity-40",
        className
      )}
      {...handle.attributes}
      {...handle.listeners}
    >
      <GripVerticalIcon className="size-4" />
    </button>
  )
}
