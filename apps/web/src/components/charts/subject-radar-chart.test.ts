import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("the subjects radar", () => {
  test("its labels are placed the way the previous app placed them", async () => {
    const chart = await source("./subject-radar-chart.tsx")

    // Tangential, folded twice so nothing on the left half reads upside down.
    expect(chart).toContain("labelRotate: ({ angle }) => labelRotation(angle)")
    expect(chart).toContain("if (rotation > 90) rotation -= 180")
    expect(chart).toContain("else if (rotation < -90) rotation += 180")

    // The ring is the previous app's, so the shape keeps its size — which is
    // the whole reason a radar is on this dashboard rather than another
    // ranked list beside the one already there.
    expect(chart).toContain("const radiusRatio = width < 360 ? 0.64 : 0.72")
    expect(chart).toContain("LABEL_FONT_SIZE = 12")
    expect(chart).toContain("LABEL_OFFSET = 8")
  })

  test("a name is cut to the room it has, not to a fixed number", async () => {
    const chart = await source("./subject-radar-chart.tsx")

    // A budget stepped by width alone cannot see how much room is left
    // outside the ring, and the ring is bound by the shorter side of the box.
    // On a card narrower than that ladder was tuned against, every label on
    // the right ran off the edge.
    expect(chart).toContain("const half = Math.min(width, height) / 2")
    expect(chart).toContain("half - half * radiusRatio - LABEL_OFFSET")
    expect(chart).toContain("Math.floor(room / (LABEL_FONT_SIZE")
  })

  test("the rings say what they are worth", async () => {
    const chart = await source("./subject-radar-chart.tsx")

    // Without values a radar is a shape with no units: you can see that one
    // subject reaches further than another and not what either one is.
    expect(chart).toContain("labelAngle: 90")
    expect(chart).toContain("format: (value) => format.number(Number(value))")
    expect(chart).toContain("values: [0, scale * 0.25")
  })

  test("it reads the year's own scale rather than assuming twenty", async () => {
    const chart = await source("./subject-radar-chart.tsx")

    expect(chart).toContain("scaleLinear().domain([0, scale])")
    expect(chart).toContain("scale * 0.25, scale * 0.5, scale * 0.75, scale")
    // Short names exist so that a long subject has something to show here.
    expect(chart).toContain("subject.shortName ?? subject.name")
  })
})
