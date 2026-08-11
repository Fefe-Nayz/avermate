"use client"

import Link from "next/link"
import { use, useMemo } from "react"
import {
  ChevronRightIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import {
  averageOverTime,
  consistency,
  dayRange,
  gradeRatio,
  gradeRatios,
  passRate,
  resolveCustomAverage,
  standardDeviation,
  subjectImpact,
} from "@avermate/core"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { PeriodRail, PeriodSwitcher } from "@/components/shell/period-switcher"
import {
  AverageValue,
  CoefficientBadge,
  DeltaValue,
  ResultBadge,
} from "@/components/data/value"
import {
  AVERAGE_SERIES_COLORS,
  MultiSeriesAverageChart,
  type AverageSeries,
} from "@/components/charts/multi-series-average-chart"
import { GradeResultsChart } from "@/components/charts/grade-results-chart"
import { ImpactGrid } from "@/components/analytics/impact-grid"
import { useYear } from "@/components/year/year-provider"
import { usePreferences } from "@/hooks/use-preferences"
import { cn } from "@/lib/utils"
import { TimelineTrigger } from "@/components/shell/timeline-banner"

/**
 * One subject.
 *
 * The three questions a subject page has to answer are how it is going, what
 * it is doing to the general average, and what is in it. In that order, and
 * without making anyone open a second screen for the middle one.
 */
export default function SubjectPage({
  params,
}: {
  params: Promise<{ subjectId: string }>
}) {
  const { subjectId } = use(params)
  const t = useExtracted()
  const format = useFormatter()
  const {
    graph,
    customAverages,
    period,
    year,
    passingRatio,
    scale,
    timelineDate,
    now,
  } = useYear()
  const { preferences, update: updatePreferences } = usePreferences()

  const subject = graph.byId(subjectId)

  const dates = useMemo(() => {
    if (!year || !subject) return []
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
    const span = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)
    return dayRange(from, to, Math.max(1, Math.ceil(span / 60)))
  }, [period, timelineDate, year, subject, now])

  const averageSeries = useMemo<AverageSeries[]>(() => {
    if (!subject || dates.length === 0) return []
    const children = preferences.chartSettings.showSubSubjects
      ? graph.childrenOf(subjectId)
      : []
    return [
      ...children.map((child, index) => ({
        id: child.id,
        label: child.name,
        color:
          AVERAGE_SERIES_COLORS[(index + 1) % AVERAGE_SERIES_COLORS.length],
        points: averageOverTime(graph.subjects, dates, child.id),
      })),
      {
        id: subject.id,
        label: subject.name,
        color: AVERAGE_SERIES_COLORS[0],
        points: averageOverTime(graph.subjects, dates, subject.id),
        primary: true,
      },
    ]
  }, [
    dates,
    graph,
    preferences.chartSettings.showSubSubjects,
    subject,
    subjectId,
  ])

  if (!subject) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Subject not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted, or it belongs to another year.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/subjects" />}>
          {t("Back to subjects")}
        </Button>
      </Empty>
    )
  }

  const ratio = graph.ratio(subjectId)
  const general = graph.ratio(null)
  const children = graph.childrenOf(subjectId)
  const ratios = gradeRatios(graph, subjectId)
  const grades = [...graph.allGrades(subjectId)].reverse()
  const isCategory = subject.kind === "category"

  const impacts = [
    {
      id: "general",
      label: t("General average"),
      href: "/averages/general",
      impact: subjectImpact(graph, subjectId, null),
    },
    ...graph.ancestorsOf(subjectId).map((ancestor) => ({
      id: `subject:${ancestor.id}`,
      label: ancestor.name,
      href: `/subjects/${ancestor.id}`,
      impact: subjectImpact(graph, subjectId, ancestor.id),
    })),
    ...customAverages.flatMap((average) => {
      const resolved = resolveCustomAverage(graph, average)
      if (!resolved.graph.has(subjectId)) return []
      return [
        {
          id: `custom:${average.id}`,
          label: average.name,
          href: `/averages/${average.id}`,
          impact: subjectImpact(
            resolved.graph,
            subjectId,
            null,
            resolved.scope
          ),
        },
      ]
    }),
  ]

  const stats = [
    {
      label: t("Pass rate"),
      value:
        passRate(ratios, passingRatio) === null
          ? "—"
          : format.number(passRate(ratios, passingRatio) as number, {
              style: "percent",
              maximumFractionDigits: 0,
            }),
    },
    {
      label: t("Spread"),
      value:
        standardDeviation(ratios) === null
          ? "—"
          : format.number((standardDeviation(ratios) as number) * scale, {
              maximumFractionDigits: 2,
            }),
    },
    {
      label: t("Consistency"),
      value:
        consistency(ratios) === null
          ? "—"
          : format.number(consistency(ratios) as number, {
              style: "percent",
              maximumFractionDigits: 0,
            }),
    },
    { label: t("Grades"), value: String(ratios.length) },
  ]

  return (
    <>
      <PageMeta
        title={subject.name}
        subtitle={isCategory ? t("Category") : undefined}
      />
      <PageActions>
        <TimelineTrigger />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Edit")}
          render={<Link href={`/subjects/${subjectId}/edit`} />}
        >
          <PencilIcon className="size-4" />
        </Button>
      </PageActions>

      <div className="flex flex-col gap-4">
        <div className="hidden items-center justify-between md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {subject.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isCategory ? t("Category") : t("Subject")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PeriodSwitcher />
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/subjects/${subjectId}/edit`} />}
            >
              <PencilIcon className="size-4" />
              {t("Edit")}
            </Button>
            <Button
              size="sm"
              render={<Link href={`/grades/new?subject=${subjectId}`} />}
            >
              <PlusIcon className="size-4" />
              {t("Add grade")}
            </Button>
          </div>
        </div>

        <div className="-mx-4 md:hidden">
          <PeriodRail />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Card className="col-span-2 gap-1 py-4 @md/main:col-span-1">
            <CardHeader className="px-4">
              <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t("Average")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-baseline gap-2 px-4">
              <AverageValue
                ratio={ratio}
                showScale
                colored
                className="text-3xl font-semibold"
              />
              {ratio !== null && general !== null ? (
                <DeltaValue delta={ratio - general} className="text-sm" />
              ) : null}
            </CardContent>
          </Card>
        </div>

        {children.length > 0 ? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              aria-pressed={preferences.chartSettings.showSubSubjects}
              onClick={() =>
                updatePreferences({
                  chartSettings: {
                    ...preferences.chartSettings,
                    showSubSubjects: !preferences.chartSettings.showSubSubjects,
                  },
                })
              }
            >
              <LayersIcon className="size-4" />
              {preferences.chartSettings.showSubSubjects
                ? t("Hide child series")
                : t("Show child series")}
            </Button>
          </div>
        ) : null}

        <MultiSeriesAverageChart
          title={t("Average over time")}
          series={averageSeries}
          height={340}
          emptyHint={t("Record a few grades and the curve will appear here.")}
        />

        <GradeResultsChart
          grades={graph.allGrades(subjectId)}
          subjects={graph.subjects}
          title={t("Grade results")}
        />

        <ImpactGrid readings={impacts} title={t("Impact on averages")} />

        {!isCategory ? (
          <div className="grid grid-cols-4 gap-2">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border bg-card px-3 py-2.5 text-center"
              >
                <p className="numeric text-lg font-semibold">{stat.value}</p>
                <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {children.length > 0 ? (
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">
                {t("Inside this one")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <ul>
                {children.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/subjects/${child.id}`}
                      className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent active:bg-accent"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {child.name}
                      </span>
                      <CoefficientBadge coefficient={child.coefficient} />
                      <AverageValue
                        ratio={graph.ratio(child.id)}
                        colored
                        animate={false}
                        className="text-sm font-medium"
                      />
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card className="gap-2 py-4">
          <CardHeader className="flex items-center px-4">
            <CardTitle className="flex-1 text-sm font-medium">
              {t("Grades")}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 h-7 text-xs"
              render={<Link href={`/grades/new?subject=${subjectId}`} />}
            >
              <PlusIcon className="size-3.5" />
              {t("Add")}
            </Button>
          </CardHeader>
          <CardContent className="px-2">
            {grades.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("No grade recorded here yet.")}
              </p>
            ) : (
              <ul>
                {grades.map((grade) => (
                  <li key={grade.id}>
                    <Link
                      href={`/grades/${grade.id}`}
                      className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent active:bg-accent"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {grade.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format.dateTime(grade.passedAt, {
                            day: "numeric",
                            month: "short",
                          })}
                          {grade.subjectId !== subjectId ? (
                            <span
                              className={cn("ms-1", "text-muted-foreground/80")}
                            >
                              · {graph.byId(grade.subjectId)?.name}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <CoefficientBadge coefficient={grade.coefficient} />
                      <ResultBadge ratio={gradeRatio(grade)} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
