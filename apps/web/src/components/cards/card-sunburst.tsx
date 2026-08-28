"use client"

import { useMemo } from "react"
import { polar } from "@tanstack/charts/polar"
import { sunburst } from "@tanstack/charts/hierarchy/sunburst"
import { tooltip } from "@tanstack/charts/tooltip"
import { useFormatter, useExtracted } from "next-intl"
import type { HierarchyNode } from "@avermate/core"
import { AVERAGE_SERIES_COLORS } from "@/components/charts/multi-series-average-chart"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"
import {
  labelledTreemapTiles,
  TREEMAP_ROOT,
  type TreemapTile,
} from "./card-treemap"

/**
 * Where the average comes from, as concentric rings.
 *
 * The treemap's question read by *level* instead of by area. A ring is a depth, so
 * "categories, then the subjects inside them" is two rings rather than a nesting the
 * reader infers from borders — which is the one thing a treemap is genuinely bad at once
 * the tree is more than two deep.
 *
 * It shares the treemap's rows on purpose: `treemapTiles` inserts the synthetic root,
 * leaves branches valueless so the mark sums them from their children, and rolls a
 * subtree up into its last drawn node. Any drift between the two drawings would be a
 * drift in what the app claims a subject's weight *is*, so there is one builder.
 *
 * No labels on the rings. The mark has none, and a name written along an arc of eleven
 * degrees is a smear — so the names are in the tooltip and the innermost ring carries the
 * colour that identifies the branch.
 */

export function CardSunburst({
  nodes,
  depth,
  ringPadding,
  ownMarksLabel,
  ariaLabel,
}: {
  nodes: readonly HierarchyNode[]
  depth: number
  ringPadding: number
  /** What to call a subject's own results, shown beside its sub-subjects. */
  ownMarksLabel: (subject: string) => string
  ariaLabel: string
}) {
  const t = useExtracted()
  const format = useFormatter()

  const tiles = useMemo(
    () => labelledTreemapTiles(nodes, depth, ownMarksLabel),
    [depth, nodes, ownMarksLabel]
  )

  /** Every branch and its share, as a sentence — the ring says nothing out loud. */
  const spoken = useMemo(
    () =>
      tiles
        .filter((tile) => tile.id !== TREEMAP_ROOT)
        .map(
          (tile) =>
            `${tile.label}: ${format.number(tile.displayValue, {
              style: "percent",
              maximumFractionDigits: 1,
            })}`
        )
        .join(", "),
    [format, tiles]
  )

  const definition = useMemo(() => {
    const branches = [...new Set(tiles.map((tile) => tile.branch))]
    const colour = (branch: string) =>
      AVERAGE_SERIES_COLORS[
        branches.indexOf(branch) % AVERAGE_SERIES_COLORS.length
      ] ?? "var(--chart-1)"

    return {
      marks: [
        polar({
          id: "card-sunburst-polar",
          scales: { angle: null, radius: null },
          marks: [
            sunburst(tiles, {
              id: "card-sunburst",
              nodeId: "id",
              parentId: "parentId",
              value: "value",
              // The synthetic root is the *container*, not a ring: its children are the
              // first thing drawn, or the middle of the card would be one flat disc
              // meaning "everything".
              rootId: TREEMAP_ROOT,
              visibleDepth: Math.max(1, depth),
              ringPadding,
              fill: (node: { data: TreemapTile | null }) =>
                colour(node.data?.branch ?? ""),
              // Depth as lightness: an outer ring is a part of the ring inside it, and
              // drawing both at full strength loses which contains which.
              fillOpacity: 0.85,
              stroke: "var(--card)",
              strokeWidth: 1,
            }),
          ],
        }),
      ],
      scales: { x: null, y: null },
      guides: false,
      margin: 0,
      focus: "nearest",
      focusRing: true,
      keyboard: true,
      tooltip: {
        use: tooltip,
        placement: ["top", "bottom", "left", "right"],
        content: (
          focused: Array<{ datum?: { data?: TreemapTile | null } }>
        ) => {
          const tile = focused[0]?.datum?.data
          return {
            title: tile?.label ?? "",
            rows: tile
              ? [
                  {
                    color: colour(tile.branch),
                    // A share of the average, which is what the angle is.
                    label: t("Weight"),
                    value: format.number(tile.displayValue, {
                      style: "percent",
                      maximumFractionDigits: 1,
                    }),
                  },
                  ...(tile.branchLabel === tile.label
                    ? []
                    : [
                        {
                          color: "var(--muted-foreground)",
                          label: t("In"),
                          value: tile.branchLabel,
                        },
                      ]),
                ]
              : [],
          }
        },
      },
    }
  }, [depth, format, ringPadding, t, tiles])

  if (tiles.length <= 1) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("Not enough data yet")}
      </p>
    )
  }

  return (
    <figure
      className="h-full min-h-0 text-muted-foreground"
      aria-label={ariaLabel}
    >
      {/* The reading in words: an angle and a colour say nothing out loud. */}
      <figcaption className="sr-only">{spoken}</figcaption>
      <ResponsiveChart
        ariaLabel={ariaLabel}
        // The cast the treemap makes for the same reason: a hierarchy mark owns its own
        // pixels and leaves the reserved scales empty, so the definition cannot be inferred statically.
        definition={definition as never}
        fill
        height={220}
        initialWidth={240}
        updateTransition={INSTANT_CHART_UPDATES}
      />
    </figure>
  )
}
