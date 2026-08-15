"use client"

import Link from "next/link"
import { use, useMemo } from "react"
import { ChevronRightIcon, PencilIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import {
  averageEventDates,
  averageOverTime,
  consistency,
  gradeRatio,
  gradeRatios,
  median,
  passRate,
  resolveCustomAverage,
  subjectImpact,
  type ResolvedCustomAverage,
} from "@avermate/core"
import { ImpactGrid } from "@/components/analytics/impact-grid"
import { AverageChart } from "@/components/charts/average-chart"
import {
  AverageValue,
  CoefficientBadge,
  ResultBadge,
} from "@/components/data/value"
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
  const custom = customAverages.find((average) => average.id === averageId)
  const isGeneral = averageId === "general"

  const resolved = useMemo<ResolvedCustomAverage | null>(() => {
    if (isGeneral) return { graph, scope: {} }
    return custom ? resolveCustomAverage(graph, custom) : null
  }, [custom, graph, isGeneral])

  const series = useMemo(() => {
    if (!resolved || !year) return []
    const from = new Date(
      Math.max(period.startAt.getTime(), year.startsAt.getTime())
    )
    const timelineEnd = timelineDate
      ? new Date(`${timelineDate}T23:59:59`).getTime()
      : now
    const to = new Date(
      Math.min(timelineEnd, period.endAt.getTime(), year.endsAt.getTime())
    )
    if (to <= from) return []
    return averageOverTime(
      resolved.graph.subjects,
      averageEventDates(resolved.graph.subjects, from, to),
      null,
      resolved.scope
    )
  }, [now, period, resolved, timelineDate, year])

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

  const title = isGeneral ? t("General average") : (custom?.name ?? "")
  const ratio = resolved.graph.ratio(null, resolved.scope)
  const ratios = gradeRatios(resolved.graph)
  const grades = [...resolved.graph.allGrades()].reverse()
  const contributors = resolved.graph.contributorsOf(null)
  const composition = custom
    ? custom.entries.flatMap((entry) => {
        const subject = graph.byId(entry.subjectId)
        if (!subject || !resolved.graph.has(subject.id)) return []
        return [
          {
            coefficient: entry.coefficient ?? subject.coefficient,
            ratio: resolved.graph.ratio(subject.id, resolved.scope),
            subject,
          },
        ]
      })
    : contributors.map((subject) => ({
        coefficient: subject.coefficient,
        ratio: graph.ratio(subject.id),
        subject,
      }))
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
    { label: t("Grades"), value: String(grades.length) },
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

        <Card className="gap-1 py-4">
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
              className="text-4xl font-semibold"
            />
          </CardContent>
        </Card>

        <AverageChart
          title={t("Over time")}
          series={series}
          emptyHint={t("Record a few grades and the curve will appear here.")}
          height={320}
          zoomPresets
        />

        {composition.length > 0 ? (
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">
                {t("Subjects")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <ul>
                {composition.map(({ coefficient, ratio, subject }) => (
                  <li key={subject.id}>
                    <Link
                      href={`/subjects/${subject.id}`}
                      className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent active:bg-accent"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {subject.name}
                      </span>
                      <CoefficientBadge coefficient={coefficient} />
                      <AverageValue
                        ratio={ratio}
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

        <ImpactGrid readings={impacts} title={t("Impact by subject")} />

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm font-medium">{t("Grades")}</CardTitle>
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
                        <p className="truncate text-xs text-muted-foreground">
                          {resolved.graph.byId(grade.subjectId)?.name}
                          {" · "}
                          {format.dateTime(grade.passedAt, {
                            day: "numeric",
                            month: "short",
                          })}
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
