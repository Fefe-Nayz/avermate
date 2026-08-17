"use client"

import Link from "next/link"
import { useLayoutEffect, useState } from "react"
import { useExtracted } from "next-intl"
import { AverageValue, DeltaValue } from "@/components/data/value"
import { cardListCellLimit, cardListColumns, limitCardList } from "./card-list"
import { FitSingleLine } from "./fit-single-line"

/**
 * A ranking sized to its surface.
 *
 * Slicing every list to six rows hid the rest of the year without saying so,
 * and stacked six rows into a column even when the card was half a desktop
 * wide. This list measures the box it was actually given: columns come from
 * the width, the cell count from the height. The card itself only ever asks
 * the grid row for five rows — the ul is absolutely positioned, so revealing
 * more entries into a taller neighbour's row can never inflate that row in
 * return. What still doesn't fit is counted, out loud, by a cell that links
 * to the full ranking. Names stay complete on one line, shrinking a touch
 * when they must, rather than losing their ends to an ellipsis.
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
    ratio: number | null
    delta: number | null
  }>
}) {
  const t = useExtracted()
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    if (!node) return
    const measure = () => {
      const next = { width: node.clientWidth, height: node.clientHeight }
      setViewport((current) =>
        current.width === next.width && current.height === next.height
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

  const columns = cardListColumns(viewport.width)
  const { visible, remaining } = limitCardList(
    items,
    cardListCellLimit(viewport)
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
        className="absolute inset-0 grid content-center overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
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
