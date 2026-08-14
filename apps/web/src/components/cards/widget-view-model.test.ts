import { describe, expect, test } from "bun:test"
import {
  createWidgetDefinition,
  createWidgetVisualization,
} from "@avermate/core"
import {
  widgetDefinitionValueType,
  widgetDefinitionShowsDelta,
  widgetDisplayValue,
  widgetEncodedScaleValue,
  widgetEncodedSeriesDatum,
  widgetEncodedThresholdColor,
  widgetEncodingValueType,
  widgetGaugeFillRatio,
  widgetGoalPresentation,
  widgetNumericDomain,
  widgetResolvedUnit,
  widgetSeriesDomainValues,
  widgetThresholdColor,
  widgetValuePresentation,
} from "./widget-view-model"

describe("widget presentation model", () => {
  test("uses a goal target as the gauge domain", () => {
    expect(widgetGaugeFillRatio(0.75, 0, 0.8, false)).toBeCloseTo(0.9375)
    expect(widgetGaugeFillRatio(0.75, 0, 0.8, true)).toBeCloseTo(0.0625)
  })

  test("applies record thresholds in raw data units", () => {
    const visualization = createWidgetVisualization("value")
    visualization.thresholds = [
      { value: 0.5, color: "#d97706", label: "Watch" },
      { value: 0.8, color: "#15803d", label: "Strong" },
    ]

    expect(widgetThresholdColor(0.85, visualization.thresholds)).toBe("#15803d")
    expect(widgetThresholdColor(0.7, visualization.thresholds)).toBe("#d97706")
    expect(widgetDisplayValue(0.85, "ratio", "auto", 20)).toBe(17)
  })

  test("resolves auto units before choosing a suffix", () => {
    expect(widgetResolvedUnit("percent", "auto")).toBe("percent")
    expect(widgetResolvedUnit("days", "auto")).toBe("days")
  })

  test("formats deltas in the configured display unit", () => {
    expect(
      widgetValuePresentation(
        0.1,
        "percent",
        { decimals: null, unit: "auto", compact: false },
        20,
        2
      )
    ).toEqual({ displayed: 10, decimals: 0, compact: false, unit: "percent" })
  })

  test("does not force zero into an inferred numeric domain", () => {
    expect(widgetNumericDomain([14, 16], false, null, null)).toEqual([14, 16])
    expect(widgetNumericDomain([14, 16], true, null, null)).toEqual([0, 16])
    expect(widgetNumericDomain([-5, -2], true, null, null)).toEqual([-5, 0])
  })

  test("uses each streak capability's unit", () => {
    const definition = createWidgetDefinition("overview")
    definition.analysis.measure = {
      kind: "metric",
      metric: "activityStreak",
      goalId: null,
    }
    expect(widgetDefinitionValueType(definition)).toBe("days")

    definition.analysis.measure = {
      kind: "metric",
      metric: "passStreak",
      goalId: null,
    }
    expect(widgetDefinitionValueType(definition)).toBe("count")
  })

  test("shows intrinsic subject deltas without a comparison", () => {
    const definition = createWidgetDefinition("overview")
    definition.analysis.measure = {
      kind: "metric",
      metric: "subjectRanking",
      goalId: null,
    }
    expect(widgetDefinitionShowsDelta(definition)).toBe(true)

    definition.analysis.measure = {
      kind: "metric",
      metric: "mostImproved",
      goalId: null,
    }
    expect(widgetDefinitionShowsDelta(definition)).toBe(true)

    definition.analysis.measure = {
      kind: "metric",
      metric: "average",
      goalId: null,
    }
    expect(widgetDefinitionShowsDelta(definition)).toBe(false)
    definition.analysis.comparison = { kind: "baseline", value: 0.5 }
    expect(widgetDefinitionShowsDelta(definition)).toBe(true)
  })

  test("keeps an empty goal current value distinct from zero", () => {
    expect(
      widgetGoalPresentation({
        current: null,
        target: 0.8,
        status: "no-data",
      })
    ).toEqual({
      current: null,
      target: 0.8,
      status: "no-data",
      hasCurrent: false,
    })
  })

  test("sizes stacked bars from the sum of each series", () => {
    const values = [
      { x: "A", y: 12 },
      { x: "A", y: 8 },
      { x: "B", y: 7 },
      { x: "B", y: 5 },
    ]
    expect(widgetSeriesDomainValues(values, false)).toEqual([12, 8, 7, 5])
    expect(widgetSeriesDomainValues(values, true)).toEqual([0, 20, 0, 12])
  })

  test("excludes a missing delta instead of plotting it as zero", () => {
    const visualization = createWidgetVisualization("line")
    const item = {
      key: "grade",
      label: "Grade",
      date: null,
      value: 0.8,
      delta: null,
      count: 1,
      series: null,
    }

    expect(
      widgetEncodedSeriesDatum(
        item,
        "category",
        "delta",
        null,
        "ratio",
        visualization,
        20
      )
    ).toBeNull()
    expect(
      widgetEncodedSeriesDatum(
        { ...item, delta: 0 },
        "category",
        "delta",
        null,
        "ratio",
        visualization,
        20
      )
    ).toMatchObject({ y: 0 })
  })

  test("uses count units for count channels on a ratio metric", () => {
    const visualization = createWidgetVisualization("bar")
    visualization.format = { decimals: 0, unit: "auto", compact: true }

    expect(widgetEncodingValueType("count", "ratio")).toBe("count")
    expect(
      widgetEncodedScaleValue(12, "count", "ratio", visualization, 20)
    ).toBe(12)
    expect(
      widgetNumericDomain(
        [12],
        false,
        widgetEncodedScaleValue(10, "count", "ratio", visualization, 20),
        widgetEncodedScaleValue(20, "count", "ratio", visualization, 20)
      )
    ).toEqual([10, 20])
    visualization.thresholds = [
      { value: 10, color: "#15803d", label: "Enough" },
    ]
    expect(
      widgetEncodedThresholdColor(12, "count", "ratio", visualization, 20)
    ).toBe("#15803d")
    expect(
      widgetValuePresentation(
        1_250,
        widgetEncodingValueType("count", "ratio"),
        visualization.format,
        20,
        2
      )
    ).toEqual({
      displayed: 1_250,
      decimals: 0,
      compact: true,
      unit: "count",
    })
  })
})
