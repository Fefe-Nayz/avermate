"use client"

import {
  gradeRatio,
  segmentedTrendLine,
  type Grade,
  type SeriesPoint,
  type Subject,
} from "@avermate/core"
import { defineChart, dot, lineY, ruleY } from "@tanstack/charts"
import { d3Curve } from "@tanstack/charts/d3/shape"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { curveMonotoneX } from "d3-shape"
import { useExtracted, useFormatter } from "next-intl"
import { useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useYear } from "@/components/year/year-provider"
import { usePreferences } from "@/hooks/use-preferences"
import { InteractiveTimeSeriesChart } from "./interactive-time-series-chart"
import {
  createIndependentSeriesFocus,
  type NumericDomain,
} from "./time-series-interaction"

const DAY_IN_MS = 86_400_000
const GRADE_MARK_ID = "grade-result-series"

interface GradeDatum {
  coefficient: number
  gradeId: string
  gradeName: string
  id: string
  outOf: number
  seriesId: string
  subjectName: string
  timestamp: number
  value: number
  valueOnOriginalScale: number
}

function domainOf(values: readonly number[]): NumericDomain {
  if (values.length === 0) return [0, DAY_IN_MS]
  const first = Math.min(...values)
  const last = Math.max(...values)
  return first === last
    ? [first - DAY_IN_MS / 2, last + DAY_IN_MS / 2]
    : [first, last]
}

/** Actual assessments as their own series, separate from the running average. */
export function GradeResultsChart({
  grades,
  subjects,
  title,
  height = 280,
}: {
  grades: readonly Grade[]
  subjects: readonly Subject[]
  title: string
  height?: number
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { passingRatio, scale } = useYear()
  const { preferences } = usePreferences()
  const settings = preferences.chartSettings

  const prepared = useMemo(() => {
    const subjectNames = new Map(
      subjects.map((subject) => [subject.id, subject.name])
    )
    const ordered = [...grades].sort(
      (left, right) => left.passedAt.getTime() - right.passedAt.getTime()
    )
    const rows = ordered.flatMap((grade, index): GradeDatum[] => {
      const ratio = gradeRatio(grade)
      const timestamp = grade.passedAt.getTime()
      if (ratio === null || !Number.isFinite(timestamp)) return []
      return [
        {
          coefficient: grade.coefficient,
          gradeId: grade.id,
          gradeName: grade.name,
          id: `${grade.id}:${index}`,
          outOf: grade.outOf,
          seriesId: "grades",
          subjectName: subjectNames.get(grade.subjectId) ?? "",
          timestamp,
          value: ratio * scale,
          valueOnOriginalScale: grade.value,
        },
      ]
    })

    const trendSource: SeriesPoint[] = rows.map((row) => ({
      date: new Date(row.timestamp),
      ratio: row.value / scale,
    }))
    const trendRows: GradeDatum[] = settings.showTrend
      ? segmentedTrendLine(trendSource, settings.trendSubdivisions).flatMap(
          (point, index) =>
            point.ratio === null
              ? []
              : [
                  {
                    coefficient: 0,
                    gradeId: "__trend__",
                    gradeName: t("Trend"),
                    id: `trend:${point.date.getTime()}:${index}`,
                    outOf: scale,
                    seriesId: "__trend__",
                    subjectName: t("Trend"),
                    timestamp: point.date.getTime(),
                    value: point.ratio * scale,
                    valueOnOriginalScale: point.ratio * scale,
                  },
                ]
        )
      : []
    const values = [
      ...rows.map((row) => row.value),
      ...trendRows.map((row) => row.value),
    ]
    const yDomain: NumericDomain = (() => {
      if (!settings.autoZoom || values.length === 0) return [0, scale]
      const minimum = Math.min(...values)
      const maximum = Math.max(...values)
      const padding = Math.max((maximum - minimum) * 0.12, scale * 0.025)
      return [
        Math.max(0, minimum - padding),
        Math.min(scale, maximum + padding),
      ]
    })()

    return {
      domain: domainOf(rows.map((row) => row.timestamp)),
      rows,
      trendRows,
      yDomain,
    }
  }, [
    grades,
    scale,
    settings.autoZoom,
    settings.showTrend,
    settings.trendSubdivisions,
    subjects,
    t,
  ])

  const focus = useMemo(
    () =>
      createIndependentSeriesFocus<GradeDatum>({
        getSeriesId: (datum) => datum.seriesId,
        getTimestamp: (datum) => datum.timestamp,
        isEnabled: (point) => point.markId === GRADE_MARK_ID,
      }),
    []
  )

  const buildDefinition = useCallback(
    (viewport: NumericDomain) => {
      const threshold: readonly GradeDatum[] = prepared.rows.length
        ? [
            {
              ...(prepared.rows[0] as GradeDatum),
              id: "passing-threshold",
              timestamp: prepared.domain[0],
              value: passingRatio * scale,
            },
          ]
        : []

      return defineChart({
        marks: [
          ruleY(threshold, {
            id: "passing-threshold",
            y: "value",
            stroke: "var(--muted-foreground)",
            strokeDasharray: "4 4",
            strokeOpacity: 0.45,
          }),
          lineY(prepared.rows, {
            id: GRADE_MARK_ID,
            x: "timestamp",
            y: "value",
            z: "seriesId",
            key: "id",
            curve: d3Curve(curveMonotoneX),
            stroke: "var(--chart-1)",
            strokeWidth: 2,
          }),
          ...(settings.showTrend
            ? [
                lineY(prepared.trendRows, {
                  id: "grade-trend",
                  x: "timestamp",
                  y: "value",
                  key: "id",
                  stroke: "var(--muted-foreground)",
                  strokeDasharray: "5 4",
                  strokeWidth: 1.5,
                }),
              ]
            : []),
          dot(prepared.rows, {
            id: "grade-points",
            x: "timestamp",
            y: "value",
            z: "seriesId",
            key: "id",
            r: settings.showPoints ? 4 : 0,
            fill: "var(--chart-1)",
            stroke: "var(--background)",
            strokeWidth: settings.showPoints ? 1.5 : 0,
            states: [
              {
                when: { focus: "key" },
                style: { r: 6, strokeWidth: 2 },
                transition: {
                  type: "tween",
                  duration: 90,
                  easing: "ease-out",
                  respectReducedMotion: true,
                },
              },
            ],
          }),
        ],
        x: {
          scale: scaleLinear().domain(prepared.domain),
          viewport: { domain: viewport },
          grid: false,
          axis: {
            line: false,
            ticks: {
              padding: 8,
              format: (value) =>
                format.dateTime(new Date(value), {
                  day: "numeric",
                  month: "short",
                }),
            },
            tickLabels: { thin: { minGap: 40, priority: "ends" } },
          },
        },
        y: {
          scale: scaleLinear().domain(prepared.yDomain),
          grid: true,
          axis: {
            line: false,
            ticks: {
              count: 5,
              padding: 8,
              format: (value) =>
                format.number(value, { maximumFractionDigits: 1 }),
            },
          },
        },
        clip: true,
        focus,
        focusRing: false,
        maxFocusDistance: Number.POSITIVE_INFINITY,
        pointer: false,
        tooltip: {
          use: tooltip,
          anchor: "pointer",
          placement: ["top", "right", "left", "bottom"],
          content: (points) => {
            const grade = points[0]?.datum
            return {
              title: grade
                ? `${format.dateTime(new Date(grade.timestamp), {
                    day: "numeric",
                    month: "long",
                  })} · ${grade.gradeName}`
                : undefined,
              rows: grade
                ? [
                    {
                      color: "var(--chart-1)",
                      label: grade.subjectName,
                      value: `${format.number(grade.valueOnOriginalScale, {
                        maximumFractionDigits: 2,
                      })} / ${format.number(grade.outOf, {
                        maximumFractionDigits: 2,
                      })}`,
                    },
                  ]
                : [],
            }
          },
        },
      })
    },
    [
      focus,
      format,
      passingRatio,
      prepared,
      scale,
      settings.showPoints,
      settings.showTrend,
    ]
  )

  if (prepared.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("No grade recorded here yet.")}
          </p>
        </CardContent>
      </Card>
    )
  }

  const periodDays = Math.max(
    1,
    (prepared.domain[1] - prepared.domain[0]) / DAY_IN_MS
  )

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-2 text-muted-foreground">
        <InteractiveTimeSeriesChart
          ariaLabel={title}
          buildDefinition={buildDefinition}
          domain={prepared.domain}
          formatDomain={(domain) =>
            t("Visible from {start} to {end}", {
              start: format.dateTime(new Date(domain[0]), {
                day: "numeric",
                month: "short",
              }),
              end: format.dateTime(new Date(domain[1]), {
                day: "numeric",
                month: "short",
              }),
            })
          }
          height={height}
          interactionHint={t(
            "Use a wheel, trackpad, drag, or pinch to zoom and pan. Use plus, minus, or Alt with the arrow keys from the keyboard; press 0 to reset."
          )}
          maximumZoom={Math.max(1, Math.min(64, periodDays / 2))}
          resetLabel={t("Reset chart view")}
        />
      </CardContent>
    </Card>
  )
}
