"use client"

import { HistoryIcon, XIcon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { DatePicker } from "@/components/forms/controls"
import { DayScrubber } from "@/components/shell/day-scrubber"
import { Button } from "@/components/ui/button"
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
    <section className="shrink-0 border-b border-band-fair/40 bg-band-fair/12 py-2.5 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] md:pr-[max(1.5rem,var(--spacing-safe-right))] md:pl-[max(1.5rem,var(--spacing-safe-left))]">
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

        <DatePicker
          value={timelineDate}
          min={isoDay(minimum)}
          max={isoDay(maximum)}
          onValueChange={(value) => setTimelineDate(value || null)}
          format="short"
          className="h-11 w-full md:hidden"
        />

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <DayScrubber
              totalDays={Math.max(1, totalDays)}
              selectedDay={selectedDay}
              disabled={totalDays === 0}
              monthStarts={monthStarts}
              ariaLabel={t("Date in the school year")}
              ariaValueText={format.dateTime(
                new Date(minimum + selectedDay * DAY_IN_MS),
                { day: "numeric", month: "long", year: "numeric" }
              )}
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
  )
}
