"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  widgetFrameDomain,
  widgetFrameWhere,
  type WidgetDataFrame,
  type WidgetVisualization,
} from "@avermate/core"
import { cn } from "@/lib/utils"
import { FOOTNOTE_TEXT } from "./card-figure"

/**
 * One small chart per value of a dimension.
 *
 * The format the audit calls the biggest gain in versatility after composable
 * dimensions, and the reason is arithmetic rather than taste: eight series on one chart
 * is eight lines crossing, and the reader can follow one of them at a time at best. The
 * same eight as eight panels is eight readings, each legible, compared by position.
 *
 * Two rules, and the second is what separates a facet grid from eight unrelated charts:
 *
 * - The panels are the *domain* of the splitting dimension, in the order the frame
 *   presents it — not in the order the values happen to sort. A subject that appears late
 *   is still a panel.
 * - Every panel shares one scale. Drawn on their own scales, a panel of thirteens and a
 *   panel of nineteens look identical, and the comparison the grid exists for is not just
 *   lost but actively contradicted. `sharedScale` may turn it off; nothing in this app
 *   does, and the option exists so that turning it off is a decision somebody made.
 */

export interface FacetPanel {
  key: string
  label: string
  frame: WidgetDataFrame
}

/**
 * The panels, bounded.
 *
 * A grid of twenty is a texture. Past the cap the remaining values are dropped and the
 * caller is told how many — a facet grid that silently shows six of nineteen subjects is
 * a chart that lies by omission.
 */
export function facetPanels(
  frame: WidgetDataFrame,
  dimensionId: string,
  limit: number
): { panels: FacetPanel[]; hidden: number } {
  const domain = widgetFrameDomain(frame, dimensionId)
  const shown = domain.slice(0, Math.max(1, limit))
  return {
    panels: shown.map((entry) => ({
      key: String(entry.value),
      label: entry.label,
      frame: widgetFrameWhere(frame, dimensionId, entry.value),
    })),
    hidden: Math.max(0, domain.length - shown.length),
  }
}

/** Panels that fit across, given the card's own width. */
export function facetColumns(requested: number, width: number): number {
  // Below about a hundred and forty pixels a panel is a smear, so the grid narrows rather
  // than shrinking its panels past reading.
  const affordable = Math.max(1, Math.floor(width / 140))
  return Math.max(1, Math.min(requested, affordable))
}

export function CardFacets({
  frame,
  dimensionId,
  columns,
  sharedScale,
  visualization,
  renderPanel,
  moreLabel,
}: {
  frame: WidgetDataFrame
  /** Which dimension splits the grid — the facet channel's field. */
  dimensionId: string
  columns: number
  sharedScale: boolean
  visualization: WidgetVisualization
  /**
   * One panel, drawn by the caller.
   *
   * The grid owns the layout and the shared domain; what a panel *is* stays with the
   * renderer that knows the marks. `domain` is `null` when each panel scales itself.
   */
  renderPanel: (panel: FacetPanel, domain: [number, number] | null) => ReactNode
  /** "+{count} more", already localised by the caller. */
  moreLabel: (count: number) => string
}) {
  const { panels, hidden } = useMemo(
    // Nine panels is three rows of three; past that the card is a contact sheet.
    () => facetPanels(frame, dimensionId, 9),
    [dimensionId, frame]
  )

  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    if (!node) return
    const measure = () => {
      const next = node.clientWidth
      setWidth((current) => (current === next ? current : next))
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  const domain = useMemo<[number, number] | null>(() => {
    if (!sharedScale) return null
    const measure = frame.schema.measures[0]?.id
    if (!measure) return null
    const values = frame.rows
      .map((row) => row.measures[measure])
      .filter((value): value is number => value !== null && value !== undefined)
    if (values.length === 0) return null
    const lowest = visualization.scale.y.min ?? Math.min(...values)
    const highest = visualization.scale.y.max ?? Math.max(...values)
    // A flat panel still needs a domain with width, or every point lands on one line.
    return lowest === highest
      ? [lowest - 0.05, highest + 0.05]
      : [lowest, highest]
  }, [frame, sharedScale, visualization.scale.y.max, visualization.scale.y.min])

  if (panels.length === 0) return null

  return (
    <div className="flex h-full min-h-0 flex-col gap-1" ref={setNode}>
      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{
          /**
           * The panels that fit, not the panels that were asked for.
           *
           * `facetColumns` was written for exactly this and then never called: the grid
           * used the configured number at every width, so a four-panel card on a phone
           * drew four columns of about seventy pixels each — four smears with labels.
           * Before the first measurement the configured number stands, which is what the
           * card was saved as and reads correctly at the width it was saved at.
           */
          gridTemplateColumns: `repeat(${
            width === null ? Math.max(1, columns) : facetColumns(columns, width)
          }, minmax(0, 1fr))`,
        }}
      >
        {panels.map((panel) => (
          <figure key={panel.key} className="flex min-h-0 flex-col gap-0.5">
            {/* The panel's own name, and the only thing distinguishing it — so it wraps
                to two lines rather than truncating a subject to "Mathém…". */}
            <figcaption
              className={cn(
                FOOTNOTE_TEXT,
                "line-clamp-2 leading-tight break-words text-muted-foreground"
              )}
            >
              {panel.label}
            </figcaption>
            <div className="min-h-0 flex-1">{renderPanel(panel, domain)}</div>
          </figure>
        ))}
      </div>
      {hidden > 0 ? (
        <p className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
          {moreLabel(hidden)}
        </p>
      ) : null}
    </div>
  )
}
