import { describe, expect, test } from "bun:test"
import { stripTicks } from "./card-strip"

/**
 * A strip is the marks themselves, so the only arithmetic in it is *which marks
 * are the same mark* — and that is where such a chart lies. Two roundings of one
 * result must share a column, two genuinely different results must not, and the
 * answer must not change between renders.
 */
describe("strip ticks", () => {
  test("stacks marks at the same value", () => {
    const ticks = stripTicks([0.7, 0.7, 0.7], 20)

    expect(ticks.map((tick) => tick.row)).toEqual([0, 1, 2])
    expect(new Set(ticks.map((tick) => tick.value)).size).toBe(1)
  })

  test("treats the same result written two ways as one value", () => {
    // 14/20 and 7/10 are the same mark, and a strip that put them in adjacent
    // columns would report a spread that does not exist.
    const ticks = stripTicks([14 / 20, 7 / 10], 20)

    expect(ticks.map((tick) => tick.row)).toEqual([0, 1])
  })

  test("keeps genuinely different marks apart", () => {
    // Half a point on a scale of twenty is the finest distinction a mark carries.
    const ticks = stripTicks([13.5 / 20, 14 / 20], 20)

    expect(ticks.map((tick) => tick.row)).toEqual([0, 0])
  })

  test("is stable under a re-render", () => {
    const values = [0.5, 0.9, 0.5, 0.72, 0.5]

    expect(stripTicks(values, 20)).toEqual(stripTicks(values, 20))
    // Deterministic, not jittered: a random offset moves between renders and turns
    // three tens into a smear that reads as "about ten-ish".
    expect(stripTicks(values, 20).map((tick) => tick.row)).toEqual([
      0, 0, 1, 0, 2,
    ])
  })

  test("drops what cannot be placed rather than placing it wrongly", () => {
    expect(stripTicks([Number.NaN, 0.4, Number.POSITIVE_INFINITY], 20)).toEqual(
      [{ key: "1:0.4", value: 0.4, row: 0 }]
    )
    expect(stripTicks([], 20)).toEqual([])
  })

  test("follows the year's own scale", () => {
    // On a scale of ten, half a point is twice as wide, so 13.5/20 and 14/20 — a
    // distinction that scale cannot express — meet.
    const twenty = stripTicks([13.5 / 20, 14 / 20], 20)
    const ten = stripTicks([13.5 / 20, 14 / 20], 10)

    expect(twenty.map((tick) => tick.row)).toEqual([0, 0])
    expect(ten.map((tick) => tick.row)).toEqual([0, 1])
  })
})
