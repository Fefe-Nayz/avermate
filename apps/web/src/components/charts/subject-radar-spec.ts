import {
  angleGrid,
  polar,
  radialArea,
  radialGrid,
  radialText,
} from "@tanstack/charts/polar"
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

/** Advance width of a character, as a fraction of the font size. */
export const CHARACTER_WIDTH = 0.55
/** How far past the ring the outer end of every name sits. */
export const LABEL_OFFSET = 10
/** Baseline-to-baseline distance between the lines of a folded name. */
export const LINE_HEIGHT = 1.15

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

/** The ring's radius in pixels, as the library resolves it. */
export function ringRadius(width: number, height: number): number {
  return (Math.min(width, height) / 2) * radiusRatioFor(width)
}

/** Names shrink a step at a time as the card narrows, before they fold. */
export function labelFontSizeFor(width: number): number {
  return width < 340 ? 10 : width < 440 ? 11 : 12
}

/**
 * How long a run of characters may lie along a spoke.
 *
 * The outer end is pinned just past the ring, so a name spends its length
 * running inwards — and every spoke converges on the centre, so the last
 * stretch before it is the one place where names can still meet. The budget
 * stops them short of it.
 */
export function labelBudget(width: number, height: number): number {
  const ring = ringRadius(width, height)
  return ring + LABEL_OFFSET - Math.max(ring * 0.25, 22)
}

/**
 * A name, folded to fit its spoke — never cut.
 *
 * "Sciences-Industrielles…" with the answer amputated was the truncation
 * ladder this replaces. A name that overruns its budget breaks once, at a
 * space or after a hyphen, into the two most even lines it can make. A single
 * unbreakable word keeps its full length and simply runs deeper along its
 * spoke: too rare to design around, and a shortened subject name is exactly
 * what the subject's own `shortName` field is for.
 */
export function labelLines(
  name: string,
  width: number,
  height: number
): string[] {
  const budget = labelBudget(width, height)
  const advance = labelFontSizeFor(width) * CHARACTER_WIDTH
  if (name.length * advance <= budget) return [name]

  const tokens = name.match(/[^\s-]+-|[^\s]+/g) ?? [name]
  if (tokens.length < 2) return [name]

  const join = (parts: string[]) =>
    parts.reduce(
      (text, part) =>
        text === "" ? part : text.endsWith("-") ? text + part : `${text} ${part}`,
      ""
    )

  let best: [string, string] = [join(tokens.slice(0, 1)), join(tokens.slice(1))]
  for (let split = 2; split < tokens.length; split += 1) {
    const candidate: [string, string] = [
      join(tokens.slice(0, split)),
      join(tokens.slice(split)),
    ]
    if (
      Math.max(candidate[0].length, candidate[1].length) <
      Math.max(best[0].length, best[1].length)
    ) {
      best = candidate
    }
  }
  return best
}

interface RadarLabel {
  subject: string
  value: number
  key: string
  text: string
  rotation: number
  anchor: "start" | "end"
  dx: number
  dy: number
}

export function radarSpec({
  points,
  scale,
  width,
  height,
  formatValue,
}: {
  points: readonly RadarPoint[]
  /** The year's own top mark; a year here is not always out of twenty. */
  scale: number
  width: number
  height: number
  formatValue: (value: number) => string
}) {
  const domain = points.map((point) => point.subject)
  const fontSize = labelFontSizeFor(width)
  const lineHeight = fontSize * LINE_HEIGHT

  /*
   * The names are a mark of their own rather than the angle grid's labels,
   * because a grid label is one run of text and a folded name is two. Each
   * line is its own datum: same spoke, same rotation, same pinned outer end,
   * offset across the spoke — `dx`/`dy` are added in world space after the
   * polar projection, which is exactly the perpendicular this needs.
   */
  const labels: RadarLabel[] = points.flatMap((point, index) => {
    const angle = (index * 2 * Math.PI) / points.length
    const rotation = labelRotation(angle)
    const anchor = labelAnchorFor(angle)
    const radians = (rotation * Math.PI) / 180
    // The descender side of the folded baseline: where a second line belongs.
    const across = { x: -Math.sin(radians), y: Math.cos(radians) }
    const lines = labelLines(point.subject, width, height)

    return lines.map((text, line) => {
      const offset = (line - (lines.length - 1) / 2) * lineHeight
      return {
        subject: point.subject,
        value: point.value,
        key: `${point.subject}#${line}`,
        text,
        rotation,
        anchor,
        dx: across.x * offset,
        dy: across.y * offset,
      }
    })
  })

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
            labels: false,
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
          radialText(labels, {
            angle: "subject",
            radius: scale,
            radiusOffset: LABEL_OFFSET,
            key: "key",
            text: "text",
            fill: "currentColor",
            fontSize,
            anchor: (datum) => datum.anchor,
            baseline: "middle",
            rotate: (datum) => datum.rotation,
            dx: (datum) => datum.dx,
            dy: (datum) => datum.dy,
          }),
        ],
      }),
    ],
  }
}
