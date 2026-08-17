"use client"

import Link from "next/link"
import { use, useMemo, useState } from "react"
import {
  ChevronRightIcon,
  LayersIcon,
  PencilIcon,
  SearchIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import {
  averageEventDates,
  averageOverTime,
  consistency,
  gradeRatios,
  median,
  passRate,
  resolveCustomAverage,
  subjectImpact,
  type ResolvedCustomAverage,
} from "@avermate/core"
import { ImpactGrid } from "@/components/analytics/impact-grid"
import {
  AVERAGE_SERIES_COLORS,
  MultiSeriesAverageChart,
  type AverageSeries,
} from "@/components/charts/multi-series-average-chart"
import { GradeResultsChart } from "@/components/charts/grade-results-chart"
import { SortMenu } from "@/components/data/sort-menu"
import {
  filterGrades,
  sortGrades,
  sortRows,
  type ChildSortKey,
  type GradeSortKey,
} from "@/components/grades/grade-sorting"
import { Input } from "@/components/ui/input"
import { AverageValue, CoefficientBadge } from "@/components/data/value"
import {
  GradeList,
  gradeListItemClassName,
} from "@/components/grades/grade-list"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { PeriodRail, PeriodSwitcher } from "@/components/shell/period-switcher"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { useYear } from "@/components/year/year-provider"
import { usePreferences } from "@/hooks/use-preferences"
import { TimelineTrigger } from "@/components/shell/timeline-banner"

/** Analytical destination for the general average and every custom average. */
export default function AverageAnalyticsPage({
  params,
}: {
  params: Promise<{ averageId: string }>
}) {
  const { averageId } = use(params)
  const t = useExtracted()
  const format = useFormatter()
  const {
    customAverages,
    graph,
    now,
    passingRatio,
    period,
    scale,
    timelineDate,
    year,
  } = useYear()
  const { preferences, update: updatePreferences } = usePreferences()
  const [gradeQuery, setGradeQuery] = useState("")
  const [gradeSort, setGradeSort] = useState<GradeSortKey>("date")
  const [subjectSort, setSubjectSort] = useState<ChildSortKey>("custom")
  const custom = customAverages.find((average) => average.id === averageId)
  const isGeneral = averageId === "general"

  const resolved = useMemo<ResolvedCustomAverage | null>(() => {
    if (isGeneral) return { graph, scope: {} }
    return custom ? resolveCustomAverage(graph, custom) : null
  }, [custom, graph, isGeneral])
  const title = isGeneral ? t("General average") : (custom?.name ?? "")

  const range = useMemo(() => {
    if (!resolved || !year) return null
    const from = new Date(
      Math.max(period.startAt.getTime(), year.startsAt.getTime())
    )
    const timelineEnd = timelineDate
      ? new Date(`${timelineDate}T23:59:59`).getTime()
      : now
    const to = new Date(
      Math.min(timelineEnd, period.endAt.getTime(), year.endsAt.getTime())
    )
    if (to <= from) return null
    return { from, to }
  }, [now, period, resolved, timelineDate, year])

  const averageSeries = useMemo<AverageSeries[]>(() => {
    if (!resolved || !range) return []
    const children = preferences.chartSettings.showSubSubjects
      ? resolved.graph.childrenOf(null)
      : []
    const seriesFor = (target: string | null) =>
      averageOverTime(
        resolved.graph.subjects,
        averageEventDates(
          resolved.graph.subjects,
          range.from,
          range.to,
          target
        ),
        target,
        resolved.scope
      )

    return [
      ...children.map((child, index) => ({
        id: child.id,
        label: child.name,
        color:
          AVERAGE_SERIES_COLORS[(index + 1) % AVERAGE_SERIES_COLORS.length],
        points: seriesFor(child.id),
      })),
      {
        id: "average",
        label: title,
        color: AVERAGE_SERIES_COLORS[0],
        points: seriesFor(null),
        primary: true,
      },
    ]
  }, [preferences.chartSettings.showSubSubjects, range, resolved, title])

  const children = resolved?.graph.childrenOf(null) ?? []

  if (!resolved || (!isGeneral && !custom)) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Average not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted, or it belongs to another year.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/settings/averages" />}>
          {t("Back to custom averages")}
        </Button>
      </Empty>
    )
  }

  const ratio = resolved.graph.ratio(null, resolved.scope)
  const ratios = gradeRatios(resolved.graph)
  const allGrades = [...resolved.graph.allGrades()].reverse()
  const grades = sortGrades(
    filterGrades(allGrades, gradeQuery, (id) => graph.byId(id)?.name),
    gradeSort
  )
  const contributors = resolved.graph.contributorsOf(null)
  const composition = custom
    ? custom.entries.flatMap((entry) => {
        const subject = graph.byId(entry.subjectId)
        if (!subject || !resolved.graph.has(subject.id)) return []
        return [
          {
            name: subject.name,
            coefficient: entry.coefficient ?? subject.coefficient,
            ratio: resolved.graph.ratio(subject.id, resolved.scope),
            subject,
          },
        ]
      })
    : contributors.map((subject) => ({
        name: subject.name,
        coefficient: subject.coefficient,
        ratio: graph.ratio(subject.id),
        subject,
      }))
  // Ordered on the figures the rows display, which for a custom average are
  // its own overridden coefficients and scoped ratios rather than the
  // subjects' own.
  const visibleComposition = sortRows(composition, subjectSort)
  const stats = [
    {
      label: t("Median"),
      value:
        median(ratios) === null
          ? "—"
          : format.number((median(ratios) as number) * scale, {
              maximumFractionDigits: 2,
            }),
    },
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
      label: t("Consistency"),
      value:
        consistency(ratios) === null
          ? "—"
          : format.number(consistency(ratios) as number, {
              style: "percent",
              maximumFractionDigits: 0,
            }),
    },
    // `ratios`, not the rendered list: that one is filtered by the search box,
    // and a statistic that moves while you type is describing your query rather
    // than your results. Same source as the subject page's tile.
    { label: t("Grades"), value: String(ratios.length) },
  ]
  const impacts = contributors.map((subject) => ({
    id: subject.id,
    label: subject.name,
    href: `/subjects/${subject.id}`,
    impact: subjectImpact(resolved.graph, subject.id, null, resolved.scope),
  }))

  return (
    <>
      <PageMeta title={title} backHref="/subjects" />
      <PageActions>
        <TimelineTrigger />
        {custom ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Edit")}
            render={<Link href={`/settings/averages/${custom.id}`} />}
          >
            <PencilIcon className="size-4" />
          </Button>
        ) : null}
      </PageActions>

      <div className="flex flex-col gap-4">
        <div className="hidden items-center justify-between md:flex">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("A complete view of this average")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PeriodSwitcher />
            {custom ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/settings/averages/${custom.id}`} />}
              >
                <PencilIcon className="size-4" />
                {t("Edit")}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="-mx-4 md:hidden">
          <PeriodRail />
        </div>

        {/* The same band a subject page uses: the average beside the four
            figures that qualify it. They were split here — the number at the
            top, the figures most of a page further down — so the two pages
            answered the same question in two different shapes. */}
        <div className="grid grid-cols-2 gap-3 @2xl/main:grid-cols-3 @4xl/main:grid-cols-6">
          <Card className="col-span-2 gap-1 py-4 @2xl/main:col-span-1 @4xl/main:col-span-2">
            <CardHeader className="px-4">
              <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t("Average")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <AverageValue
                ratio={ratio}
                showScale
                colored
                className="text-3xl font-semibold"
                animateFromZero
              />
            </CardContent>
          </Card>

          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col justify-center rounded-xl border bg-card px-3 py-2.5 text-center"
            >
              <p className="numeric text-lg font-semibold">{stat.value}</p>
              <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        <MultiSeriesAverageChart
          title={t("Over time")}
          series={averageSeries}
          emptyHint={t("Record a few grades and the curve will appear here.")}
          height={320}
          headerActions={
            children.length > 0 ? (
              <Button
                variant={
                  preferences.chartSettings.showSubSubjects
                    ? "secondary"
                    : "ghost"
                }
                size="sm"
                aria-pressed={preferences.chartSettings.showSubSubjects}
                aria-label={
                  preferences.chartSettings.showSubSubjects
                    ? t("Hide child series")
                    : t("Show child series")
                }
                onClick={() =>
                  updatePreferences({
                    chartSettings: {
                      ...preferences.chartSettings,
                      showSubSubjects:
                        !preferences.chartSettings.showSubSubjects,
                    },
                  })
                }
              >
                <LayersIcon className="size-4" />
                <span className="hidden sm:inline">
                  {preferences.chartSettings.showSubSubjects
                    ? t("Hide child series")
                    : t("Show child series")}
                </span>
              </Button>
            ) : undefined
          }
        />

        <GradeResultsChart
          grades={resolved.graph.allGrades()}
          subjects={resolved.graph.subjects}
          title={t("Grade results")}
        />

        {/* Impacts before the list, as on a subject page: the two answer
            "which of these matters most" and "what are these", in that order.
            They were the other way round here. */}
        <ImpactGrid readings={impacts} title={t("Impact by subject")} />

        {composition.length > 0 ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <h3 className="text-sm font-medium">{t("Subjects")}</h3>
              {composition.length > 1 ? (
                <SortMenu
                  value={subjectSort}
                  onValueChange={setSubjectSort}
                  variant="ghost"
                  size="icon-sm"
                  options={[
                    { value: "custom", label: t("Custom order") },
                    { value: "name", label: t("Name") },
                    { value: "best", label: t("Best average") },
                    { value: "coefficient", label: t("Highest coefficient") },
                  ]}
                />
              ) : null}
            </div>
            <Card className="gap-2 py-0">
              <CardContent className="p-0">
                <ul className="divide-y">
                  {visibleComposition.map(({ coefficient, ratio, subject }) => (
                    <li key={subject.id}>
                      <Link
                        href={`/subjects/${subject.id}`}
                        className={gradeListItemClassName}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {subject.name}
                        </span>
                        <CoefficientBadge coefficient={coefficient} />
                        <AverageValue
                          ratio={ratio}
                          colored
                          animateFromZero
                          className="text-sm font-medium"
                        />
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="px-1 text-sm font-medium">{t("Grades")}</h3>
          {/* Search and sort, the same pair a subject page offers over the same
              list. An average can gather more grades than any single subject,
              so it was the page that needed them most and the only one without
              them. Both controls come from the shared helpers, so the orders
              mean the same thing on both pages. */}
          {allGrades.length > 1 ? (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={gradeQuery}
                  onChange={(event) => setGradeQuery(event.target.value)}
                  placeholder={t("Search grades…")}
                  className="h-11 pl-9 md:h-9"
                />
              </div>
              <SortMenu
                value={gradeSort}
                onValueChange={setGradeSort}
                className="h-11 md:h-9 md:w-9"
                options={[
                  { value: "date", label: t("Most recent") },
                  { value: "oldest", label: t("Oldest first") },
                  { value: "best", label: t("Best result") },
                  { value: "worst", label: t("Worst result") },
                ]}
              />
            </div>
          ) : null}
          {grades.length === 0 ? (
            <Card className="gap-2 py-0">
              <CardContent className="p-0">
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("No grade recorded here yet.")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <GradeList grades={grades} />
          )}
        </section>
      </div>
    </>
  )
}
