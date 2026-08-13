import { describe, expect, test } from "bun:test"
import { createChartScene, defaultChartTheme } from "@tanstack/charts"
import {
  CHARACTER_WIDTH,
  LABEL_FONT_SIZE,
  LABEL_OFFSET,
  labelAnchorFor,
  labelRotation,
  maxLabelLengthFor,
  radarSpec,
  radiusRatioFor,
} from "./subject-radar-spec"

/**
 * Where the names land, measured rather than eyeballed.
 *
 * Several passes at this chart were judged from screenshots and most of them
 * were wrong. The renderer reports each label's anchor point, its rotation and
 * which end of the run is pinned there — enough to check the three things that
 * actually matter: the names lie along their spokes, they end just past the
 * ring, and they stay on the card.
 */

const SUBJECTS = [
  "Mathématiques",
  "Physique-Chimie",
  "Sciences-Industrielles",
  "Informatique",
  "Français",
  "Anglais",
  "LV2",
]

const points = SUBJECTS.map((subject, index) => ({
  subject,
  value: 8 + (index % 9),
}))

interface Placed {
  text: string
  rotation: number
  /** Radius of the end nearest the centre, and of the end furthest from it. */
  inner: number
  outer: number
  left: number
  right: number
  top: number
  bottom: number
}

function collect(
  node: unknown,
  found: Array<Record<string, unknown>> = [],
  seen = new Set<unknown>()
): Array<Record<string, unknown>> {
  if (!node || typeof node !== "object" || seen.has(node)) return found
  seen.add(node)
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found, seen)
    return found
  }
  const record = node as Record<string, unknown>
  if (typeof record.text === "string") found.push(record)
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") collect(value, found, seen)
  }
  return found
}

/** The subject names, as the renderer places them. */
function place(width: number, height: number): Placed[] {
  const scene = createChartScene(
    radarSpec({
      points,
      scale: 20,
      width,
      formatValue: (value) => String(value),
    }) as never,
    { width, height },
    // Only colours come from the theme, and colours move nothing.
    { theme: defaultChartTheme } as never
  )

  return collect(scene).flatMap((label) => {
    const text = String(label.text ?? "")
    // The ring values are numbers; only the names are under test here.
    if (!text || /^-?\d+([.,]\d+)?$/.test(text)) return []

    const run = text.length * LABEL_FONT_SIZE * CHARACTER_WIDTH
    const rotation = Number(label.rotate) || 0
    const radians = (rotation * Math.PI) / 180
    const anchor = String(label.anchor)
    // Where the run begins relative to its anchor, along the baseline.
    const lead = anchor === "start" ? 0 : anchor === "end" ? -run : -run / 2

    const ax = Number(label.x) || 0
    const ay = Number(label.y) || 0
    const x1 = ax + lead * Math.cos(radians)
    const y1 = ay + lead * Math.sin(radians)
    const x2 = ax + (lead + run) * Math.cos(radians)
    const y2 = ay + (lead + run) * Math.sin(radians)

    // A little slack for the cap height either side of the baseline.
    const pad = LABEL_FONT_SIZE / 2
    return [
      {
        text,
        rotation,
        inner: Math.min(Math.hypot(x1, y1), Math.hypot(x2, y2)),
        outer: Math.max(Math.hypot(x1, y1), Math.hypot(x2, y2)),
        left: width / 2 + Math.min(x1, x2) - pad,
        right: width / 2 + Math.max(x1, x2) + pad,
        top: height / 2 + Math.min(y1, y2) - pad,
        bottom: height / 2 + Math.max(y1, y2) + pad,
      },
    ]
  })
}

const SIZES = [
  [300, 340],
  [340, 340],
  [410, 340],
  [560, 340],
  [720, 340],
] as const

describe("the subjects radar", () => {
  test("every name is placed", () => {
    for (const [width, height] of SIZES) {
      expect(place(width, height)).toHaveLength(SUBJECTS.length)
    }
  })

  test("names lie along their spokes, pointing at the centre", () => {
    // The library measures its angle from the top, clockwise; a screen
    // rotation is measured from the x axis. Skipping that quarter turn laid
    // every name tangentially across its spoke instead of along it.
    const spoke = (index: number) => (index * 2 * Math.PI) / SUBJECTS.length
    for (let index = 0; index < SUBJECTS.length; index += 1) {
      const radial = (spoke(index) * 180) / Math.PI - 90
      const drawn = labelRotation(spoke(index))
      // Same line, give or take the fold that keeps it readable.
      const difference = Math.abs(((radial - drawn) % 180) + 180) % 180
      expect(Math.min(difference, 180 - difference)).toBeLessThan(0.001)
      expect(Math.abs(drawn)).toBeLessThanOrEqual(90.001)
    }
  })

  test("a name grows inwards, so it ends just past the ring", () => {
    for (const [width, height] of SIZES) {
      const ring = (Math.min(width, height) / 2) * radiusRatioFor(width)
      for (const label of place(width, height)) {
        // Left to itself a radial name grows outwards and the long ones leave
        // the card. Anchoring the far end is what keeps every one of them
        // ending in the same place.
        expect(label.outer).toBeGreaterThan(ring)
        expect(label.outer).toBeLessThan(ring + LABEL_OFFSET + 1)
        expect(label.inner).toBeLessThan(label.outer)
      }
    }
  })

  test("no name leaves the card", () => {
    for (const [width, height] of SIZES) {
      for (const label of place(width, height)) {
        expect(`${label.text} left ${label.left >= 0}`).toBe(
          `${label.text} left true`
        )
        expect(`${label.text} right ${label.right <= width}`).toBe(
          `${label.text} right true`
        )
        expect(`${label.text} top ${label.top >= 0}`).toBe(
          `${label.text} top true`
        )
        expect(`${label.text} bottom ${label.bottom <= height}`).toBe(
          `${label.text} bottom true`
        )
      }
    }
  })

  test("no two names overlap", () => {
    for (const [width, height] of SIZES) {
      const labels = place(width, height)
      for (let a = 0; a < labels.length; a += 1) {
        for (let b = a + 1; b < labels.length; b += 1) {
          const one = labels[a] as Placed
          const two = labels[b] as Placed
          const collides =
            one.left < two.right &&
            two.left < one.right &&
            one.top < two.bottom &&
            two.top < one.bottom
          expect(`${one.text} / ${two.text}: ${collides}`).toBe(
            `${one.text} / ${two.text}: false`
          )
        }
      }
    }
  })

  test("the anchored end follows the fold", () => {
    // A name turned back to stay readable runs the other way along its spoke,
    // so the end that is pinned to the ring swaps with it.
    // The right half reads outwards, so its far end is the last character.
    expect(labelAnchorFor(0)).toBe("end")
    expect(labelAnchorFor(Math.PI / 2)).toBe("end")
    // The left half is folded, so it reads inwards and the ends swap.
    expect(labelAnchorFor((3 * Math.PI) / 2)).toBe("start")
    expect(labelAnchorFor((7 * Math.PI) / 4)).toBe("start")
  })

  test("a narrow card cuts names harder than a wide one", () => {
    expect(maxLabelLengthFor(280)).toBe(5)
    expect(maxLabelLengthFor(400)).toBe(9)
    expect(maxLabelLengthFor(600)).toBe(12)
  })
})
