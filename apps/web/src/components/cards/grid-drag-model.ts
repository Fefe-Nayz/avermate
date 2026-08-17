/**
 * The geometry a drag is *decided* against — deliberately not the geometry it is
 * drawn in.
 *
 * Two things were conflated before, and each fix for one broke the other:
 *
 * - **Deciding.** Which card the pointer is aiming at has to be answered against
 *   an arrangement that does not move, or the answer feeds itself. Repack the
 *   grid under the finger, ask dnd-kit again which card the pointer is over, and
 *   the new geometry resolves to a different order, which repacks again. On a
 *   uniform 2×2 the two answers alternated forever.
 * - **Drawing.** The preview has to be the arrangement the drop produces —
 *   including each card's *width*. Cards span one to four columns and the packer
 *   widens a card to close a row's hole, so changing the order changes how wide
 *   cards are, not just where they sit.
 *
 * The previous attempt froze both: it drew the preview by translating the
 * rectangles measured at drag start into the target cells. Position was then
 * right and size was not — a card that should have narrowed from two columns to
 * one kept its old width and sat on top of its neighbour, which is the overlap in
 * the video. Nothing about a translation can fix that: the card's own body scales
 * its type and its charts to `@container/card`, so a card drawn at the wrong
 * width has the wrong contents too, and a `scaleX` would stretch them rather than
 * re-lay them out.
 *
 * So the split is the other way round. The *decision* geometry is frozen — this
 * file — and the drawing is left to CSS grid: `CardGrid` renders the candidate
 * order, the packer hands out the real `col-span-*` classes, and the browser
 * reflows for real. Widths, heights, container queries and text wrapping are then
 * correct because nothing is predicting them.
 */

export interface GridSlot {
  id: string
  /**
   * Offsets from the grid's own box rather than from the viewport, so a page
   * scroll mid-drag cannot stale them. The reader adds the grid's live origin
   * back on.
   */
  left: number
  top: number
  width: number
  height: number
}

export interface GridOrigin {
  left: number
  top: number
}

/**
 * Where every card sits at this instant, as the drop targets for a whole drag.
 *
 * Taken once, at `dragStart`, before anything has moved.
 */
export function captureGridSlots(grid: HTMLElement | null): GridSlot[] {
  if (!grid) return []
  const origin = grid.getBoundingClientRect()
  const slots: GridSlot[] = []
  for (const node of grid.querySelectorAll<HTMLElement>("[data-card-id]")) {
    const id = node.dataset.cardId
    if (!id) continue
    const rect = node.getBoundingClientRect()
    slots.push({
      id,
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
    })
  }
  return slots
}

/**
 * How many columns the grid is drawing.
 *
 * Read from the CSS rather than from a parallel breakpoint table in JavaScript.
 * The grid's three steps are container queries, so the container decides — and a
 * sidebar, a resized pane or a narrow embed all make a viewport-width guess
 * disagree with what is on screen. A drop resolved against the wrong column
 * count is resolved against the wrong rows.
 *
 * Counted, not measured: the count survives a browser that answers with the
 * specified track values rather than the used ones, where parsing them as pixels
 * would not.
 */
export function gridColumnCount(
  grid: HTMLElement | null,
  fallback: number
): number {
  if (!grid) return fallback
  const tracks = getComputedStyle(grid).gridTemplateColumns.trim()
  if (!tracks || tracks === "none") return fallback
  return tracks.split(/\s+/).length
}

/**
 * The card a point is aiming at.
 *
 * Containment first, nearest centre second. `closestCenter` alone is what made
 * the target flip early: it compares the centre of the *dragged card's*
 * rectangle, and the handle sits at that card's top-right corner — on a
 * full-width card the two are hundreds of pixels apart, so a row could change
 * before the handle had reached it. Judging the pointer itself is both closer to
 * what the person is doing and independent of how wide the dragged card happens
 * to be.
 *
 * The fallback still matters: the slots tile the grid but the gaps between them
 * belong to nobody, and a pointer dragged outside the grid entirely has to land
 * somewhere.
 */
export function nearestGridSlot(
  slots: readonly GridSlot[],
  point: { x: number; y: number },
  origin: GridOrigin
): GridSlot | null {
  const x = point.x - origin.left
  const y = point.y - origin.top

  let nearest: GridSlot | null = null
  let best = Number.POSITIVE_INFINITY

  for (const slot of slots) {
    if (
      x >= slot.left &&
      x <= slot.left + slot.width &&
      y >= slot.top &&
      y <= slot.top + slot.height
    ) {
      return slot
    }
    const dx = x - (slot.left + slot.width / 2)
    const dy = y - (slot.top + slot.height / 2)
    const distance = dx * dx + dy * dy
    if (distance < best) {
      best = distance
      nearest = slot
    }
  }

  return nearest
}

/**
 * How far outside the grid a pointer may still be aiming at it.
 *
 * Generous, because dropping onto the first or last row means aiming at its edge
 * and overshooting is normal. Bounded, because "nearest slot" answers for every
 * point on the screen: without a limit, letting go halfway down the page — the
 * gesture everyone uses to mean *no* — still reordered the dashboard.
 */
export const GRID_AIM_MARGIN = { x: 32, y: 64 }

/**
 * How much closer a new slot has to be before the aim moves to it.
 *
 * Compared centre-to-centre, so two adjacent slots are separated by a hairline
 * where a pointer resting on the boundary alternates between them — and every
 * alternation reflows the whole grid. Squared distance, so the margin is in
 * squared pixels: `24²` is about a fingertip of stickiness.
 */
const AIM_HYSTERESIS = 24 * 24

/**
 * The slot a drag is aiming at, with the two things a bare nearest-neighbour
 * answer cannot express: nothing, and a preference for staying put.
 */
export function aimGridSlot({
  slots,
  point,
  origin,
  bounds,
  previousId,
}: {
  slots: readonly GridSlot[]
  point: { x: number; y: number }
  origin: GridOrigin
  /** The grid's live box, for deciding whether the pointer is still aiming. */
  bounds: { width: number; height: number }
  /** What the drag was aiming at a moment ago, if anything. */
  previousId?: string | null
}): string | null {
  const x = point.x - origin.left
  const y = point.y - origin.top
  if (
    x < -GRID_AIM_MARGIN.x ||
    y < -GRID_AIM_MARGIN.y ||
    x > bounds.width + GRID_AIM_MARGIN.x ||
    y > bounds.height + GRID_AIM_MARGIN.y
  ) {
    return null
  }

  let nearest: GridSlot | null = null
  let best = Number.POSITIVE_INFINITY
  let previous = Number.POSITIVE_INFINITY

  for (const slot of slots) {
    // Containment is unambiguous, so it needs no stickiness: a pointer inside a
    // card is aiming at that card.
    if (
      x >= slot.left &&
      x <= slot.left + slot.width &&
      y >= slot.top &&
      y <= slot.top + slot.height
    ) {
      return slot.id
    }
    const dx = x - (slot.left + slot.width / 2)
    const dy = y - (slot.top + slot.height / 2)
    const distance = dx * dx + dy * dy
    if (slot.id === previousId) previous = distance
    if (distance < best) {
      best = distance
      nearest = slot
    }
  }

  if (!nearest) return null
  // Keep the previous aim unless the newcomer is clearly better, so a pointer
  // wobbling on a boundary cannot thrash the layout.
  if (previousId && previous - best < AIM_HYSTERESIS) return previousId
  return nearest.id
}

/** Whether two orders are the same sequence, for skipping needless renders. */
export function sameCardOrder(
  left: readonly string[] | null | undefined,
  right: readonly string[]
): boolean {
  return (
    left?.length === right.length &&
    left.every((id, index) => id === right[index])
  )
}

/**
 * How far the overlay has to be nudged so the handle stays under the finger when
 * the card changes width.
 *
 * dnd-kit anchors the overlay to the dragged card's original top-left corner plus
 * the pointer delta, which is right only while the card keeps its original size.
 * A card that narrows from two columns to one loses that width off its right
 * edge — and the handle is on the right edge, so it slides out from under the
 * finger by most of a column. Holding the grab *ratio* instead keeps the same
 * point of the card under the pointer at any width.
 */
export function overlayGrabShift(
  grab: { x: number; y: number },
  source: { width: number; height: number },
  box: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: source.width > 0 ? grab.x * (1 - box.width / source.width) : 0,
    y: source.height > 0 ? grab.y * (1 - box.height / source.height) : 0,
  }
}
