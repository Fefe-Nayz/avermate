import type { CardGridCell } from "@avermate/core"

/**
 * Drawing the arrangement a drop will produce, while the card is still moving.
 *
 * A sortable previews a reorder by permuting the rectangles it measured — every
 * card slides into the box another card vacated:
 *
 *     const newRects = arrayMove(rects, overIndex, activeIndex)
 *     return { x: newRects[index].left - rects[index].left, ... }
 *
 * That is only a reorder if every box is interchangeable. Ours are not: cards
 * span one to four columns and the grid *repacks*, so changing the order changes
 * which cards share a row and how tall those rows are. The boxes in the new
 * arrangement are not a permutation of the old ones, and sliding cards into
 * boxes that no longer exist is what put them on top of each other — a
 * full-width card dragged below a pair produced a preview nothing could be
 * dropped into, while the drop itself was correct. The two disagreed, and the
 * one on screen was the wrong one.
 *
 * So the preview is computed the way the grid computes: work out the cells of
 * the resolved order, turn them into pixels with the grid's own track sizes, and
 * translate each card from where it is to where it will be. Cards keep moving
 * under the finger, and where they move to is the arrangement that lands.
 *
 * One approximation, deliberately: a row is as tall as its tallest card, and a
 * card's height is taken as measured. Grid items stretch, so a short card
 * sharing a row with a tall one measures tall, and a move that changes which
 * card is a row's tallest can leave the preview a few pixels out vertically.
 * Measuring natural heights would mean laying the grid out twice on every
 * pointer move. The drop stays exact either way.
 */

export interface PreviewRect {
  left: number
  top: number
  width: number
  height: number
}

export interface GridTracks {
  /** Used width of each column, in order — its length is the column count. */
  columnWidths: number[]
  columnGap: number
  rowGap: number
}

/**
 * The grid's resolved track sizes.
 *
 * Read from the element rather than recomputed from breakpoints, for the same
 * reason `renderedColumns` is: the three grid steps are container queries, so
 * only the container knows how wide a column ended up.
 */
export function readGridTracks(grid: HTMLElement | null): GridTracks | null {
  if (!grid) return null
  const style = getComputedStyle(grid)
  const tracks = style.gridTemplateColumns.trim()
  if (!tracks || tracks === "none") return null
  const columnWidths = tracks
    .split(/\s+/)
    .map((track) => Number.parseFloat(track))
  if (columnWidths.length === 0) return null
  if (columnWidths.some((width) => !Number.isFinite(width))) return null
  return {
    columnWidths,
    columnGap: Number.parseFloat(style.columnGap) || 0,
    rowGap: Number.parseFloat(style.rowGap) || 0,
  }
}

/**
 * How far each card has to move to draw `cells`, keyed by card id.
 *
 * `rects` is the snapshot the drag was measured against, in `ids` order. Both
 * the current and the target position are derived from it — the grid's left edge
 * is taken as the leftmost card rather than read off the element — so the answer
 * cannot be skewed by the page scrolling mid-drag. Only the track sizes come
 * from the element, and those do not move.
 */
export function gridPreviewTransforms(input: {
  ids: readonly string[]
  rects: readonly (PreviewRect | null | undefined)[]
  cells: ReadonlyMap<string, CardGridCell>
  tracks: GridTracks
}): Map<string, { x: number; y: number }> {
  const { ids, rects, cells, tracks } = input
  const deltas = new Map<string, { x: number; y: number }>()

  const placed: { id: string; rect: PreviewRect; cell: CardGridCell }[] = []
  for (const [index, id] of ids.entries()) {
    const rect = rects[index]
    const cell = cells.get(id)
    if (rect && cell) placed.push({ id, rect, cell })
  }
  if (placed.length === 0) return deltas

  const columnOffsets: number[] = []
  let x = Math.min(...placed.map((item) => item.rect.left))
  for (const width of tracks.columnWidths) {
    columnOffsets.push(x)
    x += width + tracks.columnGap
  }

  const rowHeights = new Map<number, number>()
  for (const { cell, rect } of placed) {
    const tallest = rowHeights.get(cell.rowIndex) ?? 0
    rowHeights.set(cell.rowIndex, Math.max(tallest, rect.height))
  }

  const rowTops = new Map<number, number>()
  let y = Math.min(...placed.map((item) => item.rect.top))
  for (const rowIndex of [...rowHeights.keys()].sort((a, b) => a - b)) {
    rowTops.set(rowIndex, y)
    y += (rowHeights.get(rowIndex) ?? 0) + tracks.rowGap
  }

  for (const { id, cell, rect } of placed) {
    const left = columnOffsets[cell.columnStart] ?? rect.left
    const top = rowTops.get(cell.rowIndex) ?? rect.top
    deltas.set(id, { x: left - rect.left, y: top - rect.top })
  }
  return deltas
}
