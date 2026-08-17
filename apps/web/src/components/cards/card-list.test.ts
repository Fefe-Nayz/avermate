import { describe, expect, test } from "bun:test"
import {
  CARD_LIST_FALLBACK_CELL_LIMIT,
  CARD_LIST_MAX_CELL_LIMIT,
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

  test("uses a compact SSR budget without depending on label length", () => {
    expect(cardListCellLimit({ width: 0, height: 0 })).toBe(
      CARD_LIST_FALLBACK_CELL_LIMIT
    )

    const labels = [
      "Maths",
      "A subject name made deliberately long enough to exceed a narrow card",
      "Another subject",
      "Physics",
    ]
    const result = limitCardList(labels)
    expect(result.visible).toEqual(labels.slice(0, 2))
    expect(result.remaining).toBe(2)
  })
})
