"use client"

import { useMemo } from "react"
import { treemap } from "@tanstack/charts/hierarchy/treemap"
import { tooltip } from "@tanstack/charts/tooltip"
import { useFormatter, useExtracted } from "next-intl"
import type { HierarchyNode } from "@avermate/core"
import { AVERAGE_SERIES_COLORS } from "@/components/charts/multi-series-average-chart"
import {
  INSTANT_CHART_UPDATES,
  ResponsiveChart,
} from "@/components/charts/responsive-chart"

/**
 * Where the average comes from, as nested area.
 *
 * The one drawing that answers *which branch* carries the average — a ranking of
 * subjects cannot, because the branch is not one of the rows. Area is a share here
 * and not a coincidence: `weightHierarchy` guarantees that the leaves sum to the
 * whole and that a branch is exactly the sum of its children, so two cells of equal
 * size really do carry equal weight.
 *
 * The colour is the branch, not the leaf. A treemap coloured per leaf is a mosaic
 * that says nothing; coloured by the top-level ancestor, the category *is* the
 * block, which is the reading the card exists for.
 */

/** A row the mark lays out. A branch carries no value: it is the sum of its rows. */
export interface TreemapTile {
  id: string
  parentId: string | null
  label: string
  /** `null` on a branch, so the mark aggregates it from its children. */
  value: number | null
  /** The real aggregate shown to people, including on structural branches. */
  displayValue: number
  /** Top-level ancestor, which is what the colour encodes. */
  branch: string
  branchLabel: string
}

/**
 * Every node the drawing shows, branches included.
 *
 * The mark builds its hierarchy from the rows it is given, so a leaf whose
 * `parentId` names a row that is not there is a hard error — measured: `treemap:
 * missing: sci`. Branches are therefore rows too, with **no value of their own**, so
 * the mark sums them from their children and a nested subject cannot be counted
 * twice. That is the same rule `weightHierarchy` follows, kept here rather than
 * re-derived.
 *
 * `depth` bounds what is drawn. A node at the last drawn level becomes a leaf
 * carrying its whole subtree's weight — which it already holds, since a branch is
 * the sum of its children — so cutting the tree short changes what is *named*, never
 * what the areas add up to.
 */
export function treemapTiles(
  nodes: readonly HierarchyNode[],
  depth: number
): TreemapTile[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const topOf = (node: HierarchyNode): HierarchyNode => {
    let current = node
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent) break
      current = parent
    }
    return current
  }

  const drawn = nodes
    .filter((node) => node.depth < depth)
    .map((node) => {
      const top = topOf(node)
      // A leaf, or the last level drawn: either way nothing hangs below it here, so
      // it carries its own total.
      const drawnLeaf = node.leaf || node.depth === depth - 1
      return {
        id: node.id,
        // Re-parented to the single root below.
        parentId: node.parentId ?? TREEMAP_ROOT,
        label: node.label,
        value: drawnLeaf ? node.value : null,
        // Kept separately from the mark's value. Passing this aggregate to the mark on a
        // branch would count the branch and its children twice, but hiding it from the
        // tooltip made a visibly large branch read as if it had no weight at all.
        displayValue: node.value,
        branch: top.id,
        branchLabel: top.label,
      }
    })
  if (drawn.length === 0) return []
  const rootValue = drawn
    .filter((tile) => tile.parentId === TREEMAP_ROOT)
    .reduce((sum, tile) => sum + tile.displayValue, 0)
  // One root, because the mark insists on one — measured: `treemap: multiple roots`.
  // A year has several top-level subjects, so the root is synthetic: no value of its
  // own, so it sums to the whole, and never drawn as a rectangle of its own.
  return [
    {
      id: TREEMAP_ROOT,
      parentId: null,
      label: "",
      value: null,
      displayValue: rootValue,
      branch: TREEMAP_ROOT,
      branchLabel: "",
    },
    ...drawn,
  ]
}

/**
 * The same tiles, with own-marks branches renamed.
 *
 * Both drawings needed this and both wrote it the same way: a `nodes.find` per
 * tile, which re-reads the whole hierarchy once for every rectangle drawn. The
 * kinds are a lookup, so they are read once, here.
 */
export function labelledTreemapTiles(
  nodes: readonly HierarchyNode[],
  depth: number,
  ownMarksLabel: (subject: string) => string
): TreemapTile[] {
  const kindById = new Map(nodes.map((node) => [node.id, node.kind]))
  return treemapTiles(nodes, depth).map((tile) =>
    kindById.get(tile.id) === "own-marks"
      ? { ...tile, label: ownMarksLabel(tile.label) }
      : tile
  )
}

/** Id of the synthetic root every top-level subject hangs from. */
export const TREEMAP_ROOT = "__year__"

export function CardTreemap({
  nodes,
  depth,
  showLabels,
  ownMarksLabel,
  ariaLabel,
}: {
  nodes: readonly HierarchyNode[]
  depth: number
  showLabels: boolean
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

  /** Every branch and its share, as a sentence. */
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
        treemap(tiles, {
          id: "card-treemap",
          nodeId: "id",
          parentId: "parentId",
          value: "value",
          round: true,
          paddingInner: 2,
          radius: 3,
          // Read from the row rather than from the node: a rolled-up tile knows
          // its branch, and the mark's own ancestor chain stops at the rows given.
          fill: (node: { data: TreemapTile | null }) =>
            colour(node.data?.branch ?? ""),
          stroke: "var(--card)",
          strokeWidth: 1,
          ...(showLabels
            ? {
                label: (node: { data: TreemapTile | null }) =>
                  node.data?.label ?? "",
                labelFill: "var(--card)",
                labelFontSize: 11,
                labelFontWeight: 500,
              }
            : {}),
        }),
      ],
      // The hierarchy mark owns its pixels; the reserved Cartesian scales stay empty.
      scales: { x: null, y: null },
      guides: false,
      margin: 0,
      focus: "nearest",
      // The tooltip is part of the reading, so the chart stays in the tab order and the
      // hierarchy can be walked with the same arrow-key focus TanStack gives the pointer.
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
                    // A share of the average, which is what the area is.
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
  }, [format, showLabels, t, tiles])

  if (tiles.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("Not enough data yet")}
      </p>
    )
  }

  return (
    // Area needs both dimensions, so the treemap takes the whole body and reads
    // best near square — which its layout policy asks the grid for.
    <figure className="h-full min-h-32" aria-label={ariaLabel}>
      {/* The same reading in words, as the density rows and the waffle carry.
          A tree is drawn in area and colour and nothing else, so without this the
          card is a shape with a label and no content anybody can hear. */}
      <figcaption className="sr-only">{spoken}</figcaption>
      <ResponsiveChart
        ariaLabel={ariaLabel}
        definition={treemapChart(definition)}
        fill
        height={160}
        initialWidth={260}
        updateTransition={INSTANT_CHART_UPDATES}
      />
    </figure>
  )
}

/**
 * The config, cast rather than inferred — the same trick, and for the same reason,
 * as `dynamicChart` in `widget-view`: the label channels are present or absent
 * depending on an option, and a treemap leaves the reserved Cartesian scales
 * empty, so the generics cannot be resolved statically.
 */
function treemapChart(definition: unknown) {
  return definition as Parameters<typeof ResponsiveChart>[0]["definition"]
}
