"use client"

import Link from "next/link"
import { useLayoutEffect, useState } from "react"
import { useExtracted } from "next-intl"
import { AverageValue, DeltaValue } from "@/components/data/value"
import {
  CARD_LIST_COLUMN_QUERIES,
  cardListCellLimit,
  limitCardList,
  type CardListViewport,
} from "./card-list"
import { FitSingleLine } from "./fit-single-line"
import { cn } from "@/lib/utils"

/**
 * A ranking sized to its surface.
 *
 * Slicing every list to six rows hid the rest of the year without saying so,
 * and stacked six rows into a column even when the card was half a desktop
 * wide. This list takes the box it was actually given: the columns are asked for
 * in CSS, off the card's own query container, and the rows are however many the
 * height holds. The card itself only ever asks the grid row for five rows — the
 * ul is absolutely positioned, so revealing more entries into a taller
 * neighbour's row can never inflate that row in return. What still doesn't fit is
 * counted, out loud, by a cell that links to the full ranking. Names stay
 * complete on one line, shrinking a touch when they must, rather than losing
 * their ends to an ellipsis.
 *
 * Only that count needs measuring, and that is the point: a layout that waits for
 * a measurement is a layout that is wrong on the first paint, and this one was
 * visibly wrong — see `CARD_LIST_COLUMN_QUERIES`.
 */
const LIST_ROW_HEIGHT = 32
const LIST_ROW_GAP = 4
/** Rows the card asks the grid row for; taller neighbours reveal more. */
const LIST_NATURAL_ROWS = 5

export function RankingList({
  items,
}: {
  items: ReadonlyArray<{
    id: string
    label: string
    /** A mark out of the year's scale, drawn with the app's own reel. */
    ratio: number | null
    delta: number | null
    difference?: boolean
    /**
     * The reading, for a ranking that is not of marks.
     *
     * A weight is a percentage and a coverage is a count: neither is a mark out of twenty,
     * so neither can be drawn by `AverageValue`. Rendered by the caller, which knows the
     * measure's type and its format, and passed through as text — because the alternative
     * is this component learning the whole value model to render one number.
     *
     * Without it, both of those rankings showed a dash in every row while the same data as
     * a plain list read "24%".
     */
    reading?: string | null
  }>
}) {
  const t = useExtracted()
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  // Null until measured, rather than zeros: zeros are a width and a height, and
  // they were read as one — a card one column wide with room for three cells.
  const [viewport, setViewport] = useState<CardListViewport | null>(null)

  useLayoutEffect(() => {
    if (!node) return
    const measure = () => {
      const next = { width: node.clientWidth, height: node.clientHeight }
      setViewport((current) =>
        current?.width === next.width && current.height === next.height
          ? current
          : next
      )
    }

    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  // Unmeasured, the list shows what a card of this shape is *guaranteed* to
  // hold: the rows it asks the grid row for, in one column. Letting the clipped
  // box decide instead was worse than the guess it replaced — at 154px a card
  // rendered ten rows into five rows of space and clipped one in half, and a
  // long name at full size ran 344px past the card's edge. Measured, the count
  // is exact; before that it is short rather than wrong, and short only ever
  // reveals a row.
  const { visible, remaining } = limitCardList(
    items,
    viewport ? cardListCellLimit(viewport) : LIST_NATURAL_ROWS
  )

  const naturalRows = Math.min(items.length, LIST_NATURAL_ROWS)
  return (
    <div
      ref={setNode}
      className="relative h-full"
      style={{
        minHeight:
          naturalRows * LIST_ROW_HEIGHT + (naturalRows - 1) * LIST_ROW_GAP,
      }}
    >
      <ul
        className={cn(
          "absolute inset-0 grid overflow-hidden",
          CARD_LIST_COLUMN_QUERIES,
          // Centred once the rows are known to fit. Before that the overflow is
          // real, and centring it would clip the top of the list as well as its
          // tail.
          viewport ? "content-center" : "content-start"
        )}
        style={{
          gridAutoRows: LIST_ROW_HEIGHT,
          columnGap: 20,
          rowGap: LIST_ROW_GAP,
        }}
      >
        {visible.map((item) => (
          <li key={item.id} className="flex min-w-0 items-center gap-2 text-sm">
            <Link href={`/subjects/${item.id}`} className="min-w-0 flex-1">
              <FitSingleLine className="hover:underline">
                {item.label}
              </FitSingleLine>
            </Link>
            {item.ratio !== null ? (
              <AverageValue
                ratio={item.ratio}
                animate={false}
                decimals={1}
                colored
                className="shrink-0 text-sm"
              />
            ) : item.reading ? (
              <span
                className={cn(
                  "numeric shrink-0 text-sm font-medium",
                  item.difference &&
                    (item.delta === null || Math.abs(item.delta) < 0.0005
                      ? "text-muted-foreground"
                      : item.delta > 0
                        ? "text-positive"
                        : "text-negative")
                )}
              >
                {item.reading}
              </span>
            ) : (
              <DeltaValue delta={item.delta} className="shrink-0 text-sm" />
            )}
          </li>
        ))}
        {remaining > 0 ? (
          <li className="flex min-w-0 items-center text-xs text-muted-foreground">
            <Link href="/subjects" className="min-w-0 flex-1 hover:underline">
              <FitSingleLine>
                {t("+{count} more", { count: String(remaining) })}
              </FitSingleLine>
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  )
}
