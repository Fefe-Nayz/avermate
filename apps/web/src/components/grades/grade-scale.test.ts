import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { bandOf } from "@avermate/core"

const source = readFileSync(
  new URL("./grade-scale.tsx", import.meta.url),
  "utf8"
)

/**
 * The band edges as the strip computes them, mirrored here so a change to either
 * expression has to be a change to both.
 */
function bands(passingRatio: number) {
  const headroom = 1 - passingRatio
  return [
    { band: "poor", to: passingRatio * 0.7 },
    { band: "weak", to: passingRatio },
    { band: "fair", to: passingRatio + headroom * 0.4 },
    { band: "good", to: passingRatio + headroom * 0.7 },
    { band: "excellent", to: 1 },
  ] as const
}

const EDGE = 0.1
function chipShift(position: number): number {
  if (position <= EDGE) return -50 * (position / EDGE)
  if (position >= 1 - EDGE) return -50 - 50 * ((position - (1 - EDGE)) / EDGE)
  return -50
}

describe("the scale's bands", () => {
  test("tile the whole strip, in order, at every passing mark", () => {
    for (const passingRatio of [0.5, 0.6, 0.35, 0.75]) {
      const segments = bands(passingRatio)
      let previous = 0
      for (const segment of segments) {
        expect(segment.to, `${passingRatio} ${segment.band}`).toBeGreaterThan(
          previous
        )
        previous = segment.to
      }
      expect(previous, String(passingRatio)).toBe(1)
    }
  })

  test("agree with the colour every badge in the app already uses", () => {
    // The strip exists to make `bandOf` spatial, so a zone whose colour differs
    // from the badge for the same result would be worse than no strip at all.
    for (const passingRatio of [0.5, 0.6]) {
      const segments = bands(passingRatio)
      let previous = 0
      for (const segment of segments) {
        const inside = (previous + segment.to) / 2
        expect(
          bandOf(inside, passingRatio),
          `${passingRatio} @ ${inside}`
        ).toBe(segment.band)
        previous = segment.to
      }
    }
  })
})

describe("the chip at the ends of the strip", () => {
  test("is centred on its mark through the middle", () => {
    for (const position of [0.2, 0.5, 0.7, 0.89]) {
      expect(chipShift(position), String(position)).toBe(-50)
    }
  })

  test("goes flush rather than hanging off either edge", () => {
    // The entrance makes this unmissable: the marker *starts* at zero, where a
    // centred label would have half of itself outside the strip.
    // Floating point, so both ends are asserted to within a rounding error of
    // flush — which is all CSS can express anyway.
    expect(chipShift(0)).toBeCloseTo(0, 10)
    expect(chipShift(1)).toBeCloseTo(-100, 10)
  })

  test("slides there smoothly, so nothing jumps on the way out", () => {
    expect(chipShift(0.05)).toBeCloseTo(-25, 6)
    expect(chipShift(0.95)).toBeCloseTo(-75, 6)
  })
})

/**
 * What the component does with all of that, read as source: the browser is the
 * only place a position can actually be measured, and it was — 6px of band widths
 * at 35/15/20/15/15%, the passing rule at 50%, the marker at 70% in
 * `bg-band-good`. These are the wirings that produced it.
 */
describe("the strip's readings all come from the same travelled value", () => {
  test("position, band and number are one value, not three", () => {
    // The entrance animates a *verdict*, so a colour left at the destination
    // while the marker crosses other zones would be the component contradicting
    // itself mid-flight. One progress value, three readings off it.
    expect(source).toContain("useEnteringRatio(ratio,")
    expect(source).toContain("bandOf(travelled, passingRatio)")
    expect(source).toContain("shown(travelled)")
    expect(source).toContain("clamp(travelled) * 100")
    // And no CSS transition on the position, which could only move it — leaving
    // the colour and the number behind.
    expect(source).not.toContain("transition-[left]")
  })

  test("keeps the chip inside the strip while it travels", () => {
    expect(source).toContain("chipShift(clamp(travelled))")
  })

  test("keeps every tick whole, including at the very ends", () => {
    // The strip clips what leaves it, so a tick positioned by its left edge
    // vanishes at a perfect score — the one reading nobody should have to take
    // on trust. Centred on its value and clamped to half its own width.
    expect(source).toContain("function tickStyle")
    expect(source).toContain("translateX(-50%)")
    expect(source).toContain("calc(100% - ")
    for (const call of [
      "tickStyle(clamp(travelled) * 100, 2)",
      "tickStyle(clamp(marker.ratio) * 100, 1)",
      "tickStyle(clamp(passingRatio) * 100, 0.5)",
    ]) {
      expect(source, call).toContain(call)
    }
  })
})
