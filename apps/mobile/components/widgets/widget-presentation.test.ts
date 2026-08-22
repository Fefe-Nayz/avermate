import { describe, expect, test } from "bun:test";
import {
  createWidgetDefinition,
  createWidgetVisualization,
  widgetPrimaryMeasure,
} from "@avermate/core";
import {
  widgetDefinitionShowsDelta,
  widgetDistributionBarVisualization,
  widgetDistributionPresentation,
  widgetGoalPresentation,
  widgetRecordScalar,
  widgetScalarPresentation,
  widgetSeriesColumnVisibility,
  widgetStreakScalar,
} from "./widget-presentation";

describe("widget presentation", () => {
  test("applies gauge options, scale and thresholds to a V1 goal value", () => {
    const definition = createWidgetDefinition("overview");
    definition.visualization = createWidgetVisualization("gauge");
    definition.visualization.options = {
      kind: "gauge",
      showValue: false,
      thickness: 18,
    };
    definition.visualization.scale.y.max = 0.8;
    definition.visualization.thresholds = [
      { value: 0.6, color: "#16A34A", label: "On track" },
    ];

    const presentation = widgetScalarPresentation(definition, {
      kind: "scalar",
      shape: "scalar",
      value: 0.7,
      valueType: "ratio",
      delta: -0.1,
    });

    expect(presentation).toMatchObject({
      showValue: false,
      showDelta: false,
      gaugeThickness: 18,
      threshold: { label: "On track", color: "#16A34A" },
    });
    expect(presentation.progress).toBeCloseTo(0.875);
  });

  test("converts a V1 record before applying value deltas and thresholds", () => {
    const definition = createWidgetDefinition("overview");
    definition.visualization.thresholds = [
      { value: 0.75, color: "#2563EB", label: "Strong" },
    ];
    const scalar = widgetRecordScalar({
      kind: "subject",
      subjectId: "math",
      name: "Mathematics",
      ratio: 0.8,
      delta: 0.05,
    });

    expect(scalar).not.toBeNull();
    expect(widgetScalarPresentation(definition, scalar!)).toMatchObject({
      showDelta: true,
      trendIndicator: true,
      threshold: { label: "Strong" },
    });
  });

  test("does not invent a delta for activity and passing streaks", () => {
    const activity = createWidgetDefinition("overview");
    activity.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric: "activityStreak", goalId: null },
      },
    ];
    const passing = createWidgetDefinition("overview");
    passing.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric: "passStreak", goalId: null },
      },
    ];
    const streak = {
      kind: "streak",
      current: 3,
      longest: 8,
      alive: true,
    } as const;

    expect(widgetStreakScalar(activity, streak)).toMatchObject({
      value: 3,
      valueType: "days",
      delta: null,
    });
    expect(widgetStreakScalar(passing, streak)).toMatchObject({
      value: 3,
      valueType: "count",
      delta: null,
    });

    activity.visualization.options = {
      kind: "value",
      showDelta: true,
      trendIndicator: true,
    };
    expect(
      widgetScalarPresentation(activity, widgetStreakScalar(activity, streak)),
    ).toMatchObject({ showDelta: false, trendIndicator: false });
  });

  test("only materializes list and table adornments allowed by the definition", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric: "subjectRanking", goalId: null },
      },
    ];
    const values = [
      {
        key: "math",
        label: "Mathematics",
        date: null,
        value: 0.8,
        delta: 0.05,
        count: 4,
        series: null,
      },
    ];

    expect(widgetDefinitionShowsDelta(definition)).toBe(true);
    expect(
      widgetSeriesColumnVisibility(definition, values, {
        table: false,
        showValues: false,
      }),
    ).toEqual({ showValue: false, showDelta: false, showCount: false });
    expect(
      widgetSeriesColumnVisibility(definition, values, {
        table: true,
        showValues: true,
      }),
    ).toEqual({ showValue: true, showDelta: true, showCount: true });
    expect(
      widgetSeriesColumnVisibility(definition, values, {
        table: true,
        showValues: true,
        countMaterialized: false,
      }).showCount,
    ).toBe(false);

    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric: "steadiest", goalId: null },
      },
    ];
    expect(widgetDefinitionShowsDelta(definition)).toBe(false);
    expect(
      widgetSeriesColumnVisibility(definition, values, {
        table: true,
        showValues: true,
      }).showDelta,
    ).toBe(false);

    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric: "mostImproved", goalId: null },
      },
    ];
    expect(widgetDefinitionShowsDelta(definition)).toBe(true);
  });

  test("keeps a goal target and status when there is no current grade", () => {
    const goal = widgetGoalPresentation({
      kind: "goal",
      plan: {
        current: null,
        target: 0.8,
        status: "no-data",
        gap: null,
      },
    } as Parameters<typeof widgetGoalPresentation>[0]);

    expect(goal).toEqual({
      target: 0.8,
      status: "no-data",
      scalar: null,
    });
  });

  test("uses counts for distribution bars and the ratio summary for boxplots", () => {
    const result = {
      kind: "distribution",
      shape: "distribution",
      buckets: [
        { from: 0.4, to: 0.6, count: 2 },
        { from: 0.6, to: 0.8, count: 5 },
      ],
      total: 7,
      summary: {
        min: 0.42,
        q1: 0.55,
        median: 0.67,
        q3: 0.74,
        max: 0.79,
        outliers: [0.2],
      },
    } as Parameters<typeof widgetDistributionPresentation>[0];

    const presentation = widgetDistributionPresentation(result);

    expect(presentation.buckets.map((bucket) => bucket.magnitude)).toEqual([
      2, 5,
    ]);
    expect(presentation.summary).toBe(result.summary);
    expect(presentation.summary.median).toBe(0.67);

    const visualization = createWidgetVisualization("bar");
    visualization.encoding.y = { field: "value", type: "quantitative" };
    const rendered = widgetDistributionBarVisualization(visualization);
    expect(rendered.encoding.y).toEqual({
      field: "count",
      type: "quantitative",
    });
    expect(visualization.encoding.y).toEqual({
      field: "value",
      type: "quantitative",
    });
  });
});
