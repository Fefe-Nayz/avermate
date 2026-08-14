import { describe, expect, test } from "bun:test"
import {
  removeWidgetDraftValue,
  setWidgetDraftValue,
  widgetDraftValue,
  type WidgetDraftValue,
} from "./widget-draft"

const source: WidgetDraftValue = {
  query: { window: { kind: "active-period" }, filters: [] },
  chart: { thresholds: [{ value: 0.5, label: "Target" }] },
}

describe("declarative widget drafts", () => {
  test("reads dollar-prefixed and plain descriptor paths", () => {
    expect(widgetDraftValue(source, "$.query.window.kind")).toBe(
      "active-period"
    )
    expect(widgetDraftValue(source, "chart.thresholds.0.value")).toBe(0.5)
  })

  test("writes nested object and array fields without mutating the draft", () => {
    const next = setWidgetDraftValue(
      source,
      "chart.thresholds.0.color",
      "chart-2"
    )

    expect(widgetDraftValue(next, "chart.thresholds.0.color")).toBe("chart-2")
    expect(widgetDraftValue(source, "chart.thresholds.0.color")).toBeUndefined()
    expect(next).not.toBe(source)
  })

  test("removes hidden values and prunes their empty containers", () => {
    const withComparison = setWidgetDraftValue(
      source,
      "analysis.comparison.value",
      0.75
    )
    const next = removeWidgetDraftValue(
      withComparison,
      "analysis.comparison.value"
    )

    expect(widgetDraftValue(next, "analysis.comparison")).toBeUndefined()
    expect(widgetDraftValue(next, "query.window.kind")).toBe("active-period")
  })
})
