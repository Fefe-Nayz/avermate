import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { CardAccessibleSummary } from "./card-accessible-summary"

const requestedCharts = [
  "card-band.tsx",
  "card-control.tsx",
  "card-difference.tsx",
  "card-strip.tsx",
  "card-waterfall.tsx",
  "card-scatter.tsx",
  "card-regression.tsx",
] as const

const code = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

describe("exact chart readings", () => {
  test("exposes the complete reading without adding another visible caption", () => {
    const html = renderToStaticMarkup(
      <CardAccessibleSummary
        items={["September: 14 / 20", "", "October: 16 / 20"]}
      />
    )

    expect(html).toContain('class="sr-only"')
    expect(html).toContain("September: 14 / 20; October: 16 / 20")
    expect(html).not.toContain("<figcaption")
  })

  test("renders nothing when the chart has no exact reading", () => {
    expect(
      renderToStaticMarkup(<CardAccessibleSummary items={["", " "]} />)
    ).toBe("")
  })

  test("makes every requested renderer keyboard-readable and screen-reader exact", () => {
    for (const file of requestedCharts) {
      const source = code(`./${file}`)
      expect(source, file).toContain("const exactValues")
      expect(source, file).toContain(
        "<CardAccessibleSummary items={exactValues}"
      )
      expect(source, file).toContain("keyboard: true")
      expect(source, file).not.toContain("keyboard: false")
      expect(source, file).toContain("focusRing: true")
    }
  })
})
