"use client"

import { segmentedTrendLine, type SeriesPoint } from "@avermate/core"
import { defineChart, dot, lineY, ruleY } from "@tanstack/charts"
import { d3Curve } from "@tanstack/charts/d3/shape"
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { useExtracted, useFormatter } from "next-intl"
import { useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
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
const SERIES_MARK_ID = "average-series"

export const AVERAGE_SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#ea5545",
  "#27aeef",
  "#b33dc6",
] as const

export interface AverageSeries {
  color?: string
  id: string
  label: string
  points: readonly SeriesPoint[]
  primary?: boolean
}

interface Datum {
  color: string
  id: string
  label: string
  seriesId: string
  timestamp: number
  value: number
}

/**
 * Focus resolves one nearest sample per series, so the focused rows can sit on
 * different dates. A single tooltip date is only truthful when every row
 * shares it; otherwise each row must carry its own.
 */
function sharedDayTimestamp(
  points: readonly { datum: { timestamp: number } }[]
): number | null {
  const first = points[0]
  if (!first) return null
  const reference = new Date(first.datum.timestamp)
  return points.every((point) => {
    const date = new Date(point.datum.timestamp)
    return (
      date.getFullYear() === reference.getFullYear() &&
      date.getMonth() === reference.getMonth() &&
      date.getDate() === reference.getDate()
    )
  })
    ? first.datum.timestamp
    : null
}

function safeDomain(values: readonly number[]): NumericDomain {
  if (values.length === 0) return [0, DAY_IN_MS]
  const start = Math.min(...values)
  const end = Math.max(...values)
  return start === end
    ? [start - DAY_IN_MS / 2, end + DAY_IN_MS / 2]
    : [start, end]
}

function yDomain(
  values: readonly number[],
  scale: number,
  autoZoom: boolean
): NumericDomain {
  if (!autoZoom || values.length === 0) return [0, scale]
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const padding = Math.max((maximum - minimum) * 0.12, scale * 0.025)
  const start = Math.max(0, minimum - padding)
  const end = Math.min(scale, maximum + padding)
  if (start !== end) return [start, end]
  return [
    Math.max(0, start - scale * 0.025),
    Math.min(scale, end + scale * 0.025),
  ]
}

/**
 * A native TanStack multi-series view. Focus is resolved independently for
 * every series, so sparse descendants keep their own nearest real sample and
 * marker instead of inheriting the primary series' timestamp.
 */
export function MultiSeriesAverageChart({
  title,
  series,
  emptyHint,
  height = 320,
}: {
  title: string
  series: readonly AverageSeries[]
  emptyHint?: string
  height?: number
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { scale, passingRatio } = useYear()
  const { preferences } = usePreferences()
  const settings = preferences.chartSettings

  const prepared = useMemo(() => {
    const enabled = series.filter((item) => item.points.length > 0)
    const rows = enabled.flatMap((item, seriesIndex) => {
      const color =
        item.color ??
        AVERAGE_SERIES_COLORS[seriesIndex % AVERAGE_SERIES_COLORS.length]
      return item.points.flatMap((point, pointIndex): Datum[] => {
        const timestamp = point.date.getTime()
        if (
          point.ratio === null ||
          !Number.isFinite(point.ratio) ||
          !Number.isFinite(timestamp)
        ) {
          return []
        }
        return [
          {
            color,
            id: `${item.id}:${timestamp}:${pointIndex}`,
            label: item.label,
            seriesId: item.id,
            timestamp,
            value: point.ratio * scale,
          },
        ]
      })
    })

    const primary =
      enabled.find((item) => item.primary) ?? enabled.at(-1) ?? null
    const trend =
      settings.showTrend && primary
        ? segmentedTrendLine(primary.points, settings.trendSubdivisions)
        : []
    const primaryColor =
      primary?.color ??
      AVERAGE_SERIES_COLORS[
        Math.max(
          0,
          enabled.findIndex((item) => item.id === primary?.id)
        ) % AVERAGE_SERIES_COLORS.length
      ]
    const trendRows = trend.flatMap((point, index): Datum[] => {
      const timestamp = point.date.getTime()
      if (point.ratio === null || !Number.isFinite(timestamp)) return []
      return [
        {
          color: primaryColor,
          id: `trend:${timestamp}:${index}`,
          label: t("Trend"),
          seriesId: "__trend__",
          timestamp,
          value: point.ratio * scale,
        },
      ]
    })
    const domain = safeDomain(rows.map((row) => row.timestamp))
    const values = [...rows, ...trendRows].map((row) => row.value)

    return {
      colorDomain: enabled.map((item) => item.id),
      colorRange: enabled.map(
        (item, index) =>
          item.color ??
          AVERAGE_SERIES_COLORS[index % AVERAGE_SERIES_COLORS.length]
      ),
      domain,
      rows,
      trendRows,
      yDomain: yDomain(values, scale, settings.autoZoom),
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
      createIndependentSeriesFocus<Datum>({
        getSeriesId: (datum) => datum.seriesId,
        getTimestamp: (datum) => datum.timestamp,
        isEnabled: (point) => point.markId === SERIES_MARK_ID,
      }),
    []
  )

  const buildDefinition = useCallback(
    (viewport: NumericDomain) => {
      // The vertical frame follows the visible window, so zooming into a
      // quiet stretch reveals its detail instead of keeping the whole
      // year's extent. Falls back to the full-series domain when the
      // window holds no sample.
      const visible = viewportValues(
        [...prepared.rows, ...prepared.trendRows],
        viewport
      )
      const frame =
        visible.length > 0
          ? yDomain(visible, scale, settings.autoZoom)
          : prepared.yDomain

      const threshold: readonly Datum[] = [
        {
          color: "var(--muted-foreground)",
          id: "passing-threshold",
          label: "",
          seriesId: "__threshold__",
          timestamp: prepared.domain[0],
          value: passingRatio * scale,
        },
      ]

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
            id: SERIES_MARK_ID,
            x: "timestamp",
            y: "value",
            z: "seriesId",
            color: "seriesId",
            key: "id",
            curve: d3Curve(lineStyleCurve(settings.lineStyle)),
            strokeWidth: 2.25,
          }),
          ...(settings.showTrend
            ? [
                lineY(prepared.trendRows, {
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
          ...(settings.showPoints && prepared.rows.length <= 160
            ? [
                dot(prepared.rows, {
                  id: "average-points",
                  x: "timestamp",
                  y: "value",
                  z: "seriesId",
                  color: "seriesId",
                  key: "id",
                  r: 2.5,
                  stroke: "var(--background)",
                  strokeWidth: 1,
                }),
              ]
            : []),
          dot(prepared.rows, {
            id: "average-active-points",
            x: "timestamp",
            y: "value",
            z: "seriesId",
            color: "seriesId",
            key: "id",
            r: 0,
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
        color: {
          domain: prepared.colorDomain,
          range: prepared.colorRange,
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
          // Screen readers get this structured mirror of the custom body.
          content: (points) => {
            const sharedDay = sharedDayTimestamp(points)
            return {
              title:
                sharedDay !== null
                  ? format.dateTime(new Date(sharedDay), {
                      day: "numeric",
                      month: "long",
                    })
                  : undefined,
              rows: points.map((point) => ({
                color: point.datum.color,
                label: point.datum.label,
                value:
                  sharedDay !== null
                    ? format.number(point.datum.value, {
                        maximumFractionDigits: 2,
                      })
                    : `${format.number(point.datum.value, {
                        maximumFractionDigits: 2,
                      })} · ${format.dateTime(new Date(point.datum.timestamp), {
                        day: "numeric",
                        month: "short",
                      })}`,
              })),
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
      settings.autoZoom,
      settings.lineStyle,
      settings.showPoints,
      settings.showTrend,
    ]
  )

  // The tooltip element already carries the structured content as its
  // accessible label, so the visual body stays aria-hidden. Values keep the
  // strongest weight, series names stay primary, and dates read as quiet
  // metadata — one shared line when every row sits on the same day, otherwise
  // one line under each row so no row is ever labeled with a wrong date.
  const renderTooltipBody = useCallback(
    ({ points }: ChartTooltipBodyRenderContext<Datum, number, number>) => {
      const sharedDay = sharedDayTimestamp(points)
      return (
        <div aria-hidden="true" className="flex flex-col gap-y-1.5">
          {sharedDay !== null ? (
            <span className="text-[0.6875rem] leading-none opacity-65">
              {format.dateTime(new Date(sharedDay), {
                day: "numeric",
                month: "long",
              })}
            </span>
          ) : null}
          {points.map((point) => (
            <div
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1.5"
              key={point.datum.id}
            >
              <span
                className="size-2 rounded-[0.15rem]"
                style={{
                  background: point.datum.color,
                  boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.12)",
                }}
              />
              <span className="pr-1.5 font-normal">{point.datum.label}</span>
              <span className="text-right font-semibold whitespace-nowrap tabular-nums">
                {format.number(point.datum.value, {
                  maximumFractionDigits: 2,
                })}
              </span>
              {sharedDay === null ? (
                <span className="col-span-2 col-start-2 mt-0.5 text-[0.6875rem] leading-none opacity-65">
                  {format.dateTime(new Date(point.datum.timestamp), {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )
    },
    [format]
  )

  const presets = useViewportPresets(prepared.domain)

  if (prepared.rows.length < 2) {
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
        <ZoomPresetGroup control={presets} domain={prepared.domain} />
      </div>
      <Card className="gap-3 py-4">
        <CardHeader className="gap-3 px-4">
          <ul
            className="flex flex-wrap gap-x-3 gap-y-1"
            aria-label={t("Series")}
          >
            {series.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{
                    background:
                      item.color ??
                      AVERAGE_SERIES_COLORS[
                        index % AVERAGE_SERIES_COLORS.length
                      ],
                  }}
                />
                {item.label}
              </li>
            ))}
          </ul>
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
            interactionHint={interactionHint}
            maximumZoom={Math.max(1, Math.min(64, periodDays / 2))}
            onViewportChange={presets.onViewportChange}
            renderTooltipBody={renderTooltipBody}
            resetLabel={t("Reset chart view")}
            viewportRequest={presets.request}
          />
        </CardContent>
      </Card>
    </section>
  )
}
