import { WIDGET_LIMITS } from "./widget-types";
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
const not = (condition: WidgetFlowCondition): WidgetFlowCondition => ({
  kind: "not",
  condition,
});
/** The metrics whose reading is *of* a goal, and which therefore ask for one. */
/** The metrics read against a group, which therefore ask which one. */
const cohortMetrics = oneOf("analysis.measures.0.expression.metric", [
  "cohortRank",
  "cohortAverage",
  "cohortGap",
  "memberAverage",
]);
const goalMetrics = oneOf("analysis.measures.0.expression.metric", [
  "goalProgress",
  "requiredResult",
  // Mirrors `GOAL_METRICS` in the compiler, which has always required a goal here. The
  // list drifted, so the editor never offered the picker and the card could not be saved.
  "safetyMargin",
]);
/**
 * The recipes whose drawing *is* a pair, and which the compiler therefore refuses with
 * one measure. Both were offered by the editor with no way to add the second — chosen,
 * refused, and nothing on screen explaining what was missing.
 */
const pairedRecipes = oneOf("visualization.recipe", [
  "scatter",
  "difference-area",
]);
const secondMetricMeasure: WidgetFlowCondition = {
  kind: "and",
  conditions: [
    pairedRecipes,
    equals("analysis.measures.1.expression.kind", "metric"),
  ],
};
const secondFormulaMeasure: WidgetFlowCondition = {
  kind: "and",
  conditions: [
    pairedRecipes,
    equals("analysis.measures.1.expression.kind", "formula"),
  ],
};
/** The readings about a friend, which name the person through the friendship itself. */
const friendMetrics = oneOf("analysis.measures.0.expression.metric", [
  "friendAverage",
  "friendCurves",
  "friendSubjects",
]);
/**
 * The metrics whose value *is* a spread, and which therefore ask how to measure
 * one. Mirrors `WIDGET_DISPERSION_METRICS` — the parser drops the field on any
 * other metric, so a control offered anywhere else would be a control whose
 * answer is thrown away.
 */
const dispersionMetrics = oneOf("analysis.measures.0.expression.metric", [
  "spread",
]);
const notGoalProgress: WidgetFlowCondition = {
  kind: "not",
  condition: goalMetrics,
};
const valueAdornmentMetric: WidgetFlowCondition = {
  kind: "and",
  conditions: [
    equals("visualization.recipe", "value"),
    {
      kind: "not",
      condition: equals("analysis.comparison.kind", "none"),
    },
    {
      kind: "or",
      conditions: [
        equals("analysis.measures.0.expression.kind", "formula"),
        oneOf("analysis.measures.0.expression.metric", [
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

/**
 * Options named under a prefix of their own.
 *
 * `widget.option.<value>` is shared by every field that offers the same value, which is
 * usually what you want — "week" is "week" everywhere — and occasionally a collision:
 * a window pair aligns by `calendar` or by `period`, and both of those already name a
 * window's fill and a window's kind. One key, two sentences, and whichever was written
 * second would be wrong somewhere.
 */
function namedOptions(prefix: string, ...values: string[]): WidgetFlowOption[] {
  return values.map((value) => ({
    value,
    messageKey: `${prefix}.${value}`,
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

/**
 * The groupings a card is split by, as a list.
 *
 * This replaces six flat fields that all addressed `analysis.dimensions.0` — a single
 * choice plus its options — and the replacement is the whole point: the model has carried
 * a *list* of dimensions since the second version, the evaluator walks two of them and the
 * renderers draw the result (a series per subject, stacked bars, a facet grid), but no
 * screen could ask for the second one. The card had to be written by hand or generated.
 *
 * "No grouping" is an empty list rather than a `none` kind. The old control had to spell
 * that as a value because it was one choice over one path; a list says it by being empty,
 * which is what the model meant all along. `parseDimension` still reads `none` silently,
 * for documents written by the old control.
 *
 * Two is the ceiling — `WIDGET_LIMITS.dimensions` — because three is a cube and a cube has
 * no honest flat drawing.
 */
export const WIDGET_DIMENSION_SCHEMA: WidgetCollectionSchema = {
  discriminator: "kind",
  minItems: 0,
  maxItems: WIDGET_LIMITS.dimensions,
  addMessageKey: "widget.action.add-dimension",
  variants: [
    {
      value: "time",
      messageKey: "widget.dimension.time",
      fields: [
        collectionField("time-interval", "grain", "choice", {
          // `event` — one point per result — and `period` were evaluable and drawable all
          // along; the flat control offered neither, so no card could ask for them.
          options: options("event", "day", "week", "month", "period"),
        }),
        collectionField("time-accumulation", "accumulation", "choice", {
          options: options("bucket", "running"),
          visibleWhen: not(equals("grain", "event")),
        }),
        collectionField("time-fill", "fill", "choice", {
          options: options("observed", "calendar"),
          visibleWhen: not(equals("grain", "event")),
        }),
      ],
    },
    {
      value: "subject",
      messageKey: "widget.dimension.subject",
      fields: [
        collectionField("subject-level", "level", "choice", {
          options: options("leaf", "root", "all"),
        }),
        collectionField("subject-limit", "limit", "number", {
          min: 1,
          max: 100,
          step: 1,
        }),
        collectionField("include-categories", "includeCategories", "toggle", {
          visibleWhen: not(equals("level", "leaf")),
        }),
      ],
    },
    {
      value: "period",
      messageKey: "widget.dimension.period",
      fields: [],
    },
    {
      value: "assessment-type",
      messageKey: "widget.dimension.assessment-type",
      fields: [
        collectionField("include-untyped", "includeUntyped", "toggle", {}),
      ],
    },
    {
      // The bands are the compiler's defaults — quarters of the scale — and now really
      // are: this comment described an arrangement that did not exist, and a grade-band
      // card was refused for want of thresholds no control here could supply. A list of
      // numbers still needs a control of its own before the cuts can be moved.
      value: "grade-band",
      messageKey: "widget.dimension.grade-band",
      fields: [],
    },
    {
      value: "status",
      messageKey: "widget.dimension.status",
      fields: [
        collectionField("status-values", "values", "multi-choice", {
          options: options("passed", "failed", "missing"),
        }),
      ],
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
      visibleWhen: equals("analysis.dimensions.0.kind", "time"),
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
      visibleWhen: equals("analysis.dimensions.0.kind", "time"),
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
/**
 * The six fields that describe one window.
 *
 * Written once and used three times: the card's own window and the two sides of a window
 * pair. A pair of arbitrary windows is what the model has allowed since the second version
 * and what nothing could compose — "the first term against the third" had to be written by
 * hand — and the reason was that a window is six controls, not one.
 *
 * `visibleWhen` is the caller's own guard, `and`-ed with each field's own condition: a
 * pair's fields appear only when the comparison is a pair, and each side's options only
 * for the kind that side is.
 */
function windowFields(
  prefix: string,
  path: string,
  section: string,
  order: number,
  visibleWhen: WidgetFlowCondition = always,
): WidgetFlowFieldSchema[] {
  const when = (condition: WidgetFlowCondition): WidgetFlowCondition =>
    visibleWhen.kind === "always"
      ? condition
      : { kind: "and", conditions: [visibleWhen, condition] };
  const id = (suffix: string) => (prefix ? `${prefix}-${suffix}` : suffix);
  return [
    field(id("window"), "definition", section, order, `${path}.kind`, "choice", {
      options: options(
        "active-period",
        "whole-year",
        "period",
        "rolling-days",
        "last-grades",
        "date-range",
      ),
      visibleWhen: prefix ? visibleWhen : when(notGoalProgress),
    }),
    field(
      id("period"),
      "definition",
      section,
      order + 1,
      `${path}.periodId`,
      "reference",
      {
        optionProvider: "periods",
        visibleWhen: when(equals(`${path}.kind`, "period")),
      },
    ),
    field(
      id("rolling-days"),
      "definition",
      section,
      order + 2,
      `${path}.days`,
      "number",
      {
        min: 1,
        max: 3_650,
        step: 1,
        visibleWhen: when(equals(`${path}.kind`, "rolling-days")),
      },
    ),
    field(
      id("last-grades"),
      "definition",
      section,
      order + 3,
      `${path}.count`,
      "number",
      {
        min: 1,
        max: 500,
        step: 1,
        visibleWhen: when(equals(`${path}.kind`, "last-grades")),
      },
    ),
    field(id("from"), "definition", section, order + 4, `${path}.from`, "date", {
      visibleWhen: when(equals(`${path}.kind`, "date-range")),
    }),
    field(id("to"), "definition", section, order + 5, `${path}.to`, "date", {
      visibleWhen: when(equals(`${path}.kind`, "date-range")),
    }),
  ];
}

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
  ...windowFields("", "query.window", "window", 10),
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
    "analysis.measures.0.expression.kind",
    "choice",
    {
      options: options("metric", "formula"),
    },
  ),
  /**
   * The second reading, for the two recipes that are a pair.
   *
   * Kept to the shape the first one has — a kind, a metric, a name — and offered only
   * where a pair is what is being drawn, so an ordinary card is still one measure with
   * one control. The labels are required by the compiler as soon as there are two, which
   * is why both appear here rather than only the second.
   */
  field(
    "measure-label",
    "definition",
    "measure",
    11,
    "analysis.measures.0.label",
    "text",
    { visibleWhen: pairedRecipes, clearWhenHidden: false },
  ),
  field(
    "second-measure-kind",
    "definition",
    "measure",
    12,
    "analysis.measures.1.expression.kind",
    "choice",
    {
      options: options("metric", "formula"),
      visibleWhen: pairedRecipes,
      clearWhenHidden: false,
    },
  ),
  field(
    "second-metric",
    "definition",
    "measure",
    13,
    "analysis.measures.1.expression.metric",
    "choice",
    {
      optionProvider: "metrics",
      visibleWhen: secondMetricMeasure,
      clearWhenHidden: false,
    },
  ),
  field(
    "second-formula-output",
    "definition",
    "measure",
    14,
    "analysis.measures.1.expression.valueType",
    "choice",
    {
      options: options("ratio", "number", "count", "percent"),
      visibleWhen: secondFormulaMeasure,
      clearWhenHidden: false,
    },
  ),
  field(
    "second-formula",
    "definition",
    "measure",
    15,
    "analysis.measures.1.expression.formula",
    "formula",
    {
      visibleWhen: secondFormulaMeasure,
      collection: WIDGET_FORMULA_SCHEMA,
      clearWhenHidden: false,
    },
  ),
  field(
    "second-measure-label",
    "definition",
    "measure",
    16,
    "analysis.measures.1.label",
    "text",
    { visibleWhen: pairedRecipes, clearWhenHidden: false },
  ),
  field(
    "metric",
    "definition",
    "measure",
    20,
    "analysis.measures.0.expression.metric",
    "choice",
    {
      optionProvider: "metrics",
      visibleWhen: equals("analysis.measures.0.expression.kind", "metric"),
    },
  ),
  field(
    "goal",
    "definition",
    "measure",
    30,
    "analysis.measures.0.expression.goalId",
    "reference",
    {
      optionProvider: "goals",
      visibleWhen: goalMetrics,
    },
  ),
  field(
    "dispersion",
    "definition",
    "measure",
    35,
    "analysis.measures.0.expression.dispersion",
    "choice",
    {
      options: options(
        "standard-deviation",
        "range",
        "interquartile-range",
        "median-absolute-deviation",
      ),
      visibleWhen: dispersionMetrics,
    },
  ),
  field(
    "formula-output",
    "definition",
    "measure",
    40,
    "analysis.measures.0.expression.valueType",
    "choice",
    {
      options: options("ratio", "number", "count", "percent"),
      visibleWhen: equals("analysis.measures.0.expression.kind", "formula"),
    },
  ),
  field(
    "formula",
    "definition",
    "measure",
    50,
    "analysis.measures.0.expression.formula",
    "formula",
    {
      visibleWhen: equals("analysis.measures.0.expression.kind", "formula"),
      collection: WIDGET_FORMULA_SCHEMA,
    },
  ),
  field(
    "cohort-group",
    "definition",
    "measure",
    26,
    "analysis.measures.0.expression.groupId",
    "reference",
    {
      optionProvider: "cohorts",
      visibleWhen: cohortMetrics,
    },
  ),
  field(
    "cohort-member",
    "definition",
    "measure",
    27,
    "analysis.measures.0.expression.memberId",
    "reference",
    {
      optionProvider: "cohort-members",
      visibleWhen: equals(
        "analysis.measures.0.expression.metric",
        "memberAverage",
      ),
    },
  ),
  /**
   * The same field of the definition, asked as a different question.
   *
   * `memberId` is "who is this reading about", and the answer comes from a group for a
   * classmate and from the friendships for a friend — two lists, two consents. One
   * control each, so neither offers people the other's rule never opened.
   */
  field(
    "friend",
    "definition",
    "measure",
    28,
    "analysis.measures.0.expression.memberId",
    "reference",
    { optionProvider: "friends", visibleWhen: friendMetrics },
  ),
  field(
    "dimensions",
    "definition",
    "grouping",
    10,
    "analysis.dimensions",
    "dimensions",
    {
      required: false,
      clearWhenHidden: false,
      collection: WIDGET_DIMENSION_SCHEMA,
      descriptionKey: "widget.field.dimensions.description",
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
      options: options("none", "previous-window", "baseline", "window-pair"),
    },
  ),
  /**
   * The two windows of a pair, and how their buckets meet.
   *
   * The comparison the model has carried and nothing could compose. Both sides are full
   * windows — the same six controls as the card's own — so "the first term against the
   * third", "the last ten results against the ten before them" and "September against
   * September" are all sayable, and the right-hand side is the reading.
   */
  ...windowFields(
    "pair-left",
    "analysis.comparison.left",
    "comparison",
    30,
    equals("analysis.comparison.kind", "window-pair"),
  ),
  ...windowFields(
    "pair-right",
    "analysis.comparison.right",
    "comparison",
    40,
    equals("analysis.comparison.kind", "window-pair"),
  ),
  field(
    "pair-alignment",
    "definition",
    "comparison",
    50,
    "analysis.comparison.alignment",
    "choice",
    {
      options: namedOptions(
        "widget.alignment",
        "relative",
        "calendar",
        "period",
      ),
      visibleWhen: equals("analysis.comparison.kind", "window-pair"),
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
      visibleWhen: oneOf("analysis.dimensions.0.kind", ["time", "subject"]),
    },
  ),
  field(
    "mark",
    "visualization",
    "chart",
    10,
    "visualization.recipe",
    "choice",
    {
      optionProvider: "marks",
    },
  ),
  field(
    "encoding-x",
    "visualization",
    "encoding",
    10,
    "visualization.encoding.x.field",
    "encoding",
    {
      optionProvider: "encoding-fields",
      visibleWhen: oneOf("visualization.recipe", [
        "line",
        "area",
        "bar",
        "dot",
        "heatmap",
        "lollipop",
        "slope-arrow",
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
          oneOf("visualization.recipe", [
            "line",
            "area",
            "bar",
            "dot",
            "histogram",
            "heatmap",
            "boxplot",
            "lollipop",
            "slope-arrow",
          ]),
          {
            kind: "not",
            condition: {
              kind: "and",
              conditions: [
                equals("analysis.measures.0.expression.metric", "distribution"),
                oneOf("visualization.recipe", ["histogram", "boxplot"]),
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
      visibleWhen: oneOf("visualization.recipe", [
        "line",
        "area",
        "bar",
        "dot",
        "heatmap",
        "lollipop",
        "slope-arrow",
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
      visibleWhen: oneOf("visualization.recipe", [
        "line",
        "area",
        "bar",
        "dot",
      ]),
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
      visibleWhen: oneOf("visualization.recipe", ["line", "area"]),
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
      visibleWhen: oneOf("visualization.recipe", ["line", "area"]),
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
      visibleWhen: equals("visualization.recipe", "line"),
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
      visibleWhen: equals("visualization.recipe", "area"),
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
      visibleWhen: oneOf("visualization.recipe", ["bar", "lollipop"]),
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
      // Stacking needs bars over time *and* something to stack them by: a second
      // dimension, shown on the colour or the series channel. The condition used to
      // test a channel against the literal `category`, which was the only way the old
      // model could say "split by subject" — the analysis says it now.
      visibleWhen: {
        kind: "and",
        conditions: [
          equals("visualization.recipe", "bar"),
          equals("analysis.dimensions.0.kind", "time"),
          exists("analysis.dimensions.1.kind"),
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
      visibleWhen: equals("visualization.recipe", "bar"),
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
      // Optional, because empty is a real answer here: it stores nothing and the
      // definition reads back as `"auto"`, the responsive bar. A required number
      // would have left a card unable to give the choice back once it had named a
      // thickness, since no number means "let the renderer decide".
      required: false,
      visibleWhen: equals("visualization.recipe", "gauge"),
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
      visibleWhen: equals("visualization.recipe", "gauge"),
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
      visibleWhen: equals("visualization.recipe", "dot"),
    },
  ),
  field(
    "lollipop-size",
    "visualization",
    "appearance",
    83,
    "visualization.options.size",
    "number",
    {
      min: 2,
      max: 24,
      step: 1,
      visibleWhen: equals("visualization.recipe", "lollipop"),
    },
  ),
  // A share, not a count of observations: twenty cells suit a mark out of
  // twenty, and a hundred needs a wide card to stay square.
  field(
    "waffle-cells",
    "visualization",
    "appearance",
    84,
    "visualization.options.cells",
    "number",
    {
      min: 10,
      max: 100,
      step: 5,
      visibleWhen: equals("visualization.recipe", "waffle"),
    },
  ),
  field(
    "slope-labels",
    "visualization",
    "appearance",
    85,
    "visualization.options.showLabels",
    "toggle",
    { visibleWhen: equals("visualization.recipe", "slope-arrow") },
  ),
  // Two ends per row: their size, and whether each carries its own number.
  field(
    "dumbbell-size",
    "visualization",
    "appearance",
    88,
    "visualization.options.size",
    "number",
    {
      min: 4,
      max: 24,
      step: 1,
      visibleWhen: equals("visualization.recipe", "dumbbell"),
    },
  ),
  field(
    "dumbbell-labels",
    "visualization",
    "appearance",
    89,
    "visualization.options.showLabels",
    "toggle",
    { visibleWhen: equals("visualization.recipe", "dumbbell") },
  ),
  // A strip is the marks themselves, so its only sizes are the tick and whether
  // the median is drawn through them.
  field(
    "strip-tick",
    "visualization",
    "appearance",
    86,
    "visualization.options.tick",
    "number",
    {
      min: 4,
      max: 24,
      step: 1,
      visibleWhen: equals("visualization.recipe", "strip"),
    },
  ),
  field(
    "strip-median",
    "visualization",
    "appearance",
    87,
    "visualization.options.showMedian",
    "toggle",
    { visibleWhen: equals("visualization.recipe", "strip") },
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
      visibleWhen: equals("visualization.recipe", "histogram"),
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
      visibleWhen: equals("visualization.recipe", "heatmap"),
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
      visibleWhen: equals("visualization.recipe", "boxplot"),
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
      visibleWhen: oneOf("visualization.recipe", ["table", "list"]),
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
      visibleWhen: equals("visualization.recipe", "list"),
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
      visibleWhen: oneOf("visualization.recipe", [
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
      visibleWhen: oneOf("visualization.recipe", [
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
      visibleWhen: oneOf("visualization.recipe", [
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
      visibleWhen: oneOf("visualization.recipe", [
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
      visibleWhen: oneOf("visualization.recipe", [
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
      visibleWhen: oneOf("visualization.recipe", [
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
      visibleWhen: oneOf("visualization.recipe", [
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
      visibleWhen: oneOf("visualization.recipe", [
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
      visibleWhen: oneOf("visualization.recipe", [
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
      visibleWhen: oneOf("visualization.recipe", [
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
      visibleWhen: oneOf("visualization.recipe", [
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
          oneOf("visualization.recipe", [
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
          oneOf("visualization.recipe", [
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
