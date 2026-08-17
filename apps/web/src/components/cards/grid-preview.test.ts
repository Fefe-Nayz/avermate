import { describe, expect, test } from "bun:test"
import { cardGridCells, planGridReorder, type CardSpec } from "@avermate/core"
import { gridPreviewTransforms, type PreviewRect } from "./grid-preview"

function card(
  id: string,
  span: CardSpec["span"],
  display: CardSpec["display"]
): CardSpec {
  return {
    id,
    metric: "average",
    target: { kind: "general", referenceId: null },
    display,
    span,
    title: id,
    accent: null,
    goalId: null,
    sortOrder: 0,
    hidden: false,
  }
}

/** Full span: the whole row on two columns. */
const wide = (id: string) => card(id, 4, "sparkline")
/** Half span: one column on two. */
const small = (id: string) => card(id, 2, "value")

const tracks = { columnWidths: [100, 100], columnGap: 10, rowGap: 10 }

/**
 * The arrangement in the report: a full-width card above a pair of small ones.
 *
 *     M M      (0, 0)   210 × 200
 *     A B      (0, 210) and (110, 210), 100 × 100
 */
const ids = ["M", "A", "B"]
const specs = [wide("M"), small("A"), small("B")]
const rects: PreviewRect[] = [
  { left: 0, top: 0, width: 210, height: 200 },
  { left: 0, top: 210, width: 100, height: 100 },
  { left: 110, top: 210, width: 100, height: 100 },
]

const reordered = (order: readonly string[]) => {
  const byId = new Map(specs.map((spec) => [spec.id, spec]))
  return order.flatMap((id) => {
    const spec = byId.get(id)
    return spec ? [spec] : []
  })
}

const preview = (order: readonly string[]) =>
  gridPreviewTransforms({
    ids,
    rects,
    cells: cardGridCells(reordered(order), tracks.columnWidths.length),
    tracks,
  })

describe("gridPreviewTransforms", () => {
  test("drops the wide card below the pair and lifts the pair whole", () => {
    const order = planGridReorder(specs, 2, "M", "A").order
    const deltas = preview(order)

    expect(order).toEqual(["A", "B", "M"])
    // The pair rises by the wide card's height plus the gap, keeping its row;
    // the wide card falls by the pair's height plus the gap. Neither small card
    // is widened into the other's place, which is what the drop also does.
    expect(deltas.get("A")).toEqual({ x: 0, y: -210 })
    expect(deltas.get("B")).toEqual({ x: 0, y: -210 })
    expect(deltas.get("M")).toEqual({ x: 0, y: 110 })
  })

  test("never puts two cards on top of each other", () => {
    // The failure that was on screen, stated as a property. A rect permutation
    // moves cards into boxes the new arrangement does not contain, so it cannot
    // hold this for a grid whose rows repack.
    const cells = cardGridCells(
      reordered(planGridReorder(specs, 2, "M", "A").order),
      2
    )
    const deltas = preview(planGridReorder(specs, 2, "M", "A").order)

    const boxes = rects.flatMap((rect, index) => {
      const id = ids[index]
      if (!id) return []
      const delta = deltas.get(id) ?? { x: 0, y: 0 }
      const span = cells.get(id)?.columnSpan ?? 1
      const column = tracks.columnWidths[0] ?? 0
      const width = span * column + (span - 1) * tracks.columnGap
      return {
        id,
        left: rect.left + delta.x,
        top: rect.top + delta.y,
        right: rect.left + delta.x + width,
        bottom: rect.top + delta.y + rect.height,
      }
    })

    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id === b.id) continue
        const overlaps =
          a.left < b.right &&
          b.left < a.right &&
          a.top < b.bottom &&
          b.top < a.bottom
        expect(overlaps).toBe(false)
      }
    }
  })

  test("predicts what the browser's own grid does", () => {
    // Measured, not derived. The same three cards laid out by Chrome at 600px in
    // `grid grid-cols-2 gap-3` — tracks `294px 294px`, both gaps `12px` — first
    // as `[M, A, B]` and then as `[A, B, M]`, each normalised to its own first
    // row. Whatever else this function is, it has to agree with this.
    const measured = { columnWidths: [294, 294], columnGap: 12, rowGap: 12 }
    const before: PreviewRect[] = [
      { left: 0, top: 0, width: 600, height: 200 },
      { left: 0, top: 212, width: 294, height: 100 },
      { left: 306, top: 212, width: 294, height: 100 },
    ]
    const after = { A: { top: 0 }, B: { top: 0 }, M: { top: 112 } }

    const deltas = gridPreviewTransforms({
      ids,
      rects: before,
      cells: cardGridCells(reordered(["A", "B", "M"]), 2),
      tracks: measured,
    })

    expect(deltas.get("A")).toEqual({ x: 0, y: after.A.top - 212 })
    expect(deltas.get("B")).toEqual({ x: 0, y: after.B.top - 212 })
    expect(deltas.get("M")).toEqual({ x: 0, y: after.M.top - 0 })
  })

  test("holds every card still when the order does not change", () => {
    const deltas = preview(ids)

    expect([...deltas.values()]).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ])
  })

  test("leaves a card alone when the plan has no cell for it", () => {
    const deltas = gridPreviewTransforms({
      ids,
      rects,
      cells: cardGridCells(reordered(["A", "B"]), 2),
      tracks,
    })

    // No answer for a card the plan does not mention, and the rest anchor on the
    // topmost card it does — so a plan that lags a refetch by one card moves
    // nothing rather than sliding the whole grid up into the gap.
    expect(deltas.has("M")).toBe(false)
    expect(deltas.get("A")).toEqual({ x: 0, y: 0 })
    expect(deltas.get("B")).toEqual({ x: 0, y: 0 })
  })

  test("answers nothing when the drag was never measured", () => {
    expect(
      gridPreviewTransforms({
        ids,
        rects: [null, null, null],
        cells: cardGridCells(specs, 2),
        tracks,
      }).size
    ).toBe(0)
  })
})
