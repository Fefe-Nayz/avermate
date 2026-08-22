"use client"

import { useMemo } from "react"
import {
  DENSITY_MINIMUM_SAMPLE,
  kernelDensity,
  type WidgetDistributionGroup,
} from "@avermate/core"
import { AVERAGE_SERIES_COLORS } from "@/components/charts/multi-series-average-chart"
import { cn } from "@/lib/utils"
import { FOOTNOTE_TEXT } from "./card-figure"

/**
 * A distribution as a shape: one violin per group, or several stacked as a ridgeline.
 *
 * What five numbers cannot say. A box plot of a term of thirteens and a box plot of a term
 * that was half nines and half seventeens can be identical — same median, same quartiles —
 * and the second reader is having a very different year. The outline says which.
 *
 * Three rules, and the first is the one that keeps it from lying:
 *
 * - A group with too few marks gets **no shape**. `kernelDensity` refuses below
 *   `DENSITY_MINIMUM_SAMPLE`, and this draws its box plot instead — a summary that is
 *   honest at that size — rather than a smooth curve interpolated from four points, which
 *   looks like knowledge and is a drawing.
 * - Every shape is scaled by the **same** density, so a wide group looks wide. Normalising
 *   each group to its own peak is the standard mistake: it makes a subject with two marks
 *   as emphatic as one with thirty.
 * - The axis is the whole scale, always, for the reason a strip's is: two groups can only be
 *   compared if they are drawn against the same twenty.
 *
 * Drawn as SVG paths rather than through the chart renderer: a violin is one polygon per
 * group with no scales, no axis of its own and no tooltip anchor, so a measurement pass and
 * a canvas would buy nothing.
 */

export interface DensityRow {
  key: string
  label: string
  /** `null` where the sample is too small for a shape — the box is drawn instead. */
  outline: string | null
  box: { q1: number; median: number; q3: number; min: number; max: number }
  total: number
  colour: string
}

/**
 * The outline of one group, as a path in a unit box.
 *
 * `x` runs 0..1 across the scale and `y` 0..1 upwards from the row's baseline, so the caller
 * scales it with a transform and never recomputes the shape on resize. `peak` is the shared
 * maximum: passing each group's own would be the normalising mistake described above.
 */
export function densityOutline(
  values: readonly number[],
  peak: number,
  options: { half?: boolean } = {}
): string | null {
  const points = kernelDensity(values)
  if (points === null || peak <= 0) return null
  const height = (density: number) => Math.min(1, density / peak)
  const top = points.map(
    (point) =>
      `${point.at.toFixed(4)},${(-height(point.density) / (options.half ? 1 : 2)).toFixed(4)}`
  )
  if (options.half) {
    // A ridgeline's row: the shape above its own baseline, closed along it.
    return `M0,0 L${top.join(" L")} L1,0 Z`
  }
  // A violin: mirrored around the row's centre line.
  const bottom = [...points]
    .reverse()
    .map(
      (point) =>
        `${point.at.toFixed(4)},${(height(point.density) / 2).toFixed(4)}`
    )
  return `M${top.join(" L")} L${bottom.join(" L")} Z`
}

/** The tallest density across every group, which is what they are all drawn against. */
export function sharedDensityPeak(
  groups: readonly WidgetDistributionGroup[]
): number {
  let peak = 0
  for (const group of groups) {
    const points = kernelDensity(group.values)
    if (points === null) continue
    for (const point of points) peak = Math.max(peak, point.density)
  }
  return peak
}

export function CardDensity({
  groups,
  mode,
  showBox,
  overlap,
  formatValue,
  scale,
  ariaLabel,
  tooSmallLabel,
}: {
  groups: readonly WidgetDistributionGroup[]
  /**
   * `boxplot` draws the boxes and no outlines: a grouped box plot is this same result read
   * as five numbers per group, and giving it a shape it did not ask for would be the
   * renderer overriding the card.
   */
  mode: "violin" | "ridgeline" | "boxplot"
  showBox: boolean
  /** A ridgeline's rows may overlap by this share of their own height. */
  overlap: number
  formatValue: (ratio: number) => string
  scale: number
  ariaLabel: string
  /** What a group with too few marks for a shape is called. */
  tooSmallLabel: (count: number) => string
}) {
  const rows = useMemo<DensityRow[]>(() => {
    const peak = sharedDensityPeak(groups)
    return groups.map((group, index) => ({
      key: group.key,
      label: group.label,
      outline:
        mode === "boxplot"
          ? null
          : densityOutline(group.values, peak, {
              half: mode === "ridgeline",
            }),
      box: {
        min: group.summary.min,
        q1: group.summary.q1,
        median: group.summary.median,
        q3: group.summary.q3,
        max: group.summary.max,
      },
      total: group.total,
      colour:
        AVERAGE_SERIES_COLORS[index % AVERAGE_SERIES_COLORS.length] ??
        "var(--chart-1)",
    }))
  }, [groups, mode])

  if (rows.length === 0) return null

  // A ridgeline's rows are allowed to climb into the one above, which is what makes the
  // shift readable; a violin's stay inside their own band.
  const climb = mode === "ridgeline" ? 1 + Math.max(0, overlap) : 1

  return (
    <figure
      className="flex h-full min-h-0 flex-col gap-1"
      aria-label={ariaLabel}
    >
      {/* The readings in words, for anyone not reading shapes — and for assistive
          technology, which cannot. */}
      <figcaption className="sr-only">
        {rows
          .map(
            (row) =>
              `${row.label}: ${formatValue(row.box.median)} (${formatValue(
                row.box.q1
              )} – ${formatValue(row.box.q3)})`
          )
          .join(", ")}
      </figcaption>
      <div className="flex min-h-0 flex-1 flex-col">
        {rows.map((row, index) => (
          <div
            key={row.key}
            className="relative min-h-0 flex-1"
            style={{ zIndex: rows.length - index }}
          >
            <svg
              aria-hidden
              /**
               * `w-full`, and not `inset-x-0` alone.
               *
               * An absolutely positioned SVG carrying a `viewBox` has an intrinsic aspect
               * ratio, and for a replaced element `width: auto` resolves to the intrinsic
               * width — so `left: 0; right: 0` was ignored and every row came out square.
               * Measured: 38×38 inside a 260px card, which drew seven violins in the
               * leftmost seventh of the card and made the ungrouped one overhang by 38px.
               * `preserveAspectRatio="none"` does not help: it governs how the content is
               * scaled inside the viewport, not how the element sizes itself.
               */
              className="absolute inset-x-0 w-full"
              style={{
                // The row's own band, grown upwards by the overlap so a shape can reach
                // over its neighbour without the band itself changing size.
                bottom: 0,
                height: `${climb * 100}%`,
              }}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              {row.outline ? (
                <path
                  d={row.outline}
                  transform={
                    mode === "ridgeline"
                      ? "translate(0 1) scale(1 1)"
                      : "translate(0 0.5) scale(1 1)"
                  }
                  fill={row.colour}
                  fillOpacity={mode === "ridgeline" ? 0.55 : 0.35}
                  stroke={row.colour}
                  strokeWidth={0.006}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {showBox ? (
                <g
                  transform={
                    mode === "ridgeline"
                      ? "translate(0 0.86)"
                      : "translate(0 0.5)"
                  }
                >
                  {/* The whiskers, then the middle half, then the median: the reading a
                      reader asks for once the shape has told them the shape. */}
                  <line
                    x1={row.box.min}
                    x2={row.box.max}
                    y1={0}
                    y2={0}
                    stroke={row.colour}
                    strokeWidth={0.008}
                    vectorEffect="non-scaling-stroke"
                  />
                  <rect
                    x={row.box.q1}
                    width={Math.max(0.002, row.box.q3 - row.box.q1)}
                    y={-0.06}
                    height={0.12}
                    fill={row.colour}
                    fillOpacity={0.85}
                  />
                  <line
                    x1={row.box.median}
                    x2={row.box.median}
                    y1={-0.09}
                    y2={0.09}
                    stroke="var(--background)"
                    strokeWidth={0.02}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ) : null}
            </svg>
            <span
              className={cn(
                FOOTNOTE_TEXT,
                "absolute inset-x-0 bottom-0 line-clamp-1 text-muted-foreground"
              )}
              style={{ lineHeight: 1 }}
            >
              {row.outline === null && mode !== "boxplot"
                ? `${row.label} · ${tooSmallLabel(row.total)}`
                : row.label}
            </span>
          </div>
        ))}
      </div>
      {/* The axis, in marks. One for every row, because they share it — which is the whole
          basis of the comparison. */}
      <div
        className={cn(
          FOOTNOTE_TEXT,
          "flex justify-between text-muted-foreground"
        )}
        aria-hidden
      >
        {[0, 0.25, 0.5, 0.75, 1].map((at) => (
          <span key={at} className="numeric">
            {Math.round(at * scale)}
          </span>
        ))}
      </div>
    </figure>
  )
}

/** The smallest sample a shape may be drawn from — re-exported so a caller can say why. */
export { DENSITY_MINIMUM_SAMPLE }
