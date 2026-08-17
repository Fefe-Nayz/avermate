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
import { bandOf, gradeRatio, type Grade, type ResultBand } from "@avermate/core"
import { GradeList } from "@/components/grades/grade-list"
import { Button } from "@/components/ui/button"
import { useYear } from "@/components/year/year-provider"
import { dayKey, monthGrid } from "@/lib/calendar"
import { cn } from "@/lib/utils"

export { dayKey, monthGrid }

/**
 * Grades, on a calendar.
 *
 * This used to be a general scheduling calendar — time grids, resources, drag
 * and resize, recurrence — pressed into showing all-day, read-only marks. It
 * brought two problems with it. Every event was tinted by a hash of its
 * subject id, so the colours carried no meaning at all on a screen where the
 * one thing worth seeing at a glance is *how it went*; and it bucketed days in
 * UTC while the list beside it grouped by local month, so a late-evening grade
 * could sit in a different month depending on which view you opened.
 *
 * A purpose-built grid fixes both: colour is the result band, and days are
 * local. It also means the mark itself fits in the cell, which is the entire
 * point of putting grades on a calendar.
 */

const BAND_CHIP: Record<ResultBand, string> = {
  excellent: "bg-band-excellent/15 text-band-excellent",
  good: "bg-band-good/15 text-band-good",
  fair: "bg-band-fair/18 text-band-fair",
  weak: "bg-band-weak/18 text-band-weak",
  poor: "bg-band-poor/18 text-band-poor",
}

const BAND_DOT: Record<ResultBand, string> = {
  excellent: "bg-band-excellent",
  good: "bg-band-good",
  fair: "bg-band-fair",
  weak: "bg-band-weak",
  poor: "bg-band-poor",
}

/** Grades bucketed by the local day they were sat. */
export function groupGradesByDay(grades: Grade[]): Map<string, Grade[]> {
  const byDay = new Map<string, Grade[]>()
  for (const grade of grades) {
    const key = dayKey(grade.passedAt)
    const list = byDay.get(key)
    if (list) list.push(grade)
    else byDay.set(key, [grade])
  }
  return byDay
}

/** Bound on rendered month panels, so one stray date cannot mint hundreds. */
const MAX_MONTH_PANELS = 36

export function GradeCalendar({ grades }: { grades: Grade[] }) {
  const t = useExtracted()
  const format = useFormatter()
  const locale = useLocale()
  const { graph, now, passingRatio, scale, decimals } = useYear()

  const dateLocale = locale === "fr" ? fr : enUS
  const weekStartsOn = dateLocale.options?.weekStartsOn === 0 ? 0 : 1

  const today = useMemo(() => new Date(now), [now])
  // Open on the month of the most recent result rather than on today: a
  // student looking at a finished term should not have to page backwards.
  const latest = useMemo(
    () =>
      grades.reduce<Date | null>(
        (last, grade) =>
          last === null || grade.passedAt > last ? grade.passedAt : last,
        null
      ) ?? today,
    [grades, today]
  )
  /**
   * Every month the calendar can reach, laid out end to end.
   *
   * Paging used to mean pressing a chevron, which on a phone is the one
   * interaction a calendar should never need — the gesture for "next month" is
   * a swipe. Rendering the whole span into a scroll-snapping row makes that
   * swipe the native one: no gesture handler, no recentring, and the chevrons
   * simply scroll the same container. The span is bounded by the data (with
   * today always inside it) and capped, so a stray date cannot mint hundreds
   * of panels.
   */
  const months = useMemo(() => {
    const earliest = grades.reduce<Date | null>(
      (first, grade) =>
        first === null || grade.passedAt < first ? grade.passedAt : first,
      null
    )
    const end = startOfMonth(latest > today ? latest : today)
    let start = startOfMonth(earliest ?? end)
    if (start > end) start = end
    const list: Date[] = []
    for (
      let cursor = start;
      cursor <= end && list.length < MAX_MONTH_PANELS;
      cursor = addMonths(cursor, 1)
    ) {
      list.push(cursor)
    }
    // A capped span keeps the most recent months, which are the ones read.
    return list.length === MAX_MONTH_PANELS ? list : list.length ? list : [end]
  }, [grades, latest, today])

  const openAt = useMemo(() => {
    const target = startOfMonth(latest)
    const index = months.findIndex((entry) => isSameMonth(entry, target))
    return index === -1 ? months.length - 1 : index
  }, [latest, months])

  const [monthIndex, setMonthIndex] = useState(openAt)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const pagerRef = useRef<HTMLDivElement | null>(null)
  const settleRef = useRef<number | undefined>(undefined)

  const month =
    months[Math.min(monthIndex, months.length - 1)] ?? startOfMonth(latest)

  /** Jump the pager to a panel; `auto` for the first paint, so it never slides in. */
  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = "smooth") => {
      const node = pagerRef.current
      if (!node) return
      node.scrollTo({ left: index * node.clientWidth, behavior })
    },
    []
  )

  // Adjusted during render rather than from an effect: when the data moves the
  // opening month, the pager must already be on it for the paint that follows.
  const [lastOpenAt, setLastOpenAt] = useState(openAt)
  if (lastOpenAt !== openAt) {
    setLastOpenAt(openAt)
    setMonthIndex(openAt)
  }

  // No animation for the initial placement: the calendar opens on its month,
  // it does not slide there from January.
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

  // Read the settled panel rather than every intermediate pixel: momentum on a
  // phone fires scroll continuously, and re-rendering the month name per frame
  // would flicker it through the months being passed.
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

  const byDay = useMemo(() => groupGradesByDay(grades), [grades])
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
      monthGrid(month, weekStartsOn)
        .slice(0, 7)
        .map((day) => format.dateTime(day, { weekday: "short" })),
    [month, weekStartsOn, format]
  )

  const selected = selectedKey ? (byDay.get(selectedKey) ?? []) : []
  const monthCount = monthGrid(month, weekStartsOn).filter(
    (day) => isSameMonth(day, month) && byDay.has(dayKey(day))
  ).length

  function chipFor(grade: Grade) {
    const ratio = gradeRatio(grade)
    const band = ratio === null ? null : bandOf(ratio, passingRatio)
    return {
      band,
      label:
        ratio === null
          ? "—"
          : (ratio * scale).toLocaleString(locale, {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            }),
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">
          {format.dateTime(month, { month: "long", year: "numeric" })}
        </h2>
        <span className="text-xs text-muted-foreground">
          {monthCount === 1
            ? t("1 day with results")
            : t("{count} days with results", { count: String(monthCount) })}
        </span>
        {/* The chevrons drive the same scroller the swipe does, so the two
            can never disagree about which month is showing. */}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("Previous month")}
            disabled={monthIndex <= 0}
            onClick={() => scrollToIndex(monthIndex - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const index = months.findIndex((entry) =>
                isSameMonth(entry, today)
              )
              if (index !== -1) scrollToIndex(index)
            }}
          >
            {t("Today")}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("Next month")}
            disabled={monthIndex >= months.length - 1}
            onClick={() => scrollToIndex(monthIndex + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div
          role="row"
          className="grid grid-cols-7 border-b bg-muted/40 text-center"
        >
          {weekdays.map((label) => (
            <div
              key={label}
              role="columnheader"
              className="py-2 text-[11px] font-medium text-muted-foreground uppercase"
            >
              {label}
            </div>
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
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const key = dayKey(day)
                  const dayGrades = byDay.get(key) ?? []
                  const outside = !isSameMonth(day, panelMonth)
                  const isToday = isSameDay(day, today)
                  const isSelected = key === selectedKey

                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={format.dateTime(day, {
                        day: "numeric",
                        month: "long",
                      })}
                      disabled={dayGrades.length === 0}
                      onClick={() => setSelectedKey(isSelected ? null : key)}
                      className={cn(
                        "flex min-h-16 flex-col items-stretch gap-1 border-r border-b p-1.5 text-left transition-colors last:border-r-0 md:min-h-24",
                        "[&:nth-child(7n)]:border-r-0",
                        outside && "bg-muted/25",
                        dayGrades.length > 0 && "hover:bg-accent/50",
                        isSelected && "bg-accent",
                        dayGrades.length === 0 && "cursor-default"
                      )}
                    >
                      <span
                        className={cn(
                          "numeric flex size-5 shrink-0 items-center justify-center self-start rounded-full text-[11px]",
                          isToday &&
                            "bg-primary font-semibold text-primary-foreground",
                          !isToday && outside && "text-muted-foreground/50",
                          !isToday && !outside && "text-muted-foreground"
                        )}
                      >
                        {day.getDate()}
                      </span>

                      {/* Phones get a dot per result — a mark chip in a 44px cell is
                    unreadable — and the day's detail opens underneath. */}
                      <span className="flex flex-wrap gap-0.5 md:hidden">
                        {dayGrades.slice(0, 6).map((grade) => {
                          const { band } = chipFor(grade)
                          return (
                            <span
                              key={grade.id}
                              className={cn(
                                "size-1.5 rounded-full",
                                band ? BAND_DOT[band] : "bg-muted-foreground/40"
                              )}
                            />
                          )
                        })}
                      </span>

                      <span className="hidden flex-col gap-0.5 md:flex">
                        {dayGrades.slice(0, 3).map((grade) => {
                          const { band, label } = chipFor(grade)
                          return (
                            <span
                              key={grade.id}
                              className={cn(
                                "flex items-center gap-1 rounded px-1 py-0.5 text-[11px]",
                                band
                                  ? BAND_CHIP[band]
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {graph.byId(grade.subjectId)?.shortName ||
                                  graph.byId(grade.subjectId)?.name ||
                                  grade.name}
                              </span>
                              <span className="numeric font-medium">
                                {label}
                              </span>
                            </span>
                          )
                        })}
                        {dayGrades.length > 3 ? (
                          <span className="px-1 text-[11px] text-muted-foreground">
                            {t("+{count} more", {
                              count: String(dayGrades.length - 3),
                            })}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedKey ? (
        // The same list the timeline and the dashboard use, rather than a
        // fourth hand-rolled copy of it: a day's results are the same rows
        // wherever you meet them, and three near-identical lists is how they
        // drifted apart before.
        <section className="flex flex-col gap-2">
          <h3 className="px-1 text-sm font-medium">
            {format.dateTime(new Date(`${selectedKey}T00:00:00`), {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h3>
          <GradeList grades={selected} />
        </section>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">
          {t("Select a day to see its results.")}
        </p>
      )}
    </div>
  )
}
