"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { CheckIcon, PencilRulerIcon, PlusIcon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { averageEventDates, averageOverTime } from "@avermate/core"
import { Button } from "@/components/ui/button"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { PeriodRail, PeriodSwitcher } from "@/components/shell/period-switcher"
import { CardGrid } from "@/components/cards/card-grid"
import { AverageChart } from "@/components/charts/average-chart"
import { SubjectRadarChart } from "@/components/charts/subject-radar-chart"
import { RecentGrades } from "@/components/grades/recent-grades"
import { GoalStrip } from "@/components/goals/goal-strip"
import { useYear } from "@/components/year/year-provider"
import { useGoalPlans } from "@/hooks/use-goal-plans"
import { haptic } from "@/lib/haptics"
import { TimelineTrigger } from "@/components/shell/timeline-banner"
import { cn } from "@/lib/utils"

/**
 * The dashboard.
 *
 * Layout is the user's: the cards are theirs to choose, arrange and resize.
 * What is fixed is the order of the questions — how am I doing, where am I
 * heading, what did I just get — because that is the order people ask them in.
 */
export default function DashboardPage() {
  const t = useExtracted()
  const format = useFormatter()
  const { year, graph, period, goals, timelineDate, now } = useYear()
  const { plans } = useGoalPlans()
  const [editing, setEditing] = useState(false)

  const series = useMemo(() => {
    if (!year) return []
    const from = new Date(
      Math.max(
        new Date(period.startAt).getTime(),
        new Date(year.startsAt).getTime()
      )
    )
    const timelineEnd = timelineDate
      ? new Date(`${timelineDate}T23:59:59`).getTime()
      : now
    const to = new Date(Math.min(timelineEnd, new Date(period.endAt).getTime()))
    if (to <= from) return []
    // A point per day that received a grade, never one in between: the
    // average only moves when a note lands, and the linear time axis keeps
    // the quiet weeks visibly quiet.
    return averageOverTime(
      graph.subjects,
      averageEventDates(graph.subjects, from, to),
      null,
      null,
      graph.options
    )
  }, [graph, period, timelineDate, year, now])

  const pinnedGoals = useMemo(
    () =>
      plans(
        goals.filter((goal) => goal.isPinned || goals.length <= 2).slice(0, 3)
      ),
    [goals, plans]
  )

  const hasCurve = series.length > 1

  const greeting = format.dateTime(new Date(now), {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  return (
    <>
      <PageMeta title={t("Dashboard")} subtitle={greeting} bare={false} />
      <PageActions>
        <TimelineTrigger />
        <Button
          variant="ghost"
          size="icon"
          aria-label={editing ? t("Done") : t("Edit dashboard")}
          onClick={() => {
            haptic("selection")
            setEditing((current) => !current)
          }}
        >
          {editing ? (
            <CheckIcon className="size-4" />
          ) : (
            <PencilRulerIcon className="size-4" />
          )}
        </Button>
      </PageActions>

      <div className="flex flex-col gap-5">
        <div className="hidden items-center justify-between gap-3 md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Dashboard")}
            </h1>
            <p className="text-sm text-muted-foreground">{greeting}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={editing ? "default" : "outline"}
              size="sm"
              onClick={() => setEditing((current) => !current)}
            >
              {editing ? (
                <>
                  <CheckIcon className="size-4" />
                  {t("Done")}
                </>
              ) : (
                <>
                  <PencilRulerIcon className="size-4" />
                  {t("Customise")}
                </>
              )}
            </Button>
            <Button size="sm" render={<Link href="/grades/new" />}>
              <PlusIcon className="size-4" />
              {t("Add grade")}
            </Button>
          </div>
        </div>

        <div className="-mx-4 md:hidden">
          <PeriodRail />
        </div>
        <div className="hidden md:block">
          <PeriodSwitcher variant="ghost" className="-ml-2" />
        </div>

        <CardGrid editing={editing} />

        {pinnedGoals.length > 0 ? <GoalStrip plans={pinnedGoals} /> : null}

        {/*
         * Two columns only when there are two things to put in them. The grid
         * was unconditionally `grid-cols-2`, so a year without enough history
         * for a curve left the radar in the first column and half the row
         * empty — a gap that reads as something failing to load.
         */}
        <div
          className={cn(
            "grid gap-3",
            hasCurve && "@3xl/main:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
          )}
        >
          {hasCurve ? (
            <AverageChart
              title={t("How the year is going")}
              series={series}
              emptyHint={t(
                "Record a few grades and the curve will appear here."
              )}
              height={340}
            />
          ) : null}
          <SubjectRadarChart title={t("Main subjects at a glance")} />
        </div>

        <RecentGrades limit={6} />

        {graph.subjects.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {t("This year has no subjects yet.")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              render={<Link href="/subjects/new" />}
            >
              <PlusIcon className="size-4" />
              {t("Add a subject")}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  )
}
