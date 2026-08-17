"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { addMonths, isSameDay, isSameMonth, startOfMonth } from "date-fns"
import { enUS, fr } from "date-fns/locale"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useExtracted, useFormatter, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { dayKey, monthGrid } from "@/lib/calendar"
import { cn } from "@/lib/utils"

/**
 * A month you swipe, for picking a date on a phone.
 *
 * The picker this replaces asked a phone to change months through a chevron
 * and two dropdowns — three controls competing for the top of the screen, none
 * of them the gesture a calendar actually invites. It also drew a fixed-size
 * month and left the bottom half of a full-screen layer empty, which is the
 * one thing a screen given entirely to one decision must not do.
 *
 * So: the same scroll-snapping row of months the grades calendar uses, because
 * the swipe is then the browser's own and needs no gesture handler; days that
 * grow square with the width, so the month is generous without being stretched
 * and the caller can centre it in the screen; and the chevrons stay, driving
 * the same scroller, for the pointer and the keyboard. The dropdowns are gone
 * — a bounded range is a swipe away, and an unbounded one gets a wide enough
 * window that swiping still reaches it.
 *
 * Locale comes from next-intl, once, for the weekday names and the week start
 * both. The old picker passed nothing to react-day-picker, so its month
 * caption followed the browser while its weekday row stayed hardcoded
 * English — "avr." above "Su Mo Tu".
 */

/** Bound on rendered panels. Wide enough to scroll, small enough to mount. */
const MAX_PANELS = 60
/** Months either side of the anchor when the caller sets no bound. */
const UNBOUNDED_REACH = 24

export function MonthPagerCalendar({
  selected,
  min,
  max,
  onSelect,
  fill = false,
  className,
}: {
  selected?: Date
  min?: Date
  max?: Date
  onSelect: (date: Date) => void
  /**
   * Sizes the month for a screen given entirely to it: days grow square with
   * the width instead of sitting at a fixed 1.75rem. Stretching the six rows
   * to *fill* a phone's height was the other tempting reading and it is wrong
   * — it makes 104px-tall day cells, trading a top-heavy layout for a
   * stretched one. The caller centres the block instead.
   */
  fill?: boolean
  className?: string
}) {
  const t = useExtracted()
  const format = useFormatter()
  const locale = useLocale()

  const dateLocale = locale === "fr" ? fr : enUS
  const weekStartsOn = dateLocale.options?.weekStartsOn === 0 ? 0 : 1

  const today = useMemo(() => {
    const value = new Date()
    value.setHours(12, 0, 0, 0)
    return value
  }, [])

  /** Where the picker opens: the value being edited, else today. */
  const anchor = useMemo(
    () => startOfMonth(selected ?? (min && today < min ? min : today)),
    [selected, min, today]
  )

  const months = useMemo(() => {
    const start = startOfMonth(min ?? addMonths(anchor, -UNBOUNDED_REACH))
    const end = startOfMonth(max ?? addMonths(anchor, UNBOUNDED_REACH))
    const list: Date[] = []
    for (
      let cursor = start;
      cursor <= end && list.length < MAX_PANELS;
      cursor = addMonths(cursor, 1)
    ) {
      list.push(cursor)
    }
    return list.length > 0 ? list : [anchor]
  }, [anchor, max, min])

  const openAt = useMemo(() => {
    const index = months.findIndex((entry) => isSameMonth(entry, anchor))
    return index === -1 ? 0 : index
  }, [anchor, months])

  const [monthIndex, setMonthIndex] = useState(openAt)
  const pagerRef = useRef<HTMLDivElement | null>(null)
  const settleRef = useRef<number | undefined>(undefined)

  const month = months[Math.min(monthIndex, months.length - 1)] ?? anchor

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = "smooth") => {
      const node = pagerRef.current
      if (!node) return
      node.scrollTo({ left: index * node.clientWidth, behavior })
    },
    []
  )

  // Adjusted during render: when the edited value moves the opening month, the
  // pager has to already be on it for the paint that follows.
  const [lastOpenAt, setLastOpenAt] = useState(openAt)
  if (lastOpenAt !== openAt) {
    setLastOpenAt(openAt)
    setMonthIndex(openAt)
  }

  useLayoutEffect(() => {
    scrollToIndex(openAt, "auto")
  }, [openAt, scrollToIndex])

  useEffect(
    () => () => {
      if (settleRef.current !== undefined)
        window.clearTimeout(settleRef.current)
    },
    []
  )

  // The settled panel, not every intermediate pixel: momentum fires scroll
  // continuously and the heading would flicker through the months passed.
  const handlePagerScroll = useCallback(() => {
    if (settleRef.current !== undefined) window.clearTimeout(settleRef.current)
    settleRef.current = window.setTimeout(() => {
      settleRef.current = undefined
      const node = pagerRef.current
      if (!node || node.clientWidth === 0) return
      const index = Math.round(node.scrollLeft / node.clientWidth)
      setMonthIndex((current) => (current === index ? current : index))
    }, 90)
  }, [])

  const panels = useMemo(
    () =>
      months.map((entry) => ({
        month: entry,
        days: monthGrid(entry, weekStartsOn),
      })),
    [months, weekStartsOn]
  )

  const weekdays = useMemo(
    () =>
      monthGrid(anchor, weekStartsOn)
        .slice(0, 7)
        .map((day) => format.dateTime(day, { weekday: "short" })),
    [anchor, weekStartsOn, format]
  )

  const allowed = (date: Date) => (!min || date >= min) && (!max || date <= max)

  const controls = (
    <div className="flex items-center gap-2">
      {/* One heading rather than a month dropdown beside a year dropdown: the
          range is reachable by swiping, so the caption only has to say where
          the swipe has got to. */}
      <h3
        aria-live="polite"
        className="min-w-0 flex-1 truncate text-base font-semibold"
      >
        {format.dateTime(month, { month: "long", year: "numeric" })}
      </h3>
      <Button
        type="button"
        variant="outline"
        size={fill ? "icon" : "icon-sm"}
        aria-label={t("Previous month")}
        disabled={monthIndex <= 0}
        onClick={() => scrollToIndex(monthIndex - 1)}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        type="button"
        variant="outline"
        size={fill ? "icon" : "icon-sm"}
        aria-label={t("Next month")}
        disabled={monthIndex >= months.length - 1}
        onClick={() => scrollToIndex(monthIndex + 1)}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )

  const grid = (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="shrink-0 px-1 pb-2">{controls}</div>

      <div
        aria-hidden
        className="grid shrink-0 grid-cols-7 border-b pb-1.5 text-center"
      >
        {weekdays.map((day) => (
          <span
            key={day}
            className="text-[11px] font-medium text-muted-foreground uppercase"
          >
            {day}
          </span>
        ))}
      </div>

      <div
        ref={pagerRef}
        onScroll={handlePagerScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {panels.map(({ month: panelMonth, days }) => (
          <div
            key={panelMonth.toISOString()}
            className="w-full shrink-0 snap-center"
            aria-hidden={isSameMonth(panelMonth, month) ? undefined : true}
          >
            <div className="grid grid-cols-7 gap-0.5 py-1">
              {days.map((day) => {
                const outside = !isSameMonth(day, panelMonth)
                const isSelected = selected ? isSameDay(day, selected) : false
                const isToday = isSameDay(day, today)
                const enabled = allowed(day)
                return (
                  <button
                    key={dayKey(day)}
                    type="button"
                    disabled={!enabled}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={format.dateTime(day, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                    onClick={() => onSelect(day)}
                    className={cn(
                      // Square, so the month grows with the width it is
                      // given and the days never stretch. `min-h-11` is the
                      // thumb floor for the narrowest phone.
                      "numeric flex items-center justify-center rounded-lg text-sm transition-colors",
                      fill ? "aspect-square min-h-11" : "min-h-9",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      !enabled && "cursor-default opacity-30",
                      enabled && !isSelected && "active:bg-accent",
                      outside && !isSelected && "text-muted-foreground/45",
                      isSelected &&
                        "bg-primary font-semibold text-primary-foreground",
                      // Today reads as a ring, so it survives being the
                      // selected day as well.
                      isToday && !isSelected && "ring-1 ring-primary/60"
                    )}
                  >
                    {day.getDate()}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return grid
}
