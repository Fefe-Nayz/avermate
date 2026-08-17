"use client"

import { ChevronUpIcon, HistoryIcon, XIcon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { useEffect, useRef, useState } from "react"
import { DatePicker } from "@/components/forms/controls"
import { DayScrubber } from "@/components/shell/day-scrubber"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"

const DAY_IN_MS = 86_400_000

function isoDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

/** Makes the global time-travel mode discoverable from page and desktop chrome. */
export function TimelineTrigger({ compact = true }: { compact?: boolean }) {
  const t = useExtracted()
  const { now, setTimelineDate, timelineDate, year } = useYear()
  if (!year) return null

  return (
    <Button
      variant={timelineDate ? "secondary" : "ghost"}
      size={compact ? "icon-sm" : "sm"}
      aria-label={timelineDate ? t("Back to today") : t("Time travel")}
      aria-pressed={Boolean(timelineDate)}
      onClick={() => {
        haptic("selection")
        if (timelineDate) {
          setTimelineDate(null)
          return
        }
        const latest = Math.min(now, year.endsAt.getTime())
        setTimelineDate(isoDay(latest))
      }}
    >
      <HistoryIcon className="size-4" />
      {!compact ? t("Time travel") : null}
    </Button>
  )
}

/**
 * While a date is set, every later grade is hidden from the same domain graph
 * used by dashboards, charts and goals. The slider adds the temporal context
 * that a bare date input cannot communicate.
 */
export function TimelineBanner() {
  const t = useExtracted()
  const format = useFormatter()
  const { now, setTimelineDate, timelineDate, year, yearGraph } = useYear()

  if (!timelineDate || !year) return null

  const minimum = year.startsAt.getTime()
  const maximum = Math.max(minimum, Math.min(now, year.endsAt.getTime()))
  const totalDays = Math.max(0, Math.round((maximum - minimum) / DAY_IN_MS))
  const selectedTimestamp = new Date(`${timelineDate}T12:00:00`).getTime()
  const selectedDay = Math.min(
    totalDays,
    Math.max(0, Math.round((selectedTimestamp - minimum) / DAY_IN_MS))
  )
  const marks = [0, Math.round(totalDays / 2), totalDays].filter(
    (value, index, values) => values.indexOf(value) === index
  )
  const monthStarts: number[] = []
  for (let day = 1; day < totalDays; day += 1) {
    if (new Date(minimum + day * DAY_IN_MS).getDate() === 1) {
      monthStarts.push(day)
    }
  }
  const visibleGrades = yearGraph.allGrades().length

  return (
    <>
      <TimelineMiniBar />
      <section className="hidden shrink-0 border-b border-band-fair/40 bg-band-fair/12 py-2.5 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] md:block md:pr-[max(1.5rem,var(--spacing-safe-right))] md:pl-[max(1.5rem,var(--spacing-safe-left))]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 text-sm">
          <div className="relative flex items-start gap-2 md:items-center">
            <HistoryIcon className="mt-0.5 hidden size-4 shrink-0 opacity-70 md:mt-0 md:block" />

            <div className="min-w-0 flex-1 pr-10 md:pr-0">
              <p className="font-medium">
                {t("Showing the year as it stood on {date}.", {
                  date: format.dateTime(new Date(`${timelineDate}T12:00:00`), {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }),
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("{count} grades visible", { count: String(visibleGrades) })}
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("Back to today")}
              className="absolute top-0 right-0 shrink-0 md:static md:order-4"
              onClick={() => {
                haptic("light")
                setTimelineDate(null)
              }}
            >
              <XIcon className="size-4" />
            </Button>

            <div className="hidden md:contents">
              <DatePicker
                value={timelineDate}
                min={isoDay(minimum)}
                max={isoDay(maximum)}
                onValueChange={(value) => setTimelineDate(value || null)}
                format="short"
                className="h-9 w-44 md:order-3 md:flex-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <DayScrubber
                totalDays={Math.max(1, totalDays)}
                selectedDay={selectedDay}
                disabled={totalDays === 0}
                monthStarts={monthStarts}
                ariaLabel={t("Date in the school year")}
                formatDayAction={(day) =>
                  format.dateTime(new Date(minimum + day * DAY_IN_MS), {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                }
                onSelectDay={(day) => {
                  if (day === selectedDay) return
                  haptic("light")
                  setTimelineDate(isoDay(minimum + day * DAY_IN_MS))
                }}
              />
              <div className="mt-1 flex justify-between gap-2 text-[10px] text-muted-foreground">
                {marks.map((day) => (
                  <span key={day} className="whitespace-nowrap">
                    {format.dateTime(new Date(minimum + day * DAY_IN_MS), {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

const SWIPE_OPEN_THRESHOLD_PX = 14

/**
 * The phone's rewind chrome: a pill parked above the tab bar shows the
 * rewound date, and the full controls live in an ordinary drawer — swipe
 * handle, rounded sheet, content height, never reaching the top. The pill
 * opens it on a tap or by being pushed upward: the sheet then grows out of
 * the pill's spot, up over the page and down across the tab bar, and while
 * parked the tab bar underneath stays fully visible and tappable.
 */
function TimelineMiniBar() {
  const t = useExtracted()
  const format = useFormatter()
  const { now, setTimelineDate, timelineDate, year, yearGraph } = useYear()
  const [open, setOpen] = useState(false)
  const gestureRef = useRef<{ startY: number; opened: boolean } | null>(null)

  // The floating pill occludes a strip above the tab bar; the scroll pane
  // digs matching clearance (app.css, mobile only) so the last content can
  // still rise above it.
  const active = Boolean(timelineDate && year)
  useEffect(() => {
    if (!active) return
    document.documentElement.setAttribute("data-rewind", "active")
    return () => document.documentElement.removeAttribute("data-rewind")
  }, [active])

  if (!timelineDate || !year) return null

  const minimum = year.startsAt.getTime()
  const maximum = Math.max(minimum, Math.min(now, year.endsAt.getTime()))
  const totalDays = Math.max(0, Math.round((maximum - minimum) / DAY_IN_MS))
  const selectedTimestamp = new Date(`${timelineDate}T12:00:00`).getTime()
  const selectedDay = Math.min(
    totalDays,
    Math.max(0, Math.round((selectedTimestamp - minimum) / DAY_IN_MS))
  )
  const marks = [0, Math.round(totalDays / 2), totalDays].filter(
    (value, index, values) => values.indexOf(value) === index
  )
  const monthStarts: number[] = []
  for (let day = 1; day < totalDays; day += 1) {
    if (new Date(minimum + day * DAY_IN_MS).getDate() === 1) {
      monthStarts.push(day)
    }
  }
  const visibleGrades = yearGraph.allGrades().length

  const openSheet = () => {
    haptic("selection")
    setOpen(true)
  }

  return (
    <div className="md:hidden">
      {/* Parked pill: fades under the sheet while it is open. */}
      <button
        type="button"
        aria-label={t("Time travel")}
        aria-expanded={open}
        // The tap path is the plain click: a click fired after a pointerup
        // would land on the freshly-mounted overlay and dismiss the sheet
        // in the same breath, which read as "tapping does nothing". A swipe
        // moves past the browser's click slop, so the ghost click never
        // fires on the gesture path.
        onClick={() => {
          if (gestureRef.current?.opened) return
          openSheet()
        }}
        onPointerDown={(event) => {
          gestureRef.current = { startY: event.clientY, opened: false }
        }}
        onPointerMove={(event) => {
          const gesture = gestureRef.current
          if (!gesture || gesture.opened) return
          if (gesture.startY - event.clientY >= SWIPE_OPEN_THRESHOLD_PX) {
            gesture.opened = true
            openSheet()
          }
        }}
        onPointerUp={() => {
          const gesture = gestureRef.current
          if (gesture && !gesture.opened) gestureRef.current = null
        }}
        onPointerCancel={() => {
          gestureRef.current = null
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          openSheet()
        }}
        style={{
          bottom:
            "calc(var(--spacing-tabbar) + var(--spacing-safe-bottom) + 0.5rem)",
        }}
        className="fixed inset-x-4 z-30 flex h-14 touch-none items-center gap-3 rounded-2xl border border-band-fair/40 bg-popover/95 pr-3 pl-2 text-left shadow-lg shadow-black/10 backdrop-blur-xl transition-[opacity,transform] duration-200 active:scale-[0.99] aria-expanded:pointer-events-none aria-expanded:translate-y-2 aria-expanded:opacity-0"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-band-fair/15">
          <HistoryIcon className="size-4 opacity-80" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-tight font-medium">
            {format.dateTime(new Date(`${timelineDate}T12:00:00`), {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">
            {t("{count} grades visible", { count: String(visibleGrades) })}
          </span>
        </span>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted/60">
          <ChevronUpIcon className="size-4 text-muted-foreground" />
        </span>
      </button>

      <Drawer
        open={open}
        onOpenChange={setOpen}
        showSwipeHandle
        swipeDirection="down"
      >
        <DrawerContent aria-label={t("Time travel")} className="md:hidden">
          <DrawerHeader className="pt-1 text-left">
            <DrawerTitle className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-band-fair/15">
                <HistoryIcon className="size-4 opacity-80" />
              </span>
              {format.dateTime(new Date(`${timelineDate}T12:00:00`), {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </DrawerTitle>
            <DrawerDescription>
              {t("{count} grades visible", { count: String(visibleGrades) })}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col gap-5 px-4 pt-1">
            <DatePicker
              value={timelineDate}
              min={isoDay(minimum)}
              max={isoDay(maximum)}
              onValueChange={(value) => setTimelineDate(value || null)}
              format="short"
              className="h-11 w-full"
            />
            {/* The whole scrubber, dates included, is off-limits to the swipe.
                `DayScrubber` carries `data-base-ui-swipe-ignore` itself, and the
                drawer resolves it with `target.closest()` — so the exemption
                covered the ticks and stopped at their bottom edge. The dates
                underneath sit right where a thumb lands, a drag from one was a
                downward swipe like any other, and the sheet shut on the way to
                picking a day. Held here instead of on each child so the two
                halves of one control cannot answer differently again. */}
            <div data-base-ui-swipe-ignore="">
              <DayScrubber
                totalDays={Math.max(1, totalDays)}
                selectedDay={selectedDay}
                disabled={totalDays === 0}
                monthStarts={monthStarts}
                ariaLabel={t("Date in the school year")}
                formatDayAction={(day) =>
                  format.dateTime(new Date(minimum + day * DAY_IN_MS), {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                }
                onSelectDay={(day) => {
                  if (day === selectedDay) return
                  haptic("light")
                  setTimelineDate(isoDay(minimum + day * DAY_IN_MS))
                }}
              />
              <div className="mt-1.5 flex justify-between gap-2 text-[10px] text-muted-foreground">
                {marks.map((day) => (
                  <span key={day} className="whitespace-nowrap">
                    {format.dateTime(new Date(minimum + day * DAY_IN_MS), {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <DrawerFooter className="pt-5">
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => {
                haptic("light")
                setOpen(false)
                setTimelineDate(null)
              }}
            >
              <XIcon className="size-4" />
              {t("Back to today")}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
