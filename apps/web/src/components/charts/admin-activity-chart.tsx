"use client"

import { areaY, defineChart, dot, lineY } from "@tanstack/charts"
import { d3Curve } from "@tanstack/charts/d3/shape"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { curveMonotoneX } from "d3-shape"
import { useExtracted, useFormatter } from "next-intl"
import { useCallback, useMemo } from "react"
import { InteractiveTimeSeriesChart } from "./interactive-time-series-chart"
import {
  createIndependentSeriesFocus,
  type NumericDomain,
} from "./time-series-interaction"

const DAY_IN_MS = 86_400_000
const ADMIN_ACTIVITY_LINE_MARK_ID = "admin-activity-line"

export interface AdminActivityDatum {
  count: number
  day: string
}

interface AdminActivityPoint {
  count: number
  day: string
  id: string
  seriesId: "grades"
  timestamp: number
}

function safeDomain(values: readonly number[]): NumericDomain {
  if (values.length === 0) return [0, DAY_IN_MS]
  const start = Math.min(...values)
  const end = Math.max(...values)
  return start === end
    ? [start - DAY_IN_MS / 2, end + DAY_IN_MS / 2]
    : [start, end]
}

function parseDay(day: string) {
  const timestamp = Date.parse(`${day}T00:00:00.000Z`)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function AdminActivityChart({
  ariaLabel,
  countLabel,
  data,
  formatCount,
}: {
  ariaLabel: string
  countLabel: string
  data: readonly AdminActivityDatum[]
  formatCount: (count: number) => string
}) {
  const t = useExtracted()
  const format = useFormatter()
  const prepared = useMemo(() => {
    const points = data
      .flatMap((datum): AdminActivityPoint[] => {
        const timestamp = parseDay(datum.day)
        return timestamp === null
          ? []
          : [
              {
                ...datum,
                id: `grades:${datum.day}`,
                seriesId: "grades",
                timestamp,
              },
            ]
      })
      .toSorted((left, right) => left.timestamp - right.timestamp)

    return {
      domain: safeDomain(points.map(({ timestamp }) => timestamp)),
      maximum: Math.max(1, ...points.map(({ count }) => count)),
      points,
    }
  }, [data])
  const focus = useMemo(
    () =>
      createIndependentSeriesFocus<AdminActivityPoint>({
        getSeriesId: (datum) => datum.seriesId,
        getTimestamp: (datum) => datum.timestamp,
        isEnabled: (point) => point.markId === ADMIN_ACTIVITY_LINE_MARK_ID,
      }),
    []
  )
  const buildDefinition = useCallback(
    (viewport: NumericDomain) =>
      defineChart({
        marks: [
          areaY(prepared.points, {
            id: "admin-activity-area",
            x: "timestamp",
            y1: 0,
            y2: "count",
            key: "id",
            curve: d3Curve(curveMonotoneX),
            fill: "var(--chart-1)",
            fillOpacity: 0.2,
          }),
          lineY(prepared.points, {
            id: ADMIN_ACTIVITY_LINE_MARK_ID,
            x: "timestamp",
            y: "count",
            z: "seriesId",
            key: "id",
            curve: d3Curve(curveMonotoneX),
            stroke: "var(--chart-1)",
            strokeWidth: 2,
          }),
          dot(prepared.points, {
            id: "admin-activity-active-points",
            x: "timestamp",
            y: "count",
            z: "seriesId",
            key: "id",
            r: 0,
            fill: "var(--chart-1)",
            fillOpacity: 0,
            stroke: "var(--background)",
            strokeWidth: 2,
            states: [
              {
                when: { focus: "key" },
                style: { r: 4, fillOpacity: 1 },
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
              padding: 6,
              format: (value) =>
                format.dateTime(new Date(value), {
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                }),
            },
            tickLabels: {
              fontSize: 10,
              thin: { minGap: 30, priority: "ends" },
            },
          },
        },
        y: {
          scale: scaleLinear().domain([0, prepared.maximum]),
          grid: false,
          axis: false,
        },
        margin: { top: 6, right: 6, bottom: 0, left: 6 },
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
                    timeZone: "UTC",
                  })
                : undefined,
              rows: point
                ? [
                    {
                      color: "var(--chart-1)",
                      label: countLabel,
                      value: formatCount(point.count),
                    },
                  ]
                : [],
            }
          },
        },
      }),
    [countLabel, focus, format, formatCount, prepared]
  )
  const periodDays = Math.max(
    1,
    (prepared.domain[1] - prepared.domain[0]) / DAY_IN_MS
  )

  return (
    <InteractiveTimeSeriesChart
      ariaLabel={ariaLabel}
      buildDefinition={buildDefinition}
      className="h-32 text-muted-foreground"
      domain={prepared.domain}
      formatDomain={(domain) =>
        t("Visible from {start} to {end}", {
          start: format.dateTime(new Date(domain[0]), {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }),
          end: format.dateTime(new Date(domain[1]), {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }),
        })
      }
      height={128}
      initialWidth={420}
      interactionHint={t(
        "Use a wheel, trackpad, drag, or pinch to zoom and pan. Use plus, minus, or Alt with the arrow keys from the keyboard; press 0 to reset."
      )}
      maximumZoom={Math.max(1, Math.min(16, periodDays / 2))}
      resetLabel={t("Reset chart view")}
    />
  )
}
