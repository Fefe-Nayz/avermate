export const CARD_LIST_FALLBACK_CELL_LIMIT = 3
export const CARD_LIST_MAX_CELL_LIMIT = 12

const CARD_LIST_ROW_HEIGHT = 32
const CARD_LIST_ROW_GAP = 4
const TWO_COLUMN_WIDTH = 384
const THREE_COLUMN_WIDTH = 672

export interface CardListViewport {
  width: number
  height: number
}

export function cardListColumns(width: number): 1 | 2 | 3 {
  if (width >= THREE_COLUMN_WIDTH) return 3
  if (width >= TWO_COLUMN_WIDTH) return 2
  return 1
}

/**
 * Number of cells that fit in the space the grid row already gave the card.
 * The list never asks the outer grid for more height; a taller neighbour only
 * lets it reveal more entries.
 */
export function cardListCellLimit({ width, height }: CardListViewport): number {
  if (width <= 0 || height <= 0) return CARD_LIST_FALLBACK_CELL_LIMIT

  const rows = Math.max(
    1,
    Math.floor(
      (height + CARD_LIST_ROW_GAP) / (CARD_LIST_ROW_HEIGHT + CARD_LIST_ROW_GAP)
    )
  )
  return Math.min(
    CARD_LIST_MAX_CELL_LIMIT,
    Math.max(2, rows * cardListColumns(width))
  )
}

/** Keep list cards finite, reserving the final cell for the overflow link. */
export function limitCardList<T>(
  items: readonly T[],
  cellLimit = CARD_LIST_FALLBACK_CELL_LIMIT
): {
  visible: readonly T[]
  remaining: number
} {
  const boundedLimit = Math.max(2, Math.floor(cellLimit))
  const visibleCount =
    items.length > boundedLimit ? boundedLimit - 1 : boundedLimit
  const visible = items.slice(0, visibleCount)
  return { visible, remaining: items.length - visible.length }
}
