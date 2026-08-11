"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useFormatter, useExtracted } from "next-intl"
import {
  activityStreaks,
  averageOverTime,
  consistency,
  dayRange,
  distribution,
  gradeRatios,
  median,
  passRate,
  passStreaks,
  projectedRatio,
  rankByConsistency,
  rankByImprovement,
  rankSubjects,
  standardDeviation,
  trend,
} from "@avermate/core"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageMeta } from "@/components/shell/page-chrome"
import { PeriodRail, PeriodSwitcher } from "@/components/shell/period-switcher"
import { AverageValue, DeltaValue } from "@/components/data/value"
import { AverageChart } from "@/components/charts/average-chart"
import { DistributionHistogram } from "@/components/charts/distribution-histogram"
import { useYear } from "@/components/year/year-provider"

/**
 * The statistics screen.
 *
 * Everything here is derived, not stored, so it costs nothing to offer and it
 * can never disagree with the dashboard. The framing is comparative — a spread
 * or a pass rate only means something next to the subjects it came from.
 */
export default function InsightsPage() {
  const t = useExtracted()
  const format = useFormatter()
  const { graph, subjects, period, year, passingRatio, scale, now } = useYear()

  const series = useMemo(() => {
    if (!year) return []
    const from = new Date(
      Math.max(
        new Date(period.startAt).getTime(),
        new Date(year.startsAt).getTime()
      )
    )
    const to = new Date(Math.min(now, new Date(period.endAt).getTime()))
    if (to <= from) return []
    const span = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)
    return averageOverTime(
      subjects,
      dayRange(from, to, Math.max(1, Math.ceil(span / 60))),
      null
    )
  }, [subjects, period, year, now])

  const ratios = gradeRatios(graph)
  const ranked = rankSubjects(graph)
  const improved = rankByImprovement(graph)
  const steady = rankByConsistency(graph)
  const buckets = distribution(ratios, 5)
  const streaks = passStreaks(graph.allGrades(), passingRatio)
  const activity = activityStreaks(graph.allGrades())
  const slope = trend(series)
  const projected = projectedRatio(series, 10)
  const general = graph.ratio(null)

  const headline = [
    {
      label: t("Median"),
      value: median(ratios),
      kind: "ratio" as const,
    },
    {
      label: t("Pass rate"),
      value: passRate(ratios, passingRatio),
      kind: "percent" as const,
    },
    {
      label: t("Consistency"),
      value: consistency(ratios),
      kind: "percent" as const,
    },
    {
      label: t("Spread"),
      value: standardDeviation(ratios),
      kind: "points" as const,
    },
  ]

  const bucketData = buckets.map((bucket) => ({
    label: `${Math.round(bucket.from * scale)}–${Math.round(bucket.to * scale)}`,
    count: bucket.count,
    good: bucket.from >= passingRatio,
  }))

  if (ratios.length === 0) {
    return (
      <>
        <PageMeta title={t("Insights")} />
        <p className="py-16 text-center text-sm text-muted-foreground">
          {t("Record a few grades and this screen fills in.")}
        </p>
      </>
    )
  }

  return (
    <>
      <PageMeta title={t("Insights")} />

      <div className="flex flex-col gap-4">
        <div className="hidden items-center justify-between md:flex">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Insights")}
          </h1>
          <PeriodSwitcher />
        </div>
        <div className="-mx-4 md:hidden">
          <PeriodRail />
        </div>

        <div className="grid grid-cols-2 gap-3 @md/main:grid-cols-4">
          {headline.map((item) => (
            <Card key={item.label} className="gap-1 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {item.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="numeric text-2xl font-semibold">
                  {item.value === null
                    ? "—"
                    : item.kind === "percent"
                      ? format.number(item.value, {
                          style: "percent",
                          maximumFractionDigits: 0,
                        })
                      : format.number(item.value * scale, {
                          maximumFractionDigits: 2,
                        })}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {series.length > 1 ? (
          <AverageChart
            title={t("Average over time")}
            series={series}
            height={240}
          />
        ) : null}

        <div className="grid gap-3 @lg/main:grid-cols-2">
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">
                {t("Where your results land")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <DistributionHistogram
                ariaLabel={t("Where your results land")}
                data={bucketData}
              />
            </CardContent>
          </Card>

          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">
                {t("Where the year is heading")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 px-4">
              <div className="flex items-baseline gap-2">
                <AverageValue
                  ratio={projected}
                  showScale
                  colored
                  className="text-2xl font-semibold"
                />
                {projected !== null && general !== null ? (
                  <DeltaValue delta={projected - general} className="text-sm" />
                ) : null}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {slope === null
                  ? t("Not enough history to read a direction yet.")
                  : slope > 0.0005
                    ? t(
                        "Your running average has been climbing. Holding this pace lands you here."
                      )
                    : slope < -0.0005
                      ? t(
                          "Your running average has been slipping. This is where the current pace leads."
                        )
                      : t("Your average has been flat. No drift either way.")}
              </p>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <p className="numeric text-lg font-semibold">
                    {streaks.longest.length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("longest passing streak")}
                  </p>
                </div>
                <div>
                  <p className="numeric text-lg font-semibold">
                    {activity.longest.length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("busiest run of days")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-3 @lg/main:grid-cols-2">
          <RankCard
            title={t("Strongest subjects")}
            rows={ranked.slice(0, 5).map((entry) => ({
              id: entry.subject.id,
              label: entry.subject.name,
              ratio: entry.ratio,
            }))}
          />
          <RankCard
            title={t("Needs the most attention")}
            rows={ranked
              .slice(-5)
              .reverse()
              .map((entry) => ({
                id: entry.subject.id,
                label: entry.subject.name,
                ratio: entry.ratio,
              }))}
          />
          <RankCard
            title={t("Most improved")}
            rows={improved.slice(0, 5).map((entry) => ({
              id: entry.subject.id,
              label: entry.subject.name,
              delta: entry.delta,
            }))}
          />
          <RankCard
            title={t("Steadiest")}
            rows={steady.slice(0, 5).map((entry) => ({
              id: entry.subject.id,
              label: entry.subject.name,
              percent: entry.consistency,
            }))}
          />
        </div>
      </div>
    </>
  )
}

function RankCard({
  title,
  rows,
}: {
  title: string
  rows: Array<{
    id: string
    label: string
    ratio?: number
    delta?: number
    percent?: number
  }>
}) {
  const format = useFormatter()
  if (rows.length === 0) return null

  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-2">
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/subjects/${row.id}`}
                className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {row.ratio !== undefined ? (
                  <AverageValue
                    ratio={row.ratio}
                    animate={false}
                    colored
                    className="font-medium"
                  />
                ) : null}
                {row.delta !== undefined ? (
                  <DeltaValue delta={row.delta} className="font-medium" />
                ) : null}
                {row.percent !== undefined ? (
                  <span className="numeric font-medium">
                    {format.number(row.percent, {
                      style: "percent",
                      maximumFractionDigits: 0,
                    })}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
