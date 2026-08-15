"use client"

import { segmentedTrendLine, type SeriesPoint } from "@avermate/core"
import { areaY, defineChart, dot, lineY, ruleY } from "@tanstack/charts"
import { d3Curve } from "@tanstack/charts/d3/shape"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { useExtracted, useFormatter } from "next-intl"
import { useCallback, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { useYear } from "@/components/year/year-provider"
import { usePreferences } from "@/hooks/use-preferences"
import { useViewportPresets, ZoomPresetGroup } from "./chart-zoom-presets"
import { InteractiveTimeSeriesChart } from "./interactive-time-series-chart"
import { lineStyleCurve } from "./line-style"
import {
  createIndependentSeriesFocus,
  viewportValues,
  type NumericDomain,
} from "./time-series-interaction"

const DAY_IN_MS = 86_400_000
const AVERAGE_LINE_MARK_ID = "average-series"

interface AveragePoint {
  id: string
  label: string
  seriesId: "average"
  timestamp: number
  trend: number | null
  value: number
}

function safeDomain(values: readonly number[]): NumericDomain {
  if (values.length === 0) return [0, DAY_IN_MS]
  const start = Math.min(...values)
  const end = Math.max(...values)
  return start === end
    ? [start - DAY_IN_MS / 2, end + DAY_IN_MS / 2]
    : [start, end]
}

function frameDomain(
  values: readonly number[],
  scale: number,
  autoZoom: boolean
): NumericDomain {
  if (!autoZoom || values.length === 0) return [0, scale]
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const padding = Math.max((maximum - minimum) * 0.2, scale * 0.02)
  return [
    Math.max(0, Number((minimum - padding).toFixed(2))),
    Math.min(scale, Number((maximum + padding).toFixed(2))),
  ]
}

/** The average over time, with a semantic time viewport and native marks. */
export function AverageChart({
  title,
  series,
  emptyHint,
  height = 220,
  zoomPresets = false,
}: {
  title: string
  series: SeriesPoint[]
  emptyHint?: string
  height?: number
  /**
   * Named zoom windows in the header. Analytical pages opt in; the
   * dashboard keeps its glanceable chart free of controls.
   */
  zoomPresets?: boolean
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale, passingRatio } = useYear()
  const { preferences } = usePreferences()
  const settings = preferences.chartSettings

  const prepared = useMemo(() => {
    const trend = settings.showTrend
      ? segmentedTrendLine(series, settings.trendSubdivisions)
      : []
    const rows = series.flatMap((point, index) => {
      const timestamp = point.date.getTime()
      if (!Number.isFinite(timestamp)) return []
      const value =
        point.ratio !== null && Number.isFinite(point.ratio)
          ? point.ratio * scale
          : null
      const trendRatio = trend[index]?.ratio
      const trendValue =
        typeof trendRatio === "number" && Number.isFinite(trendRatio)
          ? trendRatio * scale
          : null
      return [{ timestamp, value, trend: trendValue }]
    })
    const averagePoints = rows.flatMap((row): AveragePoint[] =>
      row.value === null
        ? []
        : [
            {
              id: `average:${row.timestamp}`,
              label: t("Average"),
              seriesId: "average",
              timestamp: row.timestamp,
              trend: row.trend,
              value: row.value,
            },
          ]
    )
    const trendPoints = rows.flatMap((row): AveragePoint[] =>
      row.trend === null
        ? []
        : [
            {
              id: `trend:${row.timestamp}`,
              label: t("Trend"),
              seriesId: "average",
              timestamp: row.timestamp,
              trend: null,
              value: row.trend,
            },
          ]
    )
    const yDomain = frameDomain(
      averagePoints.map(({ value }) => value),
      scale,
      settings.autoZoom
    )

    return {
      averagePoints,
      domain: safeDomain(rows.map(({ timestamp }) => timestamp)),
      trendPoints,
      yDomain,
    }
  }, [
    scale,
    series,
    settings.autoZoom,
    settings.showTrend,
    settings.trendSubdivisions,
    t,
  ])

  const focus = useMemo(
    () =>
      createIndependentSeriesFocus<AveragePoint>({
        getSeriesId: (datum) => datum.seriesId,
        getTimestamp: (datum) => datum.timestamp,
        isEnabled: (point) => point.markId === AVERAGE_LINE_MARK_ID,
      }),
    []
  )
  const buildDefinition = useCallback(
    (viewport: NumericDomain) => {
      // The vertical frame follows the visible window so zooming in
      // magnifies the visible stretch instead of keeping the year's extent.
      const visible = viewportValues(
        [...prepared.averagePoints, ...prepared.trendPoints],
        viewport
      )
      const frame =
        visible.length > 0
          ? frameDomain(visible, scale, settings.autoZoom)
          : prepared.yDomain

      const thresholdPoints: readonly AveragePoint[] = [
        {
          id: "passing-threshold",
          label: "",
          seriesId: "average",
          timestamp: prepared.domain[0],
          trend: null,
          value: passingRatio * scale,
        },
      ]

      return defineChart({
        marks: [
          areaY(prepared.averagePoints, {
            id: "average-area",
            x: "timestamp",
            y1: frame[0],
            y2: "value",
            key: "id",
            curve: d3Curve(lineStyleCurve(settings.lineStyle)),
            fill: "url(#average-fill)",
          }),
          ruleY(thresholdPoints, {
            id: "passing-threshold",
            y: "value",
            stroke: "var(--muted-foreground)",
            strokeDasharray: "4 4",
            strokeOpacity: 0.5,
          }),
          lineY(prepared.averagePoints, {
            id: AVERAGE_LINE_MARK_ID,
            x: "timestamp",
            y: "value",
            z: "seriesId",
            key: "id",
            curve: d3Curve(lineStyleCurve(settings.lineStyle)),
            stroke: "var(--chart-1)",
            strokeWidth: 2,
          }),
          ...(settings.showTrend
            ? [
                lineY(prepared.trendPoints, {
                  id: "average-trend",
                  x: "timestamp",
                  y: "value",
                  key: "id",
                  stroke: "var(--muted-foreground)",
                  strokeDasharray: "5 4",
                  strokeWidth: 1.5,
                }),
              ]
            : []),
          ...(settings.showPoints && series.length < 40
            ? [
                dot(prepared.averagePoints, {
                  id: "average-points",
                  x: "timestamp",
                  y: "value",
                  key: "id",
                  r: 3,
                  fill: "var(--chart-1)",
                  stroke: "var(--background)",
                  strokeWidth: 1.5,
                }),
              ]
            : []),
          dot(prepared.averagePoints, {
            id: "average-active-points",
            x: "timestamp",
            y: "value",
            z: "seriesId",
            key: "id",
            r: 0,
            fill: "var(--chart-1)",
            fillOpacity: 0,
            stroke: "var(--background)",
            strokeWidth: 2,
            states: [
              {
                // "group", not "key": the independent-series focus returns
                // one nearest point per series, and every one of them gets
                // its dot — "key" lit only the single closest series.
                when: { focus: "group" },
                style: { r: 5, fillOpacity: 1 },
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
          scale: scaleLinear().domain(frame),
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
        gradients: [
          {
            id: "average-fill",
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 1,
            stops: [
              { offset: 0, color: "var(--chart-1)", opacity: 0.25 },
              { offset: 1, color: "var(--chart-1)", opacity: 0 },
            ],
          },
        ],
        clip: true,
        focus,
        maxFocusDistance: Number.POSITIVE_INFINITY,
        pointer: false,
        tooltip: {
          use: tooltip,
          anchor: "pointer",
          placement: ["top", "right", "left", "bottom"],
          content: (points) => {
            const point = points[0]?.datum
            return {
              title: point
                ? format.dateTime(new Date(point.timestamp), {
                    day: "numeric",
                    month: "long",
                  })
                : undefined,
              rows: point
                ? [
                    {
                      color: "var(--chart-1)",
                      label: point.label,
                      value: format.number(point.value, {
                        maximumFractionDigits: 2,
                      }),
                    },
                    ...(settings.showTrend && point.trend !== null
                      ? [
                          {
                            color: "var(--muted-foreground)",
                            label: t("Trend"),
                            value: format.number(point.trend, {
                              maximumFractionDigits: 2,
                            }),
                          },
                        ]
                      : []),
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
      series.length,
      settings.autoZoom,
      settings.lineStyle,
      settings.showPoints,
      settings.showTrend,
      t,
    ]
  )

  const presets = useViewportPresets(prepared.domain)

  if (series.length < 2) {
    return (
      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-sm font-medium">{title}</h3>
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-muted-foreground">
              {emptyHint ?? t("Not enough data yet")}
            </p>
          </CardContent>
        </Card>
      </section>
    )
  }

  const periodDays = Math.max(
    1,
    (prepared.domain[1] - prepared.domain[0]) / DAY_IN_MS
  )
  const interactionHint = t(
    "Use a wheel, trackpad, drag, or pinch to zoom and pan. Use plus, minus, or Alt with the arrow keys from the keyboard; press 0 to reset."
  )

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="text-sm font-medium">{title}</h3>
        {zoomPresets ? (
          <ZoomPresetGroup control={presets} domain={prepared.domain} />
        ) : null}
      </div>
      <Card className="gap-3 py-4">
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
            interactionHint={interactionHint}
            maximumZoom={Math.max(1, Math.min(64, periodDays / 2))}
            onViewportChange={
              zoomPresets ? presets.onViewportChange : undefined
            }
            resetLabel={t("Reset chart view")}
            viewportRequest={zoomPresets ? presets.request : null}
          />
        </CardContent>
      </Card>
    </section>
  )
}
