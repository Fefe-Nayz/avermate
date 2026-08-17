import type { CardDisplay } from "./cards";
import { widgetCapability, widgetCompatibleMarks } from "./widget-registry";
import type {
  WidgetChartMark,
  WidgetDefinitionV1,
  CardSemantics,
  WidgetMarkOptions,
  WidgetPreset,
  WidgetSurface,
  WidgetVisualizationV1,
} from "./widget-types";

function defaultMarkOptions(mark: WidgetChartMark): WidgetMarkOptions {
  switch (mark) {
    case "value":
      return { kind: "value", showDelta: true, trendIndicator: true };
    case "gauge":
      return { kind: "gauge", showValue: true, thickness: 10 };
    case "line":
      return { kind: "line", curve: "monotone", points: false, strokeWidth: 2 };
    case "area":
      return { kind: "area", curve: "monotone", points: false, opacity: 0.22 };
    case "bar":
      return {
        kind: "bar",
        orientation: "vertical",
        stacked: false,
        cornerRadius: 4,
      };
    case "dot":
      return { kind: "dot", size: 6 };
    case "histogram":
      return { kind: "histogram", bins: 10 };
    case "boxplot":
      return { kind: "boxplot", showOutliers: true };
    case "heatmap":
      return { kind: "heatmap", colorScheme: "semantic" };
    case "table":
      return { kind: "table", rows: 10 };
    case "list":
      return { kind: "list", rows: 8, showValues: true };
  }
}

export function createWidgetVisualization(
  mark: WidgetChartMark,
): WidgetVisualizationV1 {
  const isSeries = ["line", "area", "bar", "dot"].includes(mark);
  return {
    mark,
    encoding: {
      x: isSeries ? { field: "date", type: "temporal" } : null,
      y: isSeries ? { field: "value", type: "quantitative" } : null,
      color: null,
      series: null,
    },
    options: defaultMarkOptions(mark),
    scale: {
      x: { reverse: false },
      y: { zero: false, min: null, max: null, reverse: false },
    },
    axes: {
      x: { visible: isSeries, grid: false, label: null },
      y: { visible: isSeries, grid: true, label: null },
    },
    legend: { visible: false, position: "bottom" },
    format: { decimals: null, unit: "auto", compact: false },
    thresholds: [],
  };
}

export function createWidgetDefinition(
  surface: WidgetSurface = "overview",
): WidgetDefinitionV1 {
  const mark: WidgetChartMark = surface === "insights" ? "line" : "value";
  return {
    apiVersion: 1,
    query: {
      source: "grades",
      scope: { kind: "general" },
      window: { kind: "active-period" },
      filters: [],
    },
    analysis: {
      measure: { kind: "metric", metric: "average", goalId: null },
      groupBy:
        surface === "insights"
          ? { kind: "time", interval: "week", accumulation: "running" }
          : { kind: "none" },
      comparison: { kind: "none" },
      transforms: [],
    },
    visualization: createWidgetVisualization(mark),
  };
}

function displayToMark(input: CardSemantics): WidgetChartMark {
  if (input.display === "value") return "value";
  if (input.display === "gauge") return "gauge";
  if (input.display === "list") return "list";
  if (input.metric === "distribution") return "histogram";
  return input.display === "sparkline" || input.display === "chart"
    ? "line"
    : "value";
}

export function widgetDefinitionFromCard(
  input: CardSemantics,
): WidgetDefinitionV1 {
  const mark = displayToMark(input);
  const scope =
    input.metric === "goalProgress"
      ? { kind: "general" as const }
      : input.targetKind === "subject" && input.targetId
        ? {
            kind: "subjects" as const,
            subjectIds: [input.targetId],
            includeDescendants: true,
          }
        : input.targetKind === "custom" && input.targetId
          ? { kind: "custom-average" as const, averageId: input.targetId }
          : { kind: "general" as const };
  const capability = widgetCapability(input.metric);
  const groupBy =
    capability.groupings.includes("subject") &&
    ["subjectRanking", "mostImproved", "steadiest"].includes(input.metric)
      ? { kind: "subject" as const, limit: 10, includeCategories: false }
      : mark === "line" && capability.groupings.includes("time")
        ? {
            kind: "time" as const,
            interval: "week" as const,
            accumulation: "running" as const,
          }
        : { kind: "none" as const };
  const compatibleMarks = widgetCompatibleMarks(
    { kind: "metric", metric: input.metric },
    groupBy,
  );
  const compatibleMark = compatibleMarks.includes(mark)
    ? mark
    : (compatibleMarks[0] ?? "value");
  return {
    apiVersion: 1,
    query: {
      source: "grades",
      scope,
      window: { kind: "active-period" },
      filters: [],
    },
    analysis: {
      measure: { kind: "metric", metric: input.metric, goalId: input.goalId },
      groupBy,
      comparison: { kind: "none" },
      transforms: [],
    },
    visualization: createWidgetVisualization(compatibleMark),
  };
}

function markToDisplay(mark: WidgetChartMark): CardDisplay {
  if (mark === "value") return "value";
  if (mark === "gauge") return "gauge";
  if (mark === "list" || mark === "table") return "list";
  return "chart";
}

export function cardSemanticsFromDefinition(
  definition: WidgetDefinitionV1,
): CardSemantics {
  const measure = definition.analysis.measure;
  const metric = measure.kind === "metric" ? measure.metric : "average";
  const target = definition.query.scope;
  const targetKind =
    target.kind === "subjects"
      ? "subject"
      : target.kind === "custom-average"
        ? "custom"
        : "general";
  const targetId =
    target.kind === "subjects"
      ? (target.subjectIds[0] ?? null)
      : target.kind === "custom-average"
        ? target.averageId
        : null;
  return {
    metric,
    targetKind,
    targetId,
    goalId: measure.kind === "metric" ? measure.goalId : null,
    display: markToDisplay(definition.visualization.mark),
  };
}

function preset(
  key: string,
  metric: CardSemantics["metric"],
  mark: WidgetChartMark,
  span: 1 | 2 | 3 | 4,
): WidgetPreset {
  const definition = widgetDefinitionFromCard({
    metric,
    targetKind: "general",
    targetId: null,
    goalId: null,
    display: markToDisplay(mark),
  });
  const compatible = widgetCompatibleMarks(
    definition.analysis.measure,
    definition.analysis.groupBy,
  );
  definition.visualization = createWidgetVisualization(
    compatible.includes(mark) ? mark : (compatible[0] ?? "value"),
  );
  if (definition.analysis.groupBy.kind === "subject") {
    definition.visualization.encoding.x = {
      field: "category",
      type: "nominal",
    };
    definition.visualization.encoding.y = {
      field: "value",
      type: "quantitative",
    };
  }
  return { key, definition, presentation: { span, title: null, accent: null } };
}

/** Recommended Insights is explicit: clients call reset; empty never auto-seeds. */
export function defaultInsightWidgets(): WidgetPreset[] {
  return [
    preset("average-over-time", "average", "line", 4),
    preset("distribution", "distribution", "histogram", 2),
    preset("most-improved", "mostImproved", "bar", 2),
    preset("consistency", "consistency", "gauge", 2),
  ].map((item) => ({
    ...item,
    definition: {
      ...item.definition,
      query: {
        ...item.definition.query,
        window: { kind: "whole-year" },
      },
    },
  }));
}
