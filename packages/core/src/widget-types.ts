import type { CardContext, CardMetric, CardResult, CardSpec } from "./cards";
import type { Goal } from "./goals";
import type { CustomAverage, Period, Subject, Year } from "./types";

/** Stable wire version stored in `dashboard_cards.definitionJson`. */
export const WIDGET_DEFINITION_VERSION = 1 as const;

/**
 * A gauge's bar, in pixels, for a renderer that has no scale of its own.
 *
 * The dashboard draws its gauge as a hairline that thickens once the card is wide
 * enough — a margin note under the number, not a pipe beside it. That is what
 * `"auto"` asks for, and it is what a card gets unless it names a number.
 *
 * This constant used to carry that meaning *itself*: 6 was the value that meant
 * "the card's own bar", and any other value was a deliberate override. Which left
 * one number saying two things, so a card that genuinely wanted a 6px bar was given
 * the responsive one instead, with nothing to distinguish the two intentions. The
 * thickness is `"auto" | number` now and says which it is.
 */
export const WIDGET_GAUGE_THICKNESS = 6;

/**
 * How thick a gauge's bar is drawn.
 *
 * `"auto"` leaves it to the renderer, which is the only way to ask for a bar that
 * responds to the card's width — no single number can. Anything else is a literal
 * pixel height, honoured as given.
 */
export type WidgetGaugeThickness = "auto" | number;

export const WIDGET_SURFACES = [
  "overview",
  "subject",
  "grade",
  "insights",
] as const;
export type WidgetSurface = (typeof WIDGET_SURFACES)[number];

export const WIDGET_LIMITS = Object.freeze({
  filters: 12,
  transforms: 8,
  thresholds: 8,
  subjectReferences: 12,
  formulaDepth: 12,
  formulaNodes: 64,
  /** Each metric operand is a full data pass; bounded separately. */
  formulaMetricNodes: 8,
  series: 8,
  /**
   * Logical buckets one series may hold *before* transforms.
   *
   * Separate from `resultPoints` because the two answer different questions.
   * This one bounds the work: one scalar evaluation per bucket, so it exists to
   * stop a pathological window from walking forever. A school year cannot reach
   * it — daily buckets over two years is 730 — which is the point: transforms
   * must never see a shortened series, because a cumulative over a shortened
   * series is simply a wrong number.
   */
  seriesBuckets: 4_000,
  /**
   * Points handed to a renderer, per series.
   *
   * Applied *last*, after every transform and comparison, and as a downsample
   * that keeps the first and last point rather than a truncation. It is a
   * drawing budget: dropping a point changes how a line looks, never what it
   * says.
   */
  resultPoints: 500,
});

export type WidgetScope =
  | { kind: "general" }
  | { kind: "subjects"; subjectIds: string[]; includeDescendants: boolean }
  | { kind: "custom-average"; averageId: string };

export type WidgetWindow =
  | { kind: "active-period" }
  | { kind: "whole-year" }
  | { kind: "period"; periodId: string }
  | { kind: "rolling-days"; days: number }
  | { kind: "last-grades"; count: number }
  | { kind: "date-range"; from: string; to: string };

export type WidgetNumericOperator = "gt" | "gte" | "lt" | "lte" | "eq";

export type WidgetFilter =
  | {
      kind: "grade-ratio";
      operator: WidgetNumericOperator;
      value: number;
    }
  | {
      kind: "coefficient";
      operator: WidgetNumericOperator;
      value: number;
    }
  | { kind: "has-note"; value: boolean }
  | { kind: "grade-name"; operator: "contains" | "not-contains"; value: string }
  | { kind: "passed"; value: boolean };

export interface WidgetQueryV1 {
  source: "grades";
  scope: WidgetScope;
  window: WidgetWindow;
  filters: WidgetFilter[];
}

export type WidgetFormulaField = "ratio" | "value" | "outOf" | "coefficient";

/**
 * The metrics a formula may use as an operand: the ones whose card result
 * is a plain number. Rankings, best/worst labels, streaks, distributions
 * and goal plans stay out — their value is the structure, not a scalar.
 */
export const WIDGET_FORMULA_METRICS = [
  "average",
  "averageTrend",
  "projection",
  "gradeCount",
  "passRate",
  "median",
  "spread",
  "consistency",
  "improvement",
] as const;

export type WidgetFormulaMetric = (typeof WIDGET_FORMULA_METRICS)[number];

export type WidgetFormulaAggregate =
  "count" | "sum" | "mean" | "median" | "min" | "max" | "standard-deviation";

/**
 * A deliberately bounded expression tree. There is no property access,
 * function name, loop, executable source, network access, or user code.
 */
export type WidgetFormula =
  | { kind: "literal"; value: number }
  | { kind: "parameter"; name: "passingRatio" | "yearScale" }
  | {
      kind: "aggregate";
      operation: WidgetFormulaAggregate;
      field: WidgetFormulaField;
    }
  | {
      /**
       * A built-in metric as an operand, evaluated with the card's own
       * scope and window unless the node overrides them — which is what
       * makes "average of subject X minus the general average" a formula.
       */
      kind: "metric";
      metric: WidgetFormulaMetric;
      scope?: WidgetScope;
      window?: WidgetWindow;
    }
  | {
      kind: "unary";
      operation: "absolute" | "negate" | "round" | "floor" | "ceil";
      operand: WidgetFormula;
    }
  | {
      kind: "binary";
      operation:
        "add" | "subtract" | "multiply" | "divide" | "minimum" | "maximum";
      left: WidgetFormula;
      right: WidgetFormula;
    }
  | {
      kind: "compare";
      operation: WidgetNumericOperator;
      left: WidgetFormula;
      right: WidgetFormula;
    }
  | {
      kind: "conditional";
      condition: WidgetFormula;
      whenTrue: WidgetFormula;
      whenFalse: WidgetFormula;
    };

export type WidgetMeasure =
  | { kind: "metric"; metric: CardMetric; goalId: string | null }
  | {
      kind: "formula";
      formula: WidgetFormula;
      valueType: "ratio" | "number" | "count" | "percent";
    };

export type WidgetGroupBy =
  | { kind: "none" }
  | {
      kind: "time";
      interval: "day" | "week" | "month";
      accumulation: "bucket" | "running";
    }
  | {
      kind: "subject";
      limit: number;
      includeCategories: boolean;
    };

export type WidgetComparison =
  | { kind: "none" }
  | { kind: "previous-window" }
  | { kind: "baseline"; value: number };

export type WidgetTransform =
  | { kind: "sort"; direction: "ascending" | "descending" }
  | { kind: "limit"; count: number }
  | { kind: "moving-average"; points: number }
  | { kind: "cumulative" };

export interface WidgetAnalysisV1 {
  measure: WidgetMeasure;
  groupBy: WidgetGroupBy;
  comparison: WidgetComparison;
  transforms: WidgetTransform[];
}

export type WidgetChartMark =
  | "value"
  | "gauge"
  | "line"
  | "area"
  | "bar"
  | "dot"
  | "histogram"
  | "boxplot"
  | "heatmap"
  | "table"
  | "list";

export type WidgetEncodingField =
  "date" | "category" | "value" | "delta" | "count";

export interface WidgetEncoding {
  field: WidgetEncodingField;
  type: "temporal" | "nominal" | "quantitative";
}

export interface WidgetScaleSpec {
  /** Force the quantitative domain to include zero. */
  zero: boolean;
  min: number | null;
  max: number | null;
  reverse: boolean;
}

export interface WidgetAxisSpec {
  visible: boolean;
  grid: boolean;
  label: string | null;
}

export type WidgetMarkOptions =
  | {
      kind: "value";
      showDelta: boolean;
      trendIndicator: boolean;
    }
  | { kind: "gauge"; showValue: boolean; thickness: WidgetGaugeThickness }
  | {
      kind: "line";
      curve: "linear" | "monotone" | "step";
      points: boolean;
      strokeWidth: number;
    }
  | {
      kind: "area";
      curve: "linear" | "monotone" | "step";
      points: boolean;
      opacity: number;
    }
  | {
      kind: "bar";
      orientation: "vertical" | "horizontal";
      stacked: boolean;
      cornerRadius: number;
    }
  | { kind: "dot"; size: number }
  | { kind: "histogram"; bins: number }
  | { kind: "boxplot"; showOutliers: boolean }
  | {
      kind: "heatmap";
      colorScheme: "semantic" | "sequential" | "diverging";
    }
  | { kind: "table"; rows: number }
  | { kind: "list"; rows: number; showValues: boolean };

export interface WidgetVisualizationV1 {
  mark: WidgetChartMark;
  encoding: {
    x: WidgetEncoding | null;
    y: WidgetEncoding | null;
    color: WidgetEncoding | null;
    series: WidgetEncoding | null;
  };
  options: WidgetMarkOptions;
  /** X is positional (direction only in V1); Y owns the numeric domain. */
  scale: {
    x: Pick<WidgetScaleSpec, "reverse">;
    y: WidgetScaleSpec;
  };
  axes: { x: WidgetAxisSpec; y: WidgetAxisSpec };
  legend: {
    visible: boolean;
    position: "top" | "right" | "bottom";
  };
  format: {
    decimals: number | null;
    unit: "auto" | "ratio" | "percent" | "count" | "days";
    compact: boolean;
  };
  thresholds: Array<{
    value: number;
    color: string | null;
    label: string | null;
  }>;
}

/** Only semantic data lives in JSON. Layout, title and ownership remain columns. */
export interface WidgetDefinitionV1 {
  apiVersion: typeof WIDGET_DEFINITION_VERSION;
  query: WidgetQueryV1;
  analysis: WidgetAnalysisV1;
  visualization: WidgetVisualizationV1;
}

export type WidgetDefinition = WidgetDefinitionV1;

export type WidgetResultShape =
  | "scalar"
  | "temporal-series"
  | "categorical-series"
  | "distribution"
  | "record"
  | "records"
  | "streak"
  | "goal";

export type WidgetValueType = "ratio" | "number" | "count" | "percent" | "days";

export interface WidgetCapability {
  id: CardMetric | "formula";
  messageKey: string;
  descriptionKey: string;
  resultShape: WidgetResultShape;
  valueType: WidgetValueType;
  scopes: WidgetScope["kind"][];
  groupings: WidgetGroupBy["kind"][];
  comparisons: WidgetComparison["kind"][];
  marks: WidgetChartMark[];
  surfaces: WidgetSurface[];
}

export type WidgetFlowEditor = "definition" | "visualization";
export type WidgetFlowControl =
  | "choice"
  | "multi-choice"
  | "reference"
  | "number"
  | "date"
  | "text"
  | "toggle"
  | "color"
  | "filters"
  | "formula"
  | "transforms"
  | "encoding"
  | "thresholds";

export type WidgetOptionProvider =
  | "subjects"
  | "custom-averages"
  | "goals"
  | "periods"
  | "metrics"
  | "marks"
  | "encoding-fields";

export interface WidgetFlowOption {
  value: string;
  messageKey: string;
  disabled?: boolean;
}

export type WidgetFlowCondition =
  | { kind: "always" }
  | { kind: "equals"; path: string; value: string | number | boolean | null }
  | { kind: "one-of"; path: string; values: Array<string | number | boolean> }
  | { kind: "exists"; path: string }
  | {
      kind: "capability";
      property: "marks" | "groupings" | "comparisons" | "scopes";
      path: string;
    }
  | { kind: "and"; conditions: WidgetFlowCondition[] }
  | { kind: "or"; conditions: WidgetFlowCondition[] }
  | { kind: "not"; condition: WidgetFlowCondition };

export interface WidgetFlowFieldSchema {
  id: string;
  editor: WidgetFlowEditor;
  section: string;
  order: number;
  path: string;
  control: WidgetFlowControl;
  messageKey: string;
  descriptionKey: string | null;
  required: boolean;
  clearWhenHidden: boolean;
  visibleWhen: WidgetFlowCondition;
  options?: WidgetFlowOption[];
  optionProvider?: WidgetOptionProvider;
  min?: number;
  max?: number;
  step?: number;
  /** Descriptor for repeated/recursive data; clients render it generically. */
  collection?: WidgetCollectionSchema;
}

export interface WidgetFlowField extends WidgetFlowFieldSchema {
  active: boolean;
  error: string | null;
  options: WidgetFlowOption[];
}

export interface WidgetCollectionVariant {
  value: string;
  messageKey: string;
  /** Optional declarative guard for variants that only make sense in one branch. */
  visibleWhen?: WidgetFlowCondition;
  /** Relative paths inside one collection item. */
  fields: WidgetCollectionField[];
}

export interface WidgetCollectionField {
  id: string;
  path: string;
  control: Exclude<
    WidgetFlowControl,
    "filters" | "transforms" | "encoding" | "thresholds"
  >;
  messageKey: string;
  descriptionKey: string | null;
  required: boolean;
  visibleWhen: WidgetFlowCondition;
  options?: WidgetFlowOption[];
  optionProvider?: WidgetOptionProvider;
  min?: number;
  max?: number;
  step?: number;
  /** A recursive formula child; bounded by WIDGET_LIMITS during validation. */
  recursive?: "self" | WidgetCollectionSchema;
}

export interface WidgetCollectionSchema {
  discriminator: string | null;
  minItems: number;
  maxItems: number;
  addMessageKey: string;
  variants: WidgetCollectionVariant[];
}

export interface WidgetFlowSection {
  id: string;
  editor: WidgetFlowEditor;
  order: number;
  messageKey: string;
  descriptionKey: string | null;
  fields: WidgetFlowField[];
}

export interface WidgetFlow {
  definition: WidgetFlowSection[];
  visualization: WidgetFlowSection[];
  activePaths: string[];
  prunedDefinition: WidgetDefinitionV1;
  issues: WidgetValidationIssue[];
}

export interface WidgetFlowContext {
  surface: WidgetSurface;
  options?: Partial<Record<WidgetOptionProvider, WidgetFlowOption[]>>;
}

export interface WidgetValidationIssue {
  path: string;
  code:
    | "invalid-type"
    | "invalid-value"
    | "unsupported"
    | "required"
    | "invalid-reference"
    | "complexity-limit";
  messageKey: string;
}

export interface WidgetValidationResult {
  valid: boolean;
  issues: WidgetValidationIssue[];
  definition: WidgetDefinitionV1 | null;
}

export interface WidgetReferences {
  subjectIds: string[];
  customAverageIds: string[];
  goalIds: string[];
  periodIds: string[];
}

export interface WidgetExecutionPlan {
  version: typeof WIDGET_DEFINITION_VERSION;
  definition: WidgetDefinitionV1;
  capability: WidgetCapability;
  resultShape: WidgetResultShape;
  valueType: WidgetValueType;
  references: WidgetReferences;
}

export interface WidgetCompileResult {
  valid: boolean;
  issues: WidgetValidationIssue[];
  plan: WidgetExecutionPlan | null;
}

export interface WidgetSeriesDatum {
  key: string;
  label: string;
  date: Date | null;
  value: number | null;
  delta: number | null;
  count: number;
  /** Optional split-series label, e.g. one line per selected subject. */
  series: string | null;
}

export type WidgetEvaluationResult =
  | { kind: "empty"; shape: WidgetResultShape }
  | {
      kind: "scalar";
      shape: "scalar";
      value: number;
      valueType: WidgetValueType;
      delta: number | null;
    }
  | {
      kind: "series";
      shape: "temporal-series" | "categorical-series";
      values: WidgetSeriesDatum[];
      valueType: WidgetValueType;
    }
  | {
      kind: "distribution";
      shape: "distribution";
      buckets: Array<{ from: number; to: number; count: number }>;
      total: number;
      summary: {
        min: number;
        q1: number;
        median: number;
        q3: number;
        max: number;
        outliers: number[];
      };
    }
  | {
      kind: "structured";
      shape: "record" | "records" | "streak" | "goal";
      value: CardResult;
    };

/**
 * The live streak a result is reporting, if it is reporting one.
 *
 * Here rather than in a renderer because it is a question about *this* union, and
 * the answer has already been got wrong once by being asked elsewhere. A streak
 * arrives wrapped — the evaluator returns it as a `structured` result whose value
 * is the streak — and the dashboard's card dress matched only the outer kind, so
 * every streak card silently stopped burning. Nothing failed; the card just went
 * quiet, which is the kind of loss that survives a refactor.
 *
 * So the shape is read where the shape is declared. Change the wrapping and this
 * function is what stops compiling, instead of a card in another package going
 * dark.
 */
export function widgetLiveStreak(
  result: WidgetEvaluationResult,
): Extract<CardResult, { kind: "streak" }> | null {
  if (result.kind !== "structured") return null;
  if (result.value.kind !== "streak") return null;
  return result.value.alive ? result.value : null;
}

export interface WidgetEvaluationContext extends CardContext {
  surface: WidgetSurface;
  year: Pick<Year, "startsAt" | "endsAt" | "scale">;
  yearSubjects: readonly Subject[];
  periods: readonly Period[];
  customAverages: readonly CustomAverage[];
  now?: Date;
}

/**
 * A card described the way the packer and the storage row still need it: what it
 * measures, what it measures over, and how it is drawn.
 *
 * There were two identical copies of this — one for reading a definition down to
 * these fields, one for building a definition up from them — named for a
 * migration that is over. Layout genuinely needs them: a list card needs room for
 * its columns, so a width cannot be derived from the stored span alone.
 */
export interface CardSemantics {
  metric: CardMetric;
  targetKind: "general" | "subject" | "custom";
  targetId: string | null;
  goalId: string | null;
  display: CardSpec["display"];
}

export interface WidgetPreset {
  key: string;
  definition: WidgetDefinitionV1;
  presentation: Pick<CardSpec, "span" | "title" | "accent">;
}

export interface WidgetCompileOptions {
  surface: WidgetSurface;
  references?: {
    subjectIds?: ReadonlySet<string>;
    customAverageIds?: ReadonlySet<string>;
    goalIds?: ReadonlySet<string>;
    periodIds?: ReadonlySet<string>;
  };
}

export interface WidgetFormulaContext {
  grades: Array<{
    ratio: number;
    value: number;
    outOf: number;
    coefficient: number;
  }>;
  passingRatio: number;
  yearScale: number;
  /**
   * Evaluates a metric operand against the card's data (or the node's own
   * scope/window). Supplied by the widget evaluator; a context without it
   * resolves metric nodes to null.
   */
  resolveMetric?: (
    node: Extract<WidgetFormula, { kind: "metric" }>,
  ) => number | null;
}

export interface WidgetMetricEvaluation {
  result: CardResult;
  spec: CardSpec;
  goals: readonly Goal[];
}
