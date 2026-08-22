import type { CardContext, CardMetric, CardResult, CardSpec } from "./cards";
import type { WidgetDispersion } from "./analytics";
import type { CohortContext } from "./cohort";
import type { FriendContext } from "./friend";
import type { WidgetChartRecipe } from "./widget-recipes";
import type { Goal } from "./goals";
import type {
  CustomAverage,
  GradeType,
  Period,
  Subject,
  Year,
} from "./types";

/**
 * The document version, stored in `dashboard_cards.definitionJson`.
 *
 * Two, and there is no reader for one. The first version could ask a single measure,
 * grouped a single way, drawn as one of eleven marks; nine of the audited charts are
 * unsayable in it, and the fix is structural rather than additive — a list of measures,
 * a list of dimensions, channels that name them, and a semantic recipe in place of a
 * mark. Nothing converts: a stored document of the old shape is not upgraded, it is
 * read as the malformed document it now is and falls back to the defaults.
 */
export const WIDGET_DEFINITION_VERSION = 2 as const;

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
  /**
   * Measures in one analysis.
   *
   * Four, because a chart with five readings on it is a table. Each measure is a full
   * evaluation per row, so this bounds the work as well as the reading.
   */
  measures: 4,
  /**
   * Dimensions in one analysis.
   *
   * Two. Three is a cube, and a cube has no honest two-dimensional drawing — only a
   * choice of drawing, which is a different feature and needs its own controls.
   */
  dimensions: 2,
  /**
   * Rows across the whole cross-product, before any drawing budget.
   *
   * Separate from `seriesBuckets`, which bounds one series: a year of days crossed with
   * a dozen subjects is four thousand cells, and each is an evaluation.
   */
  rows: 4_000,
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

/**
 * Where the numbers come from.
 *
 * `grades` is the only one built. The others are named because the audited cards read
 * them and because a source that has to be *added* to this union later is a source whose
 * absence is invisible today — `subject-weights` is what a weight tree reads, `cohort` is
 * what a rank would read and what this app has no data for. The compiler refuses the
 * ones that are not built, with a reason.
 */
export const WIDGET_SOURCES = [
  "grades",
  "subjects",
  "subject-weights",
  "goals",
  "cohort",
] as const;
export type WidgetSource = (typeof WIDGET_SOURCES)[number];

export const WIDGET_AVAILABLE_SOURCES: readonly WidgetSource[] = ["grades"];

export interface WidgetQuery {
  source: WidgetSource;
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

export type { WidgetDispersion };
export { WIDGET_DISPERSIONS } from "./analytics";

/** The metrics whose value *is* a dispersion, and so read the estimator. */
export const WIDGET_DISPERSION_METRICS: readonly CardMetric[] = ["spread"];

export type WidgetMeasure =
  | {
      kind: "metric";
      metric: CardMetric;
      goalId: string | null;
      /**
       * What a cohort metric is *about*: the group, and inside it the member.
       *
       * Two ids rather than one because a card can name both — "Amélie, in Terminale 2" —
       * and because the second is meaningless without the first: a member is only readable
       * through a group that opened itself, so a lone member id would be a reference with
       * no consent attached to it.
       *
       * Ids only. The figures arrive with the render and are never written into the
       * document, so a withdrawn consent empties the card instead of leaving a number
       * behind in storage.
       */
      groupId?: string | null;
      memberId?: string | null;
      /**
       * Present only on the metrics that measure a spread — see
       * `WIDGET_DISPERSION_METRICS`. Absent means the standard deviation, which
       * is what every stored card measured before the choice existed.
       */
      dispersion?: WidgetDispersion;
    }
  | {
      kind: "formula";
      formula: WidgetFormula;
      valueType: "ratio" | "number" | "count" | "percent";
    };

/**
 * One axis of the cross-product a result is grouped by.
 *
 * This replaced a single `groupBy` that was one of `none | time | subject`, and that
 * single field is why nine of the audited charts could not exist: a document that
 * cannot say "by month **and** by subject" cannot describe a stacked composition, a
 * facet grid, a grouped distribution or a difference. A list of dimensions can.
 *
 * Each carries an `id`, because a row is keyed by it and an encoding channel points at
 * it by name. Two dimensions is the ceiling — three is a cube, and a cube has no honest
 * two-dimensional drawing, only a choice of drawing, which is a different feature.
 */
export type WidgetDimension =
  | {
      id: string;
      kind: "time";
      /**
       * `event` is one bucket per mark, in order: the grain a strip of individual marks
       * needs, and the one a "running average after each result" curve is made of. Two
       * marks on the same day stay two buckets, which is exactly what `day` cannot do.
       */
      grain: "event" | "day" | "week" | "month" | "period";
      /**
       * Whether the buckets are the ones that happened, or every one in the window.
       *
       * `observed` keys buckets off the marks themselves, so a week with no assessment
       * is not a bucket at all. That is right for a line: a gap is a gap, and drawing a
       * zero there would invent a bad week.
       *
       * `calendar` materialises every bucket between the window's ends, whether
       * anything happened in it or not, which is what a calendar heatmap needs — a year
       * of squares has to have a square for every day. The value of an empty bucket is
       * not invented either: it is whatever the measure says about an empty set, so a
       * count is 0 and an average is `null`. A running accumulation carries its set
       * forward, so an empty day inherits the value before it. `count: 0` on the row is
       * what lets a tooltip tell "no assessment" from "a mark of zero".
       */
      fill: "observed" | "calendar";
      /**
       * Kept, against the audit's sketch, which drops it and expects the `cumulative`
       * transform to cover it. It does not: `running` re-averages over every mark to
       * date — a running *average* — while `cumulative` sums the values of the buckets.
       * On marks out of twenty those are entirely different numbers and the second one
       * is meaningless.
       */
      accumulation: "bucket" | "running";
    }
  | {
      id: string;
      kind: "subject";
      /**
       * Which nodes are candidates. `leaf` is the subjects that weigh in directly — the
       * contributors, with categories dissolved; `root` is the top level as the tree
       * shows it; `all` is every node in the tree.
       *
       * `includeCategories` then decides whether category nodes may appear at all, which
       * only has anything to decide under `root` and `all`.
       */
      level: "leaf" | "root" | "all";
      includeCategories: boolean;
      limit: number;
    }
  | {
      id: string;
      /**
       * The kinds of assessment this year holds — a DS against a colle, an oral against
       * a written paper.
       *
       * Refused for as long as a mark had no type of its own, because deriving one from
       * the *name* would have made a heuristic the canonical truth and a guess that
       * cannot be corrected is worse than a missing dimension. A year now defines its own
       * kinds and a result records which one it was, so the dimension reads a stored fact.
       *
       * Results with no type are a bucket of their own rather than a silence: a card that
       * dropped them would report a share of the year as if it were all of it.
       */
      kind: "assessment-type";
      /** Whether results that carry no type get a bucket. */
      includeUntyped: boolean;
    }
  | {
      id: string;
      kind: "grade-band";
      /** Ascending cut points as ratios; a band is the space between two of them. */
      thresholds: number[];
    }
  | { id: string; kind: "period" }
  | {
      id: string;
      kind: "status";
      values: Array<"passed" | "failed" | "missing">;
    }
  | {
      id: string;
      /**
       * Refused by the compiler: this app exposes no cohort to compare against, and a
       * rank against an imagined class is not a rank.
       */
      kind: "cohort";
    };

export type WidgetDimensionKind = WidgetDimension["kind"];

/**
 * Whether an axis is drawn as an instant or as a name.
 *
 * A day, a week and a month are points on a calendar and belong on a continuous scale, and
 * so is an `event` — a mark was sat on a day, and two marks a fortnight apart should sit a
 * fortnight apart. A *period* is not: five terms are five named slots, evenly spaced, and
 * placing them at their start dates puts them wherever the calendar happened to put them.
 * Measured on the bench, the last bar of a period axis ran 71px past the plot, because a
 * bar has a width and a linear scale had no room left for it.
 *
 * One function, because two answers to this question is a chart building a time scale over
 * rows that carry no dates — which is a NaN domain and a blank card.
 */
export function widgetAxisType(
  dimension: WidgetDimension,
): "time" | "category" | "number" {
  if (dimension.kind === "period") return "category";
  if (dimension.kind === "time") {
    return dimension.grain === "period" ? "category" : "time";
  }
  return "category";
}

/** A grouping a measure may support: no dimension at all, or one of the kinds. */
export type WidgetGrouping = "none" | WidgetDimensionKind;

export const WIDGET_DIMENSION_KINDS: readonly WidgetDimensionKind[] = [
  "time",
  "subject",
  "assessment-type",
  "grade-band",
  "period",
  "status",
  "cohort",
];

/**
 * The dimensions whose data exists.
 *
 * The others are declared because the model has to be able to *say* them — a dimension
 * missing from the union is a gap nobody can see — and refused by the compiler with a
 * reason, rather than accepted and silently ignored.
 */
export const WIDGET_AVAILABLE_DIMENSIONS: readonly WidgetDimensionKind[] = [
  "time",
  "subject",
  "grade-band",
  "period",
  "status",
  // A year defines its own kinds of assessment and a result records which one it was, so
  // this reads a stored fact rather than a guess about a name.
  "assessment-type",
];

export type WidgetComparison =
  | { kind: "none" }
  | { kind: "previous-window" }
  | { kind: "baseline"; value: number }
  /**
   * Two arbitrary windows, side by side.
   *
   * `previous-window` compares against *the* window before this one, which is the right
   * answer for "how am I doing lately" and cannot express "term one against term three".
   * A pair is two measurements, neither of them privileged, and `alignment` says how they
   * are lined up: by their own length (day seven against day seven), by the calendar (the
   * same dates), or by the periods they are.
   */
  | {
      kind: "window-pair";
      left: WidgetWindow;
      right: WidgetWindow;
      alignment: "relative" | "calendar" | "period";
    };

export type WidgetTransform =
  | { kind: "sort"; direction: "ascending" | "descending" }
  | { kind: "limit"; count: number }
  | { kind: "moving-average"; points: number }
  | { kind: "cumulative" };

/**
 * One reading, named.
 *
 * The list is what makes "current **and** target", "start **and** end", "observed
 * **and** predicted" expressible — the pairs half the audited charts are made of. The
 * id is how an encoding channel points at it, and the label is how a legend names it
 * when the measure's own name is not the words the card wants.
 */
export interface WidgetMeasureEntry {
  id: string;
  /** `null` falls back to the measure's own localised name. */
  label: string | null;
  expression: WidgetMeasure;
}

export interface WidgetAnalysis {
  measures: WidgetMeasureEntry[];
  dimensions: WidgetDimension[];
  comparison: WidgetComparison;
  transforms: WidgetTransform[];
}

/**
 * The first measure, for the readers that can only handle one.
 *
 * The documented seam for narrowing a multi-measure analysis: a legacy card row, a
 * capability lookup, a renderer built on one series. Calling this says *I am taking the
 * first and ignoring the rest*, which is a claim a reviewer can check — an inline
 * `measures[0]` says nothing and is how the second measure comes to be silently dropped
 * in eleven places.
 *
 * Never undefined: the compiler guarantees at least one measure, and a hand-built
 * analysis with none gets the default average rather than a crash.
 */
export function widgetPrimaryMeasure(
  analysis: Pick<WidgetAnalysis, "measures">,
): WidgetMeasure {
  return (
    analysis.measures[0]?.expression ?? {
      kind: "metric",
      metric: "average",
      goalId: null,
    }
  );
}

/** The first dimension, or `null` when the reading is ungrouped. */
export function widgetPrimaryDimension(
  analysis: Pick<WidgetAnalysis, "dimensions">,
): WidgetDimension | null {
  return analysis.dimensions[0] ?? null;
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
  | "list"
  /**
   * A ranking drawn as a stem and a head rather than a filled bar.
   *
   * Same data as `bar` over a categorical grouping, and it survives a narrow
   * card where a bar does not: the head keeps a point's precision while the stem
   * gives it a baseline to be read against.
   */
  | "lollipop"
  /**
   * A composition, as counted cells.
   *
   * Twenty of them is the natural grid for a mark out of twenty. Reads at a
   * width where a histogram cannot, which is most of a phone.
   */
  | "waffle"
  /**
   * Where each category started and where it is now, as an arrow.
   *
   * Needs a before and an after, and the result already carries both: a datum's
   * `delta` is the movement and `value - delta` is where it began. So this is
   * available only where a comparison — or an intrinsically comparative measure
   * such as `mostImproved` — actually produced a delta.
   */
  | "slope-arrow"
  /**
   * Every mark as its own tick along the scale.
   *
   * The answer to "where do my results actually sit out of twenty", and the honest
   * drawing on a small number of marks: a histogram of five buckets over fourteen
   * results invents a shape, while a strip shows the fourteen. Reads in a hundred
   * and fifty pixels, which is why it is also the compact fallback for a histogram.
   *
   * Draws the distribution's own `values` — the marks were always computed and the
   * result summarised them away. Coincident marks are stacked rather than jittered:
   * a deterministic drawing beats a prettier one that moves between renders.
   */
  | "strip"
  /**
   * Two ends and the distance between them.
   *
   * The same pair a slope arrow draws — `value`, and `value - delta` for where it
   * began — read as a comparison rather than as a movement, which is a different
   * claim and not a cosmetic choice. An arrow says *this went up*, and is honest
   * only where the pair really is a before and an after; a dumbbell says *these two
   * differ by this much*, which is what a period against a period, a subject
   * against the general average, or a result against a target actually is. So
   * neither end is privileged and neither is coloured by direction.
   */
  | "dumbbell"
  /**
   * A hierarchy as nested area.
   *
   * The one drawing that answers "which *branch* carries my average" — a flat
   * ranking of leaves cannot, because the branch is not in it. Reads a `hierarchy`
   * result, whose leaves sum to the whole and whose branches are exactly the sum of
   * their children, so area is a share and not a coincidence.
   */
  | "treemap"
  /**
   * A change, as the steps that made it.
   *
   * Each bar spans from where the running total stood to where this step left it, so
   * the drawing is the arithmetic: the bars *are* the decomposition, and a reader can
   * see both the size of each cause and the order they accumulate in.
   */
  | "waterfall"
  /**
   * A band between a low and a high, with a line through the middle.
   *
   * What the band *means* is not the mark's business: the result says whether it is a
   * range, a set of scenarios, a confidence interval or a prediction interval, and the
   * renderer labels it accordingly. Drawing all four the same way is fine; calling
   * them the same thing is not.
   */
  | "band"
  /**
   * A grid of small charts, one per value of a dimension.
   *
   * A container rather than a shape: what each panel draws is its own inner recipe, and
   * what the facet adds is the *split*. Eight series on one chart is a texture; the same
   * eight as eight small charts is readable, and the audit calls it the format that buys
   * the most versatility after composable dimensions.
   */
  | "facets"
  /**
   * A distribution as a shape, one per group.
   *
   * Where a box plot gives five numbers, a violin gives the whole outline: the centre, the
   * spread, the skew, and whether the marks cluster in two places rather than one — which
   * five numbers cannot say at all. Drawn from `kernelDensity`, which refuses a sample too
   * small to have a shape, so a violin over four marks is a box plot instead.
   */
  | "violin"
  /**
   * Several distributions stacked, each on the same axis.
   *
   * The comparison a grid of violins makes awkward: overlapping outlines down one axis, so
   * the eye reads *shift* — a term that moved up, a subject that spread out — rather than
   * comparing shapes side by side. Needs the height a wide card has, which its policy says.
   */
  | "ridgeline"
  /**
   * A hierarchy as concentric rings.
   *
   * The treemap's question — where does the average come from — read by *depth* rather than
   * by area. A ring is a level, so "the categories, then the subjects inside them" is two
   * rings rather than nesting a reader has to infer from borders. Which of the two is
   * better depends on the tree: area compares siblings, rings show the levels.
   *
   * Same arithmetic either way: both consume the hierarchy where a branch is exactly the
   * sum of its children, so equal angle means equal weight.
   */
  | "sunburst"
  /**
   * The results, and the straight line through them.
   *
   * A trend arrow says "up". This says up *how fast*, over what, and how closely the
   * results actually follow it — the last of which is the part that decides whether the
   * first two mean anything. See `linearFit`: the fit withholds its own quality below three
   * results rather than reporting a perfect line through two.
   */
  | "regression"
  /**
   * Several readings on one ring, each on its own spoke.
   *
   * The shape answers "where am I strong" in one look, which is the question a bar chart of
   * the same numbers answers only after the reader has walked its axis. It is also the
   * easiest chart in this file to make lie: the spokes must share one scale, they must stay
   * in the same order between renders, and there must be at least three of them and not
   * many more — the area of the polygon is read as a quantity, and it is not one.
   *
   * The number of spokes is enforced where it can be: three at compile time, eight at draw
   * time with the remainder named rather than dropped in silence.
   */
  | "radar"
  /**
   * The marks in order, with the band ordinary variation falls inside.
   *
   * A mark on its own says nothing about whether it belongs to the same pattern as the
   * others, and that is the only question this chart answers. Its own mark rather than the
   * projection band's, because what is drawn is different: a level, two limits, and every
   * result as a point — with the ones outside said outright.
   */
  | "control"
  /**
   * Two measures against each other, one point per group.
   *
   * Where every other chart in this file plots a reading against *what it is of* — a date,
   * a subject — this plots one reading against another and lets the group be the point.
   * "Which subjects are both improving and steady" has no answer on a single axis, and the
   * quadrant lines that make it readable are the medians of the data rather than numbers
   * somebody picked.
   *
   * Needs exactly two measures, and the compiler says so.
   */
  | "scatter"
  /**
   * Two readings and the ground between them.
   *
   * The chart a single-measure document could not describe at all: current against target,
   * this term against that one, where the trend says you land against where you are. The
   * *area* is the reading — how far apart they are, and which is on top — which is why it is
   * shaded by sign rather than drawn as two lines and left to the reader to subtract.
   *
   * Needs exactly two measures, and the compiler says so: one line and an empty fill is a
   * line chart with extra machinery.
   */
  | "difference-area";

/**
 * How a measure may be read.
 *
 * Not fields on a row any more — a row's measures are named by the analysis — but the
 * three readings of one measure, spelled as a suffix on its id in a channel: the value,
 * its movement against the comparison, and how many marks it rests on.
 */
export type WidgetMeasureReading = "value" | "delta" | "count";

/**
 * The slots a plotted datum has.
 *
 * The renderer's vocabulary rather than the document's: a channel names an id, and
 * `widgetDatumSlot` says which of these it lands in. Kept as five names because that is
 * what a row of a series *is* — a place on the axis, a label, a number, its movement and
 * its sample — not because the document still thinks in them.
 */
/**
 * A grouped result, as a table.
 *
 * Rows keyed by the cross-product of the dimensions, columns for every reading of every
 * measure. The audit's `WidgetDataFrameResult`, with one addition it does not have and
 * this app needs: `labels`.
 *
 * A dimension's *value* and its *display* are not the same thing and the second is not
 * always derivable from the first. A day bucket's value is a timestamp and its label is
 * the date; an `event` bucket's label is the name of the mark that made it, and a
 * `period` bucket's is the period's name. Neither can be formatted out of a number, so
 * the row carries them.
 */
export interface WidgetDataFrame {
  schema: {
    dimensions: Array<{
      id: string;
      type: "time" | "category" | "number";
    }>;
    /**
     * Every column a channel may name: a measure, and its delta and count. Spelled as
     * `<id>`, `<id>.delta`, `<id>.count` — the same names `widgetChannelFields` offers,
     * so a channel that compiles resolves to a column that exists.
     */
    measures: Array<{
      id: string;
      type: "number";
      /**
       * How the column reads: a mark out of the year's scale, a percentage, a count.
       *
       * Per measure, and not per frame, because a chart may plot two of them against each
       * other: steadiness against improvement is a percentage against a number of points,
       * and one `valueType` for the whole table formatted one of the two axes as the other.
       * Measured on the bench — a regularity of 88% was drawn as "17.7".
       */
      valueType: WidgetValueType;
    }>;
  };
  rows: WidgetDataFrameRow[];
}

export interface WidgetDataFrameRow {
  key: string;
  dimensions: Record<string, string | number | null>;
  /** Display text per dimension, where the value alone cannot produce it. */
  labels: Record<string, string>;
  measures: Record<string, number | null>;
}

/**
 * One group's distribution.
 *
 * The same numbers the ungrouped result carries — buckets for a histogram, five for a box,
 * the marks themselves for a strip or a violin — plus who it belongs to.
 */
export interface WidgetDistributionGroup {
  key: string;
  label: string;
  buckets: Array<{ from: number; to: number; count: number }>;
  total: number;
  values: number[];
  summary: {
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    outliers: number[];
  };
}

export type WidgetDatumSlotName =
  "date" | "category" | "value" | "delta" | "count";

export const WIDGET_MEASURE_READINGS: readonly WidgetMeasureReading[] = [
  "value",
  "delta",
  "count",
];

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
  | { kind: "list"; rows: number; showValues: boolean }
  | {
      kind: "lollipop";
      orientation: "vertical" | "horizontal";
      /** Diameter of the head, in pixels. */
      size: number;
    }
  | {
      kind: "waffle";
      /**
       * Cells in the grid.
       *
       * A cell stands for a share, not for an observation, so the exact count
       * always accompanies it — see the renderer. Twenty suits a mark out of
       * twenty; a hundred needs a wide card to stay square.
       */
      cells: number;
    }
  | { kind: "slope-arrow"; showLabels: boolean }
  | {
      kind: "violin";
      /**
       * Draw the box inside the shape.
       *
       * On by default: an outline says where the mass is and a box says where the middle
       * half is, and a reader asking "is this good" wants the second. Turning it off leaves
       * a shape that is honest about the distribution and mute about the reading.
       */
      showBox: boolean;
      /** Half a violin — the shape on one side of its axis — for a ridgeline's rows. */
      half: boolean;
    }
  | {
      kind: "sunburst";
      /** Levels of the tree to draw, as a treemap's `depth` means it. */
      depth: number;
      /** Pixels between the rings, so a level reads as a level. */
      ringPadding: number;
    }
  | {
      kind: "regression";
      /** Draw the band around the line — how well the line itself is pinned down. */
      showBand: boolean;
      /** Draw the results the line was fitted through. */
      showPoints: boolean;
      /**
       * Say the slope and the fit quality under the chart.
       *
       * On by default, and the reason is the whole point of the recipe: a line with no R²
       * beside it is read as a fact, and a line through scattered results is not one.
       */
      showReading: boolean;
    }
  | {
      kind: "radar";
      /** Fill the polygon, rather than drawing its outline alone. */
      fill: boolean;
      /** A dot at each spoke, so a reader can see where the readings actually are. */
      showPoints: boolean;
    }
  | {
      kind: "control";
      /** Draw the marks as points, rather than the band alone. */
      showPoints: boolean;
      /** How many standard deviations wide the band is drawn. */
      deviations: number;
    }
  | {
      kind: "scatter";
      /** Draw the median lines that make the four quadrants. */
      quadrants: boolean;
      /** Name each point, where the card is wide enough for the names to fit. */
      showLabels: boolean;
      /** Diameter of a point, in pixels. */
      size: number;
    }
  | {
      kind: "difference-area";
      /** Draw the two readings as lines over the fill, rather than the fill alone. */
      showLines: boolean;
      /** Opacity of the shaded ground, so the lines stay readable through it. */
      opacity: number;
    }
  | {
      kind: "ridgeline";
      /** How much each row may overlap the one above, as a share of its own height. */
      overlap: number;
    }
  | {
      kind: "facets";
      /**
       * What one panel draws. A recipe rather than a mark, because a panel is a card in
       * miniature and the same product decision applies to it.
       */
      inner: WidgetChartRecipe;
      /** Panels across. The grid wraps, and a narrow card overrides this downwards. */
      columns: number;
      /**
       * One scale for every panel.
       *
       * On by default, and it is the difference between a facet grid and eight unrelated
       * charts: panels drawn on their own scales look alike whatever they say, and the
       * comparison the grid exists for becomes impossible.
       */
      sharedScale: boolean;
    }
  | {
      kind: "band";
      /** Opacity of the filled band, so the middle line stays the reading. */
      opacity: number;
      /** Draw the middle as its own line rather than leaving the fill to say it. */
      showCenter: boolean;
    }
  | {
      kind: "waterfall";
      /**
       * Steps to draw before the rest is folded into one.
       *
       * A waterfall of fourteen subjects is a comb. Folding the tail keeps the total
       * exact — the folded step carries their sum — while naming only the causes big
       * enough to act on.
       */
      steps: number;
      /** Draw the start and end totals as their own bars. */
      showTotals: boolean;
    }
  | {
      kind: "treemap";
      /**
       * Levels of the tree to draw.
       *
       * Two is a category and its subjects, which is every hierarchy this app has
       * in practice. Deeper trees keep their arithmetic and stop drawing the parts
       * a reader could not label anyway.
       */
      depth: number;
      showLabels: boolean;
    }
  | {
      kind: "dumbbell";
      /** Diameter of each end, in pixels. */
      size: number;
      /** Label the two ends with their own values, where the card is wide enough. */
      showLabels: boolean;
    }
  | {
      kind: "strip";
      /**
       * Height of one tick, in pixels. The row is as tall as the deepest stack of
       * coincident marks, so this is the only size the strip needs.
       */
      tick: number;
      /** Draw the median as a rule through the ticks. */
      showMedian: boolean;
    };

/**
 * A visual channel, pointed at a dimension or a measure by id.
 *
 * The generalisation that unlocks the rest. The channels used to name one of five fixed
 * fields — `date`, `category`, `value`, `delta`, `count` — so "colour by subject while
 * the x axis is the month" was unsayable, and the renderer had to guess which of the
 * five a card meant. Here a channel names something the analysis actually produced and
 * the compiler checks it exists.
 *
 * A measure may be read three ways, spelled as a suffix on its id: `sales` is the value,
 * `sales.delta` its movement against the comparison, `sales.count` how many marks it
 * rests on.
 */
export interface WidgetChannel {
  /** A dimension id, a measure id, or `<measure id>.delta` / `.count`. */
  field: string;
  type: "temporal" | "nominal" | "quantitative";
}

export interface WidgetEncodingSpec {
  x: WidgetChannel | null;
  y: WidgetChannel | null;
  color: WidgetChannel | null;
  series: WidgetChannel | null;
  /** Small multiples: one panel per value of this dimension. */
  facet: WidgetChannel | null;
}

export interface WidgetVisualization {
  /**
   * What the card *is*, semantically — never a drawing library's mark name.
   *
   * A recipe is a product decision ("a bullet", "a calendar", "a slopegraph"); a mark is
   * how one renderer happens to draw it. Persisting the mark meant the document
   * described an implementation: the same `line` covered a dashboard sparkline and a
   * full study, mobile had to reverse-engineer the intent, and a recipe built from two
   * marks had nowhere to live. See `widgetMarkForRecipe` for the renderer's side.
   */
  recipe: WidgetChartRecipe;
  encoding: WidgetEncodingSpec;
  options: WidgetMarkOptions;
  /** X is positional (direction only); Y owns the numeric domain. */
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

/**
 * How a card behaves as an object on a screen, as opposed to as a question.
 *
 * `responsiveBehavior` is the one the audit asks for by name: `adapt` follows the
 * recipe's `compactFallback` — a treemap becomes a ranking, keeping the reading and
 * losing the shape — while `preserve-visualization` refuses to substitute and asks the
 * grid for the width instead. Only whoever made the card knows whether the shape *is*
 * the point.
 */
export interface WidgetPresentation {
  mode: "dashboard" | "analytical";
  responsiveBehavior: "adapt" | "preserve-visualization";
}

/** Only semantic data lives in JSON. Layout, title and ownership remain columns. */
export interface WidgetDefinition {
  apiVersion: typeof WIDGET_DEFINITION_VERSION;
  query: WidgetQuery;
  analysis: WidgetAnalysis;
  visualization: WidgetVisualization;
  presentation: WidgetPresentation;
}

export type WidgetResultShape =
  | "scalar"
  | "temporal-series"
  | "categorical-series"
  | "distribution"
  | "record"
  | "records"
  | "streak"
  | "goal"
  /**
   * A tree with a value on every node — subject weights, where a category's
   * share is the sum of its children's.
   *
   * Declared before anything produces one, deliberately: `widget-recipes`
   * describes the treemap and the sunburst that consume it, and a recipe whose
   * accepted result shape did not exist could not be described at all. Nothing
   * can be *saved* against them — their descriptors report no renderer — so the
   * shape is a contract waiting for its producer rather than a half-built path.
   */
  | "hierarchy"
  /**
   * A change and the steps that made it, which sum to it.
   *
   * Its own shape rather than a categorical series, because the steps are chained —
   * each starts where the last ended — and a flat list of values would lose the one
   * property that makes a waterfall readable.
   */
  | "waterfall"
  /**
   * A low, a middle and a high at every step — see `IntervalKind`, which is the field
   * that stops a scenario band being read as a confidence interval.
   */
  | "interval-series";

export type WidgetValueType = "ratio" | "number" | "count" | "percent" | "days";

export interface WidgetCapability {
  id: CardMetric | "formula";
  messageKey: string;
  descriptionKey: string;
  resultShape: WidgetResultShape;
  valueType: WidgetValueType;
  scopes: WidgetScope["kind"][];
  /**
   * How this measure may be grouped: `"none"` for ungrouped, or a dimension kind.
   *
   * A list rather than a flag, because the answer is per dimension — an average reads by
   * time and by subject, a distribution only ungrouped until grouped distributions land,
   * a goal plan never.
   */
  groupings: WidgetGrouping[];
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
  | "thresholds"
  /** The list of groupings a card is split by. Rendered like the other collections. */
  | "dimensions";

export type WidgetOptionProvider =
  | "subjects"
  | "custom-averages"
  | "goals"
  | "periods"
  /**
   * The comparisons a group offers, and the members inside one.
   *
   * Both are supplied by the host rather than derived from the definition, because both
   * are *other people's* — which groups opened themselves to cards, and who inside them
   * agreed to be read. A provider is the right shape for that: the flow asks for a list
   * and never learns where it came from.
   */
  | "cohorts"
  | "cohort-members"
  /**
   * The friends who opened something to this reader.
   *
   * Separate from `cohort-members` because the consent is: a classmate is readable
   * through a group that opened itself, a friend through the friendship. Same shape of
   * answer, two different questions about who agreed to what.
   */
  | "friends"
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
    "filters" | "transforms" | "encoding" | "thresholds" | "dimensions"
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
  /**
   * Variants offered for the next item, when that depends on items already present.
   * Existing items still use `variants`, so filtering an add menu never makes their
   * current discriminator impossible to render or edit.
   */
  addVariants?: WidgetCollectionVariant[];
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
  prunedDefinition: WidgetDefinition;
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
  definition: WidgetDefinition | null;
}

export interface WidgetReferences {
  subjectIds: string[];
  customAverageIds: string[];
  goalIds: string[];
  periodIds: string[];
  /**
   * The group and people a card names, which are references to *other people's* consent
   * rather than to rows the reader owns. Cohort members and friends are kept separate:
   * the former are readable through a group, the latter through a friendship.
   */
  cohortIds: string[];
  cohortMemberIds: string[];
  friendIds: string[];
}

export interface WidgetExecutionPlan {
  version: typeof WIDGET_DEFINITION_VERSION;
  definition: WidgetDefinition;
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

/**
 * Why a card has nothing to show, where the reason is itself the reading.
 *
 * "No marks yet" and "three marks, and a middle half needs four" are different
 * sentences, and a card that says the first when the second is true reads as
 * broken. Optional and open: a result with no reason is empty for the ordinary
 * reason, and the card says so as it always did.
 */
export type WidgetEmptyReason =
  | {
      kind: "insufficient-sample";
      count: number;
      minimum: number;
    }
  /**
   * The card looked and found nothing worth saying.
   *
   * A different sentence from "no data", and a *positive* reading: an anomaly card with
   * nothing to report means every recent mark looks like the rest, which is what a reader
   * wants to know. Saying "not enough data yet" there is a card claiming to be broken
   * while working perfectly.
   */
  | { kind: "nothing-unusual" }
  /**
   * The reader is not in the comparison they asked to be placed in.
   *
   * A ranking of a list you are not in has no answer, and the reason is the reader's own
   * sharing switch — so the card can say what to do about it, which "no data" cannot.
   */
  | { kind: "not-sharing" }
  /** The requested cross-product exceeds the evaluator's pre-transform row budget. */
  | { kind: "complexity-limit"; actual: number; limit: number };

export type WidgetEvaluationResult =
  | { kind: "empty"; shape: WidgetResultShape; reason?: WidgetEmptyReason }
  | {
      kind: "scalar";
      shape: "scalar";
      value: number;
      valueType: WidgetValueType;
      delta: number | null;
      /**
       * How many observations the reading rests on, where that matters — and what they
       * are.
       *
       * The unit is not decoration: a cohort's average rests on *members*, and a footer
       * that said "over 6 marks" under a class average would be describing something
       * else entirely. Absent means marks, which is every reading that existed before a
       * card could be about other people.
       */
      sample?: { count: number; unit?: "marks" | "members" };
      /** Which estimator produced it, for the readings that are a spread. */
      dispersion?: WidgetDispersion;
    }
  | {
      /**
       * Every grouped reading, as one table.
       *
       * The single carrier for anything with a dimension on it. A `series` result used to
       * come out of here — five fixed slots per row — and it could not hold a second
       * dimension except by folding it into a `series` string, nor a second measure at
       * all. A frame holds both by construction, which is what makes stacking, facets,
       * grouped distributions and paired measures expressible rather than special cases.
       *
       * Renderers built on rows still get rows: `widgetFrameSeries` projects a frame into
       * the plotted datums they already draw, and that projection is the one place the
       * five-slot vocabulary survives.
       */
      kind: "data-frame";
      shape: "temporal-series" | "categorical-series";
      frame: WidgetDataFrame;
      valueType: WidgetValueType;
    }
  | {
      kind: "distribution";
      shape: "distribution";
      buckets: Array<{ from: number; to: number; count: number }>;
      total: number;
      /**
       * The marks themselves, in order, as ratios.
       *
       * A histogram is buckets and a box plot is five numbers, but a strip plot is
       * the marks — and on fourteen results a strip is the honest drawing where a
       * histogram of five buckets invents a shape. The values were always there;
       * the result summarised them away.
       *
       * Bounded by the drawing budget, keeping the most recent: a strip is a
       * drawing, and past a few hundred ticks it is a filled bar whatever the
       * count. The bucket counts and the summary still cover every mark, so
       * nothing that is *reported* is truncated.
       */
      values: number[];
      summary: {
        min: number;
        q1: number;
        median: number;
        q3: number;
        max: number;
        outliers: number[];
      };
    }
  /**
   * One distribution per group.
   *
   * The shape the audit asks for and the registry used to forbid: `distribution` was pinned
   * to no grouping at all, which is what made a box plot per subject, a violin per subject
   * and a ridgeline unsayable. Its own result rather than a data frame, deliberately — §7 of
   * the audit — because a group's *values* are an array and a frame's cells are numbers.
   * Flattening them to five summary columns would lose exactly what a violin is drawn from.
   */
  | {
      kind: "distribution-set";
      shape: "distribution";
      groups: WidgetDistributionGroup[];
      /** Marks across every group, so a shared axis can be scaled once. */
      total: number;
    }
  | {
      kind: "structured";
      shape:
        | "record"
        | "records"
        | "streak"
        | "goal"
        | "hierarchy"
        | "waterfall"
        | "interval-series";
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
  year: Pick<Year, "startsAt" | "endsAt" | "scale" | "generalBonus">;
  yearSubjects: readonly Subject[];
  periods: readonly Period[];
  customAverages: readonly CustomAverage[];
  /**
   * The kinds of assessment this year defines.
   *
   * Needed for the names: a result stores which type it was, and only the year knows what
   * that type is called. A year with none simply has no such dimension to offer.
   */
  gradeTypes?: readonly GradeType[];
  now?: Date;
  /**
   * The groups this reader may be compared against, by group id.
   *
   * Supplied by the host rather than derived, because it is the one thing on this context
   * that is *other people's* — it exists only where a group's owner opened it and only for
   * the members who consented, both decided on the server. A card names a group; the
   * numbers arrive with the render and are never stored in the document, so withdrawing a
   * consent empties the card at the next refetch rather than leaving a figure behind.
   */
  cohorts?: ReadonlyMap<string, CohortContext>;
  /**
   * The friends who share something with this reader, by user id.
   *
   * Same shape and same rule as the cohorts beside it: supplied by the host, never stored
   * in a document, and present only for what its owner opened. A friend who closes a lock
   * disappears from the map, and the card that named them goes quiet.
   */
  friends?: ReadonlyMap<string, FriendContext>;
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
  definition: WidgetDefinition;
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
