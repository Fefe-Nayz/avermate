"use client"

import { useMemo } from "react"
import { useExtracted } from "next-intl"
import type { WidgetVisualization } from "@avermate/core"
import { AVERAGE_SERIES_COLORS } from "@/components/charts/multi-series-average-chart"
import { cn } from "@/lib/utils"
import { FOOTNOTE_TEXT } from "./card-figure"

/**
 * A composition, as counted cells.
 *
 * The card this is for is the narrow one. A histogram needs width for its axis
 * and a donut needs height for its hole; a waffle needs neither, so it is the
 * one shape that still says "two thirds of your marks are above ten" in a
 * hundred and fifty pixels.
 *
 * Two rules, and the second is the one that makes it honest:
 *
 * - The grid is a *share*, so the count is rounded to cells and the remainder is
 *   carried, which keeps the filled total exactly equal to the requested cells
 *   rather than one or two out from independent rounding.
 * - A cell is therefore not an observation, and it must never be presented as
 *   one. The real counts sit in the legend beside every band, and the accessible
 *   summary reads them out — so nothing depends on counting squares.
 *
 * Drawn as a CSS grid rather than through the chart renderer: cells have no
 * scales, no axes and no tooltip anchor, and asking a cartesian renderer for a
 * hundred equal squares buys a measurement pass and a canvas for nothing.
 */

export interface WaffleBand {
  key: string
  label: string
  count: number
}

/**
 * Cells per band, summing to exactly `cells`.
 *
 * Largest-remainder, because the obvious `Math.round(share * cells)` per band
 * does not sum: three bands at a third of twenty cells round to 7 + 7 + 7 and
 * leave the grid a cell short, which reads as a gap that means nothing. The
 * remainders decide who gets the spare cells, and a band with any observations
 * at all keeps at least one — a band shown as empty when it is not is a lie the
 * legend then contradicts.
 */
export function waffleCells(
  bands: readonly WaffleBand[],
  cells: number
): number[] {
  const total = bands.reduce((sum, band) => sum + band.count, 0)
  if (total <= 0 || cells <= 0) return bands.map(() => 0)

  const exact = bands.map((band) => (band.count / total) * cells)
  // The minimum-of-one guarantee only holds while there are cells to keep it
  // with. Twelve bands cannot each hold one of ten cells, and forcing it there
  // is what breaks the sum — a grid that does not fill is a hole the reader has
  // to interpret. Where the guarantee is impossible the smallest shares fall to
  // zero and the legend, which carries the real counts, is what keeps it honest.
  const populated = bands.filter((band) => band.count > 0).length
  const guaranteed = populated <= cells
  const floors = exact.map((value, index) =>
    bands[index]!.count > 0 && guaranteed
      ? Math.max(1, Math.floor(value))
      : Math.floor(value)
  )
  let spare = cells - floors.reduce((sum, value) => sum + value, 0)

  // Over-allocated by the minimum-of-one rule: take back from the largest
  // shares, which is where a cell is least missed.
  while (spare < 0) {
    let victim = -1
    for (let index = 0; index < floors.length; index += 1) {
      if (floors[index]! <= 1) continue
      if (victim === -1 || floors[index]! > floors[victim]!) victim = index
    }
    if (victim === -1) break
    floors[victim] = floors[victim]! - 1
    spare += 1
  }

  // Hand the rest out by remainder, largest first, ties to the earlier band so
  // the answer belongs to the band order rather than to sort stability.
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) =>
      right.remainder === left.remainder
        ? left.index - right.index
        : right.remainder - left.remainder
    )
  for (let step = 0; spare > 0 && step < order.length * cells; step += 1) {
    const target = order[step % order.length]!
    floors[target.index] = floors[target.index]! + 1
    spare -= 1
  }

  return floors
}

/** Columns that keep the grid close to square at a given cell count. */
export function waffleColumns(cells: number): number {
  if (cells <= 20) return 5
  if (cells <= 30) return 5
  if (cells <= 50) return 10
  return 10
}

export function CardWaffle({
  bands,
  visualization,
  formatCount,
}: {
  bands: readonly WaffleBand[]
  visualization: WidgetVisualization
  /** The real number behind a band, which the legend owes the reader. */
  formatCount: (count: number) => string
}) {
  const t = useExtracted()
  const cells =
    visualization.options.kind === "waffle" ? visualization.options.cells : 20

  const filled = useMemo(() => waffleCells(bands, cells), [bands, cells])
  const columns = waffleColumns(cells)
  const total = bands.reduce((sum, band) => sum + band.count, 0)

  if (total <= 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("Not enough data yet")}
      </p>
    )
  }

  const squares = bands.flatMap((band, index) =>
    Array.from({ length: filled[index] ?? 0 }, (_, cell) => ({
      key: `${band.key}:${cell}`,
      color:
        AVERAGE_SERIES_COLORS[index % AVERAGE_SERIES_COLORS.length] ??
        "var(--chart-1)",
    }))
  )

  return (
    <figure
      className="flex h-full flex-col justify-center gap-3"
      aria-label={t("Composition")}
    >
      {/* The reading, in words, for anyone not counting squares — and for
          assistive technology, which cannot. */}
      <figcaption className="sr-only">
        {bands
          .map((band) => `${band.label}: ${formatCount(band.count)}`)
          .join(", ")}
      </figcaption>
      <div
        aria-hidden
        className="grid gap-[3px]"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          maxWidth: `${columns * 22}px`,
        }}
      >
        {squares.map((square) => (
          <span
            key={square.key}
            className="aspect-square rounded-[2px]"
            style={{ background: square.color }}
          />
        ))}
      </div>
      <ul className={cn(FOOTNOTE_TEXT, "flex flex-col gap-0.5")}>
        {bands.map((band, index) => (
          <li key={band.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{
                background:
                  AVERAGE_SERIES_COLORS[index % AVERAGE_SERIES_COLORS.length],
              }}
            />
            <span className="min-w-0 flex-1 truncate">{band.label}</span>
            {/* The count, never the cell count: a cell is a share. */}
            <span className="numeric shrink-0 text-muted-foreground">
              {formatCount(band.count)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
