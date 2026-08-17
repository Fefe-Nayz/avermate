import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const source = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8")

const sparkline = source("./widget-sparkline.tsx")
const view = source("./widget-view.tsx")

/**
 * The card the dashboard is supposed to show for a trend.
 *
 * Routing every card through the generic widget renderer replaced this with a
 * cartesian chart in a 170px box — axes, a y-grid, dated ticks — and dropped the
 * headline number entirely, because a series result has no scalar in it. The
 * reading was the point of the card. These assertions are the shape of the answer;
 * the geometry itself was measured in a browser (full card width, fill flush to
 * the bottom edge, one gradient, one dot, no axis text) because nothing here can
 * see a layout.
 */
describe("the trend card", () => {
  test("shows the reading, not only the curve", () => {
    expect(view).toContain("function WidgetTrend")
    expect(view).toContain("<Sparkline")
    // The number and its change sit above the curve, in the app's own hand — see
    // card-presentation.test.tsx for what that hand is.
    expect(view).toContain("<CardFigure")
    expect(view).toContain("<CardDelta")
  })

  test("reads the change across the window, not against last week", () => {
    // A plain series leaves each datum's `delta` null — that field belongs to
    // `analysis.comparison`, which would answer a different question. The card
    // has always shown current minus the first point on the curve.
    expect(view).toContain("last.value - first")
  })

  test("moves the reading to the day under the finger, and not the change", () => {
    expect(view).toContain("focused ?? last.value")
    expect(view).toContain("onPointFocus={setFocused}")
    expect(sparkline).toContain("dragInspection")
  })

  test("shows the reading whichever curve the definition asked for", () => {
    // A line that kept its axes is still a card, and a card answers first. Only
    // the insights surface skips the reading, where the chart is the subject.
    expect(view).toContain("!expanded && result.values.some")
    expect(view).toContain("<WidgetSeriesChart")
  })

  test("is a sparkline because the definition stripped its apparatus", () => {
    // Not a twelfth mark: "sparkline" was never a different drawing, it was a
    // line without axes — and the axes are already in the model.
    expect(view).toContain("function widgetIsSparkline")
    expect(view).toContain("!visualization.axes.x.visible")
    expect(view).toContain("!visualization.axes.y.grid")
  })

  test("keeps the details that make it read as scenery", () => {
    // Each of these was a deliberate decision in the original, and each is
    // invisible in a diff that only checks the chart renders at all.
    expect(sparkline).toContain("card-spark-fill")
    // Bleeds through the card's padding so the fill pours to the bottom border,
    // and drinks whatever height the row has spare.
    expect(sparkline).toContain("-mx-4 mt-2 -mb-4 min-h-14 flex-1")
    // No axes, no grid, and no focus ring — the built-in one reads as a halo on
    // a light card.
    expect(sparkline).toContain("focusRing: false")
    expect(sparkline).toContain("axis: false")
    expect(sparkline).toContain("grid: false")
    // Coloured by which way the period went.
    expect(sparkline).toContain(
      'positive ? "var(--positive)" : "var(--negative)"'
    )
  })

  test("keeps a full-length twin under the drawn curve", () => {
    // The drawn curve is clipped back to the finger, so focus resolved against it
    // alone would stop finding the days it no longer shows.
    expect(sparkline).toContain("card-spark-line-interaction")
    expect(sparkline).toContain("clippedData")
  })
})
