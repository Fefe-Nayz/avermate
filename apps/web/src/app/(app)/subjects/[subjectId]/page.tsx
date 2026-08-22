"use client"

import Link from "next/link"
import { use, useMemo, useState } from "react"
import {
  ChevronRightIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import {
  FULL_YEAR_PERIOD_ID,
  averageEventDates,
  averageOverTime,
  consistency,
  gradeRatios,
  passRate,
  resolveCustomAverage,
  standardDeviation,
  subjectImpact,
} from "@avermate/core"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
  ResultBadge,
  DeltaValue,
} from "@/components/data/value"
import {
  AVERAGE_SERIES_COLORS,
  MultiSeriesAverageChart,
  type AverageSeries,
} from "@/components/charts/multi-series-average-chart"
import { GradeResultsChart } from "@/components/charts/grade-results-chart"
import { ImpactGrid } from "@/components/analytics/impact-grid"
import { SortMenu } from "@/components/data/sort-menu"
import {
  filterGrades,
  sortChildren,
  sortGrades,
  type ChildSortKey,
  type GradeSortKey,
} from "@/components/grades/grade-sorting"
import {
  GradeList,
  gradeListItemClassName,
} from "@/components/grades/grade-list"
import { useYear } from "@/components/year/year-provider"
import { usePreferences } from "@/hooks/use-preferences"
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
  const [gradeQuery, setGradeQuery] = useState("")
  const [gradeSort, setGradeSort] = useState<GradeSortKey>("date")
  const [childSort, setChildSort] = useState<ChildSortKey>("custom")

  const subject = graph.byId(subjectId)

  const range = useMemo(() => {
    if (!year || !subject) return null
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
    return to <= from ? null : { from, to }
  }, [period, timelineDate, year, subject, now])

  const averageSeries = useMemo<AverageSeries[]>(() => {
    if (!subject || !range) return []
    const children = preferences.chartSettings.showSubSubjects
      ? graph.childrenOf(subjectId)
      : []
    // Each series samples its own grade days: a note in Chimie moves the
    // Chimie line and only that one, so every line keeps its own event
    // dates — and its own gaps — on the shared linear time axis.
    const seriesFor = (target: string) =>
      averageOverTime(
        graph.subjects,
        averageEventDates(graph.subjects, range.from, range.to, target),
        target,
        null,
        graph.options
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
        id: subject.id,
        label: subject.name,
        color: AVERAGE_SERIES_COLORS[0],
        points: seriesFor(subject.id),
        primary: true,
      },
    ]
  }, [
    range,
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
  const visibleChildren = sortChildren(children, childSort, (id) =>
    graph.ratio(id)
  )
  const ratios = gradeRatios(graph, subjectId)
  const allGrades = [...graph.allGrades(subjectId)].reverse()
  const grades = sortGrades(
    filterGrades(allGrades, gradeQuery, (id) => graph.byId(id)?.name),
    gradeSort
  )
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

        {/*
         * The average and the four figures that qualify it, as one band. The
         * average used to sit alone in a two-column grid and shrink to half of
         * it above `@md`, leaving the other half blank, while the figures were
         * four cramped boxes further down the page — so the number and the
         * things that explain it never appeared together.
         */}
        {/* One grid for both kinds. The single-column variant existed only
            while a category showed nothing but the average; with the four
            figures back it left the `col-span-2` card straddling an implicit
            second column, which is what made the tiles come out in mismatched
            wide/narrow pairs. */}
        <div className="grid grid-cols-2 gap-3 @2xl/main:grid-cols-3 @4xl/main:grid-cols-6">
          <Card className="col-span-2 gap-1 py-4 @2xl/main:col-span-1 @4xl/main:col-span-2">
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
                animateFromZero
              />
              {ratio !== null && general !== null ? (
                <DeltaValue delta={ratio - general} className="text-sm" />
              ) : null}
            </CardContent>
            {/* Where the figure above is not only the marks. Beneath rather than beside
                the number, so the average stays the thing being read and the bonus is
                the footnote it is. */}
            {subject.bonus ? (
              <CardContent className="px-4 pt-0">
                <p className="text-xs text-muted-foreground">
                  {period.id === FULL_YEAR_PERIOD_ID
                    ? t("Includes {points} legacy year-wide adjustment", {
                        points: format.number(subject.bonus, {
                          signDisplay: "always",
                          maximumFractionDigits: 2,
                        }),
                      })
                    : t("Includes {points} adjustment for {period}", {
                        points: format.number(subject.bonus, {
                          signDisplay: "always",
                          maximumFractionDigits: 2,
                        }),
                        period: period.name,
                      })}
                </p>
              </CardContent>
            ) : null}
          </Card>

          {/* Categories get these too. They were gated out, but every figure
              here reads the whole sub-tree — `gradeRatios(graph, subjectId)`
              and `allGrades(subjectId)` both walk descendants — so a category
              has exactly as much to describe as a leaf, and hiding them left
              the busiest subjects with the least detail. */}
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
          title={t("Average over time")}
          series={averageSeries}
          height={340}
          emptyHint={t("Record a few grades and the curve will appear here.")}
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
          grades={graph.allGrades(subjectId)}
          subjects={graph.subjects}
          title={t("Grade results")}
        />

        <ImpactGrid readings={impacts} title={t("Impact on averages")} />

        {children.length > 0 ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <h3 className="text-sm font-medium">{t("Inside this one")}</h3>
              {children.length > 1 ? (
                <SortMenu
                  value={childSort}
                  onValueChange={setChildSort}
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
                  {visibleChildren.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={`/subjects/${child.id}`}
                        className={gradeListItemClassName}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {child.name}
                        </span>
                        <CoefficientBadge coefficient={child.coefficient} />
                        <ResultBadge ratio={graph.ratio(child.id)} />
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
          <div className="flex items-center justify-between gap-2 px-1">
            <h3 className="text-sm font-medium">{t("Grades")}</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              render={<Link href={`/grades/new?subject=${subjectId}`} />}
            >
              <PlusIcon className="size-3.5" />
              {t("Add")}
            </Button>
          </div>
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
                  { value: "coefficient", label: t("Highest coefficient") },
                ]}
              />
            </div>
          ) : null}
          {grades.length === 0 ? (
            <Card className="gap-2 py-4">
              <CardContent className="px-2">
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {gradeQuery.trim()
                    ? t("No grade matches.")
                    : t("No grade recorded here yet.")}
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
