"use client"

import { useMemo } from "react"
import { cell, type DomChartDefinition } from "@tanstack/charts"
import { scaleBand } from "@tanstack/charts/scales/band"
import { tooltip } from "@tanstack/charts/tooltip"
import { useFormatter, useExtracted } from "next-intl"
import type {
  WidgetDatumSlots,
  WidgetSeriesDatum,
  WidgetValueType,
  WidgetVisualization,
} from "@avermate/core"
import { AVERAGE_SERIES_COLORS } from "@/components/charts/multi-series-average-chart"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import { cn } from "@/lib/utils"
import {
  widgetColorBucketKey,
  widgetColorBuckets,
  widgetEncodedScaleValue,
  widgetEncodedSeriesDatum,
  widgetEncodedThresholdColor,
  widgetEncodingValueType,
  widgetNumericDomain,
} from "./widget-view-model"

/**
 * The heatmap a card wears.
 *
 * It was a `grid-cols-[repeat(auto-fill,…)]` of square divs with a `title`
 * attribute for a tooltip, which had three costs. It could not fill its card —
 * the cells kept their own aspect and left 55% of a tall row blank. It had no
 * tooltip in the sense the rest of the app means one, only the browser's. And a
 * date heatmap came out as one long wrapping strip of squares, so the thing a
 * heatmap over time is *for* — this week against last week, weekends against
 * weekdays — was the one thing it could not show.
 *
 * A `cell` matrix on band scales says all of it: weeks across, weekdays down,
 * which is the shape the reader already knows from every contribution graph.
 * Categorical data keeps the single row it always had, on the same mark.
 *
 * Colour stays where it was, and that is deliberate: the buckets and the
 * `color-mix` recipe are the app's, so the palette still follows the theme and
 * still honours a definition's thresholds. An interpolating scale would have
 * been the obvious move and is not available — d3 interpolates colours it can
 * parse, and `var(--band-good)` is not one. Ordinal over the buckets is what the
 * calendar examples do anyway.
 */

/**
 * The config, cast rather than inferred — the same trick, and for the same
 * reason, as `dynamicChart` in `widget-view`: the marks here are built from a
 * definition at runtime, so the channel generics cannot be resolved statically
 * and spelling them out would be a fiction. Declared locally instead of shared,
 * because importing it from `widget-view` would make these two files a cycle.
 */
function heatmapChart(
  definition: unknown
): DomChartDefinition<unknown, string | number, string | number> {
  return definition as DomChartDefinition<
    unknown,
    string | number,
    string | number
  >
}

/** Monday first: the app models French school years, and its weeks start there. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

const MILLISECONDS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

/** The Monday of a date's week, at local midnight. */
function startOfWeek(value: Date): Date {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const shift = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - shift)
  return start
}

/**
 * Weeks across, weekdays down.
 *
 * Lifted out of the component so the calendar can be measured without mounting
 * a chart: which weekday rows exist and which week a cell lands in are
 * arithmetic, and arithmetic is testable. Naming stays with the caller, because
 * it is the caller that has a locale.
 */
export function calendarLayout<T extends { date: Date }>(
  dated: readonly T[],
  names: { weekday: (date: Date) => string; month: (date: Date) => string }
): {
  cells: (T & { week: number; weekday: number; weekdayLabel: string })[]
  weeks: number[]
  weekdayLabels: string[]
  monthOf: (week: number) => string
} | null {
  if (dated.length === 0) return null

  const origin = startOfWeek(
    dated.reduce(
      (earliest, item) => (item.date < earliest ? item.date : earliest),
      dated[0]!.date
    )
  )
  const laid = dated.map((item) => ({
    ...item,
    week: Math.round(
      (startOfWeek(item.date).getTime() - origin.getTime()) /
        MILLISECONDS_PER_WEEK
    ),
    weekday: item.date.getDay(),
  }))
  const weeks = [...new Set(laid.map((item) => item.week))].sort(
    (left, right) => left - right
  )
  /**
   * Only the weekdays the data actually lands on.
   *
   * A weekly series buckets to one day of the week, so all seven rows would
   * leave six empty and squeeze the cells into a seventh of the card — which is
   * what it did. Daily data still fills all seven and reads as the calendar it
   * is; a weekly one collapses to the single row it deserves.
   */
  const present = new Set(laid.map((item) => item.weekday))
  const rows = WEEKDAY_ORDER.filter((day) => present.has(day))
  /**
   * Weekday to label, rather than two arrays held in step by index.
   *
   * The parallel form worked, but only for as long as both filters stayed
   * written the same way, and it needed a cast to index one with the other.
   * `present` is built from `laid`, so every cell's weekday is a key here.
   */
  const labelFor = new Map<number, string>(
    rows.map((day) => {
      const sample = new Date(origin)
      sample.setDate(sample.getDate() + ((day + 6) % 7))
      return [day, names.weekday(sample)]
    })
  )
  return {
    cells: laid.map((item) => ({
      ...item,
      weekdayLabel: labelFor.get(item.weekday)!,
    })),
    weeks,
    weekdayLabels: rows.map((day) => labelFor.get(day)!),
    /** The month a week belongs to, for the axis that asks for one. */
    monthOf: (week: number) => {
      const day = new Date(origin)
      day.setDate(day.getDate() + week * 7)
      return names.month(day)
    },
  }
}

export function CardHeatmap({
  values,
  valueType,
  visualization,
  slots,
  scale,
  formatValue,
}: {
  values: WidgetSeriesDatum[]
  valueType: WidgetValueType
  visualization: WidgetVisualization
  /** Which slot each channel meant — see `widgetDatumSlots`. */
  slots: WidgetDatumSlots
  scale: number
  /** Owned by the caller, which knows the year's decimals. */
  formatValue: (shown: number, valueType: WidgetValueType) => string
}) {
  const t = useExtracted()
  const format = useFormatter()

  const xField = slots.x ?? "date"
  const yField = slots.y ?? "value"
  const colorField = slots.color ?? yField
  const yValueType = widgetEncodingValueType(yField, valueType)

  const prepared = useMemo(() => {
    const encoded = values.flatMap((item) => {
      const point = widgetEncodedSeriesDatum(
        item,
        xField,
        yField,
        colorField,
        valueType,
        visualization,
        scale
      )
      if (!point) return []
      return [
        {
          key: item.key,
          label: item.label,
          date: item.date,
          x: point.x,
          shownValue: point.y,
          colorValue: point.colorValue,
          // A day the calendar filled in carries no marks, and a day whose marks
          // averaged zero carries some. Both draw the same empty square, so the
          // tooltip is the only place the difference can be told — and it is a
          // difference that matters: one is a rest day, the other is a disaster.
          observations: item.count,
        },
      ]
    })

    const ordered = [...encoded].sort((left, right) =>
      typeof left.x === "number" && typeof right.x === "number"
        ? left.x - right.x
        : String(left.x).localeCompare(String(right.x))
    )
    if (visualization.scale.x.reverse) ordered.reverse()

    const numeric = ordered.flatMap((item) =>
      typeof item.colorValue === "number" ? [item.colorValue] : []
    )
    const buckets = widgetColorBuckets(numeric)
    const [minimum, maximum] = widgetNumericDomain(
      numeric,
      visualization.scale.y.zero,
      visualization.scale.y.min === null
        ? null
        : widgetEncodedScaleValue(
            visualization.scale.y.min,
            colorField,
            valueType,
            visualization,
            scale
          ),
      visualization.scale.y.max === null
        ? null
        : widgetEncodedScaleValue(
            visualization.scale.y.max,
            colorField,
            valueType,
            visualization,
            scale
          )
    )
    const span = Math.max(Number.EPSILON, maximum - minimum)
    const scheme =
      visualization.options.kind === "heatmap"
        ? visualization.options.colorScheme
        : "semantic"

    /** The mix a value of this intensity wears, in the scheme asked for. */
    const shade = (value: number, negative: boolean) => {
      const normalized = Math.max(0, Math.min(1, (value - minimum) / span))
      const intensity = Math.round(
        Math.max(
          0.12,
          visualization.scale.y.reverse ? 1 - normalized : normalized
        ) * 100
      )
      const hue =
        scheme === "diverging"
          ? negative
            ? "var(--destructive)"
            : "var(--band-good)"
          : scheme === "sequential"
            ? "var(--chart-1)"
            : "var(--band-good)"
      return `color-mix(in oklab, ${hue} ${intensity}%, var(--muted))`
    }

    // One key per distinct colour, so buckets, categories and a definition's own
    // threshold colours all reach the mark through the same ordinal channel.
    const palette = new Map<string, string>()
    const categories: string[] = []
    const cells = ordered.map((item) => {
      const threshold = widgetEncodedThresholdColor(
        item.shownValue,
        yField,
        valueType,
        visualization,
        scale
      )
      let colorKey: string
      let color: string
      if (threshold) {
        colorKey = `threshold:${threshold}`
        color = threshold
      } else if (typeof item.colorValue === "string") {
        colorKey = `category:${item.colorValue}`
        if (!categories.includes(item.colorValue))
          categories.push(item.colorValue)
        color =
          AVERAGE_SERIES_COLORS[
            categories.indexOf(item.colorValue) % AVERAGE_SERIES_COLORS.length
          ]!
      } else if (typeof item.colorValue === "number") {
        colorKey = `bucket:${widgetColorBucketKey(item.colorValue, buckets)}`
        color = shade(item.colorValue, item.shownValue < 0)
      } else {
        // Nothing to colour by: the cell is present but says nothing, so it
        // wears the empty shade rather than being dropped from the matrix.
        colorKey = "none"
        color = "var(--muted)"
      }
      palette.set(colorKey, color)
      return { ...item, colorKey }
    })

    return {
      cells,
      colorDomain: [...palette.keys()],
      colorRange: [...palette.values()],
      buckets,
      shade,
    }
  }, [colorField, scale, valueType, values, visualization, xField, yField])

  /**
   * Weeks across and weekdays down, when the axis is time. Anything else keeps
   * the single row it has always had — a heatmap of five subjects is a strip,
   * and pretending it is a calendar would invent six empty rows.
   */
  const calendar = useMemo(() => {
    if (xField !== "date") return null
    return calendarLayout(
      prepared.cells.flatMap((item) =>
        item.date ? [{ ...item, date: item.date }] : []
      ),
      {
        weekday: (date) => format.dateTime(date, { weekday: "short" }),
        month: (date) => format.dateTime(date, { month: "short" }),
      }
    )
  }, [format, prepared.cells, xField])

  const definition = useMemo(() => {
    const rows = calendar?.weekdayLabels ?? [""]
    const cells = calendar
      ? calendar.cells
      : prepared.cells.map((item) => ({
          ...item,
          week: 0,
          weekday: 0,
          weekdayLabel: "",
        }))
    const columns = calendar
      ? calendar.weeks.map(String)
      : prepared.cells.map((item) => String(item.x))

    return heatmapChart({
      marks: [
        cell(
          cells.map((item) => ({
            ...item,
            column: calendar ? String(item.week) : String(item.x),
          })),
          {
            id: "card-heatmap",
            x: "column",
            y: "weekdayLabel",
            color: "colorKey",
            key: "key",
            inset: 1,
            radius: 3,
          }
        ),
      ],
      x: {
        scale: scaleBand<string>().domain(columns).padding(0.06),
        grid: false,
        axis: visualization.axes.x.visible
          ? {
              line: false,
              label: visualization.axes.x.label ?? undefined,
              ticks: {
                size: 0,
                format: (value: string) =>
                  calendar ? calendar.monthOf(Number(value)) : value,
              },
            }
          : false,
      },
      y: {
        scale: scaleBand<string>().domain(rows).padding(0.06),
        grid: false,
        axis:
          visualization.axes.y.visible && calendar
            ? {
                line: false,
                label: visualization.axes.y.label ?? undefined,
                ticks: { size: 0 },
              }
            : false,
      },
      color: { domain: prepared.colorDomain, range: prepared.colorRange },
      focus: "nearest",
      // Same reason as every other card chart: the renderer's own ring is a
      // filled circle, and a filled circle under a square cell is a smudge.
      focusRing: false,
      tooltip: {
        use: tooltip,
        placement: ["top", "bottom", "right", "left"],
        content: (points: Array<{ datum?: (typeof cells)[number] }>) => {
          const item = points[0]?.datum
          return {
            title: item?.date
              ? format.dateTime(item.date, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
              : (item?.label ?? ""),
            rows: item
              ? [
                  item.observations === 0
                    ? {
                        color: "var(--muted-foreground)",
                        label: visualization.axes.y.label ?? t("Value"),
                        value: t("No assessment"),
                      }
                    : {
                        color: "var(--chart-1)",
                        label: visualization.axes.y.label ?? t("Value"),
                        value: formatValue(item.shownValue, yValueType),
                      },
                ]
              : [],
          }
        },
      },
    })
  }, [
    calendar,
    format,
    formatValue,
    prepared.cells,
    prepared.colorDomain,
    prepared.colorRange,
    t,
    visualization.axes.x.label,
    visualization.axes.x.visible,
    visualization.axes.y.label,
    visualization.axes.y.visible,
    yValueType,
  ])

  if (prepared.cells.length === 0) return null

  const legendItems =
    visualization.legend.visible && prepared.buckets.length > 0
      ? prepared.buckets.map((bucket) => ({
          key: bucket.key,
          color: prepared.shade((bucket.from + bucket.to) / 2, bucket.to < 0),
          label: `${formatValue(bucket.from, yValueType)}–${formatValue(bucket.to, yValueType)}`,
        }))
      : []

  const legend =
    legendItems.length > 0 ? (
      <ul
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
        aria-label={t("Legend")}
      >
        {legendItems.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: item.color }}
            />
            <span className="min-w-0 break-words">{item.label}</span>
          </li>
        ))}
      </ul>
    ) : null

  return (
    // The matrix is the body of its card, so it takes the height the row
    // resolved to; 9rem is only the floor it insists on.
    <figure className="flex h-full flex-col gap-2" aria-label={t("Heatmap")}>
      {visualization.legend.position === "top" ? legend : null}
      <div
        className={cn(
          // A flex column: the matrix below has to be a flex child to inherit a
          // definite height, or `fill` measures nothing and the cells come out
          // zero pixels tall.
          "flex min-h-0 min-w-0 flex-1 flex-col",
          visualization.legend.position === "right" &&
            legend &&
            "grid grid-cols-[minmax(0,1fr)_minmax(5rem,auto)] items-center gap-3"
        )}
        style={{ minHeight: 144 }}
      >
        <div className="min-h-0 min-w-0 flex-1 text-muted-foreground">
          <ResponsiveChart
            ariaLabel={t("Heatmap")}
            definition={definition}
            fill
            height={144}
            initialWidth={360}
            updateTransition={INSTANT_CHART_UPDATES}
          />
        </div>
        {visualization.legend.position === "right" ? legend : null}
      </div>
      {visualization.legend.position === "bottom" ? legend : null}
    </figure>
  )
}
