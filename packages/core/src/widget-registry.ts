import { CARD_METRICS, type CardMetric } from "./cards";
import type {
  WidgetCapability,
  WidgetChartMark,
  WidgetComparison,
  WidgetEncodingField,
  WidgetGroupBy,
  WidgetMeasure,
  WidgetResultShape,
  WidgetScope,
  WidgetSurface,
  WidgetValueType,
} from "./widget-types";

const ALL_SURFACES: WidgetSurface[] = [
  "overview",
  "subject",
  "grade",
  "insights",
];
const ALL_SCOPES: WidgetScope["kind"][] = [
  "general",
  "subjects",
  "custom-average",
];
const COMPARISONS: WidgetComparison["kind"][] = [
  "none",
  "previous-window",
  "baseline",
];

function defineCapability(
  id: WidgetCapability["id"],
  shape: WidgetResultShape,
  valueType: WidgetValueType,
  marks: WidgetChartMark[],
  options: Partial<
    Pick<WidgetCapability, "scopes" | "groupings" | "comparisons" | "surfaces">
  > = {},
): WidgetCapability {
  return {
    id,
    messageKey: `widget.measure.${id}`,
    descriptionKey: `widget.measure.${id}.description`,
    resultShape: shape,
    valueType,
    marks,
    scopes: options.scopes ?? ALL_SCOPES,
    groupings: options.groupings ?? ["none", "time", "subject"],
    comparisons: options.comparisons ?? COMPARISONS,
    surfaces: options.surfaces ?? ALL_SURFACES,
  };
}

const SIMPLE_RECORDS: CardMetric[] = ["lastGrade", "bestGrade", "worstGrade"];

const capabilities = [
  defineCapability("average", "scalar", "ratio", [
    "value",
    "gauge",
    "line",
    "area",
    "bar",
    "dot",
    "heatmap",
  ]),
  defineCapability("averageTrend", "scalar", "ratio", [
    "value",
    "line",
    "area",
    "bar",
  ]),
  defineCapability("projection", "scalar", "ratio", [
    "value",
    "gauge",
    "line",
    "area",
  ]),
  defineCapability("gradeCount", "scalar", "count", [
    "value",
    "line",
    "bar",
    "heatmap",
  ]),
  ...SIMPLE_RECORDS.map((metric) =>
    defineCapability(metric, "record", "ratio", ["value"], {
      groupings: ["none"],
      comparisons: ["none"],
    }),
  ),
  defineCapability("bestSubject", "record", "ratio", ["value"], {
    groupings: ["none"],
    comparisons: ["none"],
  }),
  defineCapability("worstSubject", "record", "ratio", ["value"], {
    groupings: ["none"],
    comparisons: ["none"],
  }),
  defineCapability(
    "subjectRanking",
    "categorical-series",
    "ratio",
    ["bar", "dot", "table", "list"],
    { groupings: ["subject"], comparisons: ["none", "baseline"] },
  ),
  defineCapability("passRate", "scalar", "percent", [
    "value",
    "gauge",
    "line",
    "bar",
  ]),
  defineCapability("median", "scalar", "ratio", [
    "value",
    "gauge",
    "line",
    "bar",
  ]),
  defineCapability("spread", "scalar", "ratio", ["value", "line", "bar"]),
  defineCapability("consistency", "scalar", "percent", [
    "value",
    "gauge",
    "line",
    "bar",
  ]),
  defineCapability("improvement", "scalar", "ratio", [
    "value",
    "line",
    "area",
    "bar",
  ]),
  defineCapability(
    "mostImproved",
    "categorical-series",
    "ratio",
    ["bar", "dot", "table", "list"],
    { groupings: ["subject"] },
  ),
  defineCapability(
    "steadiest",
    "categorical-series",
    "percent",
    ["bar", "dot", "table", "list"],
    { groupings: ["subject"] },
  ),
  defineCapability("passStreak", "streak", "count", ["value"], {
    groupings: ["none"],
    comparisons: ["none"],
  }),
  defineCapability("activityStreak", "streak", "days", ["value"], {
    groupings: ["none"],
    comparisons: ["none"],
  }),
  defineCapability(
    "distribution",
    "distribution",
    "count",
    ["histogram", "bar", "boxplot"],
    { groupings: ["none"], comparisons: ["none"] },
  ),
  defineCapability("goalProgress", "goal", "ratio", ["gauge"], {
    scopes: ["general"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  defineCapability("formula", "scalar", "number", [
    "value",
    "gauge",
    "line",
    "area",
    "bar",
    "dot",
  ]),
] satisfies WidgetCapability[];

export const WIDGET_CAPABILITIES: ReadonlyMap<
  WidgetCapability["id"],
  WidgetCapability
> = new Map(capabilities.map((capability) => [capability.id, capability]));

if (
  CARD_METRICS.some((metric) => !WIDGET_CAPABILITIES.has(metric)) ||
  WIDGET_CAPABILITIES.size !== CARD_METRICS.length + 1
) {
  throw new Error(
    "The widget capability registry must cover every card metric",
  );
}

export function widgetCapability(id: WidgetCapability["id"]): WidgetCapability {
  const capability = WIDGET_CAPABILITIES.get(id);
  if (!capability) throw new Error(`Unknown widget capability: ${id}`);
  return capability;
}

export function widgetCapabilitiesForSurface(
  surface: WidgetSurface,
): WidgetCapability[] {
  return capabilities.filter((capability) =>
    capability.surfaces.includes(surface),
  );
}

export function widgetMeasureId(
  measure: { kind: "metric"; metric: CardMetric } | { kind: "formula" },
): WidgetCapability["id"] {
  return measure.kind === "metric" ? measure.metric : "formula";
}

export function widgetCompatibleMarks(
  measure: { kind: "metric"; metric: CardMetric } | { kind: "formula" },
  groupBy: WidgetGroupBy,
): WidgetChartMark[] {
  const capability = widgetCapability(widgetMeasureId(measure));
  if (groupBy.kind === "time") {
    return capability.marks.filter((mark) =>
      ["line", "area", "bar", "dot", "heatmap", "table", "list"].includes(mark),
    );
  }
  if (groupBy.kind === "subject") {
    return capability.marks.filter((mark) =>
      ["bar", "dot", "table", "list"].includes(mark),
    );
  }
  if (capability.resultShape === "scalar") {
    return capability.marks.filter((mark) => ["value", "gauge"].includes(mark));
  }
  return capability.marks;
}

/** Fields that the evaluator can materialize for one visual channel. */
export function widgetEncodingFields(
  capability: WidgetCapability,
  groupBy: WidgetGroupBy,
  channel: "x" | "y" | "color" | "series",
  includeDelta = false,
): WidgetEncodingField[] {
  const materialized: WidgetEncodingField[] =
    groupBy.kind === "time"
      ? ["date", "category", "value", "delta", "count"]
      : groupBy.kind === "subject"
        ? ["category", "value", "delta", "count"]
        : capability.resultShape === "distribution"
          ? ["category", "count"]
          : ["value", "delta"];
  const available = includeDelta
    ? materialized
    : materialized.filter((field) => field !== "delta");

  if (channel === "series") {
    return groupBy.kind === "time" ? ["category"] : [];
  }
  if (channel === "y") {
    return available.filter(
      (field) => field !== "date" && field !== "category",
    );
  }
  if (channel === "color") {
    return available.filter((field) => field !== "date");
  }
  return available;
}

export function widgetMeasureHasIntrinsicDelta(
  measure: WidgetMeasure,
): boolean {
  const id = widgetMeasureId(measure);
  return id === "subjectRanking" || id === "mostImproved";
}
