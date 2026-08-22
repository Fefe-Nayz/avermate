export const CARD_LIST_MAX_CELL_LIMIT = 12

/**
 * Column counts as CSS, so the first paint is already right.
 *
 * There is no measurement before the first paint, and the list used to answer
 * that with a guess: one column and three cells. A ten-subject ranking on a
 * half-desktop card therefore opened as "two subjects, +8 more" in a single
 * column, and rearranged itself into two columns of five the moment the layout
 * effect ran — the whole card visibly reflowing on every reload.
 *
 * A guess was never needed. The card is a query container, so the columns can be
 * asked for in CSS at the same widths the measurement uses, and the cells the
 * height allows are simply the ones that fit inside a clipped box. Only the
 * "+N more" count genuinely needs measuring, and it is the one thing that can
 * appear a moment later without the card moving.
 */
export const CARD_LIST_COLUMN_QUERIES =
  "grid-cols-1 @[26rem]/card:grid-cols-2 @[44rem]/card:grid-cols-3"

const CARD_LIST_ROW_HEIGHT = 32
const CARD_LIST_ROW_GAP = 4
export const TWO_COLUMN_WIDTH = 384
export const THREE_COLUMN_WIDTH = 672

/**
 * The card's own horizontal padding, `px-4` on each side.
 *
 * The column count is decided twice, and has to come out the same both times: in
 * CSS, so the first paint is already in the right number of columns, and here,
 * so the cell count knows how many cells a row holds. The CSS asks
 * `@container/card`, which measures the card — padding included — and the
 * measurement below reads the content box. This is the difference between them,
 * and `card-list.test.ts` checks the two ladders line up through it.
 */
export const CARD_LIST_CARD_PADDING = 32

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
  if (width <= 0 || height <= 0) return CARD_LIST_MAX_CELL_LIMIT

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
  cellLimit = CARD_LIST_MAX_CELL_LIMIT
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
