import {
  widgetCapability,
  widgetMeasureHasIntrinsicDelta,
  widgetMeasureId,
  type CardResult,
  type WidgetDefinitionV1,
  type WidgetEvaluationResult,
  type WidgetSeriesDatum,
  type WidgetVisualizationV1,
} from "@avermate/core";

type ScalarResult = Extract<WidgetEvaluationResult, { kind: "scalar" }>;
type RecordResult = Extract<CardResult, { kind: "grade" | "subject" }>;
type StreakResult = Extract<CardResult, { kind: "streak" }>;
type GoalResult = Extract<CardResult, { kind: "goal" }>;
type DistributionResult = Extract<
  WidgetEvaluationResult,
  { kind: "distribution" }
>;

export function widgetThreshold(value: number, definition: WidgetDefinitionV1) {
  return (
    [...definition.visualization.thresholds]
      .sort((left, right) => left.value - right.value)
      .filter((threshold) => value >= threshold.value)
      .at(-1) ?? null
  );
}

export function widgetRecordScalar(value: RecordResult): ScalarResult | null {
  if (value.ratio === null) return null;
  return {
    kind: "scalar",
    shape: "scalar",
    value: value.ratio,
    valueType: "ratio",
    delta: value.kind === "subject" ? value.delta : null,
  };
}

export function widgetStreakScalar(
  definition: WidgetDefinitionV1,
  value: StreakResult,
): ScalarResult {
  return {
    kind: "scalar",
    shape: "scalar",
    value: value.current,
    valueType: widgetCapability(widgetMeasureId(definition.analysis.measure))
      .valueType,
    delta: null,
  };
}

export function widgetDefinitionShowsDelta(
  definition: WidgetDefinitionV1,
): boolean {
  return (
    definition.analysis.comparison.kind !== "none" ||
    widgetMeasureHasIntrinsicDelta(definition.analysis.measure)
  );
}

export function widgetSeriesColumnVisibility(
  definition: WidgetDefinitionV1,
  values: readonly WidgetSeriesDatum[],
  options: {
    table: boolean;
    showValues: boolean;
    countMaterialized?: boolean;
  },
) {
  const showDelta =
    options.showValues &&
    widgetDefinitionShowsDelta(definition) &&
    values.some((entry) => entry.delta !== null);
  return {
    showValue: options.showValues,
    showDelta,
    showCount:
      options.table &&
      options.countMaterialized !== false &&
      values.some((entry) => Number.isFinite(entry.count)),
  };
}

export function widgetDistributionBarVisualization(
  visualization: WidgetVisualizationV1,
): WidgetVisualizationV1 {
  return {
    ...visualization,
    encoding: {
      ...visualization.encoding,
      y: { field: "count", type: "quantitative" },
    },
  };
}

export function widgetGoalPresentation(value: GoalResult) {
  const { plan } = value;
  return {
    target: plan.target,
    status: plan.status,
    scalar:
      plan.current === null
        ? null
        : {
            kind: "scalar" as const,
            shape: "scalar" as const,
            value: plan.current,
            valueType: "ratio" as const,
            delta: plan.gap === null ? null : -plan.gap,
          },
  };
}

export function widgetDistributionPresentation(value: DistributionResult) {
  return {
    buckets: value.buckets.map((bucket) => ({
      ...bucket,
      magnitude: bucket.count,
    })),
    summary: value.summary,
  };
}

export function widgetScalarPresentation(
  definition: WidgetDefinitionV1,
  result: ScalarResult,
) {
  const options = definition.visualization.options;
  const valueOptions = options.kind === "value" ? options : null;
  const gaugeOptions = options.kind === "gauge" ? options : null;
  const scale = definition.visualization.scale.y;
  const minimum = scale.min ?? 0;
  const maximum =
    scale.max ??
    (result.valueType === "ratio" || result.valueType === "percent"
      ? 1
      : Math.max(1, result.value));
  const rawProgress =
    (result.value - minimum) / Math.max(1e-9, maximum - minimum);

  return {
    showValue: gaugeOptions?.showValue ?? true,
    showDelta: Boolean(valueOptions?.showDelta && result.delta !== null),
    trendIndicator: Boolean(
      valueOptions?.trendIndicator && result.delta !== null,
    ),
    gaugeThickness: gaugeOptions?.thickness ?? 10,
    progress: Math.max(
      0,
      Math.min(1, scale.reverse ? 1 - rawProgress : rawProgress),
    ),
    threshold: widgetThreshold(result.value, definition),
  };
}
