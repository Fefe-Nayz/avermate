"use client"

import { useState } from "react"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { EllipsisIcon, PlusIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { NAV_ENTRIES } from "@/lib/nav"
import { useReorderSensors } from "@/components/ui/sortable-list"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"

/**
 * The phone tab bar, arranged by moving its own contents.
 *
 * It used to be a miniature of the bar with three `SelectControl`s underneath — so
 * the thing you looked at and the thing you changed were different objects, and
 * "put Grades in the middle" was a matter of finding the right row and opening a
 * menu. The preview *is* the control now: drag a screen out of the tray into a
 * seat, or swap two seats by dragging one onto the other.
 *
 * Three seats, always full. The bar has five and two of them are spoken for — the
 * add button and More — and a bar with a hole in it is not an arrangement anyone
 * wants, so there is no way to empty a seat. Every drop is therefore a swap: from
 * the tray, the screen that was seated goes back to the tray; between seats, the
 * two trade. That closes the interaction: no invalid state to guard against and
 * nothing to explain.
 */
export function TabBarEditor({
  tabs,
  pool,
  labels,
  onChange,
}: {
  /** The three customisable seats, in bar order. */
  tabs: readonly string[]
  /** Every other screen that may be seated. */
  pool: readonly string[]
  labels: Record<string, string>
  onChange: (next: string[]) => void
}) {
  const t = useExtracted()
  const sensors = useReorderSensors()
  const [dragging, setDragging] = useState<string | null>(null)

  const onDragStart = (event: DragStartEvent) => {
    setDragging(String(event.active.id))
    haptic("selection")
  }

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null)
    const seat = seatIndexOf(event.over?.id)
    if (seat === null) return
    const moved = String(event.active.id)
    const next = [...tabs]
    const from = next.indexOf(moved)
    if (from === seat) return
    if (from >= 0) {
      // Seat to seat: the two trade, so both stay filled.
      next[from] = next[seat] as string
    }
    next[seat] = moved
    haptic("light")
    onChange(next)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex flex-col gap-3">
        {/* The bar itself, at the proportions it has on a phone: five equal seats
            with the action in the middle. */}
        <div className="rounded-xl border bg-background/60 px-2 py-1.5">
          <ul className="grid grid-cols-5 items-stretch">
            <Seat index={0} href={tabs[0]} labels={labels} />
            <Seat index={1} href={tabs[1]} labels={labels} />
            <li className="flex justify-center py-1">
              <span
                aria-label={t("Add")}
                className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <PlusIcon className="size-4" />
              </span>
            </li>
            <Seat index={2} href={tabs[2]} labels={labels} />
            <li className="flex flex-col items-center gap-0.5 py-1 text-[10px] text-muted-foreground">
              <EllipsisIcon className="size-4" />
              <span className="max-w-full truncate">{t("More")}</span>
            </li>
          </ul>
        </div>

        {pool.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="px-1 text-xs font-medium text-muted-foreground">
              {t("Drag one of these into a seat")}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {pool.map((href) => (
                <li key={href}>
                  <Chip href={href} labels={labels} inSeat={false} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Follows the pointer at the size of a tray chip, so the thing being moved
          looks the same wherever it came from. */}
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <Chip href={dragging} labels={labels} inSeat={false} overlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

const SEAT_PREFIX = "tab-seat-"

function seatIndexOf(id: unknown): number | null {
  if (typeof id !== "string" || !id.startsWith(SEAT_PREFIX)) return null
  const index = Number(id.slice(SEAT_PREFIX.length))
  return index === 0 || index === 1 || index === 2 ? index : null
}

/** One of the three customisable seats: a drop target holding a draggable chip. */
function Seat({
  index,
  href,
  labels,
}: {
  index: number
  href: string | undefined
  labels: Record<string, string>
}) {
  const t = useExtracted()
  const { setNodeRef, isOver } = useDroppable({ id: `${SEAT_PREFIX}${index}` })

  return (
    <li
      ref={setNodeRef}
      aria-label={t("Slot {number}", { number: String(index + 1) })}
      className={cn(
        "flex items-center justify-center rounded-lg py-1 transition-colors",
        // The seat lights up rather than the chip, because the seat is what the
        // drop decides — and an empty-looking highlight is easier to aim at than a
        // chip that has already moved away under the finger.
        isOver && "bg-accent"
      )}
    >
      {href ? <Chip href={href} labels={labels} inSeat /> : null}
    </li>
  )
}

function Chip({
  href,
  labels,
  inSeat,
  overlay = false,
}: {
  href: string
  labels: Record<string, string>
  inSeat: boolean
  overlay?: boolean
}) {
  const entry = NAV_ENTRIES.find((candidate) => candidate.href === href)
  const label = labels[href] ?? href
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: href,
    disabled: overlay,
  })
  const Icon = entry?.icon

  if (inSeat) {
    return (
      <span
        ref={overlay ? undefined : setNodeRef}
        {...(overlay ? {} : attributes)}
        {...(overlay ? {} : listeners)}
        className={cn(
          "flex min-w-0 cursor-grab flex-col items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] text-muted-foreground active:cursor-grabbing",
          "touch-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          isDragging && "opacity-40"
        )}
      >
        {Icon ? <Icon className="size-4" /> : null}
        <span className="max-w-full truncate">{label}</span>
      </span>
    )
  }

  return (
    <span
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      className={cn(
        "inline-flex cursor-grab items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs active:cursor-grabbing",
        "touch-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        overlay && "shadow-lg",
        isDragging && !overlay && "opacity-40"
      )}
    >
      {Icon ? <Icon className="size-3.5 text-muted-foreground" /> : null}
      {label}
    </span>
  )
}
