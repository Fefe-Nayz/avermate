import { CARD_METRICS, type CardMetric } from "./cards";
import {
  widgetMarkForRecipe,
  widgetRecipeDescriptor,
  WIDGET_RECIPES,
  type WidgetChartRecipe,
} from "./widget-recipes";
import {
  createWidgetDefinition,
  createWidgetVisualization,
  defaultMarkOptions,
  WIDGET_DEFAULT_DIMENSION_ID,
  WIDGET_DEFAULT_MEASURE_ID,
} from "./widget-defaults";
import { parseWidgetFormula } from "./widget-formula";
import {
  widgetCapability,
  widgetChannelFields,
  widgetChannelMeasure,
  widgetCompatibleRecipes,
  widgetDimensionSplitSupported,
  widgetGroupingOf,
  widgetMeasureCanMaterializeFrameValue,
  widgetMeasureHasIntrinsicDelta,
  widgetMeasureId,
  widgetMeasureValueType,
  widgetResultShapeForRecipe,
} from "./widget-registry";
import {
  widgetPrimaryDimension,
  widgetPrimaryMeasure,
  WIDGET_AVAILABLE_DIMENSIONS,
  WIDGET_AVAILABLE_SOURCES,
  WIDGET_DIMENSION_KINDS,
  WIDGET_GAUGE_THICKNESS,
  WIDGET_SOURCES,
} from "./widget-types";
import type {
  WidgetChartMark,
  WidgetCompileOptions,
  WidgetDispersion,
  WidgetCompileResult,
  WidgetAnalysis,
  WidgetChannel,
  WidgetDefinition,
  WidgetDimension,
  WidgetDimensionKind,
  WidgetEncodingSpec,
  WidgetFilter,
  WidgetGrouping,
  WidgetMeasure,
  WidgetMeasureEntry,
  WidgetFormula,
  WidgetMarkOptions,
  WidgetNumericOperator,
  WidgetReferences,
  WidgetResultShape,
  WidgetScope,
  WidgetSource,
  WidgetTransform,
  WidgetValidationIssue,
  WidgetWindow,
  WidgetValidationResult,
} from "./widget-types";
import {
  WIDGET_DEFINITION_VERSION,
  WIDGET_DISPERSION_METRICS,
  WIDGET_DISPERSIONS,
  WIDGET_LIMITS,
} from "./widget-types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function issue(
  issues: WidgetValidationIssue[],
  path: string,
  code: WidgetValidationIssue["code"],
  messageKey: string,
): void {
  issues.push({ path, code, messageKey });
}

function finite(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function integer(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.round(finite(value, fallback, min, max));
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 80)
    : null;
}

function thresholdColor(
  value: unknown,
  path: string,
  issues: WidgetValidationIssue[],
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    return value.toLowerCase();
  }
  issue(issues, path, "invalid-value", "widget.error.color");
  return null;
}

function uniqueStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  ].slice(0, limit);
}

const NUMERIC_OPERATORS: WidgetNumericOperator[] = [
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
];

function normalizeFilters(
  value: unknown,
  issues: WidgetValidationIssue[],
): WidgetFilter[] {
  if (!Array.isArray(value)) {
    issue(
      issues,
      "query.filters",
      "invalid-type",
      "widget.error.filters-array",
    );
    return [];
  }
  if (value.length > WIDGET_LIMITS.filters) {
    issue(
      issues,
      "query.filters",
      "complexity-limit",
      "widget.error.filters-limit",
    );
  }
  const filters: WidgetFilter[] = [];
  for (const [index, raw] of value.slice(0, WIDGET_LIMITS.filters).entries()) {
    const item = record(raw);
    const path = `query.filters.${index}`;
    if (!item || typeof item.kind !== "string") {
      issue(issues, path, "invalid-type", "widget.error.filter");
      continue;
    }
    if (item.kind === "grade-ratio" || item.kind === "coefficient") {
      if (
        !NUMERIC_OPERATORS.includes(item.operator as WidgetNumericOperator) ||
        typeof item.value !== "number" ||
        !Number.isFinite(item.value)
      ) {
        issue(issues, path, "invalid-value", "widget.error.numeric-filter");
        continue;
      }
      filters.push({
        kind: item.kind,
        operator: item.operator as WidgetNumericOperator,
        value:
          item.kind === "grade-ratio"
            ? finite(item.value, 0, -10, 10)
            : finite(item.value, 0, 0, 1_000),
      });
    } else if (item.kind === "has-note" || item.kind === "passed") {
      if (typeof item.value !== "boolean") {
        issue(issues, `${path}.value`, "invalid-type", "widget.error.boolean");
        continue;
      }
      filters.push({ kind: item.kind, value: item.value });
    } else if (item.kind === "grade-name") {
      if (
        (item.operator !== "contains" && item.operator !== "not-contains") ||
        typeof item.value !== "string" ||
        item.value.trim().length === 0
      ) {
        issue(issues, path, "invalid-value", "widget.error.text-filter");
        continue;
      }
      filters.push({
        kind: "grade-name",
        operator: item.operator,
        value: item.value.trim().slice(0, 80),
      });
    } else {
      issue(issues, `${path}.kind`, "unsupported", "widget.error.filter-kind");
    }
  }
  return filters;
}

/**
 * One window.
 *
 * Lifted out of the query parse, unchanged, because a window pair needs the same reading
 * twice — and a second copy of six branches is a second copy that drifts.
 */
function parseWindow(
  value: unknown,
  path: string,
  fallback: WidgetWindow,
  issues: WidgetValidationIssue[],
): WidgetWindow {
  const raw = record(value);
  if (raw?.kind === "whole-year" || raw?.kind === "active-period") {
    return { kind: raw.kind };
  }
  if (raw?.kind === "period") {
    const periodId = text(raw.periodId);
    if (!periodId) {
      issue(
        issues,
        `${path}.periodId`,
        "required",
        "widget.error.period-required",
      );
    }
    return { kind: "period", periodId };
  }
  if (raw?.kind === "rolling-days") {
    return { kind: "rolling-days", days: integer(raw.days, 30, 1, 3_650) };
  }
  if (raw?.kind === "last-grades") {
    return { kind: "last-grades", count: integer(raw.count, 10, 1, 500) };
  }
  if (raw?.kind === "date-range") {
    const window = {
      kind: "date-range" as const,
      from: text(raw.from),
      to: text(raw.to),
    };
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      issue(issues, path, "invalid-value", "widget.error.date-range");
    }
    return window;
  }
  issue(issues, `${path}.kind`, "invalid-value", "widget.error.window-kind");
  return fallback;
}

function normalizeTransforms(
  value: unknown,
  issues: WidgetValidationIssue[],
): WidgetTransform[] {
  if (!Array.isArray(value)) {
    issue(
      issues,
      "analysis.transforms",
      "invalid-type",
      "widget.error.transforms-array",
    );
    return [];
  }
  if (value.length > WIDGET_LIMITS.transforms) {
    issue(
      issues,
      "analysis.transforms",
      "complexity-limit",
      "widget.error.transforms-limit",
    );
  }
  const transforms: WidgetTransform[] = [];
  for (const [index, raw] of value
    .slice(0, WIDGET_LIMITS.transforms)
    .entries()) {
    const item = record(raw);
    const path = `analysis.transforms.${index}`;
    if (!item || typeof item.kind !== "string") {
      issue(issues, path, "invalid-type", "widget.error.transform");
      continue;
    }
    if (
      item.kind === "sort" &&
      (item.direction === "ascending" || item.direction === "descending")
    ) {
      transforms.push({ kind: "sort", direction: item.direction });
    } else if (item.kind === "limit") {
      transforms.push({
        kind: "limit",
        count: integer(item.count, 10, 1, WIDGET_LIMITS.resultPoints),
      });
    } else if (item.kind === "moving-average") {
      transforms.push({
        kind: "moving-average",
        points: integer(item.points, 3, 2, 100),
      });
    } else if (item.kind === "cumulative") {
      transforms.push({ kind: "cumulative" });
    } else {
      issue(issues, path, "invalid-value", "widget.error.transform-kind");
    }
  }
  return transforms;
}

/**
 * Metrics read against a group, and which therefore need one named.
 *
 * A card stores the group's id and nothing else about it: the figures arrive with the
 * render, so a comparison a member withdrew from empties rather than lingering.
 */
const COHORT_METRICS: CardMetric[] = [
  "cohortRank",
  "cohortAverage",
  "cohortGap",
  "memberAverage",
];

/**
 * The readings that are about a *particular* person, and so need one named.
 *
 * A classmate is named through a group and a friend through the friendship itself, and
 * both are one id — who this reading is about. The group is a separate requirement, which
 * is why `memberAverage` appears in both lists and the friend readings only in this one.
 */
const COHORT_MEMBER_METRICS: CardMetric[] = ["memberAverage"];

const FRIEND_METRICS: CardMetric[] = [
  "friendAverage",
  "friendCurves",
  "friendSubjects",
];

const MEMBER_METRICS: CardMetric[] = [
  ...COHORT_MEMBER_METRICS,
  ...FRIEND_METRICS,
];

/**
 * Which kinds of other-people's data a definition actually needs.
 *
 * The two lists above are the truth about that, and the host asking "should I fetch a
 * class?" needs the same answer the compiler uses. Without it every card on a dashboard
 * mounted the cohort and friend queries — one request per class, per card — to evaluate
 * an average that reads nobody.
 */
export function widgetSocialNeeds(definition: WidgetDefinition): {
  cohorts: boolean;
  friends: boolean;
} {
  const metrics = definition.analysis.measures.flatMap((entry) =>
    entry.expression.kind === "metric" ? [entry.expression.metric] : [],
  );
  return {
    cohorts: metrics.some((metric) => COHORT_METRICS.includes(metric)),
    friends: metrics.some((metric) => FRIEND_METRICS.includes(metric)),
  };
}

/** Metrics whose reading is *of* a goal, and which therefore need one named. */
/** Quarters, in the ratio space thresholds live in. See the grade-band dimension. */
const WIDGET_DEFAULT_BANDS = [0.25, 0.5, 0.75];

const GOAL_METRICS: CardMetric[] = [
  "goalProgress",
  "requiredResult",
  "safetyMargin",
];

const MARKS: WidgetChartMark[] = [
  "value",
  "gauge",
  "line",
  "area",
  "bar",
  "dot",
  "histogram",
  "boxplot",
  "heatmap",
  "table",
  "list",
  "lollipop",
  "waffle",
  "slope-arrow",
  "strip",
  "dumbbell",
  "treemap",
  "waterfall",
  "band",
  "facets",
  "violin",
  "ridgeline",
  "difference-area",
  "scatter",
  "control",
  "radar",
  "regression",
  "sunburst",
];

/**
 * Marks whose second end is `value - delta`, and so are nothing without one.
 *
 * Exported because two places need the same answer: the compiler refuses such a
 * mark with nothing to pair, and anything *building* a definition — the editor's
 * defaults, the test matrix — has to supply the comparison rather than discover the
 * refusal.
 */
export const WIDGET_PAIRED_MARKS: readonly WidgetChartMark[] = [
  "slope-arrow",
  "dumbbell",
];

/**
 * A measure expression: a built-in metric, or a formula.
 *
 * Lifted out of the single-measure parse it used to be inlined in, unchanged in what it
 * accepts — a list of measures needs the same reading N times, and one copy is how the
 * goal requirement and the dispersion option stay identical on every one of them.
 */
function parseMeasureExpression(
  value: unknown,
  path: string,
  issues: WidgetValidationIssue[],
): WidgetMeasure {
  const raw = record(value);
  if (raw?.kind === "formula") {
    const parsed = parseWidgetFormula(
      raw.formula,
      `${path}.expression.formula`,
    );
    issues.push(...parsed.issues);
    return {
      kind: "formula",
      formula: parsed.formula ?? { kind: "literal", value: 0 },
      valueType:
        raw.valueType === "ratio" ||
        raw.valueType === "count" ||
        raw.valueType === "percent"
          ? raw.valueType
          : "number",
    };
  }
  if (
    raw?.kind === "metric" &&
    CARD_METRICS.includes(raw.metric as CardMetric)
  ) {
    const metric = raw.metric as CardMetric;
    // The metrics that measure a goal. A goal id on anything else is dropped, and a
    // missing one on these is an error: a card that asks what it needs next has to be
    // told what for.
    const needsGoal = GOAL_METRICS.includes(metric);
    // Only the metrics that read it carry it, so a spread's estimator cannot travel on
    // an average and reappear if that average later becomes one.
    const dispersion =
      WIDGET_DISPERSION_METRICS.includes(metric) &&
      WIDGET_DISPERSIONS.includes(raw.dispersion as WidgetDispersion)
        ? (raw.dispersion as WidgetDispersion)
        : undefined;
    const goalId =
      needsGoal && typeof raw.goalId === "string" ? raw.goalId : null;
    if (needsGoal && !goalId) {
      issue(
        issues,
        `${path}.expression.goalId`,
        "required",
        "widget.error.goal-required",
      );
    }
    /**
     * The group a cohort metric compares against, and the member it is about.
     *
     * Carried only by the metrics that read them, for the same reason the estimator is:
     * a group id left on an average would travel silently and reappear the day that
     * average became a cohort reading. A cohort metric without a group is an error — the
     * card cannot be answered at all — while the member is optional, because most of
     * these readings are about the reader.
     */
    const cohort = COHORT_METRICS.includes(metric);
    const groupId =
      cohort && typeof raw.groupId === "string" && raw.groupId.length > 0
        ? raw.groupId
        : null;
    if (cohort && !groupId) {
      issue(
        issues,
        `${path}.expression.groupId`,
        "required",
        "widget.error.group-required",
      );
    }
    const needsMember = MEMBER_METRICS.includes(metric);
    const memberId =
      needsMember && typeof raw.memberId === "string" && raw.memberId.length > 0
        ? raw.memberId
        : null;
    if (needsMember && !memberId) {
      issue(
        issues,
        `${path}.expression.memberId`,
        "required",
        "widget.error.member-required",
      );
    }
    return {
      kind: "metric",
      metric,
      goalId,
      ...(cohort ? { groupId } : {}),
      ...(needsMember ? { memberId } : {}),
      ...(dispersion === undefined ? {} : { dispersion }),
    };
  }
  issue(issues, `${path}.expression`, "invalid-value", "widget.error.measure");
  return { kind: "metric", metric: "average", goalId: null };
}

/**
 * One named measure.
 *
 * The id is the card's own handle on the reading — a channel points at it, a legend
 * names it — so it has to be present and stable. A missing one is filled from the
 * position rather than refused: an unnamed measure is a document written by hand, and
 * naming it `measure` (or `measure2`) is a better answer than an empty card.
 */
function parseMeasureEntry(
  value: unknown,
  index: number,
  issues: WidgetValidationIssue[],
  total: number,
): WidgetMeasureEntry {
  const raw = record(value);
  const path = `analysis.measures.${index}`;
  const fallbackId =
    index === 0
      ? WIDGET_DEFAULT_MEASURE_ID
      : `${WIDGET_DEFAULT_MEASURE_ID}${index + 1}`;
  const id =
    typeof raw?.id === "string" && raw.id.trim().length > 0
      ? raw.id.trim()
      : fallbackId;
  const label =
    typeof raw?.label === "string" && raw.label.trim().length > 0
      ? raw.label.trim()
      : null;
  // A single unlabelled measure needs no label — the measure's own name is the words —
  // but two measures on one chart do, or the legend says "average" twice.
  if (total > 1 && label === null) {
    issue(issues, `${path}.label`, "required", "widget.error.measure-label");
  }
  return {
    id,
    label,
    expression: parseMeasureExpression(raw?.expression, path, issues),
  };
}

/**
 * A dimension, or `null` when it is not one this build can answer.
 *
 * The unavailable kinds are refused here rather than accepted and ignored: an
 * assessment-type axis with no normalised type behind it would draw one bucket called
 * "unknown", which looks like an answer and is not one.
 */
function parseDimension(
  value: unknown,
  index: number,
  issues: WidgetValidationIssue[],
): WidgetDimension | null {
  const raw = record(value);
  const path = `analysis.dimensions.${index}`;
  const kind = raw?.kind;
  // The editor writes `none` to mean "no dimension here": its grouping control is one
  // choice over a path, and an ungrouped analysis has *no* dimension rather than a
  // dimension of nothing. Read as an empty slot, silently, because it is not an error.
  if (kind === "none") return null;
  if (
    typeof kind !== "string" ||
    !WIDGET_DIMENSION_KINDS.includes(kind as WidgetDimensionKind)
  ) {
    issue(issues, path, "invalid-value", "widget.error.grouping");
    return null;
  }
  if (!WIDGET_AVAILABLE_DIMENSIONS.includes(kind as WidgetDimensionKind)) {
    issue(issues, path, "unsupported", "widget.error.dimension-unavailable");
    return null;
  }
  const id =
    typeof raw?.id === "string" && raw.id.trim().length > 0
      ? raw.id.trim()
      : index === 0
        ? WIDGET_DEFAULT_DIMENSION_ID
        : `${WIDGET_DEFAULT_DIMENSION_ID}${index + 1}`;

  switch (kind as WidgetDimensionKind) {
    case "time":
      return {
        id,
        kind: "time",
        grain:
          raw?.grain === "event" ||
          raw?.grain === "day" ||
          raw?.grain === "month" ||
          raw?.grain === "period"
            ? raw.grain
            : "week",
        accumulation: raw?.accumulation === "bucket" ? "bucket" : "running",
        // `observed` is what a line wants: an empty week is a gap, not a zero.
        fill: raw?.fill === "calendar" ? "calendar" : "observed",
      };
    case "subject":
      return {
        id,
        kind: "subject",
        level:
          raw?.level === "leaf" || raw?.level === "root" ? raw.level : "all",
        includeCategories: bool(raw?.includeCategories, false),
        limit: integer(raw?.limit, 10, 1, 100),
      };
    case "grade-band": {
      const thresholds = Array.isArray(raw?.thresholds)
        ? raw.thresholds
            .filter(
              (item): item is number =>
                typeof item === "number" && Number.isFinite(item),
            )
            .map((item) => Math.min(1, Math.max(0, item)))
            .sort((left, right) => left - right)
            .slice(0, WIDGET_LIMITS.thresholds)
        : [];
      /**
       * Quarters of the scale, when nobody has said otherwise.
       *
       * This used to be an error, and no editor could clear it: the flow offers no
       * control for a list of thresholds — it says so, in a comment that assumed the
       * defaults existed here — so a grade-band card was offered, could not be filled in,
       * and refused to compile. A default that can be changed later is what the flow was
       * written against, and quarters are the neutral reading: four bands, no opinion
       * about where a pass sits.
       */
      return {
        id,
        kind: "grade-band",
        thresholds: thresholds.length > 0 ? thresholds : WIDGET_DEFAULT_BANDS,
      };
    }
    case "period":
      return { id, kind: "period" };
    case "assessment-type":
      return {
        id,
        kind: "assessment-type",
        // On by default: results with no type are part of the year, and a card that
        // dropped them would report a share of it as if it were all of it.
        includeUntyped: bool(raw?.includeUntyped, true),
      };
    case "status": {
      const allowed = ["passed", "failed", "missing"] as const;
      const requested = Array.isArray(raw?.values) ? raw.values : [];
      const values = allowed.filter((item) => requested.includes(item));
      return {
        id,
        kind: "status",
        // Nothing selected is the two states marks actually carry. `missing` describes a
        // subject with no marks and is only meaningful on coverage × subject; it is never
        // injected into an ordinary status axis by a default.
        values:
          values.length > 0 ? [...values] : (["passed", "failed"] as const),
      };
    }
    default:
      issue(issues, path, "unsupported", "widget.error.dimension-unavailable");
      return null;
  }
}

/** The dimension a capability falls back to when the document supplied none it takes. */
function defaultDimension(kind: WidgetGrouping): WidgetDimension {
  if (kind === "subject") {
    return {
      id: WIDGET_DEFAULT_DIMENSION_ID,
      kind: "subject",
      level: "all",
      includeCategories: false,
      limit: 10,
    };
  }
  if (kind === "period")
    return { id: WIDGET_DEFAULT_DIMENSION_ID, kind: "period" };
  if (kind === "status") {
    return {
      id: WIDGET_DEFAULT_DIMENSION_ID,
      kind: "status",
      values: ["passed", "failed"],
    };
  }
  if (kind === "grade-band") {
    return {
      id: WIDGET_DEFAULT_DIMENSION_ID,
      kind: "grade-band",
      thresholds: [0.4, 0.5, 0.6, 0.7, 0.8],
    };
  }
  return {
    id: WIDGET_DEFAULT_DIMENSION_ID,
    kind: "time",
    grain: "week",
    accumulation: "running",
    fill: "observed",
  };
}

function markOptions(mark: WidgetChartMark, value: unknown): WidgetMarkOptions {
  const raw = record(value);
  const defaults = defaultMarkOptions(mark);
  if (!raw || raw.kind !== mark) return defaults;
  switch (mark) {
    case "value":
      return {
        kind: "value",
        showDelta: bool(raw.showDelta, true),
        trendIndicator: bool(raw.trendIndicator, true),
      };
    case "gauge":
      return {
        kind: "gauge",
        showValue: bool(raw.showValue, true),
        // Absent, malformed, or the string: all of them mean "let the renderer
        // decide". Only a usable number is an override.
        thickness:
          typeof raw.thickness === "number" && Number.isFinite(raw.thickness)
            ? finite(raw.thickness, WIDGET_GAUGE_THICKNESS, 2, 32)
            : "auto",
      };
    case "line":
      return {
        kind: "line",
        curve:
          raw.curve === "linear" || raw.curve === "step"
            ? raw.curve
            : "monotone",
        points: bool(raw.points, false),
        strokeWidth: finite(raw.strokeWidth, 2, 1, 8),
      };
    case "area":
      return {
        kind: "area",
        curve:
          raw.curve === "linear" || raw.curve === "step"
            ? raw.curve
            : "monotone",
        points: bool(raw.points, false),
        opacity: finite(raw.opacity, 0.22, 0, 1),
      };
    case "bar":
      return {
        kind: "bar",
        orientation:
          raw.orientation === "horizontal" ? "horizontal" : "vertical",
        stacked: bool(raw.stacked, false),
        cornerRadius: finite(raw.cornerRadius, 4, 0, 20),
      };
    case "dot":
      return { kind: "dot", size: finite(raw.size, 6, 1, 24) };
    case "histogram":
      return { kind: "histogram", bins: integer(raw.bins, 10, 3, 40) };
    case "boxplot":
      return { kind: "boxplot", showOutliers: bool(raw.showOutliers, true) };
    case "heatmap":
      return {
        kind: "heatmap",
        colorScheme:
          raw.colorScheme === "sequential" || raw.colorScheme === "diverging"
            ? raw.colorScheme
            : "semantic",
      };
    case "table":
      return { kind: "table", rows: integer(raw.rows, 10, 1, 100) };
    case "lollipop":
      return {
        kind: "lollipop",
        orientation: raw.orientation === "vertical" ? "vertical" : "horizontal",
        size: finite(raw.size, 8, 2, 24),
      };
    case "waffle":
      // Bounded rather than free: a grid of four cells says nothing and a grid
      // of a thousand is a texture. The renderer picks the arrangement.
      return { kind: "waffle", cells: integer(raw.cells, 20, 10, 100) };
    case "slope-arrow":
      return { kind: "slope-arrow", showLabels: bool(raw.showLabels, true) };
    case "violin":
      return {
        kind: "violin",
        showBox: bool(raw.showBox, true),
        half: bool(raw.half, false),
      };
    case "ridgeline":
      return { kind: "ridgeline", overlap: finite(raw.overlap, 0.35, 0, 0.9) };
    case "sunburst":
      return {
        kind: "sunburst",
        depth: Math.round(finite(raw.depth, 2, 1, 4)),
        ringPadding: finite(raw.ringPadding, 1, 0, 8),
      };
    case "regression":
      return {
        kind: "regression",
        showBand: bool(raw.showBand, true),
        showPoints: bool(raw.showPoints, true),
        showReading: bool(raw.showReading, true),
      };
    case "radar":
      return {
        kind: "radar",
        fill: bool(raw.fill, true),
        showPoints: bool(raw.showPoints, true),
      };
    case "control":
      return {
        kind: "control",
        showPoints: bool(raw.showPoints, true),
        // Two or three, and nothing else: one deviation is half the marks and four is
        // never, so a slider over the range would offer mostly wrong answers.
        deviations: raw.deviations === 3 ? 3 : 2,
      };
    case "scatter":
      return {
        kind: "scatter",
        quadrants: bool(raw.quadrants, true),
        showLabels: bool(raw.showLabels, true),
        size: finite(raw.size, 8, 3, 24),
      };
    case "difference-area":
      return {
        kind: "difference-area",
        showLines: bool(raw.showLines, true),
        opacity: finite(raw.opacity, 0.22, 0.05, 0.6),
      };
    case "facets":
      return {
        kind: "facets",
        // The inner recipe is a recipe, and one that is not a container itself: a grid of
        // grids is not a chart.
        inner:
          WIDGET_RECIPES.includes(raw.inner as WidgetChartRecipe) &&
          raw.inner !== "facets"
            ? (raw.inner as WidgetChartRecipe)
            : "line",
        columns: integer(raw.columns, 2, 1, 4),
        sharedScale: bool(raw.sharedScale, true),
      };
    case "band":
      return {
        kind: "band",
        opacity: finite(raw.opacity, 0.18, 0.05, 0.6),
        showCenter: bool(raw.showCenter, true),
      };
    case "waterfall":
      return {
        kind: "waterfall",
        steps: integer(raw.steps, 5, 2, 12),
        showTotals: bool(raw.showTotals, true),
      };
    case "treemap":
      return {
        kind: "treemap",
        depth: integer(raw.depth, 2, 1, 4),
        showLabels: bool(raw.showLabels, true),
      };
    case "dumbbell":
      return {
        kind: "dumbbell",
        size: finite(raw.size, 10, 4, 24),
        showLabels: bool(raw.showLabels, false),
      };
    case "strip":
      return {
        kind: "strip",
        // Bounded: a one-pixel tick is invisible and a twenty-pixel one is a bar.
        tick: finite(raw.tick, 10, 4, 24),
        showMedian: bool(raw.showMedian, true),
      };
    case "list":
      return {
        kind: "list",
        rows: integer(raw.rows, 8, 1, 100),
        showValues: bool(raw.showValues, true),
      };
  }
}

/**
 * A channel, with its type derived from what it points at.
 *
 * The type is not the document's to choose: a time dimension is temporal, any other
 * dimension is nominal, and a measure is a quantity. Reading it from the analysis rather
 * than trusting the stored value is what stops a channel claiming a subject axis is
 * temporal and a renderer building a time scale over subject names.
 */
function channel(
  value: unknown,
  analysis: Pick<WidgetAnalysis, "measures" | "dimensions">,
): WidgetChannel | null {
  const raw = record(value);
  const field = typeof raw?.field === "string" ? raw.field : null;
  if (field === null) return null;
  const dimension = analysis.dimensions.find((item) => item.id === field);
  if (dimension) {
    return {
      field,
      type: dimension.kind === "time" ? "temporal" : "nominal",
    };
  }
  return widgetChannelMeasure(analysis, field) === null
    ? null
    : { field, type: "quantitative" };
}

function normalizeChannel(
  name: "x" | "y" | "color" | "series" | "facet",
  value: unknown,
  fallback: WidgetChannel | null,
  allowed: readonly string[],
  analysis: Pick<WidgetAnalysis, "measures" | "dimensions">,
  issues: WidgetValidationIssue[],
): WidgetChannel | null {
  if (value === undefined) {
    return fallback && allowed.includes(fallback.field) ? fallback : null;
  }
  if (value === null) return null;
  const parsed = channel(value, analysis);
  if (!parsed) {
    issue(
      issues,
      `visualization.encoding.${name}`,
      "invalid-value",
      "widget.error.encoding",
    );
    return null;
  }
  if (!allowed.includes(parsed.field)) {
    issue(
      issues,
      `visualization.encoding.${name}`,
      "unsupported",
      "widget.error.encoding-channel",
    );
    return null;
  }
  return parsed;
}

function normalizeDefinition(
  input: unknown,
  options: WidgetCompileOptions,
): { definition: WidgetDefinition; issues: WidgetValidationIssue[] } {
  const issues: WidgetValidationIssue[] = [];
  const fallback = createWidgetDefinition(options.surface);
  const root = record(input);
  if (!root) {
    issue(issues, "", "invalid-type", "widget.error.definition-object");
    return { definition: fallback, issues };
  }
  if (root.apiVersion !== WIDGET_DEFINITION_VERSION) {
    issue(
      issues,
      "apiVersion",
      "unsupported",
      "widget.error.definition-version",
    );
  }
  const query = record(root.query);
  const analysis = record(root.analysis);
  const visualization = record(root.visualization);
  if (!query || !analysis || !visualization) {
    issue(issues, "", "required", "widget.error.definition-sections");
    return { definition: fallback, issues };
  }

  const requestedSource = WIDGET_SOURCES.includes(query.source as WidgetSource)
    ? (query.source as WidgetSource)
    : null;
  if (requestedSource === null) {
    issue(
      issues,
      "query.source",
      "invalid-value",
      "widget.error.source-kind",
    );
  } else if (!WIDGET_AVAILABLE_SOURCES.includes(requestedSource)) {
    // Declared sources are part of the V2 vocabulary before every adapter exists. They
    // must fail visibly until built: accepting `cohort` and evaluating `grades` instead
    // changes the question while claiming the document compiled successfully.
    issue(
      issues,
      "query.source",
      "unsupported",
      "widget.error.source-unavailable",
    );
  }

  const scopeRaw = record(query.scope);
  let scope = fallback.query.scope;
  if (scopeRaw?.kind === "subjects") {
    const subjectIds = uniqueStrings(
      scopeRaw.subjectIds,
      WIDGET_LIMITS.subjectReferences,
    );
    if (subjectIds.length === 0)
      issue(
        issues,
        "query.scope.subjectIds",
        "required",
        "widget.error.subject-required",
      );
    scope = {
      kind: "subjects",
      subjectIds,
      includeDescendants: bool(scopeRaw.includeDescendants, true),
    };
  } else if (scopeRaw?.kind === "custom-average") {
    const averageId = text(scopeRaw.averageId);
    if (!averageId)
      issue(
        issues,
        "query.scope.averageId",
        "required",
        "widget.error.average-required",
      );
    scope = { kind: "custom-average", averageId };
  } else if (scopeRaw?.kind !== "general") {
    issue(
      issues,
      "query.scope.kind",
      "invalid-value",
      "widget.error.scope-kind",
    );
  }

  let window = parseWindow(
    query.window,
    "query.window",
    fallback.query.window,
    issues,
  );

  const measuresRaw = Array.isArray(analysis.measures)
    ? analysis.measures.slice(0, WIDGET_LIMITS.measures)
    : [];
  if (Array.isArray(analysis.measures)) {
    if (analysis.measures.length === 0) {
      issue(
        issues,
        "analysis.measures",
        "required",
        "widget.error.measure-required",
      );
    }
    if (analysis.measures.length > WIDGET_LIMITS.measures) {
      issue(
        issues,
        "analysis.measures",
        "unsupported",
        "widget.error.too-many-measures",
      );
    }
  } else {
    issue(issues, "analysis.measures", "invalid-value", "widget.error.measure");
  }

  const measures: WidgetMeasureEntry[] =
    measuresRaw.length === 0
      ? fallback.analysis.measures
      : measuresRaw.map((raw, index) =>
          parseMeasureEntry(raw, index, issues, measuresRaw.length),
        );
  // Ids are how a channel points at a measure, so two measures cannot share one: the
  // channel would resolve to whichever came first and the second would be undrawable.
  const seenMeasureIds = new Set<string>();
  for (const [index, entry] of measures.entries()) {
    if (seenMeasureIds.has(entry.id)) {
      issue(
        issues,
        `analysis.measures.${index}.id`,
        "invalid-value",
        "widget.error.duplicate-id",
      );
    }
    seenMeasureIds.add(entry.id);
  }
  // The capability table asks about one reading, so the *first* measure is the one that
  // decides shape, scope and surface. Every measure is checked against the surface
  // below; the rest of the table applies to the primary.
  const measure =
    measures[0]?.expression ?? fallback.analysis.measures[0]!.expression;

  const capability = widgetCapability(widgetMeasureId(measure));
  if (!capability.surfaces.includes(options.surface)) {
    issue(
      issues,
      "analysis.measure",
      "unsupported",
      "widget.error.measure-surface",
    );
  }
  if (!capability.scopes.includes(scope.kind)) {
    issue(issues, "query.scope", "unsupported", "widget.error.measure-scope");
    scope = { kind: "general" };
  }
  if (measure.kind === "metric" && measure.metric === "goalProgress") {
    if (window.kind !== "active-period") {
      issue(
        issues,
        "query.window",
        "unsupported",
        "widget.error.goal-owns-window",
      );
      window = { kind: "active-period" };
    }
    if (Array.isArray(query.filters) && query.filters.length > 0) {
      issue(
        issues,
        "query.filters",
        "unsupported",
        "widget.error.goal-owns-filters",
      );
    }
  }

  const dimensionsRaw = Array.isArray(analysis.dimensions)
    ? analysis.dimensions.slice(0, WIDGET_LIMITS.dimensions)
    : [];
  if (!Array.isArray(analysis.dimensions)) {
    issue(
      issues,
      "analysis.dimensions",
      "invalid-value",
      "widget.error.grouping",
    );
  } else if (analysis.dimensions.length > WIDGET_LIMITS.dimensions) {
    // Two is the ceiling: three is a cube, and a cube has no honest two-dimensional
    // drawing — only a choice of drawing, which is a different feature.
    issue(
      issues,
      "analysis.dimensions",
      "unsupported",
      "widget.error.too-many-dimensions",
    );
  }

  let dimensions: WidgetDimension[] = dimensionsRaw.flatMap((raw, index) => {
    const parsed = parseDimension(raw, index, issues);
    return parsed ? [parsed] : [];
  });
  const seenDimensionIds = new Set<string>();
  for (const [index, dimension] of dimensions.entries()) {
    if (seenDimensionIds.has(dimension.id)) {
      issue(
        issues,
        `analysis.dimensions.${index}.id`,
        "invalid-value",
        "widget.error.duplicate-id",
      );
    }
    seenDimensionIds.add(dimension.id);
  }
  // A measure that cannot be grouped a given way keeps the dimensions it can, rather
  // than the whole card falling back: dropping the offending axis is the smallest honest
  // correction, and the issue says which.
  const supported = dimensions.filter((dimension, index) => {
    if (capability.groupings.includes(dimension.kind)) return true;
    issue(
      issues,
      `analysis.dimensions.${index}`,
      "unsupported",
      "widget.error.measure-grouping",
    );
    return false;
  });
  if (supported.length !== dimensions.length) dimensions = supported;
  if (dimensions.length === 0 && !capability.groupings.includes("none")) {
    // The reverse case: a measure that *must* be grouped, given none.
    issue(
      issues,
      "analysis.dimensions",
      "required",
      "widget.error.grouping-required",
    );
    const kind = capability.groupings.find((item) => item !== "none");
    if (kind) dimensions = [defaultDimension(kind)];
  }

  /**
   * A split the evaluator can actually cut.
   *
   * A second dimension splits the series, and there are two ways to split: filter the
   * marks — a band, a status, a kind of assessment — or take a different part of the
   * subject tree. Only the second changes what the average is *of*, and only a time axis
   * knows how to hold several trees at once. So a subject as the inner split of a
   * categorical axis has no reading behind it.
   *
   * Refused rather than dropped, because dropping is what used to happen: the axis was
   * accepted, stored, and silently ignored at render, and the card came back with one
   * series and no explanation of where the other went.
   */
  const [outer, split] = dimensions;
  if (split && outer && !widgetDimensionSplitSupported(outer, split)) {
    issue(
      issues,
      "analysis.dimensions.1",
      "unsupported",
      "widget.error.split-unsupported",
    );
    dimensions = [outer];
  }

  /**
   * `missing` is a completed subject domain, not a property of a mark.
   *
   * Coverage can answer it when subject is the outer axis: one means that selected
   * subject has no mark, zero means it has at least one. Every other measure would have
   * to invent a number for an absent observation, so those combinations are refused with
   * the status field itself identified.
   */
  for (const [index, dimension] of dimensions.entries()) {
    if (dimension.kind !== "status" || !dimension.values.includes("missing")) {
      continue;
    }
    const completesSubjects =
      index === 1 && dimensions[0]?.kind === "subject";
    const coverageOnly = measures.every(
      (entry) =>
        entry.expression.kind === "metric" &&
        entry.expression.metric === "coverage",
    );
    if (!completesSubjects || !coverageOnly) {
      issue(
        issues,
        `analysis.dimensions.${index}.values`,
        "unsupported",
        "widget.error.missing-status-measure",
      );
    }
  }

  /**
   * And every measure after the first, against *its own* table.
   *
   * The primary decides the card's shape — that is why the table above is read once —
   * but a second series is still a reading, and it is drawn on the axis the primary
   * chose. A goal gauge asked for beside an average over time is the case: `goalProgress`
   * groups by nothing at all, so it cannot be a line, and nothing here noticed. The card
   * saved, compiled, and drew one series where two were asked for.
   *
   * Reported rather than dropped: which of the two measures to keep is the author's
   * decision, and the issue names the measure so the editor can point at it.
   */
  for (const [index, entry] of measures.entries()) {
    if (index === 0) continue;
    const secondary = widgetCapability(widgetMeasureId(entry.expression));
    const path = `analysis.measures.${index}.expression`;
    if (!secondary.surfaces.includes(options.surface)) {
      issue(issues, path, "unsupported", "widget.error.measure-surface");
      continue;
    }
    if (!secondary.scopes.includes(scope.kind)) {
      issue(issues, path, "unsupported", "widget.error.measure-scope");
    }
    const groupable =
      dimensions.length === 0
        ? secondary.groupings.includes("none")
        : dimensions.every((dimension) =>
            secondary.groupings.includes(dimension.kind),
          );
    if (!groupable) {
      issue(issues, path, "unsupported", "widget.error.measure-grouping");
      continue;
    }
    if (!widgetMeasureCanMaterializeFrameValue(entry.expression, dimensions)) {
      issue(issues, path, "unsupported", "widget.error.measure-shape");
    }
  }

  /**
   * Transforms that have nothing to run over.
   *
   * A sort or a limit needs rows to sort; a moving average and a cumulative need an
   * *order* to walk, which a categorical axis does not have — subjects have no next.
   * Dropped rather than kept, with the issue saying so, because a saved transform that
   * silently does nothing is the audit's "valid, saved, ignored".
   */
  let transforms = normalizeTransforms(analysis.transforms, issues);
  const grouping = widgetGroupingOf(dimensions);
  if (grouping === "none" && transforms.length > 0) {
    issue(
      issues,
      "analysis.transforms",
      "unsupported",
      "widget.error.transforms-grouping",
    );
    transforms = [];
  } else if (grouping !== "time" && grouping !== "period") {
    const ordered = transforms.filter(
      (transform) =>
        transform.kind === "moving-average" || transform.kind === "cumulative",
    );
    if (ordered.length > 0) {
      issue(
        issues,
        "analysis.transforms",
        "unsupported",
        "widget.error.transforms-grouping",
      );
      transforms = transforms.filter(
        (transform) =>
          transform.kind !== "moving-average" &&
          transform.kind !== "cumulative",
      );
    }
  }

  const comparisonRaw = record(analysis.comparison);
  let comparison = fallback.analysis.comparison;
  if (comparisonRaw?.kind === "previous-window")
    comparison = { kind: "previous-window" };
  else if (comparisonRaw?.kind === "baseline")
    comparison = {
      kind: "baseline",
      value: finite(comparisonRaw.value, 0, -1_000_000, 1_000_000),
    };
  else if (comparisonRaw?.kind === "window-pair") {
    const left = parseWindow(
      comparisonRaw.left,
      "analysis.comparison.left",
      window,
      issues,
    );
    const right = parseWindow(
      comparisonRaw.right,
      "analysis.comparison.right",
      window,
      issues,
    );
    comparison = {
      kind: "window-pair",
      left,
      right,
      alignment:
        comparisonRaw.alignment === "calendar" ||
        comparisonRaw.alignment === "period"
          ? comparisonRaw.alignment
          : "relative",
    };
  } else if (comparisonRaw?.kind === "none") comparison = { kind: "none" };
  else
    issue(
      issues,
      "analysis.comparison",
      "invalid-value",
      "widget.error.comparison",
    );
  if (!capability.comparisons.includes(comparison.kind)) {
    issue(
      issues,
      "analysis.comparison",
      "unsupported",
      "widget.error.measure-comparison",
    );
    comparison = { kind: "none" };
  }
  for (const [index, entry] of measures.entries()) {
    if (index === 0) continue;
    const secondary = widgetCapability(widgetMeasureId(entry.expression));
    if (!secondary.comparisons.includes(comparison.kind)) {
      issue(
        issues,
        `analysis.measures.${index}.expression`,
        "unsupported",
        "widget.error.measure-comparison",
      );
    }
  }
  if (comparison.kind === "previous-window" && window.kind === "whole-year") {
    issue(
      issues,
      "analysis.comparison",
      "unsupported",
      "widget.error.previous-window-whole-year",
    );
    comparison = { kind: "none" };
  }

  const requestedRecipe = WIDGET_RECIPES.includes(
    visualization.recipe as WidgetChartRecipe,
  )
    ? (visualization.recipe as WidgetChartRecipe)
    : fallback.visualization.recipe;
  const compatibleRecipes = widgetCompatibleRecipes(measure, dimensions);
  const recipe = compatibleRecipes.includes(requestedRecipe)
    ? requestedRecipe
    : (compatibleRecipes[0] ?? "value");
  if (recipe !== requestedRecipe) {
    issue(
      issues,
      "visualization.recipe",
      "unsupported",
      "widget.error.mark-incompatible",
    );
  }
  // The renderer's shape, derived rather than stored — see `widgetMarkForRecipe`. A
  // recipe with no mark cannot be selected, so this falls back only in principle.
  const mark: WidgetChartMark = widgetMarkForRecipe(recipe) ?? "value";
  const recipeDescriptor = widgetRecipeDescriptor(recipe);

  // Calendar is a semantic recipe rather than a weekly heatmap alias. Selecting it
  // canonicalises the time domain it requires, so every saved calendar has one cell per
  // day and completes the calendar rather than keeping only observed dates.
  if (recipe === "calendar" && dimensions[0]?.kind === "time") {
    dimensions = [
      {
        ...dimensions[0],
        grain: "day",
        fill: "calendar",
      },
      ...dimensions.slice(1),
    ];
  }

  const resultShape = widgetResultShapeForRecipe(measure, dimensions, recipe);
  if (!recipeDescriptor.acceptedResults.includes(resultShape)) {
    issue(
      issues,
      "visualization.recipe",
      "unsupported",
      "widget.error.recipe-result-shape",
    );
  }

  // A flat value has nowhere to put independent readings, and a recipe that declares one
  // series cannot consume several measure columns. Refuse the document instead of
  // evaluating only measures[0]. Grouped frame recipes keep all columns faithfully.
  if (measures.length > 1 && dimensions.length === 0) {
    issue(
      issues,
      "analysis.measures",
      "unsupported",
      "widget.error.multiple-measures-need-dimension",
    );
  } else if (measures.length > 1 && !recipeDescriptor.supportsMultipleSeries) {
    issue(
      issues,
      "visualization.recipe",
      "unsupported",
      "widget.error.recipe-single-measure",
    );
  }

  // A radar needs a closed polygon with enough independent spokes to read, but not so
  // many that labels and angles become noise. Unknown assessment-type cardinality is
  // checked against the materialised frame by the evaluator.
  if (recipe === "radar") {
    const axis = dimensions[0];
    const cardinality =
      axis?.kind === "subject"
        ? axis.limit
        : axis?.kind === "grade-band"
          ? axis.thresholds.length + 1
          : axis?.kind === "status"
            ? axis.values.length
            : null;
    if (cardinality !== null && (cardinality < 3 || cardinality > 8)) {
      issue(
        issues,
        "analysis.dimensions.0",
        "unsupported",
        "widget.error.radar-cardinality",
      );
    }
  }
  /**
   * The marks that draw a *pair*, and therefore need one to exist.
   *
   * A slope arrow's tail and a dumbbell's other end are both `value - delta`, so
   * without a delta there is one end and nothing to join it to. The renderer drew
   * exactly that: measured on the bench, `average · subject · dumbbell` with no
   * comparison produced eight grid lines and no marks at all — a valid card, saved,
   * that draws nothing. A missing required channel is the compiler's to refuse, not
   * a shape for a reader to interpret.
   */
  if (
    WIDGET_PAIRED_MARKS.includes(mark) &&
    comparison.kind === "none" &&
    !widgetMeasureHasIntrinsicDelta(measure)
  ) {
    issue(
      issues,
      "visualization.mark",
      "unsupported",
      "widget.error.mark-needs-comparison",
    );
  }
  /**
   * A grid with nothing to split by.
   *
   * A facet is one panel per value of a *second* dimension. With one dimension there is
   * one panel, which is a chart with a frame around it — so the compiler refuses it here
   * rather than the renderer drawing a grid of one and everyone wondering why.
   */
  /**
   * The ground between two readings needs two readings.
   *
   * One measure and an empty fill is a line chart with extra machinery, so the compiler asks
   * for the pair rather than letting a renderer draw nothing between a line and itself.
   */
  /**
   * Both axes of a scatter are readings, so there have to be two of them.
   *
   * The same rule as the difference area and for the same reason: one measure plotted
   * against itself is a diagonal line, which is a drawing of nothing.
   */
  if (recipe === "scatter" && measures.length !== 2) {
    issue(
      issues,
      "visualization.recipe",
      "unsupported",
      "widget.error.scatter-needs-two",
    );
  }

  if (recipe === "difference-area" && measures.length !== 2) {
    issue(
      issues,
      "visualization.recipe",
      "unsupported",
      "widget.error.difference-needs-two",
    );
  }

  /**
   * A difference between a percentage and a mark is not a difference.
   *
   * Both readings of a difference area share one vertical axis, so they have to be in the
   * same units — the *gap* is the reading, and the gap between 88% and 13/20 is a number
   * with no meaning. A scatter is exempt by construction: its two measures are two axes,
   * and having different units is the point.
   */
  if (recipe === "difference-area" && measures.length >= 2) {
    const units = measures
      .slice(0, 2)
      .map((entry) => widgetMeasureValueType(entry.expression));
    if (units[0] !== units[1]) {
      issue(
        issues,
        "visualization.recipe",
        "unsupported",
        "widget.error.difference-needs-one-unit",
      );
    }
  }

  /**
   * A ridgeline of one row is a violin.
   *
   * Rows *are* the chart — the comparison between them is the whole reading — so an ungrouped
   * one has nothing to compare and is refused. A violin is fine ungrouped: one shape is a
   * shape.
   */
  if (recipe === "ridgeline" && dimensions.length === 0) {
    issue(
      issues,
      "visualization.recipe",
      "unsupported",
      "widget.error.ridgeline-needs-groups",
    );
  }
  if (recipe === "facets" && dimensions.length < 2) {
    issue(
      issues,
      "visualization.recipe",
      "unsupported",
      "widget.error.facets-need-a-split",
    );
  }
  const visualDefault = createWidgetVisualization(recipe, {
    dimensionId: dimensions[0]?.id,
    measureId: measures[0]?.id,
  });
  const encodingRaw = record(visualization.encoding);
  const activeEncodingChannels = {
    // A lollipop and a slope arrow are categorical: the category is the row and
    // the measure is the length, so both positional channels are theirs. A
    // waffle has no axes at all — it is a count of cells — so it takes none.
    x: [
      "line",
      "area",
      "bar",
      "dot",
      "heatmap",
      "lollipop",
      "slope-arrow",
      "dumbbell",
    ].includes(mark),
    y:
      [
        "line",
        "area",
        "bar",
        "dot",
        "histogram",
        "heatmap",
        "boxplot",
        "lollipop",
        "slope-arrow",
        "dumbbell",
      ].includes(mark) &&
      !(
        capability.resultShape === "distribution" &&
        (mark === "histogram" || mark === "boxplot")
      ),
    color: ["line", "area", "bar", "dot", "heatmap", "waffle"].includes(mark),
    series: ["line", "area", "bar", "dot"].includes(mark),
    // Small multiples need a second dimension to split by, and a recipe that says it can
    // draw panels. Nothing does yet, so a facet channel is dropped rather than kept as a
    // saved option nobody consumes.
    facet:
      widgetRecipeDescriptor(recipe).supportsFacets && dimensions.length > 1,
  } as const;
  const analysisForChannels = { measures, dimensions, comparison };
  const includeDelta =
    comparison.kind !== "none" || widgetMeasureHasIntrinsicDelta(measure);
  const normalizedEncodings = Object.fromEntries(
    (["x", "y", "color", "series", "facet"] as const).map((name) => [
      name,
      activeEncodingChannels[name]
        ? normalizeChannel(
            name,
            encodingRaw?.[name],
            visualDefault.encoding[name],
            widgetChannelFields(analysisForChannels, name, { includeDelta }),
            analysisForChannels,
            issues,
          )
        : null,
    ]),
  ) as unknown as WidgetEncodingSpec;
  // A series and a facet split what the x axis already carries, so they may not *be* it.
  for (const name of ["series", "facet"] as const) {
    const split = normalizedEncodings[name];
    if (split && split.field === normalizedEncodings.x?.field) {
      issue(
        issues,
        `visualization.encoding.${name}`,
        "unsupported",
        "widget.error.encoding-channel",
      );
      normalizedEncodings[name] = null;
    }
  }
  let normalizedOptions = markOptions(mark, visualization.options);
  const supportsValueAdornments =
    capability.resultShape === "scalar" && comparison.kind !== "none";
  if (normalizedOptions.kind === "value" && !supportsValueAdornments) {
    normalizedOptions = {
      ...normalizedOptions,
      showDelta: false,
      trendIndicator: false,
    };
  }
  // Stacking needs something to stack: a second dimension on the colour or series
  // channel. With one dimension there is one bar per slot and nothing to pile up.
  const hasStackableSeries = [
    normalizedEncodings.color,
    normalizedEncodings.series,
  ].some(
    (item) =>
      item !== null &&
      item !== undefined &&
      dimensions.some((dimension) => dimension.id === item.field),
  );
  if (
    normalizedOptions.kind === "bar" &&
    normalizedOptions.stacked &&
    !hasStackableSeries
  ) {
    issue(
      issues,
      "visualization.options.stacked",
      "unsupported",
      "widget.error.stacked-series",
    );
    normalizedOptions = { ...normalizedOptions, stacked: false };
  }
  const scaleRaw = record(visualization.scale);
  const scaleX = record(scaleRaw?.x);
  const scaleY = record(scaleRaw?.y);
  let scaleYMin = nullableNumber(scaleY?.min);
  let scaleYMax = nullableNumber(scaleY?.max);
  if (scaleYMin !== null && scaleYMax !== null && scaleYMin > scaleYMax) {
    issue(
      issues,
      "visualization.scale.y.min",
      "invalid-value",
      "widget.error.scale-order",
    );
    issue(
      issues,
      "visualization.scale.y.max",
      "invalid-value",
      "widget.error.scale-order",
    );
    [scaleYMin, scaleYMax] = [scaleYMax, scaleYMin];
  }
  const axesRaw = record(visualization.axes);
  const axisX = record(axesRaw?.x);
  const axisY = record(axesRaw?.y);
  const legendRaw = record(visualization.legend);
  const hasLegendEncoding = Boolean(
    normalizedEncodings.color || normalizedEncodings.series,
  );
  const requestedLegend = bool(legendRaw?.visible, false);
  if (requestedLegend && !hasLegendEncoding) {
    issue(
      issues,
      "visualization.legend.visible",
      "unsupported",
      "widget.error.legend-encoding",
    );
  }
  const formatRaw = record(visualization.format);
  const thresholdsRaw = Array.isArray(visualization.thresholds)
    ? visualization.thresholds
    : [];
  if (thresholdsRaw.length > WIDGET_LIMITS.thresholds) {
    issue(
      issues,
      "visualization.thresholds",
      "complexity-limit",
      "widget.error.thresholds-limit",
    );
  }
  const thresholds = thresholdsRaw
    .slice(0, WIDGET_LIMITS.thresholds)
    .flatMap((raw, index) => {
      const item = record(raw);
      if (
        !item ||
        typeof item.value !== "number" ||
        !Number.isFinite(item.value)
      ) {
        issue(
          issues,
          `visualization.thresholds.${index}.value`,
          "invalid-value",
          "widget.error.finite-number",
        );
        return [];
      }
      return [
        {
          value: item.value,
          color: thresholdColor(
            item.color,
            `visualization.thresholds.${index}.color`,
            issues,
          ),
          label: optionalText(item.label),
        },
      ];
    });

  const definition: WidgetDefinition = {
    apiVersion: WIDGET_DEFINITION_VERSION,
    query: {
      // The only available adapter today. Unsupported declared sources reached this
      // canonical form with an issue above, so it is safe for previews but never saved as
      // if the requested source had been honoured.
      source: fallback.query.source,
      scope,
      window,
      filters:
        measure.kind === "metric" && measure.metric === "goalProgress"
          ? []
          : normalizeFilters(query.filters, issues),
    },
    analysis: {
      measures,
      dimensions,
      comparison,
      transforms,
    },
    visualization: {
      recipe,
      encoding: normalizedEncodings,
      options: normalizedOptions,
      scale: {
        x: {
          reverse: bool(scaleX?.reverse, false),
        },
        y: {
          zero: bool(scaleY?.zero, visualDefault.scale.y.zero),
          min: scaleYMin,
          max: scaleYMax,
          reverse: bool(scaleY?.reverse, false),
        },
      },
      axes: {
        x: {
          visible: bool(axisX?.visible, visualDefault.axes.x.visible),
          grid: bool(axisX?.grid, visualDefault.axes.x.grid),
          label: optionalText(axisX?.label),
        },
        y: {
          visible: bool(axisY?.visible, visualDefault.axes.y.visible),
          grid: bool(axisY?.grid, visualDefault.axes.y.grid),
          label: optionalText(axisY?.label),
        },
      },
      legend: {
        visible: requestedLegend && hasLegendEncoding,
        position:
          legendRaw?.position === "top" || legendRaw?.position === "right"
            ? legendRaw.position
            : "bottom",
      },
      format: {
        decimals:
          formatRaw?.decimals === null
            ? null
            : integer(formatRaw?.decimals, 2, 0, 6),
        unit:
          formatRaw?.unit === "ratio" ||
          formatRaw?.unit === "percent" ||
          formatRaw?.unit === "count" ||
          formatRaw?.unit === "days"
            ? formatRaw.unit
            : "auto",
        compact: bool(formatRaw?.compact, false),
      },
      thresholds,
    },
    presentation: {
      // An analytical card owns its screen, so it keeps its shape rather than degrading
      // to fit a dashboard slot. Which surface a card is on decides that, not the card.
      mode: options.surface === "insights" ? "analytical" : "dashboard",
      responsiveBehavior:
        record(root.presentation)?.responsiveBehavior ===
        "preserve-visualization"
          ? "preserve-visualization"
          : "adapt",
    },
  };
  return { definition, issues };
}

export function validateWidgetDefinition(
  input: unknown,
  options: WidgetCompileOptions,
): WidgetValidationResult {
  const normalized = normalizeDefinition(input, options);
  const references = collectWidgetReferences(normalized.definition);
  const pools = options.references;
  const checks: Array<
    [string[], ReadonlySet<string> | undefined, string, string]
  > = [
    [
      references.subjectIds,
      pools?.subjectIds,
      "subject",
      "query.scope.subjectIds",
    ],
    [
      references.customAverageIds,
      pools?.customAverageIds,
      "custom-average",
      "query.scope.averageId",
    ],
    [references.goalIds, pools?.goalIds, "goal", "analysis.measure.goalId"],
    [references.periodIds, pools?.periodIds, "period", "query.window.periodId"],
  ];
  for (const [ids, allowed, kind, path] of checks) {
    if (!allowed) continue;
    for (const id of ids) {
      if (!allowed.has(id))
        issue(
          normalized.issues,
          path,
          "invalid-reference",
          `widget.error.reference.${kind}`,
        );
    }
  }
  return {
    valid: normalized.issues.length === 0,
    issues: normalized.issues,
    definition: normalized.issues.length === 0 ? normalized.definition : null,
  };
}

export function canonicalizeWidgetDefinition(
  input: unknown,
  options: Pick<WidgetCompileOptions, "surface">,
): WidgetDefinition {
  return normalizeDefinition(input, options).definition;
}

function collectScopeReferences(
  scope: WidgetScope | undefined,
  subjectIds: Set<string>,
  customAverageIds: Set<string>,
): void {
  if (!scope) return;
  if (scope.kind === "subjects") {
    for (const id of scope.subjectIds) subjectIds.add(id);
  } else if (scope.kind === "custom-average") {
    customAverageIds.add(scope.averageId);
  }
}

function collectFormulaReferences(
  formula: WidgetFormula,
  subjectIds: Set<string>,
  customAverageIds: Set<string>,
  periodIds: Set<string>,
): void {
  switch (formula.kind) {
    case "metric":
      collectScopeReferences(formula.scope, subjectIds, customAverageIds);
      if (formula.window?.kind === "period") {
        periodIds.add(formula.window.periodId);
      }
      return;
    case "unary":
      collectFormulaReferences(
        formula.operand,
        subjectIds,
        customAverageIds,
        periodIds,
      );
      return;
    case "binary":
    case "compare":
      collectFormulaReferences(
        formula.left,
        subjectIds,
        customAverageIds,
        periodIds,
      );
      collectFormulaReferences(
        formula.right,
        subjectIds,
        customAverageIds,
        periodIds,
      );
      return;
    case "conditional":
      collectFormulaReferences(
        formula.condition,
        subjectIds,
        customAverageIds,
        periodIds,
      );
      collectFormulaReferences(
        formula.whenTrue,
        subjectIds,
        customAverageIds,
        periodIds,
      );
      collectFormulaReferences(
        formula.whenFalse,
        subjectIds,
        customAverageIds,
        periodIds,
      );
      return;
    default:
      return;
  }
}

export function collectWidgetReferences(
  definition: WidgetDefinition,
): WidgetReferences {
  const scope = definition.query?.scope;
  const window = definition.query?.window;
  const subjectIds = new Set<string>();
  const customAverageIds = new Set<string>();
  const periodIds = new Set<string>();
  const goalIds = new Set<string>();
  const cohortIds = new Set<string>();
  const cohortMemberIds = new Set<string>();
  const friendIds = new Set<string>();
  collectScopeReferences(scope, subjectIds, customAverageIds);
  if (window?.kind === "period") periodIds.add(window.periodId);
  // Every measure, not just the first: an ownership check that read one of four would
  // let the other three smuggle references past validation, which is exactly the hole a
  // list of measures opens if this is not walked.
  //
  // Guarded, because this is one of two functions in this file reachable with *stored*
  // JSON that never went through the parser — `templateSlots` calls it on a row straight
  // out of the database. A row of the wrong shape then has no references, the card fails
  // to compile and reports itself unreadable, which is a card saying so rather than a
  // TypeError taking the page with it.
  const measures = Array.isArray(definition.analysis?.measures)
    ? definition.analysis.measures
    : [];
  for (const entry of measures) {
    const measure = entry.expression;
    if (measure.kind === "formula") {
      collectFormulaReferences(
        measure.formula,
        subjectIds,
        customAverageIds,
        periodIds,
      );
    } else {
      if (measure.goalId) goalIds.add(measure.goalId);
      /**
       * The people a card names, which are references like any other.
       *
       * Left out, a published template carried its author's group and classmate ids into
       * everybody's dashboard: nothing resolves them on the installer's side, so the card
       * arrives permanently empty with no picker offering to re-point it. They are kept
       * apart from the four entity kinds because they are not the reader's own rows —
       * see `templateSlots`, which is what actually asks for them.
       */
      if (measure.groupId) cohortIds.add(measure.groupId);
      if (
        measure.memberId &&
        COHORT_MEMBER_METRICS.includes(measure.metric)
      ) {
        cohortMemberIds.add(measure.memberId);
      }
      if (measure.memberId && FRIEND_METRICS.includes(measure.metric)) {
        friendIds.add(measure.memberId);
      }
    }
  }
  // And the comparison, which may name two windows of its own.
  const comparison = definition.analysis?.comparison;
  if (comparison?.kind === "window-pair") {
    for (const side of [comparison.left, comparison.right]) {
      if (side.kind === "period") periodIds.add(side.periodId);
    }
  }
  return {
    subjectIds: [...subjectIds],
    customAverageIds: [...customAverageIds],
    goalIds: [...goalIds],
    periodIds: [...periodIds],
    cohortIds: [...cohortIds],
    cohortMemberIds: [...cohortMemberIds],
    friendIds: [...friendIds],
  };
}

/**
 * The shape a definition's result will take.
 *
 * Grouping decides it, and a second dimension does not change it: a time axis makes a
 * temporal series whether it is split by subject or not, because what a second dimension
 * splits is the *series within* the result rather than the result's kind. The measure's
 * own shape — a goal plan, a streak, a hierarchy — wins only when nothing is grouped.
 */
export function compileWidgetDefinition(
  input: unknown,
  options: WidgetCompileOptions,
): WidgetCompileResult {
  const validation = validateWidgetDefinition(input, options);
  if (!validation.valid || !validation.definition) {
    return { valid: false, issues: validation.issues, plan: null };
  }
  const definition = validation.definition;
  const measure = widgetPrimaryMeasure(definition.analysis);
  const capability = widgetCapability(widgetMeasureId(measure));
  return {
    valid: true,
    issues: [],
    plan: {
      version: WIDGET_DEFINITION_VERSION,
      definition,
      capability,
      resultShape: widgetResultShapeForRecipe(
        measure,
        definition.analysis.dimensions,
        definition.visualization.recipe,
      ),
      valueType: widgetMeasureValueType(measure),
      references: collectWidgetReferences(definition),
    },
  };
}
