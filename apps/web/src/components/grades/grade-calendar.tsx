"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { enUS, fr } from "date-fns/locale"
import { useExtracted, useFormatter, useLocale } from "next-intl"
import { gradeRatio, type Grade } from "@avermate/core"
import { EventCalendar } from "@/components/reui/event-calendar/event-calendar"
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content"
import type { EventCalendarI18nOverrides } from "@/components/reui/event-calendar/event-calendar-i18n"
import { EventCalendarNav } from "@/components/reui/event-calendar/event-calendar-nav"
import type { CalendarEvent } from "@/components/reui/event-calendar/event-calendar-types"
import { CoefficientBadge, ResultBadge } from "@/components/data/value"
import { useYear } from "@/components/year/year-provider"

interface GradeCalendarData {
  gradeId: string
  subjectName: string
  coefficient: number
  ratio: number | null
}

function startOfUtcDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  )
}

function subjectColor(subjectId: string) {
  let hash = 0
  for (const character of subjectId) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }
  return `var(--chart-${(Math.abs(hash) % 5) + 1})`
}

export function buildGradeCalendarEvents(
  grades: Grade[],
  subjectName: (subjectId: string) => string
): CalendarEvent<GradeCalendarData>[] {
  return grades.map((grade) => {
    const start = startOfUtcDay(grade.passedAt)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 1)

    return {
      id: grade.id,
      title: grade.name,
      start,
      end,
      allDay: true,
      readOnly: true,
      color: subjectColor(grade.subjectId),
      data: {
        gradeId: grade.id,
        subjectName: subjectName(grade.subjectId),
        coefficient: grade.coefficient,
        ratio: gradeRatio(grade),
      },
    }
  })
}

export function GradeCalendar({ grades }: { grades: Grade[] }) {
  const t = useExtracted()
  const format = useFormatter()
  const locale = useLocale()
  const router = useRouter()
  const { graph, now } = useYear()

  const events = useMemo(
    () =>
      buildGradeCalendarEvents(
        grades,
        (subjectId) => graph.byId(subjectId)?.name ?? t("Unknown subject")
      ),
    [grades, graph, t]
  )
  const latestDate = useMemo(
    () =>
      grades.reduce<Date | null>(
        (latest, grade) =>
          latest === null || grade.passedAt > latest ? grade.passedAt : latest,
        null
      ) ?? new Date(now),
    [grades, now]
  )
  const i18n = useMemo<EventCalendarI18nOverrides>(
    () => ({
      labels: {
        today: t("Today"),
        previous: t("Previous"),
        next: t("Next"),
        noEvents: t("No grades in this range."),
        loading: t("Loading grades"),
        event: t("grade"),
        events: (count) =>
          count === 1
            ? t("1 grade")
            : t("{count} grades", { count: String(count) }),
        selectView: t("Select view"),
        goToDate: t("Go to date"),
      },
      viewNames: {
        month: t("Month"),
        agenda: t("Agenda"),
      },
    }),
    [t]
  )

  return (
    <div className="h-[34rem] min-h-0 overflow-hidden rounded-xl border bg-card md:h-[44rem]">
      <EventCalendar<GradeCalendarData>
        className="h-full"
        defaultDate={latestDate}
        defaultView="month"
        eventTooltip={{ delay: 250 }}
        events={events}
        i18n={i18n}
        interactions={{ drag: false, resize: false, selectSlot: false }}
        locale={locale === "fr" ? fr : enUS}
        nowIndicator={false}
        offDays
        onEventClick={(occurrence) => {
          const gradeId = occurrence.event.data?.gradeId
          if (gradeId) router.push(`/grades/${gradeId}`)
        }}
        renderAgendaEventDetails={(occurrence) => {
          const data = occurrence.event.data
          if (!data) return null
          return (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">
                {data.subjectName}
              </span>
              <CoefficientBadge coefficient={data.coefficient} />
              <ResultBadge ratio={data.ratio} />
            </div>
          )
        }}
        renderEventTooltip={({ occurrence }) => {
          const data = occurrence.event.data
          return (
            <div className="space-y-0.5">
              <p className="font-medium">{occurrence.event.title}</p>
              {data ? (
                <p className="text-muted-foreground">
                  {data.subjectName}
                  {" · "}
                  {data.ratio === null
                    ? t("Not graded")
                    : `${format.number(data.ratio * 20, {
                        maximumFractionDigits: 2,
                      })}/20`}
                </p>
              ) : null}
            </div>
          )
        }}
        scrollbars="native"
        timeZone="UTC"
        views={["month", "agenda"]}
      >
        <EventCalendarNav />
        <EventCalendarContent />
      </EventCalendar>
    </div>
  )
}
