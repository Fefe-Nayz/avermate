import { describe, expect, test } from "bun:test"
import { createChartScene, defaultChartTheme } from "@tanstack/charts"
import {
  LABEL_FONT_SIZE,
  labelRotation,
  maxLabelLengthFor,
  radarSpec,
  radiusRatioFor,
} from "./subject-radar-spec"

/**
 * Where the names land, measured rather than eyeballed.
 *
 * The renderer will say exactly where it put each label, so the three things
 * that have gone wrong on this chart — names inside the ring, names off the
 * card, names on top of each other — are all checkable without a browser.
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
  distance: number
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

/** The subject names, as boxes on the canvas. */
function place(width: number, height: number): Placed[] {
  const scene = createChartScene(
    radarSpec({
      points,
      scale: 20,
      width,
      formatValue: (value) => String(value),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
    { width, height },
    // The theme only supplies colours, and colours do not move anything.
    { theme: defaultChartTheme } as never
  )

  return collect(scene).flatMap((label) => {
    const text = String(label.text ?? "")
    // The ring values are numbers; only the names are under test here.
    if (!text || /^-?\d+([.,]\d+)?$/.test(text)) return []

    const runWidth = text.length * LABEL_FONT_SIZE * 0.55
    const angle = ((Number(label.rotate) || 0) * Math.PI) / 180
    const spanX =
      Math.abs((runWidth / 2) * Math.cos(angle)) +
      Math.abs((LABEL_FONT_SIZE / 2) * Math.sin(angle))
    const spanY =
      Math.abs((runWidth / 2) * Math.sin(angle)) +
      Math.abs((LABEL_FONT_SIZE / 2) * Math.cos(angle))

    // Scene coordinates for a polar guide are relative to its centre.
    const dx = Number(label.x) || 0
    const dy = Number(label.y) || 0
    return [
      {
        text,
        distance: Math.hypot(dx, dy),
        left: width / 2 + dx - spanX,
        right: width / 2 + dx + spanX,
        top: height / 2 + dy - spanY,
        bottom: height / 2 + dy + spanY,
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

  test("no name sits inside the ring", () => {
    for (const [width, height] of SIZES) {
      const ring = (Math.min(width, height) / 2) * radiusRatioFor(width)
      for (const label of place(width, height)) {
        // Deriving the offset from the longest name put all seven of them on
        // top of the shape, which is what a negative offset means here.
        expect(label.distance).toBeGreaterThan(ring)
      }
    }
  })

  test("no name leaves the card", () => {
    for (const [width, height] of SIZES) {
      for (const label of place(width, height)) {
        expect(label.left).toBeGreaterThanOrEqual(0)
        expect(label.right).toBeLessThanOrEqual(width)
        expect(label.top).toBeGreaterThanOrEqual(0)
        expect(label.bottom).toBeLessThanOrEqual(height)
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

  test("names lie along the ring, the right way up", () => {
    // A quarter turn past vertical folds back, so nothing reads upside down.
    expect(labelRotation(0)).toBe(0)
    expect(labelRotation(Math.PI / 2)).toBeCloseTo(90)
    expect(labelRotation(Math.PI)).toBeCloseTo(0)
    expect(labelRotation((3 * Math.PI) / 2)).toBeCloseTo(-90)
    for (let angle = 0; angle < 2 * Math.PI; angle += 0.05) {
      expect(Math.abs(labelRotation(angle))).toBeLessThanOrEqual(90.001)
    }
  })

  test("a narrow card cuts names harder than a wide one", () => {
    expect(maxLabelLengthFor(280)).toBe(5)
    expect(maxLabelLengthFor(400)).toBe(9)
    expect(maxLabelLengthFor(600)).toBe(12)
  })
})
