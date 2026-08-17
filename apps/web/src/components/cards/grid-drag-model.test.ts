import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  captureGridSlots,
  nearestGridSlot,
  overlayGrabShift,
  sameCardOrder,
  type GridSlot,
} from "./grid-drag-model"

const slot = (
  id: string,
  left: number,
  top: number,
  width: number,
  height: number
): GridSlot => ({ id, left, top, width, height })

/** The dashboard in the recording: four small cards over a pair of wide ones. */
const GRID: GridSlot[] = [
  slot("latest", 0, 0, 140, 120),
  slot("weakest", 152, 0, 140, 120),
  slot("strongest", 304, 0, 140, 120),
  slot("pass", 456, 0, 140, 120),
  slot("ranking", 0, 132, 292, 200),
  slot("average", 304, 132, 292, 200),
]

const ORIGIN = { left: 40, top: 200 }
const at = (x: number, y: number) => ({
  x: x + ORIGIN.left,
  y: y + ORIGIN.top,
})

describe("aiming a drag", () => {
  test("takes the card the pointer is inside", () => {
    expect(nearestGridSlot(GRID, at(320, 20), ORIGIN)?.id).toBe("strongest")
    expect(nearestGridSlot(GRID, at(500, 250), ORIGIN)?.id).toBe("average")
  })

  test("takes the nearest card for a pointer in the gutter", () => {
    // The slots tile the grid, but the 12px gaps between them belong to nobody.
    // Nearest *centre* there, so the two cards divide the gutter at the midpoint
    // between their centres rather than at their facing edges.
    expect(nearestGridSlot(GRID, at(144, 60), ORIGIN)?.id).toBe("latest")
    expect(nearestGridSlot(GRID, at(148, 60), ORIGIN)?.id).toBe("weakest")
  })

  test("reads the pointer, not the centre of the card being dragged", () => {
    // This is what made the target flip early. `closestCenter` compares the
    // centre of the *dragged card's* rectangle, and the handle is at that card's
    // top-right corner — 146px away on a card this wide. A pointer just inside
    // the top row means the top row, whatever the dragged card's centre is doing.
    expect(nearestGridSlot(GRID, at(310, 110), ORIGIN)?.id).toBe("strongest")
  })

  test("survives the page scrolling under the drag", () => {
    // Slots are stored relative to the grid and the caller passes the grid's
    // live box back in, so a point at the same place *in the grid* resolves to
    // the same card however far the page has scrolled since. Storing viewport
    // rectangles instead would silently retarget every slot mid-drag.
    const inStrongest = { x: 304, y: 32 }
    const scrolled = { left: ORIGIN.left, top: ORIGIN.top - 300 }

    for (const origin of [ORIGIN, scrolled]) {
      const point = {
        x: inStrongest.x + origin.left,
        y: inStrongest.y + origin.top,
      }
      expect(nearestGridSlot(GRID, point, origin)?.id).toBe("strongest")
    }
  })

  test("answers for a pointer dragged clear of the grid", () => {
    expect(nearestGridSlot(GRID, at(-400, -400), ORIGIN)?.id).toBe("latest")
    expect(nearestGridSlot(GRID, at(900, 900), ORIGIN)?.id).toBe("average")
    expect(nearestGridSlot([], at(0, 0), ORIGIN)).toBeNull()
  })
})

describe("capturing the slots", () => {
  test("records every card relative to the grid, not to the viewport", () => {
    const rect = (
      left: number,
      top: number,
      width: number,
      height: number
    ) => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => "",
    })
    const node = (id: string, left: number, top: number) => ({
      dataset: { cardId: id },
      getBoundingClientRect: () => rect(left, top, 140, 120),
    })
    const grid = {
      getBoundingClientRect: () => rect(40, 200, 600, 340),
      querySelectorAll: () => [node("a", 40, 200), node("b", 192, 200)],
    }

    // SAFETY: `captureGridSlots` reads exactly the three members stubbed above.
    // A real element is a browser away from `bun test`, and the arithmetic —
    // which is the whole of this function — is what needs pinning down.
    const slots = captureGridSlots(grid as unknown as HTMLElement)

    expect(slots).toEqual([
      { id: "a", left: 0, top: 0, width: 140, height: 120 },
      { id: "b", left: 152, top: 0, width: 140, height: 120 },
    ])
  })

  test("has nothing to say about a grid that is not there", () => {
    expect(captureGridSlots(null)).toEqual([])
  })
})

describe("holding the handle under the finger", () => {
  test("nudges the overlay when the card narrows", () => {
    // A card gripped near its right edge that halves in width would lose that
    // width off the same edge, sliding the handle out from under the finger.
    const shift = overlayGrabShift(
      { x: 280, y: 20 },
      { width: 292, height: 200 },
      { width: 140, height: 200 }
    )

    expect(shift.x).toBeCloseTo(280 * (1 - 140 / 292), 5)
    expect(shift.x).toBeGreaterThan(0)
    expect(shift.y).toBe(0)
  })

  test("pulls it the other way when the card widens", () => {
    const shift = overlayGrabShift(
      { x: 130, y: 20 },
      { width: 140, height: 200 },
      { width: 292, height: 200 }
    )

    expect(shift.x).toBeLessThan(0)
  })

  test("leaves a card that keeps its size alone", () => {
    const box = { width: 140, height: 120 }
    expect(overlayGrabShift({ x: 130, y: 20 }, box, box)).toEqual({
      x: 0,
      y: 0,
    })
  })
})

describe("sameCardOrder", () => {
  test("is true only for the same sequence", () => {
    expect(sameCardOrder(["a", "b"], ["a", "b"])).toBe(true)
    expect(sameCardOrder(["a", "b"], ["b", "a"])).toBe(false)
    expect(sameCardOrder(["a"], ["a", "b"])).toBe(false)
    expect(sameCardOrder(null, ["a"])).toBe(false)
  })
})

/**
 * The grid's own shape, read as source.
 *
 * These are the invariants the recording was a symptom of breaking, and none of
 * them can be checked without a browser — so they are checked as structure
 * instead. A unit test over synthetic rectangles cannot prove that CSS grid,
 * container queries and text wrapping agree with a prediction; the way to be sure
 * of that is to stop predicting, which is what these assert.
 */
describe("the dashboard grid draws the arrangement it will save", () => {
  const grid = readFileSync(new URL("./card-grid.tsx", import.meta.url), "utf8")

  test("renders the candidate order rather than translating cards into it", () => {
    // The old preview moved the measured rectangles into the target cells. That
    // gets position right and size wrong, and size is not cosmetic here: a card
    // narrowed from two columns to one has to *re-lay out* its contents, which a
    // translation cannot do and a scale would distort.
    expect(grid).toContain("previewIds ?? pendingIds")
    expect(grid).not.toContain("CSS.Translate")
    expect(grid).not.toContain("@dnd-kit/utilities")
    expect(grid).not.toContain("gridPreviewTransforms")
    // Size is never animated, only position — see the comment at the wrapper.
    expect(grid).toContain('layout={animateLayout ? "position" : false}')
  })

  test("leaves dnd-kit no second layout to draw", () => {
    expect(grid).toContain("const staticStrategy: SortingStrategy = () => null")
    expect(grid).toContain("strategy={staticStrategy}")
  })

  test("separates the card under the pointer from the cell it will land in", () => {
    // With no overlay, dnd-kit gives the dragged card the raw pointer
    // displacement and asks the strategy only about the others — so the dragged
    // card floated over its destination instead of marking it.
    expect(grid).toContain("<DragOverlay")
    expect(grid).toContain('dragging && "invisible"')
  })

  test("resolves every target against the arrangement the drag started from", () => {
    // Resolving against what is displayed feeds the resolver its own output, and
    // that is the oscillation the previous fix froze the whole preview to avoid.
    // Only the *decision* has to be frozen.
    for (const call of grid.matchAll(/planGridReorder\(\s*([A-Za-z.]+)/g)) {
      expect(call[1]).toBe("active.specs")
    }
    expect(grid).toContain("active.specs")
  })

  test("saves what was last drawn instead of resolving a new order", () => {
    expect(grid).toContain("const next = previewRef.current")
    expect(grid).toContain("reorder.mutate({ cardIds: next })")
    expect(grid).not.toContain("resolveGridReorder")
  })
})
