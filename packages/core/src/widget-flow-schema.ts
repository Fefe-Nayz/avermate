import type {
  WidgetCollectionField,
  WidgetCollectionSchema,
  WidgetFlowCondition,
  WidgetFlowFieldSchema,
  WidgetFlowOption,
} from "./widget-types";

const always: WidgetFlowCondition = { kind: "always" };
const equals = (
  path: string,
  value: string | number | boolean | null,
): WidgetFlowCondition => ({ kind: "equals", path, value });
const oneOf = (
  path: string,
  values: Array<string | number | boolean>,
): WidgetFlowCondition => ({ kind: "one-of", path, values });
const exists = (path: string): WidgetFlowCondition => ({
  kind: "exists",
  path,
});
const notGoalProgress: WidgetFlowCondition = {
  kind: "not",
  condition: equals("analysis.measure.metric", "goalProgress"),
};
const valueAdornmentMetric: WidgetFlowCondition = {
  kind: "and",
  conditions: [
    equals("visualization.mark", "value"),
    {
      kind: "not",
      condition: equals("analysis.comparison.kind", "none"),
    },
    {
      kind: "or",
      conditions: [
        equals("analysis.measure.kind", "formula"),
        oneOf("analysis.measure.metric", [
          "average",
          "averageTrend",
          "projection",
          "gradeCount",
          "passRate",
          "median",
          "spread",
          "consistency",
          "improvement",
        ]),
      ],
    },
  ],
};

function options(...values: string[]): WidgetFlowOption[] {
  return values.map((value) => ({
    value,
    messageKey: `widget.option.${value}`,
  }));
}

function collectionField(
  id: string,
  path: string,
  control: WidgetCollectionField["control"],
  extra: Partial<WidgetCollectionField> = {},
): WidgetCollectionField {
  return {
    id,
    path,
    control,
    messageKey: `widget.field.${id}`,
    descriptionKey: null,
    required: true,
    visibleWhen: always,
    ...extra,
  };
}

const operatorOptions = options("gt", "gte", "lt", "lte", "eq");

export const WIDGET_FILTER_SCHEMA: WidgetCollectionSchema = {
  discriminator: "kind",
  minItems: 0,
  maxItems: 12,
  addMessageKey: "widget.action.add-filter",
  variants: [
    {
      value: "grade-ratio",
      messageKey: "widget.filter.grade-ratio",
      fields: [
        collectionField("filter-operator", "operator", "choice", {
          options: operatorOptions,
        }),
        collectionField("filter-ratio", "value", "number", {
          min: 0,
          max: 1,
          step: 0.01,
        }),
      ],
    },
    {
      value: "coefficient",
      messageKey: "widget.filter.coefficient",
      fields: [
        collectionField("filter-operator", "operator", "choice", {
          options: operatorOptions,
        }),
        collectionField("filter-coefficient", "value", "number", {
          min: 0,
          max: 1_000,
          step: 0.1,
        }),
      ],
    },
    {
      value: "has-note",
      messageKey: "widget.filter.has-note",
      fields: [collectionField("filter-has-note", "value", "toggle")],
    },
    {
      value: "grade-name",
      messageKey: "widget.filter.grade-name",
      fields: [
        collectionField("filter-text-operator", "operator", "choice", {
          options: options("contains", "not-contains"),
        }),
        collectionField("filter-text", "value", "text"),
      ],
    },
    {
      value: "passed",
      messageKey: "widget.filter.passed",
      fields: [collectionField("filter-passed", "value", "toggle")],
    },
  ],
};

export const WIDGET_TRANSFORM_SCHEMA: WidgetCollectionSchema = {
  discriminator: "kind",
  minItems: 0,
  maxItems: 8,
  addMessageKey: "widget.action.add-transform",
  variants: [
    {
      value: "sort",
      messageKey: "widget.transform.sort",
      fields: [
        collectionField("transform-direction", "direction", "choice", {
          options: options("ascending", "descending"),
        }),
      ],
    },
    {
      value: "limit",
      messageKey: "widget.transform.limit",
      fields: [
        collectionField("transform-limit", "count", "number", {
          min: 1,
          max: 500,
          step: 1,
        }),
      ],
    },
    {
      value: "moving-average",
      messageKey: "widget.transform.moving-average",
      visibleWhen: equals("analysis.groupBy.kind", "time"),
      fields: [
        collectionField("transform-points", "points", "number", {
          min: 2,
          max: 100,
          step: 1,
        }),
      ],
    },
    {
      value: "cumulative",
      messageKey: "widget.transform.cumulative",
      visibleWhen: equals("analysis.groupBy.kind", "time"),
      fields: [],
    },
  ],
};

export const WIDGET_THRESHOLD_SCHEMA: WidgetCollectionSchema = {
  discriminator: null,
  minItems: 0,
  maxItems: 8,
  addMessageKey: "widget.action.add-threshold",
  variants: [
    {
      value: "threshold",
      messageKey: "widget.threshold",
      fields: [
        collectionField("threshold-value", "value", "number"),
        collectionField("threshold-color", "color", "color", {
          required: false,
        }),
        collectionField("threshold-label", "label", "text", {
          required: false,
        }),
      ],
    },
  ],
};

export const WIDGET_FORMULA_SCHEMA: WidgetCollectionSchema = {
  discriminator: "kind",
  minItems: 1,
  maxItems: 1,
  addMessageKey: "widget.action.choose-formula-node",
  variants: [
    {
      value: "literal",
      messageKey: "widget.formula.literal",
      fields: [collectionField("formula-value", "value", "number")],
    },
    {
      value: "parameter",
      messageKey: "widget.formula.parameter",
      fields: [
        collectionField("formula-parameter", "name", "choice", {
          options: options("passingRatio", "yearScale"),
        }),
      ],
    },
    {
      value: "aggregate",
      messageKey: "widget.formula.aggregate",
      fields: [
        collectionField("formula-aggregate", "operation", "choice", {
          options: options(
            "count",
            "sum",
            "mean",
            "median",
            "min",
            "max",
            "standard-deviation",
          ),
        }),
        collectionField("formula-field", "field", "choice", {
          options: options("ratio", "value", "outOf", "coefficient"),
          visibleWhen: {
            kind: "not",
            condition: equals("operation", "count"),
          },
        }),
      ],
    },
    {
      value: "metric",
      messageKey: "widget.formula.metric",
      fields: [
        collectionField("formula-metric", "metric", "choice", {
          // Labelled with the measure keys the metric dropdown already uses.
          options: [
            "average",
            "averageTrend",
            "projection",
            "gradeCount",
            "passRate",
            "median",
            "spread",
            "consistency",
            "improvement",
          ].map((value) => ({
            value,
            messageKey: `widget.measure.${value}`,
          })),
        }),
        collectionField("formula-metric-scope", "scope.kind", "choice", {
          options: options("inherit", "general", "subjects", "custom-average"),
          required: false,
        }),
        collectionField(
          "formula-metric-subjects",
          "scope.subjectIds",
          "multi-choice",
          {
            optionProvider: "subjects",
            visibleWhen: equals("scope.kind", "subjects"),
          },
        ),
        collectionField("formula-metric-average", "scope.averageId", "choice", {
          optionProvider: "custom-averages",
          visibleWhen: equals("scope.kind", "custom-average"),
        }),
        collectionField("formula-metric-window", "window.kind", "choice", {
          options: options("inherit", "active-period", "whole-year"),
          required: false,
        }),
      ],
    },
    {
      value: "unary",
      messageKey: "widget.formula.unary",
      fields: [
        collectionField("formula-unary-operation", "operation", "choice", {
          options: options("absolute", "negate", "round", "floor", "ceil"),
        }),
        collectionField("formula-operand", "operand", "formula", {
          recursive: "self",
        }),
      ],
    },
    {
      value: "binary",
      messageKey: "widget.formula.binary",
      fields: [
        collectionField("formula-binary-operation", "operation", "choice", {
          options: options(
            "add",
            "subtract",
            "multiply",
            "divide",
            "minimum",
            "maximum",
          ),
        }),
        collectionField("formula-left", "left", "formula", {
          recursive: "self",
        }),
        collectionField("formula-right", "right", "formula", {
          recursive: "self",
        }),
      ],
    },
    {
      value: "compare",
      messageKey: "widget.formula.compare",
      fields: [
        collectionField("formula-compare-operation", "operation", "choice", {
          options: operatorOptions,
        }),
        collectionField("formula-left", "left", "formula", {
          recursive: "self",
        }),
        collectionField("formula-right", "right", "formula", {
          recursive: "self",
        }),
      ],
    },
    {
      value: "conditional",
      messageKey: "widget.formula.conditional",
      fields: [
        collectionField("formula-condition", "condition", "formula", {
          recursive: "self",
        }),
        collectionField("formula-when-true", "whenTrue", "formula", {
          recursive: "self",
        }),
        collectionField("formula-when-false", "whenFalse", "formula", {
          recursive: "self",
        }),
      ],
    },
  ],
};

function field(
  id: string,
  editor: WidgetFlowFieldSchema["editor"],
  section: string,
  order: number,
  path: string,
  control: WidgetFlowFieldSchema["control"],
  extra: Partial<WidgetFlowFieldSchema> = {},
): WidgetFlowFieldSchema {
  return {
    id,
    editor,
    section,
    order,
    path,
    control,
    messageKey: `widget.field.${id}`,
    descriptionKey: null,
    required: true,
    clearWhenHidden: true,
    visibleWhen: always,
    ...extra,
  };
}

/** Declarative editor graph. Clients only understand controls and paths. */
export const WIDGET_FLOW_SCHEMA: readonly WidgetFlowFieldSchema[] = [
  field("scope", "definition", "data", 10, "query.scope.kind", "choice", {
    options: options("general", "subjects", "custom-average"),
  }),
  field(
    "subjects",
    "definition",
    "data",
    20,
    "query.scope.subjectIds",
    "multi-choice",
    {
      optionProvider: "subjects",
      visibleWhen: equals("query.scope.kind", "subjects"),
    },
  ),
  field(
    "include-descendants",
    "definition",
    "data",
    30,
    "query.scope.includeDescendants",
    "toggle",
    {
      visibleWhen: equals("query.scope.kind", "subjects"),
    },
  ),
  field(
    "custom-average",
    "definition",
    "data",
    40,
    "query.scope.averageId",
    "reference",
    {
      optionProvider: "custom-averages",
      visibleWhen: equals("query.scope.kind", "custom-average"),
    },
  ),
  field("window", "definition", "window", 10, "query.window.kind", "choice", {
    options: options(
      "active-period",
      "whole-year",
      "period",
      "rolling-days",
      "last-grades",
      "date-range",
    ),
    visibleWhen: notGoalProgress,
  }),
  field(
    "period",
    "definition",
    "window",
    20,
    "query.window.periodId",
    "reference",
    {
      optionProvider: "periods",
      visibleWhen: equals("query.window.kind", "period"),
    },
  ),
  field(
    "rolling-days",
    "definition",
    "window",
    30,
    "query.window.days",
    "number",
    {
      min: 1,
      max: 3_650,
      step: 1,
      visibleWhen: equals("query.window.kind", "rolling-days"),
    },
  ),
  field(
    "last-grades",
    "definition",
    "window",
    40,
    "query.window.count",
    "number",
    {
      min: 1,
      max: 500,
      step: 1,
      visibleWhen: equals("query.window.kind", "last-grades"),
    },
  ),
  field("from", "definition", "window", 50, "query.window.from", "date", {
    visibleWhen: equals("query.window.kind", "date-range"),
  }),
  field("to", "definition", "window", 60, "query.window.to", "date", {
    visibleWhen: equals("query.window.kind", "date-range"),
  }),
  field("filters", "definition", "filters", 10, "query.filters", "filters", {
    required: false,
    clearWhenHidden: false,
    collection: WIDGET_FILTER_SCHEMA,
    visibleWhen: notGoalProgress,
  }),
  field(
    "measure-kind",
    "definition",
    "measure",
    10,
    "analysis.measure.kind",
    "choice",
    {
      options: options("metric", "formula"),
    },
  ),
  field(
    "metric",
    "definition",
    "measure",
    20,
    "analysis.measure.metric",
    "choice",
    {
      optionProvider: "metrics",
      visibleWhen: equals("analysis.measure.kind", "metric"),
    },
  ),
  field(
    "goal",
    "definition",
    "measure",
    30,
    "analysis.measure.goalId",
    "reference",
    {
      optionProvider: "goals",
      visibleWhen: equals("analysis.measure.metric", "goalProgress"),
    },
  ),
  field(
    "formula-output",
    "definition",
    "measure",
    40,
    "analysis.measure.valueType",
    "choice",
    {
      options: options("ratio", "number", "count", "percent"),
      visibleWhen: equals("analysis.measure.kind", "formula"),
    },
  ),
  field(
    "formula",
    "definition",
    "measure",
    50,
    "analysis.measure.formula",
    "formula",
    {
      visibleWhen: equals("analysis.measure.kind", "formula"),
      collection: WIDGET_FORMULA_SCHEMA,
    },
  ),
  field(
    "group-by",
    "definition",
    "grouping",
    10,
    "analysis.groupBy.kind",
    "choice",
    {
      options: options("none", "time", "subject"),
    },
  ),
  field(
    "time-interval",
    "definition",
    "grouping",
    20,
    "analysis.groupBy.interval",
    "choice",
    {
      options: options("day", "week", "month"),
      visibleWhen: equals("analysis.groupBy.kind", "time"),
    },
  ),
  field(
    "time-accumulation",
    "definition",
    "grouping",
    25,
    "analysis.groupBy.accumulation",
    "choice",
    {
      options: options("bucket", "running"),
      visibleWhen: equals("analysis.groupBy.kind", "time"),
    },
  ),
  field(
    "subject-limit",
    "definition",
    "grouping",
    30,
    "analysis.groupBy.limit",
    "number",
    {
      min: 1,
      max: 100,
      step: 1,
      visibleWhen: equals("analysis.groupBy.kind", "subject"),
    },
  ),
  field(
    "include-categories",
    "definition",
    "grouping",
    40,
    "analysis.groupBy.includeCategories",
    "toggle",
    {
      visibleWhen: equals("analysis.groupBy.kind", "subject"),
    },
  ),
  field(
    "comparison",
    "definition",
    "comparison",
    10,
    "analysis.comparison.kind",
    "choice",
    {
      options: options("none", "previous-window", "baseline"),
    },
  ),
  field(
    "baseline",
    "definition",
    "comparison",
    20,
    "analysis.comparison.value",
    "number",
    {
      visibleWhen: equals("analysis.comparison.kind", "baseline"),
    },
  ),
  field(
    "transforms",
    "definition",
    "transforms",
    10,
    "analysis.transforms",
    "transforms",
    {
      required: false,
      clearWhenHidden: false,
      collection: WIDGET_TRANSFORM_SCHEMA,
      visibleWhen: oneOf("analysis.groupBy.kind", ["time", "subject"]),
    },
  ),
  field("mark", "visualization", "chart", 10, "visualization.mark", "choice", {
    optionProvider: "marks",
  }),
  field(
    "encoding-x",
    "visualization",
    "encoding",
    10,
    "visualization.encoding.x.field",
    "encoding",
    {
      optionProvider: "encoding-fields",
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "heatmap",
      ]),
      required: false,
    },
  ),
  field(
    "encoding-y",
    "visualization",
    "encoding",
    20,
    "visualization.encoding.y.field",
    "encoding",
    {
      optionProvider: "encoding-fields",
      visibleWhen: {
        kind: "and",
        conditions: [
          oneOf("visualization.mark", [
            "line",
            "area",
            "bar",
            "dot",
            "histogram",
            "heatmap",
            "boxplot",
          ]),
          {
            kind: "not",
            condition: {
              kind: "and",
              conditions: [
                equals("analysis.measure.metric", "distribution"),
                oneOf("visualization.mark", ["histogram", "boxplot"]),
              ],
            },
          },
        ],
      },
      required: false,
    },
  ),
  field(
    "encoding-color",
    "visualization",
    "encoding",
    30,
    "visualization.encoding.color.field",
    "encoding",
    {
      optionProvider: "encoding-fields",
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "heatmap",
      ]),
      required: false,
    },
  ),
  field(
    "encoding-series",
    "visualization",
    "encoding",
    40,
    "visualization.encoding.series.field",
    "encoding",
    {
      optionProvider: "encoding-fields",
      visibleWhen: oneOf("visualization.mark", ["line", "area", "bar", "dot"]),
      required: false,
    },
  ),
  field(
    "curve",
    "visualization",
    "appearance",
    10,
    "visualization.options.curve",
    "choice",
    {
      options: options("linear", "monotone", "step"),
      visibleWhen: oneOf("visualization.mark", ["line", "area"]),
    },
  ),
  field(
    "value-delta",
    "visualization",
    "appearance",
    5,
    "visualization.options.showDelta",
    "toggle",
    {
      visibleWhen: valueAdornmentMetric,
    },
  ),
  field(
    "value-trend",
    "visualization",
    "appearance",
    6,
    "visualization.options.trendIndicator",
    "toggle",
    {
      visibleWhen: valueAdornmentMetric,
    },
  ),
  field(
    "points",
    "visualization",
    "appearance",
    20,
    "visualization.options.points",
    "toggle",
    {
      visibleWhen: oneOf("visualization.mark", ["line", "area"]),
    },
  ),
  field(
    "stroke-width",
    "visualization",
    "appearance",
    30,
    "visualization.options.strokeWidth",
    "number",
    {
      min: 1,
      max: 8,
      step: 0.5,
      visibleWhen: equals("visualization.mark", "line"),
    },
  ),
  field(
    "area-opacity",
    "visualization",
    "appearance",
    40,
    "visualization.options.opacity",
    "number",
    {
      min: 0,
      max: 1,
      step: 0.05,
      visibleWhen: equals("visualization.mark", "area"),
    },
  ),
  field(
    "bar-orientation",
    "visualization",
    "appearance",
    50,
    "visualization.options.orientation",
    "choice",
    {
      options: options("vertical", "horizontal"),
      visibleWhen: equals("visualization.mark", "bar"),
    },
  ),
  field(
    "bar-stacked",
    "visualization",
    "appearance",
    60,
    "visualization.options.stacked",
    "toggle",
    {
      visibleWhen: {
        kind: "and",
        conditions: [
          equals("visualization.mark", "bar"),
          equals("analysis.groupBy.kind", "time"),
          {
            kind: "or",
            conditions: [
              equals("visualization.encoding.color.field", "category"),
              equals("visualization.encoding.series.field", "category"),
            ],
          },
        ],
      },
    },
  ),
  field(
    "bar-radius",
    "visualization",
    "appearance",
    70,
    "visualization.options.cornerRadius",
    "number",
    {
      min: 0,
      max: 20,
      step: 1,
      visibleWhen: equals("visualization.mark", "bar"),
    },
  ),
  field(
    "gauge-thickness",
    "visualization",
    "appearance",
    80,
    "visualization.options.thickness",
    "number",
    {
      min: 2,
      max: 32,
      step: 1,
      visibleWhen: equals("visualization.mark", "gauge"),
    },
  ),
  field(
    "gauge-value",
    "visualization",
    "appearance",
    81,
    "visualization.options.showValue",
    "toggle",
    {
      visibleWhen: equals("visualization.mark", "gauge"),
    },
  ),
  field(
    "dot-size",
    "visualization",
    "appearance",
    82,
    "visualization.options.size",
    "number",
    {
      min: 1,
      max: 24,
      step: 1,
      visibleWhen: equals("visualization.mark", "dot"),
    },
  ),
  field(
    "histogram-bins",
    "visualization",
    "appearance",
    90,
    "visualization.options.bins",
    "number",
    {
      min: 3,
      max: 40,
      step: 1,
      visibleWhen: equals("visualization.mark", "histogram"),
    },
  ),
  field(
    "heatmap-colors",
    "visualization",
    "appearance",
    100,
    "visualization.options.colorScheme",
    "choice",
    {
      options: options("semantic", "sequential", "diverging"),
      visibleWhen: equals("visualization.mark", "heatmap"),
    },
  ),
  field(
    "boxplot-outliers",
    "visualization",
    "appearance",
    101,
    "visualization.options.showOutliers",
    "toggle",
    {
      visibleWhen: equals("visualization.mark", "boxplot"),
    },
  ),
  field(
    "rows",
    "visualization",
    "appearance",
    110,
    "visualization.options.rows",
    "number",
    {
      min: 1,
      max: 100,
      step: 1,
      visibleWhen: oneOf("visualization.mark", ["table", "list"]),
    },
  ),
  field(
    "list-values",
    "visualization",
    "appearance",
    111,
    "visualization.options.showValues",
    "toggle",
    {
      visibleWhen: equals("visualization.mark", "list"),
    },
  ),
  field(
    "scale-zero",
    "visualization",
    "scale",
    10,
    "visualization.scale.y.zero",
    "toggle",
    {
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "histogram",
        "boxplot",
      ]),
    },
  ),
  field(
    "scale-min",
    "visualization",
    "scale",
    20,
    "visualization.scale.y.min",
    "number",
    {
      required: false,
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "histogram",
        "boxplot",
        "gauge",
      ]),
    },
  ),
  field(
    "scale-max",
    "visualization",
    "scale",
    30,
    "visualization.scale.y.max",
    "number",
    {
      required: false,
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "histogram",
        "boxplot",
        "gauge",
      ]),
    },
  ),
  field(
    "scale-reverse-y",
    "visualization",
    "scale",
    40,
    "visualization.scale.y.reverse",
    "toggle",
    {
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "histogram",
        "boxplot",
        "gauge",
        "heatmap",
      ]),
    },
  ),
  field(
    "scale-reverse-x",
    "visualization",
    "scale",
    50,
    "visualization.scale.x.reverse",
    "toggle",
    {
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "heatmap",
      ]),
    },
  ),
  field(
    "axis-x",
    "visualization",
    "axes",
    10,
    "visualization.axes.x.visible",
    "toggle",
    {
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "heatmap",
      ]),
    },
  ),
  field(
    "axis-y",
    "visualization",
    "axes",
    20,
    "visualization.axes.y.visible",
    "toggle",
    {
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "histogram",
        "heatmap",
        "boxplot",
      ]),
    },
  ),
  field(
    "grid",
    "visualization",
    "axes",
    30,
    "visualization.axes.y.grid",
    "toggle",
    {
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "histogram",
        "heatmap",
        "boxplot",
      ]),
    },
  ),
  field(
    "grid-x",
    "visualization",
    "axes",
    40,
    "visualization.axes.x.grid",
    "toggle",
    {
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "heatmap",
      ]),
    },
  ),
  field(
    "axis-x-label",
    "visualization",
    "axes",
    50,
    "visualization.axes.x.label",
    "text",
    {
      required: false,
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "heatmap",
      ]),
    },
  ),
  field(
    "axis-y-label",
    "visualization",
    "axes",
    60,
    "visualization.axes.y.label",
    "text",
    {
      required: false,
      visibleWhen: oneOf("visualization.mark", [
        "line",
        "area",
        "bar",
        "dot",
        "histogram",
        "boxplot",
        "heatmap",
      ]),
    },
  ),
  field(
    "legend",
    "visualization",
    "legend",
    10,
    "visualization.legend.visible",
    "toggle",
    {
      visibleWhen: {
        kind: "and",
        conditions: [
          oneOf("visualization.mark", [
            "line",
            "area",
            "bar",
            "dot",
            "heatmap",
          ]),
          {
            kind: "or",
            conditions: [
              exists("visualization.encoding.color.field"),
              exists("visualization.encoding.series.field"),
            ],
          },
        ],
      },
    },
  ),
  field(
    "legend-position",
    "visualization",
    "legend",
    20,
    "visualization.legend.position",
    "choice",
    {
      options: options("top", "right", "bottom"),
      visibleWhen: {
        kind: "and",
        conditions: [
          oneOf("visualization.mark", [
            "line",
            "area",
            "bar",
            "dot",
            "heatmap",
          ]),
          {
            kind: "or",
            conditions: [
              exists("visualization.encoding.color.field"),
              exists("visualization.encoding.series.field"),
            ],
          },
          equals("visualization.legend.visible", true),
        ],
      },
    },
  ),
  field(
    "unit",
    "visualization",
    "format",
    10,
    "visualization.format.unit",
    "choice",
    {
      options: options("auto", "ratio", "percent", "count", "days"),
    },
  ),
  field(
    "decimals",
    "visualization",
    "format",
    20,
    "visualization.format.decimals",
    "number",
    {
      min: 0,
      max: 6,
      step: 1,
      required: false,
    },
  ),
  field(
    "compact",
    "visualization",
    "format",
    30,
    "visualization.format.compact",
    "toggle",
  ),
  field(
    "thresholds",
    "visualization",
    "thresholds",
    10,
    "visualization.thresholds",
    "thresholds",
    {
      required: false,
      clearWhenHidden: false,
      collection: WIDGET_THRESHOLD_SCHEMA,
    },
  ),
] as const;

export const WIDGET_FLOW_SECTIONS = [
  ["definition", "data", 10],
  ["definition", "window", 20],
  ["definition", "filters", 30],
  ["definition", "measure", 40],
  ["definition", "grouping", 50],
  ["definition", "comparison", 60],
  ["definition", "transforms", 70],
  ["visualization", "chart", 10],
  ["visualization", "encoding", 20],
  ["visualization", "appearance", 30],
  ["visualization", "scale", 40],
  ["visualization", "axes", 50],
  ["visualization", "legend", 60],
  ["visualization", "format", 70],
  ["visualization", "thresholds", 80],
] as const;
