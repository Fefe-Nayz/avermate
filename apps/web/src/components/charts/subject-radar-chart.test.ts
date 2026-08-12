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
    expect(chart).toContain("radiusRatio: width < 360 ? 0.64 : 0.72")
    expect(chart).toContain("LABEL_FONT_SIZE = 12")
  })

  test("a long name is pulled inwards rather than off the card", async () => {
    const chart = await source("./subject-radar-chart.tsx")

    // This is what the pre-migration chart did and why its names stayed
    // inside: a label is centred on its point, so pulling it in by half its
    // own width lands its far end the same short distance past the ring
    // however long the name is. Cutting names harder solves the wrong half.
    expect(chart).toContain(
      "const labelOffset = LABEL_LEAD - longest * HALF_CHARACTER"
    )
    expect(chart).toContain(
      "const maxLength = width < 300 ? 5 : width < 440 ? 9 : 12"
    )
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
