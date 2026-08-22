"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns3Icon,
  ListIcon,
  PlusIcon,
} from "lucide-react"
import { useExtracted, useFormatter, useLocale } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { SelectControl } from "@/components/forms/controls"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { useYear } from "@/components/year/year-provider"
import { dayKey, monthGrid } from "@/components/calendar/month-grid"
import { useStickyState } from "@/hooks/use-sticky-state"
import { agendaMonthInput } from "@/lib/route-query-inputs"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"
import {
  AGENDA_TONE_CLASS,
  agendaOccurrences,
  agendaTone,
  groupAgendaByDay,
  type AgendaEntry,
  type AgendaOccurrence,
  type AgendaViewMode,
  type PlannerTaskStatus,
} from "./agenda-model"
import { AgendaBoard } from "./agenda-board"

const VIEW_ICONS = {
  calendar: CalendarDaysIcon,
  list: ListIcon,
  board: Columns3Icon,
} as const

export function AgendaClient({
  initialYearId,
  initialYear,
  initialMonth,
  initialDay,
  initialFrom,
  initialTo,
}: {
  initialYearId: string
  initialYear: number
  /** Zero-indexed, like `Date#getMonth`. */
  initialMonth: number
  /** Request-stable local day, so hydration cannot cross midnight. */
  initialDay: string
  initialFrom: string
  initialTo: string
}) {
  const t = useExtracted()
  const format = useFormatter()
  const locale = useLocale()
  const { yearId } = useYear()
  const activeYearId = yearId ?? initialYearId
  const [view, setView] = useStickyState<AgendaViewMode>(
    "avermate:agenda-view",
    "calendar"
  )
  const [month, setMonth] = useState(
    () => new Date(initialYear, initialMonth, 15, 12)
  )
  const [selectedDay, setSelectedDay] = useState(initialDay)

  const input = useMemo(() => {
    if (
      activeYearId === initialYearId &&
      month.getFullYear() === initialYear &&
      month.getMonth() === initialMonth
    ) {
      return {
        yearId: initialYearId,
        from: new Date(initialFrom),
        to: new Date(initialTo),
      }
    }
    return agendaMonthInput(activeYearId, month)
  }, [
    activeYearId,
    initialFrom,
    initialMonth,
    initialTo,
    initialYear,
    initialYearId,
    month,
  ])

  const agenda = useQuery(
    orpc.planner.agenda.queryOptions({ input, staleTime: 30_000 })
  )
  const entries = useMemo(
    () => (agenda.data ?? []) as AgendaEntry[],
    [agenda.data]
  )
  const occurrences = useMemo(
    () => agendaOccurrences(entries, input),
    [entries, input]
  )
  const groups = useMemo(() => groupAgendaByDay(occurrences), [occurrences])

  const changeMonth = (offset: number) => {
    haptic("selection")
    setMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + offset, 15, 12)
    )
    setSelectedDay("")
  }

  const viewLabels: Record<AgendaViewMode, string> = {
    calendar: t("Calendar"),
    list: t("List"),
    board: t("Board"),
  }

  return (
    <>
      <PageMeta
        title={t("Agenda")}
        subtitle={t("Tasks, events, and important dates")}
      />
      <PageActions>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("New task or event")}
          render={<Link href="/agenda/new" />}
        >
          <PlusIcon className="size-5" />
        </Button>
      </PageActions>

      <div className="flex flex-col gap-4">
        <div className="hidden items-start justify-between gap-4 md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Agenda")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("Tasks, events, and important dates")}
            </p>
          </div>
          <Button size="sm" render={<Link href="/agenda/new" />}>
            <PlusIcon className="size-4" />
            {t("New item")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {view !== "board" ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("Previous month")}
                onClick={() => changeMonth(-1)}
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <h2 className="min-w-36 text-center text-sm font-semibold capitalize">
                {format.dateTime(month, { month: "long", year: "numeric" })}
              </h2>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("Next month")}
                onClick={() => changeMonth(1)}
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          ) : (
            <h2 className="text-sm font-semibold">{t("Task board")}</h2>
          )}

          <div
            role="group"
            aria-label={t("Agenda view")}
            className="flex rounded-lg border bg-muted/35 p-0.5"
          >
            {(["calendar", "list", "board"] as const).map((mode) => {
              const Icon = VIEW_ICONS[mode]
              return (
                <Button
                  key={mode}
                  variant={view === mode ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={view === mode}
                  aria-label={viewLabels[mode]}
                  className="h-8 px-2.5"
                  onClick={() => setView(mode)}
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{viewLabels[mode]}</span>
                </Button>
              )
            })}
          </div>
        </div>

        {view === "board" ? (
          <AgendaBoard yearId={activeYearId} />
        ) : agenda.isPending ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted/50" />
        ) : agenda.isError ? (
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyTitle>{t("The agenda could not be loaded.")}</EmptyTitle>
              <EmptyDescription>
                {agenda.error.message || t("The agenda could not be loaded.")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : view === "calendar" ? (
          <CalendarView
            month={month}
            locale={locale}
            occurrences={occurrences}
            todayKey={initialDay}
            selectedDay={selectedDay}
            onSelectDay={(day) => {
              if (
                day.getFullYear() !== month.getFullYear() ||
                day.getMonth() !== month.getMonth()
              ) {
                setMonth(new Date(day.getFullYear(), day.getMonth(), 15, 12))
              }
              setSelectedDay(dayKey(day))
            }}
          />
        ) : (
          <AgendaList groups={groups} />
        )}
      </div>
    </>
  )
}

function CalendarView({
  month,
  locale,
  occurrences,
  todayKey,
  selectedDay,
  onSelectDay,
}: {
  month: Date
  locale: string
  occurrences: AgendaOccurrence[]
  todayKey: string
  selectedDay: string
  onSelectDay: (day: Date) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const weekStartsOn = locale.toLowerCase().startsWith("fr") ? 1 : 0
  const days = useMemo(
    () => monthGrid(month, weekStartsOn),
    [month, weekStartsOn]
  )
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaOccurrence[]>()
    for (const occurrence of occurrences) {
      const key = dayKey(occurrence.date)
      const current = map.get(key)
      if (current) current.push(occurrence)
      else map.set(key, [occurrence])
    }
    return map
  }, [occurrences])
  const effectiveDay =
    selectedDay && days.some((day) => dayKey(day) === selectedDay)
      ? selectedDay
      : dayKey(
          days.find(
            (day) =>
              day.getFullYear() === month.getFullYear() &&
              day.getMonth() === month.getMonth() &&
              dayKey(day) === todayKey
          ) ?? new Date(month.getFullYear(), month.getMonth(), 1, 12)
        )
  const selectedDate = days.find((day) => dayKey(day) === effectiveDay)
  const selectedItems = byDay.get(effectiveDay) ?? []
  const weekdayDates = days.slice(0, 7)

  return (
    <div className="grid gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {weekdayDates.map((day) => (
            <div
              key={dayKey(day)}
              className="px-1 py-2 text-center text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase"
            >
              {format.dateTime(day, { weekday: "short" })}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = dayKey(day)
            const items = byDay.get(key) ?? []
            const outside = day.getMonth() !== month.getMonth()
            const selected = key === effectiveDay
            const today = key === todayKey
            const dateLabel = format.dateTime(day, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                aria-current={today ? "date" : undefined}
                aria-label={
                  items.length > 0
                    ? `${dateLabel}. ${t("{count} agenda items", {
                        count: String(items.length),
                      })}`
                    : dateLabel
                }
                onClick={() => onSelectDay(day)}
                className={cn(
                  "relative min-h-16 border-r border-b p-1.5 text-left outline-none last:border-r-0 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-24",
                  outside && "bg-muted/25 text-muted-foreground",
                  selected && "bg-primary/5"
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs",
                    today && "bg-primary font-semibold text-primary-foreground"
                  )}
                >
                  {day.getDate()}
                </span>
                <span className="mt-1 flex flex-wrap gap-1" aria-hidden>
                  {items.slice(0, 4).map((item) => (
                    <span
                      key={item.key}
                      className={cn(
                        "size-1.5 rounded-full",
                        AGENDA_TONE_CLASS[agendaTone(item.entry)].dot
                      )}
                    />
                  ))}
                  {items.length > 4 ? (
                    <span className="text-[0.62rem] text-muted-foreground">
                      +{items.length - 4}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <section aria-labelledby="agenda-selected-day" className="min-w-0">
        <h3
          id="agenda-selected-day"
          className="mb-2 text-sm font-semibold capitalize"
        >
          {selectedDate
            ? format.dateTime(selectedDate, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : t("Selected day")}
        </h3>
        <AgendaItems items={selectedItems} compact />
      </section>
    </div>
  )
}

function AgendaList({
  groups,
}: {
  groups: Array<{ key: string; date: Date; items: AgendaOccurrence[] }>
}) {
  const t = useExtracted()
  const format = useFormatter()
  if (groups.length === 0) return <AgendaEmpty />

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`agenda-day-${group.key}`}>
          <h3
            id={`agenda-day-${group.key}`}
            className="mb-2 text-sm font-semibold capitalize"
          >
            {format.dateTime(group.date, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
            <span className="ml-2 font-normal text-muted-foreground">
              {t("{count} items", { count: String(group.items.length) })}
            </span>
          </h3>
          <AgendaItems items={group.items} />
        </section>
      ))}
    </div>
  )
}

function AgendaItems({
  items,
  compact = false,
}: {
  items: AgendaOccurrence[]
  compact?: boolean
}) {
  if (items.length === 0) return <AgendaEmpty compact={compact} />
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {items.map((item) => (
        <AgendaRow key={item.key} occurrence={item} />
      ))}
    </div>
  )
}

function AgendaRow({ occurrence }: { occurrence: AgendaOccurrence }) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const entry = occurrence.entry
  const tone = AGENDA_TONE_CLASS[agendaTone(entry)]
  const status = useMutation({
    ...orpc.planner.setStatus.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.planner.agenda.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.planner.list.key() }),
      ])
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const sourceLabel =
    entry.source === "planner"
      ? entry.kind === "task"
        ? t("Task")
        : t("Event")
      : entry.source === "goal"
        ? t("Goal")
        : entry.source === "grade"
          ? t("Grade")
          : occurrence.boundary === "end"
            ? t("Period ends")
            : t("Period starts")

  return (
    <div className="flex min-w-0 items-center gap-3 border-b px-3 py-3 last:border-b-0">
      <span className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
      <Link
        href={entry.href}
        className="min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="block truncate text-sm font-medium">
          {entry.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{sourceLabel}</span>
          {!entry.allDay ? (
            <span>
              {format.dateTime(occurrence.date, { timeStyle: "short" })}
            </span>
          ) : null}
          {entry.completed ? <span>{t("Completed")}</span> : null}
        </span>
      </Link>
      {entry.source === "planner" && entry.kind === "task" && entry.status ? (
        <SelectControl
          aria-label={t("Status for {title}", { title: entry.title })}
          value={
            status.isPending
              ? (status.variables?.status ?? entry.status)
              : entry.status
          }
          disabled={status.isPending}
          onValueChange={(value) =>
            status.mutate({
              itemId: entry.id,
              status: value as PlannerTaskStatus,
            })
          }
          className="h-8 w-32 text-xs"
          contentClassName="min-w-32"
          options={[
            { value: "todo", label: t("To do") },
            { value: "doing", label: t("In progress") },
            { value: "done", label: t("Done") },
          ]}
        />
      ) : (
        <span
          className={cn("rounded-full px-2 py-1 text-[0.68rem]", tone.chip)}
        >
          {sourceLabel}
        </span>
      )}
    </div>
  )
}

function AgendaEmpty({ compact = false }: { compact?: boolean }) {
  const t = useExtracted()
  return (
    <Empty className={cn("border", compact ? "min-h-36" : "min-h-64")}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarDaysIcon />
        </EmptyMedia>
        <EmptyTitle>{t("Nothing planned here")}</EmptyTitle>
        <EmptyDescription>
          {t("Tasks, events, goals, and results will appear together.")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
