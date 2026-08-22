import { CARD_METRICS, type CardMetric } from "./cards";
import {
  widgetMarkForRecipe,
  widgetRecipeDescriptor,
  WIDGET_RECIPES,
  type WidgetChartRecipe,
} from "./widget-recipes";
import { widgetAxisType } from "./widget-types";
import type {
  WidgetAnalysis,
  WidgetCapability,
  WidgetChartMark,
  WidgetComparison,
  WidgetDimension,
  WidgetGrouping,
  WidgetMeasure,
  WidgetMeasureEntry,
  WidgetChannel,
  WidgetDatumSlotName,
  WidgetEncodingSpec,
  WidgetMeasureReading,
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
  // Two windows the card names itself. A measure that can be held against the window
  // before it can be held against a window somebody chose — the arithmetic is the same
  // subtraction, and the evaluator reads both sides the same way.
  "window-pair",
];

/**
 * The groupings a reading over the *marks* supports.
 *
 * A grade band and a status slice the marks rather than the tree — "how many of my results
 * are between twelve and fourteen", "how many passed" — so any measure that reads a set of
 * marks can be grouped by them. A period is a time axis by another name. Listed once here
 * rather than repeated on every capability that takes them.
 */
const MARK_GROUPINGS: WidgetGrouping[] = [
  "none",
  "time",
  "subject",
  "period",
  "grade-band",
  "status",
  // A year defines its own kinds of assessment and a result records which one it was, so
  // any reading over marks can be split by them.
  "assessment-type",
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
    groupings: options.groupings ?? MARK_GROUPINGS,
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
    // One panel per subject, each with its own curve: the reading that a chart of eight
    // overlaid lines cannot give.
    "facets",
    // Two readings and the ground between them — needs a second measure, which the compiler
    // insists on.
    "difference-area",
    // The line through the results, with how much of them it explains.
    "regression",
    // One reading against another, with the group as the point.
    "scatter",
    // One spoke per group. Needs three of them, which the descriptor's minimum says.
    "radar",
    // Each subject's average now against its own previous window: the card the
    // audit calls "period against period", drawn as the comparison it is.
    "dumbbell",
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
    ["bar", "dot", "table", "list", "lollipop"],
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
  // A spread is the other natural axis of a quadrant: how much a subject moves against
  // how much it has improved.
  defineCapability("spread", "scalar", "ratio", [
    "value",
    "line",
    "bar",
    "scatter",
  ]),
  defineCapability("consistency", "scalar", "percent", [
    "value",
    "gauge",
    "line",
    "bar",
    /**
     * One axis of a quadrant.
     *
     * Steadiness against progress is the audit's own example, and a scatter's *primary*
     * measure is whichever one the document lists first — so the capability that has to
     * allow it is this one. The second measure is checked by the compiler, not here.
     */
    "scatter",
  ]),
  defineCapability("improvement", "scalar", "ratio", [
    "value",
    "scatter",
    "line",
    "area",
    "bar",
  ]),
  // The one measure whose whole subject is movement, so it is the one that can
  // be drawn as a slope: `delta` is intrinsic here, and the arrow's tail is
  // `value - delta`.
  defineCapability(
    "mostImproved",
    "categorical-series",
    "ratio",
    ["bar", "dot", "table", "list", "lollipop", "slope-arrow", "dumbbell"],
    { groupings: ["subject"] },
  ),
  defineCapability(
    "steadiest",
    "categorical-series",
    "percent",
    ["bar", "dot", "table", "list", "lollipop"],
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
    ["histogram", "bar", "boxplot", "waffle", "strip", "violin", "ridgeline"],
    {
      // Grouped at last, and only where a distribution *means* something grouped: one per
      // subject, one per term, one per kind of assessment. A distribution per grade band
      // is a single bucket by construction — the band is the bucket — so it is refused
      // rather than drawn as a violin of one value.
      groupings: ["none", "subject", "period", "assessment-type"],
      comparisons: ["none"],
    },
  ),
  // A list, a table or a ranking of stems: the reading is *which* subjects, so a
  // shape that names them. No comparison — a coverage gap has no previous value.
  defineCapability(
    "coverage",
    "categorical-series",
    "count",
    ["list", "table", "lollipop", "bar"],
    // `status` is meaningful only as the inner axis of a subject walk. In that
    // cross-product `missing` is the completed domain: one when the subject has no mark,
    // zero otherwise. The compiler rejects `missing` for every other measure.
    { groupings: ["subject", "status"], comparisons: ["none"] },
  ),
  defineCapability(
    "leverage",
    "categorical-series",
    "percent",
    ["bar", "dot", "table", "list", "lollipop"],
    { groupings: ["subject"], comparisons: ["none"] },
  ),
  // The same shape as `leverage` and a different question — see the metric's own note.
  // Also a percentage of the average, so the two are read against the same scale and a
  // reader can see how much of a subject's weight the next mark actually reaches.
  defineCapability(
    "nextLeverage",
    "categorical-series",
    "percent",
    ["bar", "dot", "table", "list", "lollipop"],
    { groupings: ["subject"], comparisons: ["none"] },
  ),
  /**
   * A record: the mark, and the average with and without it.
   *
   * Three numbers that only mean something together — the before, the after, and which
   * mark did it. A bare delta would be a statistic nobody can act on or verify.
   */
  defineCapability("markImpact", "record", "ratio", ["value"], {
    scopes: ["general", "subjects", "custom-average"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  /**
   * A record: a subject *and* what working on it is worth.
   *
   * The name alone is advice and the number alone is a statistic. No goal, deliberately —
   * `requiredResult` answers "what do I need for this target" and this answers "where does
   * effort pay", which is the question when there is no target.
   */
  defineCapability("nextBestAction", "record", "ratio", ["value"], {
    scopes: ["general", "subjects", "custom-average"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  /**
   * A record: a mark, the subject it is in, and how far it sits from that subject's level.
   *
   * Every part is load-bearing. The distance without the mark is a statistic about
   * nothing; the mark without the distance is just a mark; and neither says anything
   * without the subject, because a result is only unusual against its own subject.
   */
  defineCapability("anomaly", "record", "ratio", ["value"], {
    scopes: ["general", "subjects", "custom-average"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  /**
   * A record: the reading is a share *and* how few subjects hold it.
   *
   * "53%" alone is not a risk and "two subjects" alone is not either — the sentence needs
   * both halves and the count of subjects that carry any weight at all, or a year of three
   * subjects reads as alarming.
   */
  defineCapability("concentration", "record", "percent", ["value"], {
    scopes: ["general", "subjects", "custom-average"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  // A record rather than a scalar: the answer is a mark *and* the subject it is
  // in, and a bare number would drop the half that makes it actionable.
  defineCapability("requiredResult", "record", "ratio", ["value"], {
    scopes: ["general"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  // A record too, and for the same reason: the reading is a cushion *and* the mark
  // that would spend it, and a bare number would drop the actionable half.
  defineCapability("safetyMargin", "record", "ratio", ["value"], {
    scopes: ["general"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  // A tree, because the reading is *where the average comes from* and a branch is
  // part of the answer. Same numbers as `leverage`, arranged as the hierarchy they
  // live in — see `weightHierarchy`, which is what keeps the two from disagreeing.
  defineCapability(
    "weightBreakdown",
    "hierarchy",
    "percent",
    // Nested area or concentric rings: the same tree, read by area or by level.
    ["treemap", "sunburst", "lollipop"],
    {
      scopes: ["general", "subjects"],
      groupings: ["none"],
      comparisons: ["none"],
    },
  ),
  // Two windows, so a previous window is the only comparison that makes sense — and
  // it is required rather than optional: without one there is no change to decompose.
  defineCapability("contributions", "waterfall", "ratio", [
    "waterfall",
    "lollipop",
  ], {
    scopes: ["general", "custom-average"],
    groupings: ["none"],
    comparisons: ["previous-window"],
  }),
  /**
   * The four readings that are about other people.
   *
   * Ungrouped, all of them: a group's figure is one number per member, and splitting it by
   * *your* subjects or *your* months would be splitting a number that has no such
   * structure. `cohortRank` is a record — a rank alone is not a reading, it needs the size
   * of the group and how many of it stayed private.
   */
  defineCapability("cohortRank", "record", "ratio", ["value"], {
    scopes: ["general"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  defineCapability("cohortAverage", "scalar", "ratio", ["value", "gauge"], {
    scopes: ["general"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  // A signed distance, which is what a delta looks like — so it reads as one.
  defineCapability("cohortGap", "scalar", "ratio", ["value"], {
    scopes: ["general"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  defineCapability("memberAverage", "record", "ratio", ["value"], {
    scopes: ["general"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  /**
   * The three readings a friendship makes possible.
   *
   * A friend is one person, not a group, so none of these is grouped or compared: the
   * comparison *is* the card. `friendCurves` is an interval series — two lines over one
   * year — and `friendSubjects` is a list of rows, which is what a table draws.
   */
  defineCapability("friendAverage", "record", "ratio", ["value"], {
    scopes: ["general"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  defineCapability("friendCurves", "interval-series", "ratio", ["line"], {
    scopes: ["general"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  defineCapability("friendSubjects", "records", "ratio", ["table", "list"], {
    scopes: ["general"],
    groupings: ["none"],
    comparisons: ["none"],
  }),
  /**
   * The run of marks and the spread it has been running at.
   *
   * `interval-series`, like the projection band, and a different claim: that one is about
   * where the average could go and this is about where results have been. Ungrouped —
   * a control chart per subject is a grid of small charts, which is what facets are for.
   */
  defineCapability(
    "controlBand",
    "interval-series",
    "ratio",
    ["control", "value"],
    {
      scopes: ["general", "subjects", "custom-average"],
      groupings: ["none"],
      comparisons: ["none"],
    },
  ),
  // A band and a reading, and never a forecast: `projectionBand` is careful about what
  // it may be called, and the result carries the answer.
  defineCapability(
    "projectionBand",
    "interval-series",
    "ratio",
    ["band", "value"],
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

/**
 * Whether any measure actually offers this recipe.
 *
 * The honest test of "can a card be saved as this?", and stricter than asking
 * whether V1 has a mark for it: a mark the capability table never lists is
 * unreachable however well the document could describe it. That is what lets a
 * mark land before its renderer — nothing can select it yet — and it is checked
 * against the renderer flags in `widget-recipes.test.ts`.
 */
export function widgetRecipeSelectable(recipe: WidgetChartRecipe): boolean {
  const mark = widgetMarkForRecipe(recipe);
  if (!mark) return false;
  return capabilities.some((capability) => capability.marks.includes(mark));
}

export function widgetMeasureId(
  measure: { kind: "metric"; metric: CardMetric } | { kind: "formula" },
): WidgetCapability["id"] {
  return measure.kind === "metric" ? measure.metric : "formula";
}

/** The unit the measure itself declares, including a formula's authored output unit. */
export function widgetMeasureValueType(
  measure: WidgetMeasure,
): WidgetValueType {
  return measure.kind === "formula"
    ? measure.valueType
    : widgetCapability(measure.metric).valueType;
}

/**
 * Whether one measure can become one numeric cell in each row of a grouped frame.
 *
 * Most rows are built by evaluating the measure to a scalar inside each bucket. Subject
 * rankings are the one exception: their categorical result is already one numeric value
 * per subject, and `datumForSubjects` materialises it directly. A distribution remains a
 * distribution inside a subject or period; treating it as a secondary number is what used
 * to produce a valid scatter whose entire second axis was `null`.
 */
export function widgetMeasureCanMaterializeFrameValue(
  measure: WidgetMeasure,
  dimensions: readonly WidgetDimension[],
): boolean {
  const capability = widgetCapability(widgetMeasureId(measure));
  if (capability.resultShape === "scalar") return true;
  return (
    dimensions[0]?.kind === "subject" &&
    capability.resultShape === "categorical-series"
  );
}

/**
 * The grouping a set of dimensions amounts to, for the capability table.
 *
 * The table asks a one-dimensional question — *can this measure be grouped this way* —
 * and a definition may now carry two dimensions. The answer that matters is per
 * dimension, so this returns the first, and the compiler checks each of them in turn.
 */
export function widgetGroupingOf(
  dimensions: readonly WidgetDimension[],
): WidgetGrouping {
  return dimensions[0]?.kind ?? "none";
}

/** Whether the evaluator has an honest cross-product for these two axes. */
export function widgetDimensionSplitSupported(
  outer: Pick<WidgetDimension, "kind">,
  split: Pick<WidgetDimension, "kind">,
): boolean {
  if (split.kind === "time" || split.kind === "period") return false;
  if (outer.kind === "time" || outer.kind === "period") return true;
  // A subject is a real outer domain: every selected subject can be crossed with a
  // filterable property of its marks. It cannot be crossed with another subject axis,
  // because that would ask for a subject inside a subject rather than a partition.
  if (outer.kind === "subject") return split.kind !== "subject";
  return split.kind !== "subject";
}

/**
 * The marks a measure may be drawn with, given how it is grouped.
 *
 * Reads the first dimension, because that is what decides the *shape* of the result: a
 * time dimension makes a series, a subject dimension makes a ranking, and nothing makes
 * a reading. A second dimension splits what the first produced — into series, colours or
 * facets — and does not change which marks apply.
 */
/**
 * Marks that draw the tree itself, rather than its leaves.
 *
 * The evaluator flattens a hierarchy for every other mark — a ranking can show the shares
 * even though it cannot show the branches — so this list decides which drawings are handed
 * the tree. It was the literal string `"treemap"` in that condition, and adding a second
 * tree drawing turned the sunburst into a bar chart of eight leaves: right document, right
 * renderer, and a result shape neither of them asked for.
 */
export const WIDGET_HIERARCHY_MARKS: readonly WidgetChartMark[] = [
  "treemap",
  "sunburst",
];

/**
 * The result a recipe receives after the evaluator's declared semantic projection.
 *
 * Most recipes consume the measure's native result. Two specialised readings have an
 * honest flat fallback: a hierarchy becomes its leaves and a waterfall becomes its
 * contribution steps. Interval readings shown as a value become the latest centre (or
 * observation), which is a scalar rather than an interval pretending to be one.
 */
export function widgetResultShapeForRecipe(
  measure: { kind: "metric"; metric: CardMetric } | { kind: "formula" },
  dimensions: readonly WidgetDimension[],
  recipe: WidgetChartRecipe,
): WidgetResultShape {
  const capability = widgetCapability(widgetMeasureId(measure));
  const grouping = widgetGroupingOf(dimensions);
  const nativeShape: WidgetResultShape =
    capability.resultShape === "distribution"
      ? "distribution"
      : grouping === "none"
        ? capability.resultShape
        : grouping === "time" || grouping === "period"
          ? "temporal-series"
          : "categorical-series";
  const mark = widgetMarkForRecipe(recipe);
  if (
    nativeShape === "hierarchy" &&
    mark !== null &&
    !WIDGET_HIERARCHY_MARKS.includes(mark)
  ) {
    return "categorical-series";
  }
  if (nativeShape === "waterfall" && mark !== "waterfall") {
    return "categorical-series";
  }
  if (nativeShape === "interval-series" && mark === "value") {
    return "scalar";
  }
  return nativeShape;
}

export function widgetCompatibleMarks(
  measure: { kind: "metric"; metric: CardMetric } | { kind: "formula" },
  dimensions: readonly WidgetDimension[],
): WidgetChartMark[] {
  const capability = widgetCapability(widgetMeasureId(measure));
  const grouping = widgetGroupingOf(dimensions);
  /**
   * A grouped distribution is still a distribution.
   *
   * The filters below narrow by the *shape of the axis* — a time axis takes lines, a
   * categorical axis takes bars — and a distribution has neither: its axis is the scale of
   * the marks, and grouping it puts one distribution on each row rather than one number.
   * Filtering it as a categorical series left exactly one mark standing, so a violin per
   * subject compiled down to a bar chart and drew no shape at all.
   */
  if (capability.resultShape === "distribution") {
    // Grouped, the drawings that say *one distribution per group*: a box, a shape, or shapes
    // stacked. A histogram or a waffle per group is a grid of small charts — which is what
    // `facets` is for — and offering them here drew seven boxes and called them a waffle.
    return grouping === "none"
      ? capability.marks
      : capability.marks.filter((mark) =>
          ["boxplot", "violin", "ridgeline"].includes(mark),
        );
  }
  if (grouping === "time" || grouping === "period") {
    return capability.marks.filter((mark) =>
      [
        "line",
        "area",
        "bar",
        "dot",
        "heatmap",
        "table",
        "list",
        "facets",
        "difference-area",
        // A fit needs an axis with distances on it. Over categories the slope would be
        // "per subject", which is a number about the order the subjects happen to be in.
        "regression",
      ].includes(mark),
    );
  }
  if (
    grouping === "subject" ||
    grouping === "assessment-type" ||
    grouping === "grade-band" ||
    grouping === "status"
  ) {
    return capability.marks.filter((mark) =>
      [
        "bar",
        "dot",
        "table",
        "list",
        "lollipop",
        "slope-arrow",
        "dumbbell",
        // Two readings against each other, one point per group. Needs a second measure,
        // which the compiler insists on.
        "scatter",
        // A radar's spokes are *categories* — one per subject, one per band. Over a time
        // axis it would put the calendar on a ring, which reads as a cycle: December next
        // to September, and a year's progress as a shape with no beginning.
        "radar",
      ].includes(mark),
    );
  }
  if (capability.resultShape === "scalar") {
    return capability.marks.filter((mark) => ["value", "gauge"].includes(mark));
  }
  return capability.marks;
}

/**
 * The recipes a measure may be drawn as, given how it is grouped.
 *
 * What the editor should offer, and what the compiler checks. Derived from the marks
 * rather than listed again: a recipe is selectable when its base mark is, so the two
 * cannot drift. Several recipes share a mark — a sparkline and a line, a heatmap and a
 * calendar — and all of them are offered; which one a card *is* then follows from the
 * rest of the document, and the compiler narrows it.
 */
export function widgetCompatibleRecipes(
  measure: { kind: "metric"; metric: CardMetric } | { kind: "formula" },
  dimensions: readonly WidgetDimension[],
): WidgetChartRecipe[] {
  const marks = new Set(widgetCompatibleMarks(measure, dimensions));
  return WIDGET_RECIPES.filter((recipe) => {
    const mark = widgetMarkForRecipe(recipe);
    if (mark === null || !marks.has(mark)) return false;
    const resultShape = widgetResultShapeForRecipe(
      measure,
      dimensions,
      recipe,
    );
    return widgetRecipeDescriptor(recipe).acceptedResults.includes(resultShape);
  });
}

/**
 * What a channel may point at, by id.
 *
 * The generalisation of the old five-field table. A channel names a dimension or a
 * reading of a measure, so the answer is built from what this analysis actually declared
 * rather than from a fixed list — which is what makes "colour by subject while x is the
 * month" expressible at all.
 *
 * The channel still decides what *kind* of field fits: a positional y wants a quantity, a
 * series or a facet wants a category, and colour takes either.
 */
export function widgetChannelFields(
  analysis: Pick<WidgetAnalysis, "measures" | "dimensions" | "comparison">,
  channel: "x" | "y" | "color" | "series" | "facet",
  options: { includeDelta?: boolean } = {},
): string[] {
  const dimensions = analysis.dimensions.map((dimension) => dimension.id);
  const readings = analysis.measures.flatMap((measure) => [
    measure.id,
    `${measure.id}.count`,
    ...(options.includeDelta ? [`${measure.id}.delta`] : []),
  ]);

  if (channel === "series" || channel === "facet") {
    // A series and a facet *split* what the result already is, so they name one of the
    // dimensions after the first: the first is the axis itself, and pointing a series at
    // it would ask for one series per x value, which is one series per point.
    return dimensions.slice(1);
  }
  if (channel === "y") return readings;
  if (channel === "color") return [...dimensions, ...readings];
  return [...dimensions, ...readings];
}

/**
 * Which slot of a series datum a channel means.
 *
 * A datum is still `{date, label, value, delta, count}` — the projection a renderer plots
 * — while the *document* now names dimensions and measures by id. This is the one
 * translation between them: a time dimension is the date, any other dimension is the
 * category, and a measure is its value, its delta or its count.
 *
 * `null` when the field names nothing this analysis produced, which the compiler has
 * already refused; a renderer treats it as an unset channel rather than guessing.
 */
export function widgetDatumSlot(
  analysis: Pick<WidgetAnalysis, "measures" | "dimensions">,
  field: string,
): WidgetDatumSlotName | null {
  const dimension = analysis.dimensions.find((item) => item.id === field);
  if (dimension) {
    // The same question the frame asks — see `widgetAxisType`. Answering it twice is how a
    // period axis ends up with a temporal scale over rows that carry no date.
    return widgetAxisType(dimension) === "time" ? "date" : "category";
  }
  const measure = widgetChannelMeasure(analysis, field);
  return measure ? measure.reading : null;
}

/**
 * Every channel's slot, resolved once.
 *
 * What a renderer wants: it draws a datum with five slots and needs to know which of them
 * each channel meant. Resolved at the top of a render and handed down, so a chart
 * component needs the visualization and this — never the analysis, which it has no other
 * use for.
 */
export type WidgetDatumSlots = Record<
  "x" | "y" | "color" | "series" | "facet",
  WidgetDatumSlotName | null
>;

export function widgetDatumSlots(
  analysis: Pick<WidgetAnalysis, "measures" | "dimensions">,
  encoding: WidgetEncodingSpec,
): WidgetDatumSlots {
  const slot = (channel: WidgetChannel | null) =>
    channel === null ? null : widgetDatumSlot(analysis, channel.field);
  return {
    x: slot(encoding.x),
    y: slot(encoding.y),
    color: slot(encoding.color),
    series: slot(encoding.series),
    facet: slot(encoding.facet),
  };
}

/** True when a channel's field names one of the analysis's dimensions. */
export function widgetChannelIsDimension(
  analysis: Pick<WidgetAnalysis, "dimensions">,
  field: string,
): boolean {
  return analysis.dimensions.some((dimension) => dimension.id === field);
}

/**
 * The measure a channel reads, and how.
 *
 * `null` when the field names a dimension or nothing at all. Splitting on the last dot
 * rather than the first, so a measure id may contain one.
 */
export function widgetChannelMeasure(
  analysis: Pick<WidgetAnalysis, "measures">,
  field: string,
): { measure: WidgetMeasureEntry; reading: WidgetMeasureReading } | null {
  const direct = analysis.measures.find((measure) => measure.id === field);
  if (direct) return { measure: direct, reading: "value" };
  const cut = field.lastIndexOf(".");
  if (cut <= 0) return null;
  const id = field.slice(0, cut);
  const reading = field.slice(cut + 1);
  const measure = analysis.measures.find((item) => item.id === id);
  if (!measure) return null;
  return reading === "delta" || reading === "count"
    ? { measure, reading }
    : null;
}

export function widgetMeasureHasIntrinsicDelta(
  measure: WidgetMeasure,
): boolean {
  const id = widgetMeasureId(measure);
  return id === "subjectRanking" || id === "mostImproved";
}
