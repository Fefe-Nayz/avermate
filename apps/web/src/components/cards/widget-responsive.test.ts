import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  fitWidgetAspect,
  limitWidgetSeries,
  resolveWidgetResponsivePresentation,
  widgetRecipeForLayout,
} from "./widget-responsive"

const source = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8")

describe("responsive widget presentation", () => {
  test("keeps the requested recipe until the client has measured the card", () => {
    expect(
      resolveWidgetResponsivePresentation({
        recipe: "treemap",
        behavior: "adapt",
        resultShape: "hierarchy",
        width: null,
        columns: 1,
        grid: 4,
      })
    ).toMatchObject({ profile: "standard", recipe: "treemap" })
  })

  test("follows the complete compact-fallback chain in one column", () => {
    expect(
      resolveWidgetResponsivePresentation({
        recipe: "scatter",
        behavior: "adapt",
        resultShape: "categorical-series",
        width: 320,
        columns: 1,
        grid: 4,
      }).recipe
    ).toBe("lollipop")
  })

  test("uses physical micro width as the final guard", () => {
    expect(
      resolveWidgetResponsivePresentation({
        recipe: "line",
        behavior: "adapt",
        resultShape: "temporal-series",
        width: 160,
        columns: 4,
        grid: 4,
      })
    ).toMatchObject({ profile: "micro", recipe: "sparkline" })
  })

  test("preserves the requested visualization when the document asks it to", () => {
    expect(
      resolveWidgetResponsivePresentation({
        recipe: "treemap",
        behavior: "preserve-visualization",
        resultShape: "hierarchy",
        width: 160,
        columns: 1,
        grid: 4,
      }).recipe
    ).toBe("treemap")
  })

  test("lets adaptive layout shrink while preserving layout reserves the recipe floor", () => {
    expect(widgetRecipeForLayout("line", "adapt", "temporal-series")).toBe(
      "sparkline"
    )
    expect(
      widgetRecipeForLayout("line", "preserve-visualization", "temporal-series")
    ).toBe("line")
  })

  test("derives a real series budget from the resolved profile", () => {
    expect(
      resolveWidgetResponsivePresentation({
        recipe: "line",
        behavior: "adapt",
        resultShape: "temporal-series",
        width: 170,
      }).seriesBudget
    ).toBe(1)
    expect(
      resolveWidgetResponsivePresentation({
        recipe: "line",
        behavior: "adapt",
        resultShape: "temporal-series",
        width: 500,
        columns: 3,
        grid: 4,
      }).seriesBudget
    ).toBe(8)
  })

  test("wires measured policy through the dashboard and editor renderers", () => {
    const view = source("./widget-view.tsx")
    const grid = source("./card-grid.tsx")
    const form = source("./widget-form.tsx")

    expect(view).toContain("resolveWidgetResponsivePresentation({")
    expect(view).toContain("fitWidgetAspect(")
    expect(view).toContain("data-widget-series-budget")
    expect(
      view.match(/compact=\{visualization\.recipe === "line"\}/g)
    ).toHaveLength(2)
    expect(grid).toContain("widgetRecipeForLayout(")
    expect(grid).toContain("activeColumns.set(")
    expect(grid).toContain("item.columns as WidgetGridColumns")
    expect(grid).toContain("gridColumns={gridColumns}")
    expect(form).toContain("widgetRecipeForLayout(")
    expect(form).toContain("gridColumns={columns as 1 | 2 | 3 | 4}")
  })
})

describe("responsive widget geometry", () => {
  test("fits the preferred aspect ratio without overflowing either edge", () => {
    expect(fitWidgetAspect(500, 300, 1)).toEqual({ width: 300, height: 300 })
    expect(fitWidgetAspect(240, 300, 1)).toEqual({ width: 240, height: 240 })
    expect(fitWidgetAspect(500, 300, null)).toBeNull()
  })

  test("keeps stable leading series and names every omitted one", () => {
    const limited = limitWidgetSeries(
      [
        { series: "A", value: 1 },
        { series: "B", value: 2 },
        { series: "A", value: 3 },
        { series: null, value: 4 },
        { series: "C", value: 5 },
      ],
      2
    )

    expect(limited.values.map((item) => item.value)).toEqual([1, 2, 3, 4])
    expect(limited.hiddenSeries).toEqual(["C"])
  })
})
