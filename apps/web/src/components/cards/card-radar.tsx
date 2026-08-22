"use client"

import { useMemo, useState } from "react"
import { defineChart } from "@tanstack/charts"
import { tooltip } from "@tanstack/charts/tooltip"
import { useExtracted, useFormatter } from "next-intl"
import type { WidgetSeriesDatum } from "@avermate/core"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import {
  radarSpec,
  type RadarPoint,
} from "@/components/charts/subject-radar-spec"
import { cn } from "@/lib/utils"
import { FOOTNOTE_TEXT } from "./card-figure"

/**
 * Several readings on one ring, as a card.
 *
 * The chart itself is the dashboard's — `radarSpec`, geometry and all, including the four
 * attempts at putting a subject's name on its own spoke. What is here is the part a card
 * needs and a fixed chart did not: which readings become spokes, and what happens when
 * there are too few or too many.
 *
 * Both bounds matter, and they fail differently:
 *
 * - **Under three** there is no polygon. Two spokes are a line and one is a point, and a
 *   reader shown either of those reads a shape into it. The card says what it needs
 *   instead of drawing a degenerate ring.
 * - **Over eight** the ring stops being readable — the names crowd, the spokes narrow, and
 *   the polygon's *area* starts doing the talking, which is the radar's oldest lie: area
 *   grows with the square of the readings and with the order the spokes happen to be in.
 *   So the extra readings are dropped and *counted*, never dropped in silence.
 */

/** Below this a ring is not a shape. */
export const RADAR_MINIMUM_AXES = 3
/** Above this the names crowd and the polygon's area does the talking. */
export const RADAR_MAXIMUM_AXES = 8

/**
 * The spokes, in the frame's own order, in the year's own marks.
 *
 * Order is the analysis's — whatever its transforms decided — and not re-sorted here: the
 * shape a radar draws depends on the order of its spokes, so a renderer that sorted them
 * would draw a different polygon from the same readings.
 */
export function radarAxes(
  rows: readonly WidgetSeriesDatum[],
  scale: number,
  limit: number = RADAR_MAXIMUM_AXES
): { points: RadarPoint[]; hidden: number } {
  const usable = rows.filter(
    (row): row is WidgetSeriesDatum & { value: number } =>
      typeof row.value === "number" && Number.isFinite(row.value)
  )
  const shown = usable.slice(0, Math.max(1, limit))
  return {
    points: shown.map((row) => ({
      subject: row.label,
      // The spec plots marks, not ratios: its rings are labelled 0 … scale.
      value: row.value * scale,
    })),
    hidden: Math.max(0, usable.length - shown.length),
  }
}

export function CardRadar({
  rows,
  scale,
  decimals,
  fill,
  showPoints,
  ariaLabel,
}: {
  rows: readonly WidgetSeriesDatum[]
  /** The year's own top mark; a year here is not always out of twenty. */
  scale: number
  decimals: number
  fill: boolean
  showPoints: boolean
  ariaLabel: string
}) {
  const t = useExtracted()
  const format = useFormatter()

  const { points, hidden } = useMemo(
    () => radarAxes(rows, scale),
    [rows, scale]
  )

  /**
   * The spoke under the pointer.
   *
   * Held here and handed back to the spec for the reason spelled out in
   * `subject-radar-spec`: no radial mark in this library reads focus from the renderer, so
   * the host reports it and React returns it as data.
   */
  const [focused, setFocused] = useState<string | null>(null)

  const definition = useMemo(
    () =>
      defineChart({
        chart: ({ width, height }) =>
          radarSpec({
            points,
            scale,
            width,
            height,
            formatValue: (value) => format.number(value),
            focusedSubject: focused,
            fill,
            showPoints,
          }),
        focus: "nearest",
        focusRing: false,
        svgAnimation: {
          duration: 240,
          easing: "ease-out",
          respectReducedMotion: true,
          resize: false,
        },
        tooltip: {
          use: tooltip,
          placement: ["top", "right", "left", "bottom"],
          content: (focus) => {
            const point = focus[0]?.datum
            return {
              title: point?.subject,
              rows: point
                ? [
                    {
                      color: "var(--chart-1)",
                      label: t("Average"),
                      value: format.number(point.value, {
                        maximumFractionDigits: decimals,
                      }),
                    },
                  ]
                : [],
            }
          },
        },
      }),
    [decimals, fill, focused, format, points, scale, showPoints, t]
  )

  if (points.length < RADAR_MINIMUM_AXES) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("A radar needs at least {count} subjects", {
          count: String(RADAR_MINIMUM_AXES),
        })}
      </p>
    )
  }

  return (
    <figure className="flex h-full min-h-0 flex-col gap-1">
      <div className="min-h-0 flex-1 text-muted-foreground">
        <ResponsiveChart
          ariaLabel={ariaLabel}
          definition={definition}
          fill
          height={220}
          initialWidth={240}
          onFocusChange={(point) => setFocused(point?.datum?.subject ?? null)}
          updateTransition={INSTANT_CHART_UPDATES}
        />
      </div>
      {/* What is not on the ring. A radar showing eight of nineteen subjects and saying
          nothing is a chart that lies by omission. */}
      {hidden > 0 ? (
        <figcaption className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
          {t("{count} more not shown", { count: String(hidden) })}
        </figcaption>
      ) : null}
    </figure>
  )
}
