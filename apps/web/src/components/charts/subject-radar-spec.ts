import { angleGrid, polar, radialArea, radialGrid } from "@tanstack/charts/polar"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { scalePoint } from "@tanstack/charts/scales/point"
import { curveLinearClosed } from "d3-shape"

/**
 * The radar's geometry, apart from the component that draws it.
 *
 * Everything here is about where things land, and where things land is worth
 * asserting: rendered headlessly, a scene says whether a name sits outside the
 * ring, stays inside the card and clears its neighbours. Four attempts at this
 * chart were judged from screenshots and three of them were wrong.
 */

export interface RadarPoint {
  subject: string
  value: number
}

export const LABEL_FONT_SIZE = 12
/** Advance width of a character at that size. */
export const CHARACTER_WIDTH = 0.55
/** How far past the ring the outer end of every name sits. */
export const LABEL_OFFSET = 10

/**
 * Lay a name along its own spoke, pointing at the centre.
 *
 * A radar's names belong on the axes they label, not wrapped around the ring.
 * The two conventions differ by a quarter turn — the chart library measures
 * its angle from the top, clockwise, while a screen rotation is measured from
 * the x axis — and skipping that turn is what had every name lying tangentially
 * across its spoke instead of along it.
 *
 * The fold keeps them the right way up: past a quarter turn a name would read
 * upside down, so it is turned back onto the same line facing the other way.
 */
export function labelRotation(angle: number): number {
  return fold((angle * 180) / Math.PI - 90).rotation
}

/**
 * Which end of a name is pinned to its spoke.
 *
 * A radial name runs along the radius, so left to itself it grows outwards and
 * the long ones leave the card — the ring already takes seven tenths of the
 * box and no name fits in what is left. Anchoring the far end instead makes it
 * grow *inwards*, over the grid it labels, so every name ends the same short
 * distance past the ring however long it is. That is what the chart before the
 * library change did, and why nothing ever ran off it.
 *
 * Which end that is depends on the fold: a name turned back to stay readable
 * runs the other way along its spoke.
 */
export function labelAnchorFor(angle: number): "start" | "end" {
  return fold((angle * 180) / Math.PI - 90).flipped ? "start" : "end"
}

/** Bring a rotation into the half turn a reader can follow. */
function fold(degrees: number): { rotation: number; flipped: boolean } {
  let rotation = degrees
  let flipped = false
  while (rotation > 90) {
    rotation -= 180
    flipped = !flipped
  }
  while (rotation < -90) {
    rotation += 180
    flipped = !flipped
  }
  return { rotation, flipped }
}

/** How much of the box the ring takes, leaving the rest to the names. */
export function radiusRatioFor(width: number): number {
  return width < 360 ? 0.64 : 0.72
}

/** How many characters of a name survive at this width. */
export function maxLabelLengthFor(width: number): number {
  return width < 300 ? 5 : width < 440 ? 9 : 12
}

export function radarSpec({
  points,
  scale,
  width,
  formatValue,
}: {
  points: readonly RadarPoint[]
  /** The year's own top mark; a year here is not always out of twenty. */
  scale: number
  width: number
  formatValue: (value: number) => string
}) {
  const domain = points.map((point) => point.subject)
  const maxLength = maxLabelLengthFor(width)
  const shorten = (label: string) =>
    label.length > maxLength ? `${label.slice(0, maxLength)}…` : label

  return {
    marks: [
      polar({
        id: "main-subject-radar",
        radiusRatio: radiusRatioFor(width),
        angle: {
          scale: scalePoint<string>().domain(domain),
          wrap: true,
        },
        radius: { scale: scaleLinear().domain([0, scale]) },
        guides: [
          // The rings carry their own values along one spoke. Without them a
          // radar is a shape with no units: you can see that one subject
          // reaches further than another and not what either one is.
          radialGrid({
            values: [0, scale * 0.25, scale * 0.5, scale * 0.75, scale],
            shape: "polygon",
            stroke: "currentColor",
            strokeOpacity: 0.2,
            labels: true,
            format: (value) => formatValue(Number(value)),
            labelAngle: 90,
            labelOffset: 6,
            labelFill: "currentColor",
            labelFontSize: 10,
            labelClassName: "opacity-60",
          }),
          angleGrid({
            labels: true,
            format: (value) => shorten(String(value)),
            labelFill: "currentColor",
            labelFontSize: LABEL_FONT_SIZE,
            // No `labelDx` here. It is added to the world x rather than run
            // along the rotated baseline, so it drags every name sideways
            // instead of down its spoke — and it is not needed: the renderer
            // already anchors a name `start` on the right and `end` on the
            // left, so each one grows away from the ring on its own.
            labelOffset: LABEL_OFFSET,
            labelRotate: ({ angle }) => labelRotation(angle),
            labelAnchor: ({ angle }) => labelAnchorFor(angle),
            stroke: "currentColor",
            strokeOpacity: 0.2,
          }),
        ],
        marks: [
          radialArea(points as RadarPoint[], {
            angle: "subject",
            radius: "value",
            key: "subject",
            curve: curveLinearClosed,
            fill: "var(--chart-1)",
            fillOpacity: 0.1,
            stroke: "var(--chart-1)",
            strokeWidth: 2,
          }),
        ],
      }),
    ],
  }
}
