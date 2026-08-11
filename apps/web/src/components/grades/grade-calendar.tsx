"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { enUS, fr } from "date-fns/locale"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useExtracted, useFormatter, useLocale } from "next-intl"
import { bandOf, gradeRatio, type Grade, type ResultBand } from "@avermate/core"
import { CoefficientBadge, ResultBadge } from "@/components/data/value"
import { Button } from "@/components/ui/button"
import { useYear } from "@/components/year/year-provider"
import { cn } from "@/lib/utils"

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

/** A local calendar day, as a stable key. Never `toISOString` — that shifts. */
export function dayKey(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, "0")
  const day = `${value.getDate()}`.padStart(2, "0")
  return `${value.getFullYear()}-${month}-${day}`
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

/**
 * The days a month grid has to draw: whole weeks, so the grid stays
 * rectangular and the weekday columns line up.
 */
export function monthGrid(month: Date, weekStartsOn: 0 | 1): Date[] {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn }),
  })
}

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
  const [month, setMonth] = useState(() => startOfMonth(latest))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const byDay = useMemo(() => groupGradesByDay(grades), [grades])
  const days = useMemo(() => monthGrid(month, weekStartsOn), [month, weekStartsOn])
  const weekdays = useMemo(
    () =>
      monthGrid(month, weekStartsOn)
        .slice(0, 7)
        .map((day) => format.dateTime(day, { weekday: "short" })),
    [month, weekStartsOn, format]
  )

  const selected = selectedKey ? (byDay.get(selectedKey) ?? []) : []
  const monthCount = days.filter(
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
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("Previous month")}
            onClick={() => setMonth((current) => addMonths(current, -1))}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMonth(startOfMonth(today))}
          >
            {t("Today")}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("Next month")}
            onClick={() => setMonth((current) => addMonths(current, 1))}
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

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = dayKey(day)
            const dayGrades = byDay.get(key) ?? []
            const outside = !isSameMonth(day, month)
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
                    isToday && "bg-primary font-semibold text-primary-foreground",
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
                          band ? BAND_CHIP[band] : "bg-muted text-muted-foreground"
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {graph.byId(grade.subjectId)?.shortName ||
                            graph.byId(grade.subjectId)?.name ||
                            grade.name}
                        </span>
                        <span className="numeric font-medium">{label}</span>
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

      {selectedKey ? (
        <section className="overflow-hidden rounded-xl border bg-card">
          <h3 className="border-b px-4 py-2.5 text-sm font-medium">
            {format.dateTime(new Date(`${selectedKey}T00:00:00`), {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h3>
          <ul className="divide-y">
            {selected.map((grade) => (
              <li key={grade.id}>
                <Link
                  href={`/grades/${grade.id}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{grade.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {graph.byId(grade.subjectId)?.name}
                    </p>
                  </div>
                  <CoefficientBadge coefficient={grade.coefficient} />
                  <ResultBadge ratio={gradeRatio(grade)} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">
          {t("Select a day to see its results.")}
        </p>
      )}
    </div>
  )
}
