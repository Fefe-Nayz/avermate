"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { isoDateInTimeZone } from "@avermate/core/planning"
import {
  CalendarDaysIcon,
  CalendarPlus2Icon,
  BanIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  Clock3Icon,
  EllipsisIcon,
  ListTodoIcon,
  MapPinIcon,
  MicIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { dayKey, monthGrid } from "@/components/calendar/month-grid"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useYear } from "@/components/year/year-provider"
import { useStickyState } from "@/hooks/use-sticky-state"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import {
  planningCalendarInput,
  planningDayInput,
} from "@/lib/route-query-inputs"
import { cn } from "@/lib/utils"
import { PlanningEmpty } from "./planning-empty"
import {
  allDayItems,
  placeDayItems,
  timeGridWindow,
} from "./planning-time-grid"
import { useRememberedTimezone } from "./planning-timezone"
import { PlanningCalendarCapture } from "./planning-calendar-capture"
import {
  ManagedItemActions,
  PlanningManagementBadges,
} from "./planning-management"
import { PlanningLocalNote } from "./planning-local-note"
import {
  itemsForDay,
  normalizePlanningItems,
  planningItemEnd,
  planningItemIsComplete,
  planningItemIsManaged,
  planningItemStart,
  planningWeekDays,
  recordingHrefForLesson,
  timelinePlacements,
  type PlanningItem,
  type PlanningView,
} from "./planning-model"

const VIEW_ICONS = {
  month: CalendarDaysIcon,
  week: ListTodoIcon,
  day: Clock3Icon,
} as const

const subscribeToBrowserTimezone = () => () => undefined
const browserTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

export function PlanningCalendarClient({
  initialYearId,
  initialYear,
  initialMonth,
  initialDay,
  initialFrom,
  initialTo,
  initialTimezone,
  initialNow,
  initialView,
  initialFocusId,
  initialFocusStartsAt,
}: {
  initialYearId: string
  initialYear: number
  initialMonth: number
  initialDay: string
  initialFrom: string
  initialTo: string
  initialTimezone: string
  initialNow: number
  initialView: PlanningView
  initialFocusId: string | null
  initialFocusStartsAt: string | null
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { yearId, selectYear } = useYear()
  const [focusId, setFocusId] = useState(initialFocusId)
  const activeYearId = focusId ? initialYearId : (yearId ?? initialYearId)
  const [view, setView] = useStickyState<PlanningView>(
    "avermate:planning-calendar-view",
    initialView
  )
  const [storedAnchor, setStoredAnchor] = useState(
    () => new Date(initialYear, initialMonth, Number(initialDay.slice(-2)), 12)
  )
  const [storedSelectedDay, setStoredSelectedDay] = useState(initialDay)
  const [selectionTimezone, setSelectionTimezone] = useState(initialTimezone)
  const [captureItem, setCaptureItem] = useState<PlanningItem | "new" | null>(
    null
  )
  const timezone = useSyncExternalStore(
    subscribeToBrowserTimezone,
    browserTimezone,
    () => initialTimezone
  )
  // Recorded so the next server render builds this window in the reader's own zone.
  useRememberedTimezone(initialTimezone)
  const localToday = useMemo(() => new Date(initialNow), [initialNow])
  const focusedInstant = useMemo(
    () => (initialFocusStartsAt ? new Date(initialFocusStartsAt) : null),
    [initialFocusStartsAt]
  )
  const focusDay =
    focusId && focusedInstant
      ? isoDateInTimeZone(focusedInstant, timezone)
      : null
  const anchor =
    selectionTimezone === timezone
      ? storedAnchor
      : (focusedInstant ?? localToday)
  const selectedDay =
    selectionTimezone === timezone
      ? storedSelectedDay
      : (focusDay ?? dayKey(localToday))
  const effectiveView = focusId ? "day" : view

  useEffect(() => {
    if (focusId && yearId !== initialYearId) selectYear(initialYearId)
  }, [focusId, initialYearId, selectYear, yearId])

  const input = useMemo(() => {
    if (
      effectiveView === initialView &&
      activeYearId === initialYearId &&
      anchor.getFullYear() === initialYear &&
      anchor.getMonth() === initialMonth &&
      timezone === initialTimezone
    ) {
      return {
        yearId: initialYearId,
        from: new Date(initialFrom),
        to: new Date(initialTo),
        timezone: initialTimezone,
      }
    }
    return planningCalendarInput(activeYearId, anchor, effectiveView, timezone)
  }, [
    activeYearId,
    anchor,
    initialFrom,
    initialMonth,
    initialTimezone,
    initialTo,
    initialYear,
    initialYearId,
    initialView,
    timezone,
    effectiveView,
  ])
  const calendar = useQuery(
    orpc.planning.calendar.queryOptions({
      input,
      staleTime: 30_000,
      enabled: effectiveView !== "day",
    })
  )
  const dayInput = planningDayInput(activeYearId, selectedDay, timezone)
  const day = useQuery(
    orpc.planning.day.queryOptions({ input: dayInput, staleTime: 30_000 })
  )
  useEffect(() => {
    if (!focusId || day.isPending) return
    const target = Array.from(
      document.querySelectorAll<HTMLElement>("[data-planning-item-id]")
    ).find((element) => element.dataset.planningItemId === focusId)
    if (!target) return
    const frame = requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" })
      target.focus({ preventScroll: true })
      setView("day")
      setStoredAnchor(focusedInstant ?? localToday)
      setStoredSelectedDay(selectedDay)
      setSelectionTimezone(timezone)
      setFocusId(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [
    calendar.data,
    day.data,
    day.isPending,
    focusId,
    focusedInstant,
    localToday,
    selectedDay,
    setView,
    timezone,
  ])
  const items = useMemo(
    () => normalizePlanningItems(calendar.data),
    [calendar.data]
  )
  const dayItems = useMemo(() => normalizePlanningItems(day.data), [day.data])
  const todayKey = isoDateInTimeZone(new Date(initialNow), timezone)
  const viewLabels = {
    month: t("Month"),
    week: t("Week"),
    day: t("Day"),
  }

  const step = (direction: -1 | 1) => {
    haptic("selection")
    let next = new Date(anchor)
    if (effectiveView === "month") {
      const selectedDate = parseDayKey(selectedDay)
      const preferredDay = selectedDate?.getDate() ?? 1
      next = new Date(
        anchor.getFullYear(),
        anchor.getMonth() + direction,
        1,
        12
      )
      const lastDay = new Date(
        next.getFullYear(),
        next.getMonth() + 1,
        0
      ).getDate()
      next.setDate(Math.min(preferredDay, lastDay))
    } else if (effectiveView === "week") {
      next.setDate(next.getDate() + 7 * direction)
    } else next.setDate(next.getDate() + direction)
    setStoredAnchor(next)
    setStoredSelectedDay(dayKey(next))
    setSelectionTimezone(timezone)
  }
  const selectDate = (date: Date, showDay = false) => {
    haptic("selection")
    setStoredSelectedDay(dayKey(date))
    setStoredAnchor(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
    )
    setSelectionTimezone(timezone)
    if (showDay) setView("day")
  }
  const resetToday = () => {
    const today = new Date()
    setStoredAnchor(today)
    setStoredSelectedDay(dayKey(today))
    setSelectionTimezone(timezone)
  }

  return (
    <>
      <PageMeta
        title={t("Calendar")}
        subtitle={t("Classes, work, holidays, homework, and tasks")}
      />
      <PageActions>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("New calendar item")}
          render={<Link href="/planning/calendar/new" />}
        >
          <CalendarPlus2Icon />
        </Button>
      </PageActions>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="hidden items-start justify-between gap-4 md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Calendar")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "See the school calendar first, then overlay the work you need to do."
              )}
            </p>
          </div>
          <Button size="sm" render={<Link href="/planning/calendar/new" />}>
            <CalendarPlus2Icon /> {t("New calendar item")}
          </Button>
        </header>

        {captureItem ? (
          <PlanningCalendarCapture
            yearId={activeYearId}
            initialDate={selectedDay}
            timezone={timezone}
            item={captureItem === "new" ? null : captureItem}
            onClose={() => setCaptureItem(null)}
          />
        ) : null}

        <div className="flex flex-col gap-3 rounded-xl border bg-card p-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full items-center gap-1 sm:w-auto sm:justify-start">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Previous {view}", {
                view: viewLabels[effectiveView].toLowerCase(),
              })}
              onClick={() => step(-1)}
            >
              <ChevronLeftIcon />
            </Button>
            <h2 className="min-w-0 flex-1 text-center text-sm font-semibold capitalize sm:min-w-44 sm:flex-none">
              {calendarHeading(anchor, effectiveView, format)}
            </h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Next {view}", {
                view: viewLabels[effectiveView].toLowerCase(),
              })}
              onClick={() => step(1)}
            >
              <ChevronRightIcon />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={resetToday}
            >
              <RotateCcwIcon /> {t("Today")}
            </Button>
          </div>
          <div
            role="group"
            aria-label={t("Calendar view")}
            className="flex rounded-lg bg-muted/45 p-0.5"
          >
            {(["month", "week", "day"] as const).map((mode) => {
              const Icon = VIEW_ICONS[mode]
              return (
                <Button
                  key={mode}
                  variant={effectiveView === mode ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={effectiveView === mode}
                  onClick={() => {
                    setView(mode)
                    if (mode === "day") {
                      const selected = parseDayKey(selectedDay)
                      if (selected) {
                        setStoredAnchor(selected)
                        setStoredSelectedDay(selectedDay)
                        setSelectionTimezone(timezone)
                      }
                    }
                  }}
                  className="flex-1"
                >
                  <Icon /> {viewLabels[mode]}
                </Button>
              )
            })}
          </div>
        </div>

        {effectiveView !== "day" && calendar.isPending ? (
          <div className="h-[32rem] animate-pulse rounded-xl bg-muted/50" />
        ) : effectiveView !== "day" && calendar.isError ? (
          <p role="alert" className="rounded-xl border p-4 text-destructive">
            {calendar.error.message}
          </p>
        ) : effectiveView === "month" ? (
          <MonthView
            month={anchor}
            items={items}
            selectedDay={selectedDay}
            todayKey={todayKey}
            onSelect={selectDate}
            dayItems={dayItems}
            dayPending={day.isPending}
            dayError={day.isError ? day.error.message : null}
            onOpenDay={() => setView("day")}
            onEdit={setCaptureItem}
          />
        ) : effectiveView === "week" ? (
          <WeekView
            anchor={anchor}
            now={localToday}
            items={items}
            selectedDay={selectedDay}
            onSelect={selectDate}
            onEdit={setCaptureItem}
          />
        ) : (
          <DayView
            date={parseDayKey(selectedDay) ?? anchor}
            items={dayItems}
            pending={day.isPending}
            error={day.isError ? day.error.message : null}
            onEdit={setCaptureItem}
          />
        )}

        <p className="text-center text-xs text-muted-foreground">
          {t("Times are shown in {timezone}.", { timezone })}
        </p>
      </div>
    </>
  )
}

function MonthView({
  month,
  items,
  selectedDay,
  todayKey,
  onSelect,
  dayItems,
  dayPending,
  dayError,
  onOpenDay,
  onEdit,
}: {
  month: Date
  items: PlanningItem[]
  selectedDay: string
  todayKey: string
  onSelect: (date: Date, showDay?: boolean) => void
  dayItems: PlanningItem[]
  dayPending: boolean
  dayError: string | null
  onOpenDay: () => void
  onEdit: (item: PlanningItem) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const days = useMemo(() => monthGrid(month, 1), [month])

  return (
    <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {days.slice(0, 7).map((day) => (
            <div
              key={dayKey(day)}
              className="px-1 py-2 text-center text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase"
            >
              {format.dateTime(day, { weekday: "short" })}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((date) => {
            const key = dayKey(date)
            const dayItems = itemsForDay(items, date)
            const outside = date.getMonth() !== month.getMonth()
            const selected = key === selectedDay
            const today = key === todayKey
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                aria-current={today ? "date" : undefined}
                aria-label={t("{date}, {count} calendar items", {
                  date: format.dateTime(date, { dateStyle: "full" }),
                  count: String(dayItems.length),
                })}
                onClick={() => onSelect(date, true)}
                className={cn(
                  "relative min-h-20 border-r border-b p-1.5 text-left outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-28",
                  outside && "bg-muted/20 text-muted-foreground",
                  selected && "bg-primary/5 ring-1 ring-primary/30 ring-inset"
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs",
                    today && "bg-primary font-semibold text-primary-foreground"
                  )}
                >
                  {date.getDate()}
                </span>
                {/* Dots on a phone, titles once there is room for one.
                    A month cell is 49px wide at 375px, so a chip had about 36px to
                    print "Mathématiques" in at 10px — four characters and an ellipsis,
                    three of them stacked into a coloured smear. The grid is a picker;
                    the day panel below is where the titles belong, and a dot says the
                    one thing the cell has room to say: something is on this day. */}
                <span
                  className="mt-1 flex flex-wrap gap-1 sm:hidden"
                  aria-hidden
                >
                  {dayItems.slice(0, 4).map((item) => (
                    <span
                      key={`${item.kind}:${item.id}`}
                      // `itemDot` already owns the per-kind colour; `bg-current` paints
                      // the dot with it rather than starting a third colour table.
                      className={cn(
                        "size-1.5 rounded-full bg-current",
                        itemDot(item)
                      )}
                    />
                  ))}
                  {dayItems.length > 4 ? (
                    <span className="text-[0.62rem] leading-none text-muted-foreground">
                      +{dayItems.length - 4}
                    </span>
                  ) : null}
                </span>
                <span
                  className="mt-1 hidden flex-col gap-0.5 sm:flex"
                  aria-hidden
                >
                  {dayItems.slice(0, 3).map((item) => (
                    <span
                      key={`${item.kind}:${item.id}`}
                      className={cn(
                        "truncate rounded px-1 py-0.5 text-[0.62rem] leading-tight",
                        itemTone(item)
                      )}
                    >
                      {item.title}
                    </span>
                  ))}
                  {dayItems.length > 3 ? (
                    <span className="px-1 text-[0.62rem] text-muted-foreground">
                      +{dayItems.length - 3}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <DayPanel
        date={parseDayKey(selectedDay) ?? month}
        items={dayItems}
        pending={dayPending}
        error={dayError}
        onOpen={onOpenDay}
        onEdit={onEdit}
      />
    </div>
  )
}

/**
 * A week with an axis.
 *
 * This was seven stacked lists of cards: a lesson at eight and a meeting at five drew
 * the same card in the same place, so the one thing a week is read for — the shape of
 * the days, where the gaps are — was the one thing it could not show. Now the hours run
 * down the side and an item occupies the height it actually takes.
 *
 * The placement arithmetic lives in `planning-time-grid`, where it is tested: which lane
 * an item takes when two overlap, how wide the cluster splits, what a bare timestamp is
 * worth. This draws the result and nothing else.
 */
function WeekView({
  anchor,
  items,
  selectedDay,
  onSelect,
  onEdit,
  now,
}: {
  anchor: Date
  items: PlanningItem[]
  selectedDay: string
  onSelect: (date: Date, showDay?: boolean) => void
  onEdit: (item: PlanningItem) => void
  now: Date
}) {
  const t = useExtracted()
  const format = useFormatter()
  const days = planningWeekDays(anchor)
  const window = timeGridWindow(items)
  const hours = Array.from(
    { length: window.toHour - window.fromHour },
    (_, index) => window.fromHour + index
  )
  // 56px an hour: an hour has to be tall enough to hold a title, and a school day has
  // to fit on a laptop without scrolling the page to see the afternoon.
  const hourHeight = 56
  const gridHeight = hours.length * hourHeight
  const minuteTop = (minutes: number) =>
    ((minutes - window.fromHour * 60) / 60) * hourHeight
  const todayKey = dayKey(now)
  const nowTop = minuteTop(now.getHours() * 60 + now.getMinutes())
  const weekHasToday = days.some((date) => dayKey(date) === todayKey)

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* One scroller around the whole week.
          Seven columns on a 375px phone gave each day 45px and each event block
          sixteen — a coloured tick with nothing in it. The columns have a floor now
          and the week overflows sideways, which is the app's rule for wide content;
          the day heads, the all-day strip and the hour axis share the one scroller so
          they cannot drift out of step. */}
      <div className="overflow-x-auto">
        <div className="min-w-[46rem]">
          {/* The day heads, and the all-day strip beneath them: homework and holidays
          have a date but no hour, and hanging them on the axis would be a lie about
          when they happen. */}
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b">
            <span className="border-r" />
            {days.map((date) => {
              const key = dayKey(date)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect(date, true)}
                  aria-pressed={selectedDay === key}
                  className={cn(
                    "border-r px-2 py-2 text-left outline-none last:border-r-0 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    selectedDay === key && "bg-primary/5"
                  )}
                >
                  <span className="block text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">
                    {format.dateTime(date, { weekday: "short" })}
                  </span>
                  <span
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold",
                      key === todayKey && "bg-primary text-primary-foreground"
                    )}
                  >
                    {date.getDate()}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b">
            <span className="border-r px-2 py-1 text-[0.62rem] text-muted-foreground">
              {t("All day")}
            </span>
            {days.map((date) => (
              <div
                key={`allday-${dayKey(date)}`}
                className="min-h-8 border-r p-1 last:border-r-0"
              >
                <div className="flex flex-col gap-1">
                  {allDayItems(itemsForDay(items, date)).map((item) => (
                    <button
                      key={`${item.kind}:${item.id}`}
                      type="button"
                      onClick={() => onEdit(item)}
                      className={cn(
                        "truncate rounded px-1 py-0.5 text-left text-[0.62rem] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        itemTone(item)
                      )}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="relative">
            <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
              <div className="border-r">
                {hours.map((hour) => (
                  <div
                    key={hour}
                    style={{ height: hourHeight }}
                    className="relative"
                  >
                    {/* Sat on the line rather than inside the slot, so the label reads
                    as the boundary between two hours and not as one of them. */}
                    <span className="absolute -top-2 right-1 text-[0.62rem] text-muted-foreground">
                      {String(hour).padStart(2, "0")}:00
                    </span>
                  </div>
                ))}
              </div>

              {days.map((date) => {
                const key = dayKey(date)
                const placements = placeDayItems(
                  itemsForDay(items, date),
                  window
                )
                return (
                  <div
                    key={key}
                    className={cn(
                      "relative border-r last:border-r-0",
                      selectedDay === key && "bg-primary/5"
                    )}
                    style={{ height: gridHeight }}
                  >
                    {hours.map((hour) => (
                      <div
                        key={hour}
                        style={{ height: hourHeight }}
                        className="border-b border-border/60 last:border-b-0"
                      />
                    ))}
                    {key === todayKey ? (
                      <span
                        aria-hidden
                        className="absolute inset-x-0 z-10 h-px bg-destructive"
                        style={{ top: nowTop }}
                      >
                        <span className="absolute -top-1 -left-1 size-2 rounded-full bg-destructive" />
                      </span>
                    ) : null}
                    {placements.map((placement) => (
                      <button
                        key={`${placement.item.kind}:${placement.item.id}`}
                        type="button"
                        data-planning-item-id={placement.item.id}
                        onClick={() => onEdit(placement.item)}
                        title={placement.item.title}
                        className={cn(
                          "absolute overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left text-[0.68rem] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          itemTone(placement.item)
                        )}
                        style={{
                          top: minuteTop(placement.startMinutes),
                          height: Math.max(
                            18,
                            minuteTop(placement.endMinutes) -
                              minuteTop(placement.startMinutes) -
                              2
                          ),
                          left: `calc(${placement.left * 100}% + 2px)`,
                          width: `calc(${placement.width * 100}% - 4px)`,
                        }}
                      >
                        <span className="block truncate font-medium">
                          {placement.item.title}
                        </span>
                        <span className="block truncate opacity-70">
                          {format.dateTime(
                            planningItemStart(placement.item) ?? date,
                            { hour: "2-digit", minute: "2-digit" }
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
            {weekHasToday ? null : <span className="sr-only" />}
          </div>
        </div>
      </div>
    </div>
  )
}

function DayPanel({
  date,
  items,
  pending,
  error,
  onOpen,
  onEdit,
}: {
  date: Date
  items: PlanningItem[]
  pending: boolean
  error: string | null
  onOpen: () => void
  onEdit: (item: PlanningItem) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  return (
    <aside aria-labelledby="planning-selected-day" className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3
          id="planning-selected-day"
          className="text-sm font-semibold capitalize"
        >
          {format.dateTime(date, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </h3>
        <Button variant="ghost" size="sm" onClick={onOpen}>
          {t("Open day")}
        </Button>
      </div>
      {pending ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted/50" />
      ) : error ? (
        <p role="alert" className="rounded-xl border p-4 text-destructive">
          {error}
        </p>
      ) : items.length === 0 ? (
        <PlanningEmpty
          compact
          icon={CalendarDaysIcon}
          title={t("No schedule for this day")}
          description={t("Classes and work for the selected day appear here.")}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <CalendarItemCard
              key={`${item.kind}:${item.id}`}
              item={item}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </aside>
  )
}

function DayView({
  date,
  items,
  pending,
  error,
  onEdit,
}: {
  date: Date
  items: PlanningItem[]
  pending: boolean
  error: string | null
  onEdit: (item: PlanningItem) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  if (pending)
    return <div className="h-[36rem] animate-pulse rounded-xl bg-muted/50" />
  if (error) {
    return (
      <p role="alert" className="rounded-xl border p-4 text-destructive">
        {error}
      </p>
    )
  }
  const allDay = items.filter((item) => item.allDay)
  const timed = items.filter((item) => !item.allDay)
  const placements = timelinePlacements(timed, 7, 21)
  const hours = Array.from({ length: 15 }, (_, index) => 7 + index)

  return (
    <section
      aria-labelledby="planning-day-title"
      className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]"
    >
      <div>
        <h2
          id="planning-day-title"
          className="mb-3 text-lg font-semibold capitalize"
        >
          {format.dateTime(date, { dateStyle: "full" })}
        </h2>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t("All-day work")}
        </h3>
        {allDay.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            {t("No all-day work")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {allDay.map((item) => (
              <CalendarItemCard
                key={`${item.kind}:${item.id}`}
                item={item}
                onEdit={onEdit}
              />
            ))}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b bg-muted/25 px-4 py-3">
          <h3 className="font-semibold">{t("Daily timetable")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("Classes and scheduled blocks from 07:00 to 21:00")}
          </p>
        </div>
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)]">
          <div className="relative h-[56rem] border-r bg-muted/15">
            {hours.map((hour, index) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[0.68rem] text-muted-foreground"
                style={{ top: `${(index / 14) * 100}%` }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <div className="relative h-[56rem]">
            {hours.map((hour, index) => (
              <span
                key={hour}
                aria-hidden
                className="absolute inset-x-0 border-t"
                style={{ top: `${(index / 14) * 100}%` }}
              />
            ))}
            {placements.map((placement) => (
              <div
                key={`${placement.item.kind}:${placement.item.id}`}
                className="absolute z-10 min-h-11 overflow-auto rounded-lg border border-primary/20 bg-primary/8 p-2 shadow-sm"
                style={{
                  top: `${placement.topPercent}%`,
                  height: `${placement.heightPercent}%`,
                  left: `calc(${placement.leftPercent}% + 0.35rem)`,
                  width: `calc(${placement.widthPercent}% - 0.7rem)`,
                }}
              >
                <CalendarItemCard
                  item={placement.item}
                  timeline
                  onEdit={onEdit}
                />
              </div>
            ))}
            {placements.length === 0 ? (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
                {t("No timed classes or events for this day.")}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function CalendarItemCard({
  item,
  compact = false,
  timeline = false,
  onEdit,
}: {
  item: PlanningItem
  compact?: boolean
  timeline?: boolean
  onEdit?: (item: PlanningItem) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { graph } = useYear()
  const start = planningItemStart(item)
  const end = planningItemEnd(item)
  const subject = item.subjectId ? graph.byId(item.subjectId)?.name : null
  const kindLabels: Record<PlanningItem["kind"], string> = {
    task: t("Task"),
    assignment: t("Homework"),
    event: eventLabel(item, t),
    lesson: t("Class"),
    recording: t("Recording"),
    legacy: t("Imported date"),
  }

  if (compact) {
    return (
      <div
        data-planning-item-id={item.id}
        tabIndex={-1}
        className={cn(
          "rounded-lg px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring",
          itemTone(item)
        )}
      >
        <div className="flex min-w-0 items-start gap-1">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{item.title}</p>
            {!item.allDay && start ? (
              <p className="mt-0.5 opacity-75">
                {format.dateTime(start, { timeStyle: "short" })}
              </p>
            ) : null}
          </div>
          <CalendarItemActions item={item} onEdit={onEdit} />
        </div>
        <div className="mt-1">
          <PlanningManagementBadges item={item} />
        </div>
        <PlanningLocalNote item={item} />
      </div>
    )
  }

  return (
    <article
      data-planning-item-id={item.id}
      tabIndex={-1}
      className={cn(
        "focus-visible:ring-2 focus-visible:ring-ring",
        !timeline && "rounded-xl border bg-card p-3"
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <CircleIcon
          className={cn("mt-1 size-2.5 shrink-0 fill-current", itemDot(item))}
        />
        <div className="min-w-0 flex-1">
          <h4
            className={cn(
              "text-sm font-medium",
              planningItemIsComplete(item) &&
                "text-muted-foreground line-through"
            )}
          >
            {item.title}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{kindLabels[item.kind]}</span>
            {subject ? <span>{subject}</span> : null}
            {!item.allDay && start ? (
              <span>
                {format.dateTime(start, { timeStyle: "short" })}
                {end && end.getTime() !== start.getTime()
                  ? ` – ${format.dateTime(end, { timeStyle: "short" })}`
                  : ""}
              </span>
            ) : null}
            {item.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="size-3" /> {item.location}
              </span>
            ) : null}
          </div>
          <div className="mt-2">
            <PlanningManagementBadges item={item} />
          </div>
          <PlanningLocalNote item={item} />
          {(item.kind === "lesson" ||
            (item.kind === "event" &&
              item.eventKind !== "holiday" &&
              item.eventKind !== "workday")) &&
          !item.cancelled ? (
            <Button
              size="sm"
              variant={timeline ? "secondary" : "outline"}
              className="mt-2"
              render={<Link href={recordingHrefForLesson(item)} />}
            >
              <MicIcon />
              {item.kind === "lesson"
                ? t("Record this class")
                : t("Record this event")}
            </Button>
          ) : null}
          {item.recordings && item.recordings.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.recordings.map((recording) => (
                <Badge
                  key={recording.id}
                  variant="outline"
                  render={
                    <Link href={`/materials/recordings/${recording.id}`} />
                  }
                >
                  <MicIcon /> {recording.title}
                </Badge>
              ))}
            </div>
          ) : null}
          {item.recordingIds && item.recordingIds.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.recordingIds.map((recordingId, index) => (
                <Badge
                  key={recordingId}
                  variant="outline"
                  render={
                    <Link href={`/materials/recordings/${recordingId}`} />
                  }
                >
                  <MicIcon />
                  {t("Recording {number}", { number: String(index + 1) })}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <CalendarItemActions item={item} onEdit={onEdit} />
      </div>
    </article>
  )
}

function CalendarItemActions({
  item,
  onEdit,
}: {
  item: PlanningItem
  onEdit?: (item: PlanningItem) => void
}) {
  if (planningItemIsManaged(item)) {
    return <CalendarManagedActions item={item} />
  }
  if ((item.kind !== "event" && item.kind !== "lesson") || !onEdit) {
    return null
  }
  return <CalendarLocalActions item={item} onEdit={() => onEdit(item)} />
}

function CalendarLocalActions({
  item,
  onEdit,
}: {
  item: PlanningItem
  onEdit: () => void
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.planning.calendar.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.planning.day.key() }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.events.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.timetable.listSeries.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.timetable.listOccurrences.key(),
      }),
    ])
  }
  const removed = async () => {
    haptic("success")
    toast.success(
      item.kind === "lesson" && item.seriesId
        ? t("Class cancelled.")
        : t("Calendar item deleted.")
    )
    setConfirmOpen(false)
    await invalidate()
  }
  const eventDelete = useMutation({
    ...orpc.planning.events.delete.mutationOptions(),
    onSuccess: removed,
    onError: (error: Error) => toast.error(error.message),
  })
  const occurrenceDelete = useMutation({
    ...orpc.planning.timetable.deleteOccurrence.mutationOptions(),
    onSuccess: removed,
    onError: (error: Error) => toast.error(error.message),
  })
  const occurrenceCancel = useMutation({
    ...orpc.planning.timetable.cancelOccurrence.mutationOptions(),
    onSuccess: removed,
    onError: (error: Error) => toast.error(error.message),
  })
  const pending =
    eventDelete.isPending ||
    occurrenceDelete.isPending ||
    occurrenceCancel.isPending
  const cancelSeriesOccurrence =
    item.kind === "lesson" && Boolean(item.seriesId)
  const remove = () => {
    if (item.kind === "event") eventDelete.mutate({ eventId: item.id })
    else if (cancelSeriesOccurrence) {
      const locator = lessonLocator(item)
      if (locator) occurrenceCancel.mutate(locator)
    } else {
      occurrenceDelete.mutate({ occurrenceId: item.occurrenceId ?? item.id })
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pending}
              aria-label={t("Actions for {title}", { title: item.title })}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <PencilIcon /> {t("Edit this item")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            {cancelSeriesOccurrence ? <BanIcon /> : <Trash2Icon />}
            {cancelSeriesOccurrence
              ? t("Cancel this class")
              : t("Delete this item")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cancelSeriesOccurrence
                ? t("Cancel {title}?", { title: item.title })
                : t("Delete {title}?", { title: item.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cancelSeriesOccurrence
                ? t(
                    "Only this occurrence will be cancelled; the series remains."
                  )
                : t("This local calendar item will be permanently deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t("Keep")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={remove}
            >
              {cancelSeriesOccurrence ? t("Cancel class") : t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CalendarManagedActions({ item }: { item: PlanningItem }) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.planning.calendar.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.planning.day.key() }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.tasks.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.assignments.list.key(),
      }),
    ])
  }
  const taskDismiss = useMutation({
    ...orpc.planning.tasks.dismiss.mutationOptions(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })
  const taskDetach = useMutation({
    ...orpc.planning.tasks.detach.mutationOptions(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })
  const assignmentDismiss = useMutation({
    ...orpc.planning.assignments.dismiss.mutationOptions(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })
  const assignmentDetach = useMutation({
    ...orpc.planning.assignments.detach.mutationOptions(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })
  const eventDismiss = useMutation({
    ...orpc.planning.events.dismiss.mutationOptions(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })
  const eventDetach = useMutation({
    ...orpc.planning.events.detach.mutationOptions(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })
  const lessonDismiss = useMutation({
    ...orpc.planning.timetable.dismissOccurrence.mutationOptions(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })
  const lessonDetach = useMutation({
    ...orpc.planning.timetable.detachOccurrence.mutationOptions(),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  })

  const pending = [
    taskDismiss,
    taskDetach,
    assignmentDismiss,
    assignmentDetach,
    eventDismiss,
    eventDetach,
    lessonDismiss,
    lessonDetach,
  ].some((mutation) => mutation.isPending)
  const unsupported = () => toast.info(t("This imported date is read-only."))
  const dismiss = () => {
    if (item.kind === "task") taskDismiss.mutate({ taskId: item.id })
    else if (item.kind === "assignment") {
      assignmentDismiss.mutate({ assignmentId: item.id })
    } else if (item.kind === "event") {
      eventDismiss.mutate({ eventId: item.id })
    } else if (item.kind === "lesson") {
      const locator = lessonLocator(item)
      if (locator) lessonDismiss.mutate(locator)
      else unsupported()
    } else unsupported()
  }
  const detach = () => {
    if (item.kind === "task") taskDetach.mutate({ taskId: item.id })
    else if (item.kind === "assignment") {
      assignmentDetach.mutate({ assignmentId: item.id })
    } else if (item.kind === "event") {
      eventDetach.mutate({ eventId: item.id })
    } else if (item.kind === "lesson") {
      const locator = lessonLocator(item)
      if (locator) lessonDetach.mutate(locator)
      else unsupported()
    } else unsupported()
  }

  return (
    <ManagedItemActions
      item={item}
      pending={pending}
      onDismiss={dismiss}
      onDetach={detach}
    />
  )
}

function calendarHeading(
  anchor: Date,
  view: PlanningView,
  format: ReturnType<typeof useFormatter>
): string {
  if (view === "month") {
    return format.dateTime(anchor, { month: "long", year: "numeric" })
  }
  if (view === "day") {
    return format.dateTime(anchor, {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
  }
  const days = planningWeekDays(anchor)
  return `${format.dateTime(days[0]!, { day: "numeric", month: "short" })} – ${format.dateTime(days[6]!, { day: "numeric", month: "short", year: "numeric" })}`
}

function parseDayKey(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day, 12)
  return Number.isNaN(date.getTime()) ? null : date
}

function lessonLocator(
  item: PlanningItem
):
  | { occurrenceId: string }
  | { seriesId: string; occurrenceDate: string }
  | null {
  if (item.virtual && item.seriesId && item.occurrenceDate) {
    return { seriesId: item.seriesId, occurrenceDate: item.occurrenceDate }
  }
  if (!item.virtual) return { occurrenceId: item.occurrenceId ?? item.id }
  return null
}

function eventLabel(
  item: PlanningItem,
  t: ReturnType<typeof useExtracted>
): string {
  if (item.eventKind === "holiday" || item.eventKind === "vacation") {
    return t("Holiday")
  }
  if (item.eventKind === "workday") return t("Work day")
  if (item.eventKind === "block") return t("Time block")
  return t("Event")
}

function itemTone(item: PlanningItem): string {
  if (item.cancelled) return "bg-destructive/10 text-destructive line-through"
  if (item.kind === "lesson") return "bg-primary/10 text-primary"
  if (item.kind === "assignment") return "bg-chart-4/12 text-chart-4"
  if (item.kind === "task") return "bg-band-good/12 text-band-good"
  if (item.kind === "recording") return "bg-chart-2/12 text-chart-2"
  if (item.eventKind === "holiday" || item.eventKind === "vacation") {
    return "bg-chart-5/14 text-chart-5"
  }
  return "bg-muted text-muted-foreground"
}

function itemDot(item: PlanningItem): string {
  if (item.cancelled) return "text-destructive"
  if (item.kind === "lesson") return "text-primary"
  if (item.kind === "assignment") return "text-chart-4"
  if (item.kind === "task") return "text-band-good"
  if (item.kind === "recording") return "text-chart-2"
  return "text-muted-foreground"
}
