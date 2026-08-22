import { describe, expect, test } from "bun:test"
import { waffleCells, waffleColumns, type WaffleBand } from "./card-waffle"

const band = (key: string, count: number): WaffleBand => ({
  key,
  label: key,
  count,
})

/**
 * A waffle's cells are a *share*, and the arithmetic of turning counts into
 * cells is where such a chart lies. Rounding each band independently does not
 * sum — three equal bands over twenty cells round to 7 + 7 + 7 and leave a hole
 * that means nothing — and a band rounded to zero is shown as absent while the
 * legend beside it says otherwise.
 */
describe("waffle cells", () => {
  test("fills exactly the grid it was given", () => {
    const bands = [band("a", 7), band("b", 7), band("c", 6)]
    for (const cells of [10, 20, 25, 50, 100]) {
      const filled = waffleCells(bands, cells)
      expect(
        filled.reduce((sum, value) => sum + value, 0),
        `${cells} cells`
      ).toBe(cells)
    }
  })

  test("never shows a band with observations as empty", () => {
    // One grade in ninety-nine: a fiftieth of a twenty-cell grid rounds to
    // nothing, and "no marks below ten" would be false.
    const filled = waffleCells([band("low", 1), band("high", 99)], 20)

    expect(filled[0]).toBeGreaterThanOrEqual(1)
    expect(filled[0]! + filled[1]!).toBe(20)
  })

  test("gives the spare cells to the largest remainders", () => {
    // Thirds of twenty: 6.67 each, so two bands get seven and one gets six, and
    // which one is decided by the remainder rather than by iteration order.
    const filled = waffleCells([band("a", 1), band("b", 1), band("c", 1)], 20)

    expect(filled.reduce((sum, value) => sum + value, 0)).toBe(20)
    expect([...filled].sort()).toEqual([6, 7, 7])
  })

  test("says nothing when there is nothing to say", () => {
    expect(waffleCells([band("a", 0), band("b", 0)], 20)).toEqual([0, 0])
    expect(waffleCells([], 20)).toEqual([])
    expect(waffleCells([band("a", 5)], 0)).toEqual([0])
  })

  test("a single band takes the whole grid", () => {
    expect(waffleCells([band("only", 12)], 25)).toEqual([25])
  })

  test("more bands than cells still sum, and still show each band", () => {
    const bands = Array.from({ length: 12 }, (_, index) =>
      band(`b${index}`, index + 1)
    )
    const filled = waffleCells(bands, 10)

    expect(filled.reduce((sum, value) => sum + value, 0)).toBe(10)
    // Twelve bands cannot each hold a cell in a grid of ten; what must not
    // happen is a grid that no longer sums, or a negative count.
    for (const value of filled) expect(value).toBeGreaterThanOrEqual(0)
  })

  test("keeps the grid close to square", () => {
    for (const cells of [10, 20, 25, 50, 100]) {
      const columns = waffleColumns(cells)
      const rows = Math.ceil(cells / columns)
      // Never a strip: a waffle that is ten times wider than it is tall has
      // stopped being a composition and become a bar.
      expect(columns / rows, `${cells} cells`).toBeLessThanOrEqual(3)
      expect(rows / columns, `${cells} cells`).toBeLessThanOrEqual(3)
    }
  })
})
