"use client"

import Link from "next/link"
import { useMemo } from "react"
import { areaY, barY, defineChart, lineY } from "@tanstack/charts"
import { d3Curve } from "@tanstack/charts/d3/shape"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { curveMonotoneX } from "d3-shape"
import { FlameIcon, TrendingUpIcon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import {
  evaluateCard,
  type CardMetric,
  type CardResult,
  type CardSpec,
} from "@avermate/core"
import { AverageValue, DeltaValue, ResultBadge } from "@/components/data/value"
import { ResponsiveChart } from "@/components/charts/responsive-chart"
import { useGoalPlans } from "@/hooks/use-goal-plans"
import { useYear } from "@/components/year/year-provider"
import { cn } from "@/lib/utils"

/**
 * Rendering one dashboard card.
 *
 * The metric is data, so the renderer switches on the *shape* of the result
 * rather than on the metric name. Adding a metric to the engine makes it
 * appear here with no new component.
 */

/**
 * Metric names.
 *
 * A hook rather than a function taking `t`: next-intl rewrites `t("…")` calls
 * where it can see the translator being created, so a helper that receives one
 * as an argument would ship its English source strings untranslated.
 */
export function useMetricLabels(): Record<CardMetric, string> {
  const t = useExtracted()

  return {
    average: t("Average"),
    averageTrend: t("Trend"),
    projection: t("Projected average"),
    gradeCount: t("Grades recorded"),
    lastGrade: t("Latest grade"),
    bestGrade: t("Best grade"),
    worstGrade: t("Lowest grade"),
    bestSubject: t("Strongest subject"),
    worstSubject: t("Weakest subject"),
    subjectRanking: t("Subject ranking"),
    passRate: t("Pass rate"),
    median: t("Median"),
    spread: t("Spread"),
    consistency: t("Consistency"),
    improvement: t("Improvement"),
    mostImproved: t("Most improved"),
    steadiest: t("Steadiest"),
    passStreak: t("Passing streak"),
    activityStreak: t("Activity streak"),
    distribution: t("Distribution"),
    goalProgress: t("Goal"),
  }
}

export function useCardResult(spec: CardSpec): CardResult {
  const {
    graph,
    subjects,
    period,
    year,
    passingRatio,
    goals,
    headlineAverage,
    resolve,
    resolveHeadline,
    now,
  } = useYear()
  const { remaining } = useGoalPlans()

  return useMemo(() => {
    const from = period.startAt
    const to = new Date(Math.min(now, new Date(period.endAt).getTime()))

    return evaluateCard(spec, {
      graph,
      subjects,
      scope: null,
      from: from > to ? new Date(year?.startsAt ?? from) : from,
      to,
      passingRatio,
      goals,
      remaining,
      resolveTarget: (target) => {
        const resolved =
          headlineAverage &&
          spec.metric === "average" &&
          target.kind === "general"
            ? resolveHeadline()
            : resolve(target)
        if (!resolved) return null
        return { ...resolved, subjects: resolved.graph.subjects }
      },
    })
  }, [
    spec,
    graph,
    subjects,
    period,
    year,
    passingRatio,
    goals,
    headlineAverage,
    resolve,
    resolveHeadline,
    remaining,
    now,
  ])
}

function Sparkline({
  points,
  positive,
}: {
  points: Array<{ date: Date; ratio: number | null }>
  positive: boolean
}) {
  const t = useExtracted()
  const data = points
    .filter((point) => point.ratio !== null)
    .map((point) => ({ x: point.date.getTime(), y: point.ratio as number }))
  if (data.length < 2) return null

  const xValues = data.map(({ x }) => x)
  const yValues = data.map(({ y }) => y)
  const xMinimum = Math.min(...xValues)
  const xMaximum = Math.max(...xValues)
  const yMinimum = Math.min(...yValues)
  const yMaximum = Math.max(...yValues)
  const yPadding = Math.max((yMaximum - yMinimum) * 0.05, 0.01)
  const color = positive ? "var(--positive)" : "var(--negative)"
  const definition = defineChart({
    marks: [
      areaY(data, {
        id: "card-spark-area",
        x: "x",
        y1: yMinimum - yPadding,
        y2: "y",
        key: "x",
        curve: d3Curve(curveMonotoneX),
        fill: "url(#card-spark-fill)",
      }),
      lineY(data, {
        id: "card-spark-line",
        x: "x",
        y: "y",
        key: "x",
        curve: d3Curve(curveMonotoneX),
        stroke: color,
        strokeWidth: 2,
      }),
    ],
    x: {
      scale: scaleLinear().domain(
        xMinimum === xMaximum
          ? [xMinimum - 1, xMaximum + 1]
          : [xMinimum, xMaximum]
      ),
      grid: false,
      axis: false,
    },
    y: {
      scale: scaleLinear().domain([yMinimum - yPadding, yMaximum + yPadding]),
      grid: false,
      axis: false,
    },
    gradients: [
      {
        id: "card-spark-fill",
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 1,
        stops: [
          { offset: 0, color, opacity: 0.28 },
          { offset: 1, color, opacity: 0 },
        ],
      },
    ],
    margin: { top: 4, right: 0, bottom: 0, left: 0 },
    clip: true,
    focus: false,
    keyboard: false,
    pointer: false,
  })

  return (
    <div aria-hidden="true" className="pointer-events-none -mx-1 h-14">
      <ResponsiveChart
        ariaLabel={t("Trend")}
        definition={definition}
        height={56}
        initialWidth={180}
      />
    </div>
  )
}

function MiniDistribution({
  ariaLabel,
  data,
}: {
  ariaLabel: string
  data: readonly { count: number; label: string }[]
}) {
  const maximum = Math.max(1, ...data.map(({ count }) => count))
  const definition = defineChart({
    marks: [
      barY(data, {
        id: "card-distribution",
        x: "label",
        y: "count",
        key: "label",
        fill: "var(--chart-1)",
        radius: 4,
      }),
    ],
    x: {
      scale: scaleBand<string>()
        .domain(data.map(({ label }) => label))
        .padding(0.12),
      grid: false,
      axis: {
        line: false,
        ticks: { size: 0, padding: 6 },
        tickLabels: { fontSize: 10 },
      },
    },
    y: {
      scale: scaleLinear().domain([0, maximum]),
      grid: false,
      axis: false,
    },
    clip: true,
    focus: false,
    keyboard: false,
    pointer: false,
  })

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none h-24 text-muted-foreground"
    >
      <ResponsiveChart
        ariaLabel={ariaLabel}
        definition={definition}
        height={96}
        initialWidth={220}
      />
    </div>
  )
}

export function CardBody({
  spec,
  result,
}: {
  spec: CardSpec
  result: CardResult
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale } = useYear()

  switch (result.kind) {
    case "empty":
      return (
        <p className="text-sm text-muted-foreground">
          {t("Not enough data yet")}
        </p>
      )

    case "ratio":
      return (
        <div>
          <div className="flex items-baseline gap-2">
            <AverageValue
              ratio={result.ratio}
              showScale
              className="text-3xl font-semibold"
            />
            {result.delta !== null ? (
              <DeltaValue delta={result.delta} className="text-sm" />
            ) : null}
          </div>
          {result.series && spec.display !== "value" ? (
            <Sparkline
              points={result.series}
              positive={(result.delta ?? 0) >= 0}
            />
          ) : null}
        </div>
      )

    case "count":
      return <p className="numeric text-3xl font-semibold">{result.count}</p>

    case "percent":
      return (
        <div className="flex flex-col gap-2">
          <p className="numeric text-3xl font-semibold">
            {format.number(result.ratio ?? 0, {
              style: "percent",
              maximumFractionDigits: 0,
            })}
          </p>
          {spec.display === "gauge" ? (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${Math.round((result.ratio ?? 0) * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      )

    case "scalar":
      return (
        <p className="numeric text-3xl font-semibold">
          {result.value === null
            ? "—"
            : format.number(
                result.value * (result.unit === "ratio" ? scale : 1),
                {
                  maximumFractionDigits: 2,
                  signDisplay: "exceptZero",
                }
              )}
        </p>
      )

    case "subject":
      return (
        <div className="flex flex-col gap-1">
          <Link
            href={`/subjects/${result.subjectId}`}
            className="truncate text-lg font-semibold hover:underline"
          >
            {result.name}
          </Link>
          <div className="flex items-center gap-2">
            <AverageValue
              ratio={result.ratio}
              showScale
              colored
              className="text-sm"
            />
            <DeltaValue delta={result.delta} className="text-xs" />
          </div>
        </div>
      )

    case "grade":
      return (
        <div className="flex flex-col gap-1">
          <Link
            href={`/grades/${result.gradeId}`}
            className="truncate text-lg font-semibold hover:underline"
          >
            {result.name}
          </Link>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ResultBadge ratio={result.ratio} />
            <span className="truncate">{result.subjectName}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {format.dateTime(result.at, { day: "numeric", month: "long" })}
          </p>
        </div>
      )

    case "list":
      return (
        <ul className="flex flex-col gap-1.5">
          {result.items.slice(0, 6).map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <Link
                href={`/subjects/${item.id}`}
                className="flex min-h-9 min-w-0 flex-1 items-center truncate hover:underline"
              >
                {item.label}
              </Link>
              {item.ratio !== null ? (
                <AverageValue
                  ratio={item.ratio}
                  animate={false}
                  decimals={1}
                  colored
                  className="text-sm"
                />
              ) : (
                <DeltaValue delta={item.delta} className="text-sm" />
              )}
            </li>
          ))}
        </ul>
      )

    case "distribution": {
      const data = result.buckets.map((bucket) => ({
        label: `${Math.round(bucket.from * scale)}`,
        count: bucket.count,
      }))
      return <MiniDistribution ariaLabel={t("Distribution")} data={data} />
    }

    case "streak":
      return (
        <div className="flex items-baseline gap-2">
          <FlameIcon
            className={cn(
              "size-5 self-center",
              result.alive ? "text-band-weak" : "text-muted-foreground"
            )}
          />
          <span className="numeric text-3xl font-semibold">
            {result.current}
          </span>
          <span className="text-sm text-muted-foreground">
            {t("best {count}", { count: String(result.longest) })}
          </span>
        </div>
      )

    case "goal": {
      const plan = result.plan
      const progress =
        plan.current === null || plan.target === 0
          ? 0
          : Math.min(1, plan.current / plan.target)
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <AverageValue
              ratio={plan.current}
              className="text-3xl font-semibold"
            />
            <span className="text-sm text-muted-foreground">
              {t("of")}{" "}
              <AverageValue ratio={plan.target} animate={false} showScale />
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                plan.status === "unreachable" ? "bg-negative" : "bg-primary"
              )}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <TrendingUpIcon className="size-3.5" />
            {plan.goal.name}
          </p>
        </div>
      )
    }

    default:
      return null
  }
}
