"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckSquare2Icon,
  Clock3Icon,
  MicIcon,
  NotebookTabsIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { PageMeta } from "@/components/shell/page-chrome"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
} from "@/components/reui/timeline"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import {
  planningAssignmentsInput,
  planningCalendarInput,
  planningTasksInput,
} from "@/lib/route-query-inputs"
import { cn } from "@/lib/utils"
import { PlanningEmpty } from "./planning-empty"
import { useRememberedTimezone } from "./planning-timezone"
import { PlanningManagementBadges } from "./planning-management"
import {
  normalizePlanningItems,
  planningItemEnd,
  planningItemIsLocked,
  planningItemStart,
  type PlanningItem,
} from "./planning-model"
import {
  dayOffset,
  planningDays,
  planningItemIsOverdue,
  planningNextToday,
  planningTodo,
  type PlanningDayGroup,
} from "./planning-overview"

/** How long a ticked row stays on screen, struck through, before it leaves. */
const STRIKE_MS = 550

const subscribeToBrowserTimezone = () => () => undefined
const browserTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

const KIND_ICONS: Record<PlanningItem["kind"], typeof CalendarDaysIcon> = {
  lesson: CalendarDaysIcon,
  assignment: NotebookTabsIcon,
  task: CheckSquare2Icon,
  event: CalendarDaysIcon,
  recording: MicIcon,
  legacy: Clock3Icon,
}

/**
 * The planning overview.
 *
 * It opened on three counters that repeated the three tabs directly above them,
 * under a title that repeated the breadcrumb, over one flat list of eight rows —
 * classes, homework and tasks in a single column, no day boundaries, nothing to
 * tick, and every row a link to another page. Three ways of saying the same
 * three words, then a list that answered no question in particular.
 *
 * It answers two questions now, because a student arriving here has two and they
 * want opposite orders:
 *
 * - **What do I have to do?** Unfinished work, most urgent first, late at the
 *   top, and tickable where you find it.
 * - **What is coming?** The next days, chronological, grouped under one heading
 *   per day instead of the same date printed on five consecutive rows.
 *
 * Above both, the one thing a glance is usually for: what is happening now.
 */
export function PlanningHubClient({
  initialYearId,
  initialYear,
  initialMonth,
  initialFrom,
  initialTo,
  initialTimezone,
  initialNow,
}: {
  initialYearId: string
  initialYear: number
  initialMonth: number
  initialFrom: string
  initialTo: string
  initialTimezone: string
  initialNow: number
}) {
  const t = useExtracted()
  const { yearId } = useYear()
  const queryClient = useQueryClient()
  const activeYearId = yearId ?? initialYearId
  // Recorded for the next server render, so this page stops guessing UTC.
  useRememberedTimezone(initialTimezone)
  const timezone = useSyncExternalStore(
    subscribeToBrowserTimezone,
    browserTimezone,
    () => initialTimezone
  )

  /**
   * The clock this screen reads.
   *
   * It starts at the server's instant so the first paint matches the markup that
   * arrived, then follows the real one — "in 40 minutes" that never changes is
   * worse than no relative time at all.
   */
  /**
   * The rows being ticked off, held for as long as the strike-through runs.
   *
   * A tick used to make the row vanish the instant the server answered, which
   * reads as "something happened" and not as "that one is done" — there was no
   * moment where the thing you pressed and the result of pressing it were on
   * screen together. The row now stays where it is, checked and struck, and
   * leaves when the refreshed list no longer holds it.
   */
  const [completing, setCompleting] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [now, setNow] = useState(() => new Date(initialNow))
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const anchor = useMemo(
    () =>
      timezone === initialTimezone
        ? new Date(initialYear, initialMonth, 15, 12)
        : new Date(initialNow),
    [initialMonth, initialNow, initialTimezone, initialYear, timezone]
  )
  const calendarInput = useMemo(() => {
    if (activeYearId === initialYearId && timezone === initialTimezone) {
      return {
        yearId: initialYearId,
        from: new Date(initialFrom),
        to: new Date(initialTo),
        timezone: initialTimezone,
      }
    }
    return planningCalendarInput(activeYearId, anchor, "month", timezone)
  }, [
    activeYearId,
    anchor,
    initialFrom,
    initialTimezone,
    initialTo,
    initialYearId,
    timezone,
  ])

  const assignmentsQuery = useQuery(
    orpc.planning.assignments.list.queryOptions({
      input: planningAssignmentsInput(activeYearId),
      staleTime: 30_000,
    })
  )
  const tasksQuery = useQuery(
    orpc.planning.tasks.list.queryOptions({
      input: planningTasksInput(activeYearId),
      staleTime: 30_000,
    })
  )
  const calendarQuery = useQuery(
    orpc.planning.calendar.queryOptions({
      input: calendarInput,
      staleTime: 30_000,
    })
  )

  const assignments = useMemo(
    () => normalizePlanningItems(assignmentsQuery.data, "assignment"),
    [assignmentsQuery.data]
  )
  const tasks = useMemo(
    () => normalizePlanningItems(tasksQuery.data, "task"),
    [tasksQuery.data]
  )
  const calendar = useMemo(
    () => normalizePlanningItems(calendarQuery.data),
    [calendarQuery.data]
  )

  const todo = useMemo(
    () => planningTodo([...assignments, ...tasks], now),
    [assignments, now, tasks]
  )
  const days = useMemo(
    () => planningDays([...calendar, ...assignments, ...tasks], now),
    [assignments, calendar, now, tasks]
  )
  const nextUp = useMemo(
    () => planningNextToday(calendar, now),
    [calendar, now]
  )
  const lateCount = todo.filter((item) =>
    planningItemIsOverdue(item, now)
  ).length

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.planning.assignments.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.planning.tasks.list.key(),
      }),
    ])
  }
  const uncomplete = (key: string) =>
    setCompleting((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })

  const failed = (key: string) => (error: Error) => {
    haptic("error")
    // The strike comes off: nothing was saved, so nothing should look done.
    uncomplete(key)
    toast.error(error.message || t("That change could not be saved."))
  }

  /**
   * The refresh waits for the strike to be seen.
   *
   * Invalidating immediately pulls the row out of the list in the same frame as
   * the press, which is exactly the disappearance this is here to replace.
   */
  const settle = async () => {
    haptic("success")
    await new Promise((resolve) => setTimeout(resolve, STRIKE_MS))
    await invalidate()
  }

  const setAssignmentDone = useMutation(
    orpc.planning.assignments.setCompleted.mutationOptions()
  )
  const setTaskStatus = useMutation(
    orpc.planning.tasks.setStatus.mutationOptions()
  )

  /** Ticking one off, wherever it came from. */
  const complete = (item: PlanningItem) => {
    const key = `${item.kind}:${item.id}`
    setCompleting((current) => new Set(current).add(key))

    if (item.kind === "assignment") {
      setAssignmentDone.mutate(
        { assignmentId: item.id, completed: true },
        { onSuccess: settle, onError: failed(key) }
      )
      return
    }
    setTaskStatus.mutate(
      { taskId: item.id, status: "done" },
      { onSuccess: settle, onError: failed(key) }
    )
  }

  const loading =
    assignmentsQuery.isPending ||
    tasksQuery.isPending ||
    calendarQuery.isPending
  const error =
    assignmentsQuery.error ?? tasksQuery.error ?? calendarQuery.error

  return (
    <>
      <PageMeta
        title={t("Planning")}
        subtitle={t("School agenda, personal tasks, and calendar")}
      />
      {/* No page title here: the header breadcrumb already says "Planning" and
          the tabs say which part of it — a third copy was the first thing on
          the screen and the least useful. */}
      <div className="flex flex-col gap-5">
        {error ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-xl border p-4"
          >
            <p className="text-sm font-medium">
              {t("Your planning could not be loaded.")}
            </p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void assignmentsQuery.refetch()
                void tasksQuery.refetch()
                void calendarQuery.refetch()
              }}
            >
              {t("Try again")}
            </Button>
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-3">
            <div className="h-28 animate-pulse rounded-xl bg-muted/50" />
            <div className="h-64 animate-pulse rounded-xl bg-muted/50" />
          </div>
        ) : (
          <>
            <NowPanel item={nextUp} now={now} today={days[0]} />

            <TodoSection
              items={todo}
              lateCount={lateCount}
              now={now}
              completing={completing}
              onComplete={complete}
            />

            <AgendaSection days={days.slice(1)} now={now} />
          </>
        )}
      </div>
    </>
  )
}

/**
 * What is happening now, or next.
 *
 * The single most-asked question on a planning screen, and the old one made you
 * read eight rows to answer it. A class in progress wins over the one after it:
 * at half past twelve the answer is the period you are sitting in.
 */
function NowPanel({
  item,
  now,
  today,
}: {
  item: PlanningItem | null
  now: Date
  today: PlanningDayGroup | undefined
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { graph } = useYear()

  const start = item ? planningItemStart(item) : null
  const end = item ? planningItemEnd(item) : null
  const running = Boolean(
    start && end && start <= now && end.getTime() > now.getTime()
  )
  const subject = item?.subjectId ? graph.byId(item.subjectId)?.name : null
  const rest = (today?.items ?? []).filter(
    (candidate) =>
      candidate !== item &&
      !candidate.allDay &&
      (planningItemStart(candidate)?.getTime() ?? 0) >= now.getTime()
  )

  return (
    <section
      aria-label={t("Today")}
      className="rounded-xl border bg-card p-4 sm:p-5"
    >
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t("Today")}
        <span aria-hidden> · </span>
        <span className="normal-case">
          {format.dateTime(now, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </span>
      </p>

      {item && start ? (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <time
            dateTime={start.toISOString()}
            className="numeric text-2xl font-semibold sm:text-3xl"
          >
            {format.dateTime(start, { hour: "2-digit", minute: "2-digit" })}
          </time>
          <span className="text-lg font-medium">{item.title}</span>
          {running ? (
            <Badge className="gap-1.5">
              {/* A dot, because "in progress" is a state and a word for it
                  reads as a label rather than as something happening. */}
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
              />
              {t("Now")}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">
              {format.relativeTime(start, now)}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-3 text-lg font-medium">
          {today && today.items.length > 0
            ? t("Nothing left today")
            : t("Nothing planned today")}
        </p>
      )}

      {(subject || item?.location) && (
        <p className="mt-1 text-sm text-muted-foreground">
          {[subject, item?.location].filter(Boolean).join(" · ")}
        </p>
      )}

      {rest.length > 0 ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-sm text-muted-foreground">
          <span className="text-xs tracking-wide uppercase">{t("Then")}</span>
          {rest.slice(0, 4).map((entry) => {
            const at = planningItemStart(entry)
            return (
              <span key={`${entry.kind}:${entry.id}`} className="truncate">
                <span className="numeric text-foreground">
                  {at
                    ? format.dateTime(at, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : null}
                </span>{" "}
                {entry.title}
              </span>
            )
          })}
        </p>
      ) : null}
    </section>
  )
}

/** Everything still to do, and a box beside each one to be done with it. */
function TodoSection({
  items,
  lateCount,
  now,
  completing,
  onComplete,
}: {
  items: PlanningItem[]
  lateCount: number
  now: Date
  completing: ReadonlySet<string>
  onComplete: (item: PlanningItem) => void
}) {
  const t = useExtracted()
  const shown = items.slice(0, 6)

  return (
    <section aria-labelledby="planning-todo">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="planning-todo" className="font-semibold">
          {t("To do")}
        </h2>
        <span className="numeric text-sm text-muted-foreground">
          {items.length}
        </span>
        {lateCount > 0 ? (
          <Badge variant="destructive">
            {t("{count, plural, one {# late} other {# late}}", {
              count: lateCount,
            })}
          </Badge>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ms-auto"
          render={<Link href="/planning/agenda" />}
        >
          {t("Open the agenda")} <ArrowRightIcon />
        </Button>
      </div>

      {items.length === 0 ? (
        <PlanningEmpty
          icon={CheckSquare2Icon}
          title={t("Nothing to do")}
          description={t(
            "Homework and personal tasks appear here until they are ticked off."
          )}
        />
      ) : (
        <>
          <ul className="overflow-hidden rounded-xl border bg-card">
            {shown.map((item) => (
              <TodoRow
                key={`${item.kind}:${item.id}`}
                item={item}
                now={now}
                done={completing.has(`${item.kind}:${item.id}`)}
                onComplete={onComplete}
              />
            ))}
          </ul>
          {items.length > shown.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("{count} more in the agenda and the task board.", {
                count: String(items.length - shown.length),
              })}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

function TodoRow({
  item,
  now,
  done,
  onComplete,
}: {
  item: PlanningItem
  now: Date
  /** Ticked here a moment ago, and still on screen so it can be seen leaving. */
  done: boolean
  onComplete: (item: PlanningItem) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { graph } = useYear()
  const due = planningItemStart(item)
  const late = planningItemIsOverdue(item, now)
  const subject = item.subjectId ? graph.byId(item.subjectId)?.name : null
  // A provider owns some of these; ticking one off here would be undone by the
  // next sync, so the box says it cannot be touched rather than pretending.
  const locked =
    planningItemIsLocked(item, "completed") ||
    planningItemIsLocked(item, "status")
  const href =
    item.kind === "assignment" ? "/planning/agenda" : "/planning/tasks"

  const when = due
    ? item.allDay || dayOffset(due, now) !== 0
      ? format.dateTime(due, {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : format.dateTime(due, { hour: "2-digit", minute: "2-digit" })
    : t("No date")

  return (
    <li
      data-done={done || undefined}
      className="flex items-center gap-3 border-b px-3 py-2.5 transition-opacity duration-300 last:border-b-0 data-done:opacity-50 sm:px-4"
    >
      <Checkbox
        checked={done}
        disabled={locked || done}
        aria-label={t("Mark {name} as done", { name: item.title })}
        onCheckedChange={(checked) => {
          if (checked) onComplete(item)
        }}
      />
      <Link
        href={href}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-medium transition-colors",
              // The line is drawn across the title rather than the whole row:
              // the strike is about the thing, not about its date.
              done && "text-muted-foreground line-through"
            )}
          >
            {item.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>
              {item.kind === "assignment" ? t("Homework") : t("Task")}
            </span>
            {subject ? <span>{subject}</span> : null}
            <span className={cn(late && "font-medium text-destructive")}>
              {when}
            </span>
          </span>
        </span>
        <PlanningManagementBadges item={item} />
      </Link>
    </li>
  )
}

/** The days ahead, one heading each. */
function AgendaSection({ days, now }: { days: PlanningDayGroup[]; now: Date }) {
  const t = useExtracted()
  const withItems = days.filter((day) => day.items.length > 0)

  return (
    <section aria-labelledby="planning-agenda">
      <div className="mb-2 flex items-center gap-3">
        <h2 id="planning-agenda" className="font-semibold">
          {t("Coming up")}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="ms-auto"
          render={<Link href="/planning/calendar" />}
        >
          {t("Open calendar")} <ArrowRightIcon />
        </Button>
      </div>

      {withItems.length === 0 ? (
        <PlanningEmpty
          icon={Clock3Icon}
          title={t("Nothing in the next few days")}
          description={t(
            "Classes, homework deadlines and events will show up here as they are added."
          )}
        />
      ) : (
        /* One rail down the days rather than four detached blocks: the line
           between the dots is what says these are consecutive days of one
           stretch, where a repeated heading left the reader to infer it. */
        <Timeline defaultValue={1}>
          {withItems.map((day, index) => (
            <DayGroup
              key={day.date.toISOString()}
              day={day}
              now={now}
              step={index + 1}
            />
          ))}
        </Timeline>
      )}
    </section>
  )
}

function DayGroup({
  day,
  now,
  step,
}: {
  day: PlanningDayGroup
  now: Date
  step: number
}) {
  const t = useExtracted()
  const format = useFormatter()
  const offset = dayOffset(day.date, now)

  return (
    <TimelineItem step={step}>
      <TimelineIndicator />
      <TimelineSeparator />
      {/* "Tomorrow" beats a date a reader has to count from today. */}
      <TimelineDate className="flex items-baseline gap-2 text-sm text-foreground">
        {offset === 1 ? <span>{t("Tomorrow")}</span> : null}
        <span className={cn(offset === 1 && "text-xs text-muted-foreground")}>
          {format.dateTime(day.date, {
            weekday: "long",
            day: "numeric",
            month: offset > 6 ? "short" : undefined,
          })}
        </span>
      </TimelineDate>
      <TimelineContent>
        <ul className="overflow-hidden rounded-xl border bg-card">
          {day.items.map((item) => (
            <AgendaRow key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </ul>
      </TimelineContent>
    </TimelineItem>
  )
}

function AgendaRow({ item }: { item: PlanningItem }) {
  const t = useExtracted()
  const format = useFormatter()
  const { graph } = useYear()
  const start = planningItemStart(item)
  const subject = item.subjectId ? graph.byId(item.subjectId)?.name : null
  const Icon = KIND_ICONS[item.kind]
  const labels: Record<PlanningItem["kind"], string> = {
    task: t("Task"),
    assignment: t("Homework"),
    event: t("Event"),
    // "Lesson", not "Class": this app already calls a group of classmates a
    // class, and the French rendered both as "Classe".
    lesson: t("Lesson"),
    recording: t("Recording"),
    legacy: t("Imported date"),
  }
  const href =
    item.kind === "assignment"
      ? "/planning/agenda"
      : item.kind === "task"
        ? "/planning/tasks"
        : "/planning/calendar"

  return (
    <li className="border-b last:border-b-0">
      <Link
        href={href}
        className="flex min-w-0 items-center gap-3 px-3 py-2.5 transition-colors outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4"
      >
        {/* The hour carries the row, so it sits first and in a fixed column —
            a list of times only reads down if the times line up. */}
        <span className="numeric w-12 shrink-0 text-sm text-muted-foreground tabular-nums">
          {item.allDay || !start
            ? t("All day")
            : format.dateTime(start, { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {item.title}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span>{labels[item.kind]}</span>
            {subject ? <span>{subject}</span> : null}
            {item.location ? <span>{item.location}</span> : null}
          </span>
        </span>
        <PlanningManagementBadges item={item} />
      </Link>
    </li>
  )
}
