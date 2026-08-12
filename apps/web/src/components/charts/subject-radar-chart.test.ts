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

    // A character budget stepped by width, and a ring that gives up a little
    // radius on a narrow card. Deriving the radius from the longest name
    // instead cost the shape most of its size, which is the whole reason a
    // radar is on this dashboard rather than another ranked list.
    expect(chart).toContain(
      "const maxLength = width < 300 ? 5 : width < 440 ? 9 : 12"
    )
    expect(chart).toContain("radiusRatio: width < 360 ? 0.64 : 0.72")
    expect(chart).toContain("labelFontSize: 12")
    expect(chart).toContain("labelOffset: 8")
  })

  test("it reads the year's own scale rather than assuming twenty", async () => {
    const chart = await source("./subject-radar-chart.tsx")

    expect(chart).toContain("scaleLinear().domain([0, scale])")
    expect(chart).toContain("scale * 0.25, scale * 0.5, scale * 0.75, scale")
    // Short names exist so that a long subject has something to show here.
    expect(chart).toContain("subject.shortName ?? subject.name")
  })
})
