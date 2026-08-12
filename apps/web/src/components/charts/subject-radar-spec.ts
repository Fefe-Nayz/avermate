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
/** Gap between the outer ring and a name. */
export const LABEL_OFFSET = 8

/**
 * Turn a name to lie along the ring rather than across it.
 *
 * Straight from the chart this replaced: the folds keep every name the right
 * way up, so nothing on the left half reads upside down.
 */
export function labelRotation(angle: number): number {
  let rotation = (angle * 180) / Math.PI
  if (rotation > 180) rotation -= 360
  if (rotation > 90) rotation -= 180
  else if (rotation < -90) rotation += 180
  return rotation
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
            format: (value) => {
              const label = String(value)
              return label.length > maxLength
                ? `${label.slice(0, maxLength)}…`
                : label
            },
            labelFill: "currentColor",
            labelFontSize: LABEL_FONT_SIZE,
            // Measured outwards from the ring. It was briefly derived from the
            // longest name, on the theory that the chart this replaced pulled
            // long labels inwards — it does, but from a tick radius that
            // already sat outside the shape, so subtracting here put every
            // name on top of the polygon instead.
            labelOffset: LABEL_OFFSET,
            labelRotate: ({ angle }) => labelRotation(angle),
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
