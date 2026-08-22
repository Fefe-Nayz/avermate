import { describe, expect, test } from "bun:test"
import {
  CARD_LIST_CARD_PADDING,
  CARD_LIST_COLUMN_QUERIES,
  CARD_LIST_MAX_CELL_LIMIT,
  THREE_COLUMN_WIDTH,
  TWO_COLUMN_WIDTH,
  cardListCellLimit,
  cardListColumns,
  limitCardList,
} from "./card-list"

describe("dashboard card lists", () => {
  test("shows a short ranking in full", () => {
    expect(limitCardList([1, 2, 3])).toEqual({
      visible: [1, 2, 3],
      remaining: 0,
    })
  })

  test("bounds a long ranking and reserves one cell for its overflow link", () => {
    const result = limitCardList(
      Array.from({ length: 20 }, (_, index) => index),
      6
    )

    expect(result.visible).toHaveLength(5)
    expect(result.remaining).toBe(15)
    expect(result.visible.length + 1).toBe(6)
  })

  test("derives capacity from the allocated card viewport", () => {
    expect(cardListColumns(320)).toBe(1)
    expect(cardListColumns(480)).toBe(2)
    expect(cardListColumns(800)).toBe(3)

    expect(cardListCellLimit({ width: 320, height: 104 })).toBe(3)
    expect(cardListCellLimit({ width: 480, height: 104 })).toBe(6)
    expect(cardListCellLimit({ width: 800, height: 180 })).toBe(
      CARD_LIST_MAX_CELL_LIMIT
    )
  })

  /**
   * The column count is decided in CSS so the first paint is right, and again
   * here so the cell count knows how wide a row is. Two ladders, one behaviour:
   * if they ever disagree, a card renders three columns of cells into two
   * columns of grid.
   */
  test("asks CSS for the same columns the measurement would compute", () => {
    const steps = [...CARD_LIST_COLUMN_QUERIES.matchAll(/@\[(\d+)rem\]/g)].map(
      (match) => Number(match[1]) * 16
    )

    expect(steps).toEqual([
      TWO_COLUMN_WIDTH + CARD_LIST_CARD_PADDING,
      THREE_COLUMN_WIDTH + CARD_LIST_CARD_PADDING,
    ])
    // Each query names the column count it turns on, in order.
    expect(CARD_LIST_COLUMN_QUERIES).toContain("grid-cols-1")
    expect(CARD_LIST_COLUMN_QUERIES).toContain("@[26rem]/card:grid-cols-2")
    expect(CARD_LIST_COLUMN_QUERIES).toContain("@[44rem]/card:grid-cols-3")
  })

  /**
   * Before it is measured, a card shows what a card of its shape is guaranteed
   * to hold — five rows in one column — and nothing more. The old budget of
   * three cells made a ten-subject card open as "two subjects, +8 more" and then
   * rearrange itself; rendering everything instead overflowed a narrow card by
   * 344px and clipped a row in half. Short is the only answer that is never
   * wrong, because revealing a row is the one correction that costs nothing.
   */
  test("shows only what any card is sure to hold before measuring", () => {
    const subjects = Array.from({ length: 10 }, (_, index) => index)
    const guaranteed = limitCardList(subjects, 5)

    expect(guaranteed.visible).toHaveLength(4)
    expect(guaranteed.remaining).toBe(6)
    // And once measured, the count is exact rather than cautious.
    expect(
      limitCardList(subjects, cardListCellLimit({ width: 480, height: 176 }))
    ).toEqual({ visible: subjects, remaining: 0 })
  })
})
