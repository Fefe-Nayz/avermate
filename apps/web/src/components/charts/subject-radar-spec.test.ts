import { describe, expect, test } from "bun:test"
import { createChartScene, defaultChartTheme } from "@tanstack/charts"
import {
  CHARACTER_WIDTH,
  LABEL_OFFSET,
  labelAnchorFor,
  labelLines,
  labelRotation,
  radarSpec,
  ringRadius,
} from "./subject-radar-spec"

/**
 * Where the names land, measured rather than eyeballed.
 *
 * Several passes at this chart were judged from screenshots and most of them
 * were wrong. The renderer reports each label's anchor point, its rotation and
 * which end of the run is pinned there — enough to check the things that
 * actually matter: the names lie along their spokes, they end just past the
 * ring, they keep clear of the centre and of each other, and none is ever cut.
 * A folded name is two runs on the same spoke, so every check works on
 * oriented boxes: the axis-aligned kind reports two parallel diagonal lines
 * as a collision they do not have.
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

const pointsFor = (subjects: readonly string[]) =>
  subjects.map((subject, index) => ({ subject, value: 8 + (index % 9) }))

/** A run of text as the renderer places it: an oriented box. */
interface Placed {
  text: string
  rotation: number
  /** Centre of the run, relative to the polar centre. */
  cx: number
  cy: number
  /** Unit vector along the baseline. */
  ux: number
  uy: number
  /** Half the run's length, half its cap height. */
  halfLength: number
  halfHeight: number
  /** Radius of the end nearest the centre, and of the end furthest from it. */
  inner: number
  outer: number
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
  // Rendered labels only: the mark's own datums also carry a `text` field,
  // but as data — they have no position and must not be measured.
  if (record.kind === "label" && typeof record.text === "string") {
    found.push(record)
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") collect(value, found, seen)
  }
  return found
}

/** The subject names, as the renderer places them. */
function place(
  width: number,
  height: number,
  subjects: readonly string[] = SUBJECTS
): Placed[] {
  const scene = createChartScene(
    radarSpec({
      points: pointsFor(subjects),
      scale: 20,
      width,
      height,
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

    const fontSize = Number(label.fontSize) || 12
    const run = text.length * fontSize * CHARACTER_WIDTH
    const rotation = Number(label.rotate) || 0
    const radians = (rotation * Math.PI) / 180
    const ux = Math.cos(radians)
    const uy = Math.sin(radians)
    const anchor = String(label.anchor)
    // Where the run begins relative to its anchor, along the baseline.
    const lead = anchor === "start" ? 0 : anchor === "end" ? -run : -run / 2

    const ax = Number(label.x) || 0
    const ay = Number(label.y) || 0
    const x1 = ax + lead * ux
    const y1 = ay + lead * uy
    const x2 = ax + (lead + run) * ux
    const y2 = ay + (lead + run) * uy

    return [
      {
        text,
        rotation,
        cx: (x1 + x2) / 2,
        cy: (y1 + y2) / 2,
        ux,
        uy,
        halfLength: run / 2,
        halfHeight: fontSize / 2,
        inner: Math.min(Math.hypot(x1, y1), Math.hypot(x2, y2)),
        outer: Math.max(Math.hypot(x1, y1), Math.hypot(x2, y2)),
      },
    ]
  })
}

/** Separating-axis test for two oriented boxes. */
function collide(a: Placed, b: Placed): boolean {
  const axes = [
    [a.ux, a.uy],
    [-a.uy, a.ux],
    [b.ux, b.uy],
    [-b.uy, b.ux],
  ] as const
  for (const [x, y] of axes) {
    const gap = Math.abs((b.cx - a.cx) * x + (b.cy - a.cy) * y)
    const reachA =
      a.halfLength * Math.abs(a.ux * x + a.uy * y) +
      a.halfHeight * Math.abs(-a.uy * x + a.ux * y)
    const reachB =
      b.halfLength * Math.abs(b.ux * x + b.uy * y) +
      b.halfHeight * Math.abs(-b.uy * x + b.ux * y)
    if (gap > reachA + reachB) return false
  }
  return true
}

/** The four corners of a run, in card coordinates. */
function corners(label: Placed, width: number, height: number) {
  const vx = -label.uy
  const vy = label.ux
  return ([1, -1] as const).flatMap((along) =>
    ([1, -1] as const).map((across) => ({
      x:
        width / 2 +
        label.cx +
        along * label.halfLength * label.ux +
        across * label.halfHeight * vx,
      y:
        height / 2 +
        label.cy +
        along * label.halfLength * label.uy +
        across * label.halfHeight * vy,
    }))
  )
}

const SIZES = [
  [300, 340],
  [340, 340],
  [410, 340],
  [560, 340],
  [720, 340],
] as const

const COUNTS = [
  SUBJECTS.slice(0, 3),
  SUBJECTS.slice(0, 5),
  SUBJECTS,
  [...SUBJECTS, "Histoire-Géographie"],
] as const

describe("the subjects radar", () => {
  test("every name is placed whole — no truncation, no ellipsis", () => {
    for (const [width, height] of SIZES) {
      const texts = place(width, height).map((label) => label.text)
      for (const subject of SUBJECTS) {
        const lines = labelLines(subject, width, height)
        // Each line of the folded name is drawn exactly once…
        for (const line of lines) {
          expect(texts.filter((text) => text === line)).toHaveLength(1)
        }
        // …and the lines re-assemble into the full name, untouched.
        expect(lines.join(" ").replace(/- /g, "-")).toBe(subject)
        expect(lines.join("")).not.toContain("…")
      }
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

    // And the renderer draws them at exactly that rotation.
    for (const [width, height] of SIZES) {
      const byLine = new Map<string, number>()
      SUBJECTS.forEach((subject, index) => {
        for (const line of labelLines(subject, width, height)) {
          byLine.set(line, labelRotation(spoke(index)))
        }
      })
      for (const label of place(width, height)) {
        expect(label.rotation).toBeCloseTo(byLine.get(label.text) ?? NaN, 3)
      }
    }
  })

  test("a name grows inwards, ends just past the ring, and spares the centre", () => {
    for (const [width, height] of SIZES) {
      const ring = ringRadius(width, height)
      for (const label of place(width, height)) {
        // Left to itself a radial name grows outwards and the long ones leave
        // the card. Anchoring the far end is what keeps every one of them
        // ending in the same place. The slack covers the across-spoke shift
        // of a folded name's lines.
        expect(label.outer).toBeGreaterThan(ring)
        expect(label.outer).toBeLessThan(ring + LABEL_OFFSET + 2)
        // Every spoke converges on the centre; a name that reaches it collides
        // with all the others that do. The budget keeps them out.
        expect(`${label.text} inner ${label.inner > 18}`).toBe(
          `${label.text} inner true`
        )
      }
    }
  })

  test("no name leaves the card", () => {
    for (const [width, height] of SIZES) {
      for (const label of place(width, height)) {
        for (const corner of corners(label, width, height)) {
          expect(
            `${label.text} inside ${
              corner.x >= 0 &&
              corner.x <= width &&
              corner.y >= 0 &&
              corner.y <= height
            }`
          ).toBe(`${label.text} inside true`)
        }
      }
    }
  })

  test("no two names overlap, from three subjects to eight", () => {
    for (const subjects of COUNTS) {
      for (const [width, height] of SIZES) {
        const labels = place(width, height, subjects)
        for (let a = 0; a < labels.length; a += 1) {
          for (let b = a + 1; b < labels.length; b += 1) {
            const one = labels[a] as Placed
            const two = labels[b] as Placed
            expect(
              `${width}px ${one.text} / ${two.text}: ${collide(one, two)}`
            ).toBe(`${width}px ${one.text} / ${two.text}: false`)
          }
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

  test("a long name folds at a space or a hyphen, never mid-word", () => {
    // Whole while it fits…
    expect(labelLines("Anglais", 340, 340)).toEqual(["Anglais"])
    expect(labelLines("Mathématiques", 720, 340)).toEqual(["Mathématiques"])
    // …folded once when it does not…
    expect(labelLines("Sciences-Industrielles", 300, 340)).toEqual([
      "Sciences-",
      "Industrielles",
    ])
    expect(labelLines("Sciences de l'Ingénieur", 300, 340)).toEqual([
      "Sciences de",
      "l'Ingénieur",
    ])
    // …and an unbreakable word keeps its full length rather than losing it.
    expect(labelLines("Anticonstitutionnellement", 300, 340)).toEqual([
      "Anticonstitutionnellement",
    ])
  })
})

describe("the active point", () => {
  /** The dots the active-point mark draws, by radius from the polar centre. */
  function activePoints(
    width: number,
    height: number,
    focusedSubject: string | null
  ) {
    const scene = createChartScene(
      radarSpec({
        points: pointsFor(SUBJECTS),
        scale: 20,
        width,
        height,
        formatValue: (value) => String(value),
        focusedSubject,
      }) as never,
      { width, height },
      { theme: defaultChartTheme } as never
    )

    const found: Array<{ radius: number; size: number }> = []
    const seen = new Set<unknown>()
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object" || seen.has(node)) return
      seen.add(node)
      if (Array.isArray(node)) {
        for (const child of node) walk(child)
        return
      }
      const record: Record<string, unknown> = { ...node }
      // The area mark emits its own dots for hit-testing, unfilled and at the
      // library's own size; only the active-point mark's are under test.
      if (
        record.kind === "dot" &&
        String(record.key ?? "").startsWith("main-subject-radar-active-point")
      ) {
        found.push({
          radius: Math.hypot(Number(record.x) || 0, Number(record.y) || 0),
          size: Number(record.radius) || 0,
        })
      }
      for (const value of Object.values(record)) walk(value)
    }
    // The drawing layer only. The scene emits every dot twice — once inside the
    // polar group, positioned from the centre, and once in a flat interaction
    // layer in absolute scene coordinates. They are the same points, but only
    // the first is a radius, so measuring both would double every reading.
    const layers = { ...scene }.nodes
    walk(Array.isArray(layers) ? layers[0] : layers)
    return found
  }

  test("shows nothing while nothing is focused", () => {
    // One circle per subject exists either way — the mark keeps its identity so
    // the renderer resizes rather than adds — but none of them is drawn.
    const drawn = activePoints(360, 340, null)

    expect(drawn).toHaveLength(SUBJECTS.length)
    expect(drawn.every((point) => point.size === 0)).toBe(true)
  })

  test("marks the focused subject, on its own value", () => {
    // The regression this covers: `focusRing: false` reached every definition,
    // every cartesian chart replaced the ring with a focus-state dot, and this
    // one was left with no active point at all.
    const ring = ringRadius(360, 340)
    const focused = pointsFor(SUBJECTS)[3]
    if (!focused) throw new Error("no subject to focus")

    const drawn = activePoints(360, 340, focused.subject)
    const visible = drawn.filter((point) => point.size > 0)

    expect(visible).toHaveLength(1)
    expect(visible[0]?.radius).toBeCloseTo((ring * focused.value) / 20, 6)
  })

  test("follows the ring when the card is narrow", () => {
    // The radius ratio steps down below 360px, and a point that did not follow
    // it would sit off the shape it belongs to.
    const focused = pointsFor(SUBJECTS)[2]
    if (!focused) throw new Error("no subject to focus")
    const visible = activePoints(320, 340, focused.subject).filter(
      (point) => point.size > 0
    )

    expect(visible[0]?.radius).toBeCloseTo(
      (ringRadius(320, 340) * focused.value) / 20,
      6
    )
  })

  test("ignores a name that is not on the chart", () => {
    expect(
      activePoints(360, 340, "Not a subject").every((point) => point.size === 0)
    ).toBe(true)
  })
})
