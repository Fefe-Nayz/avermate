import {
  CARD_METRICS,
  canonicalizeWidgetDefinition,
  createWidgetVisualization,
  widgetCapability,
  widgetChannelFields,
  widgetChannelIsDimension,
  widgetCompatibleRecipes,
  widgetMarkForRecipe,
  WIDGET_DEFINITION_VERSION,
  widgetMeasureHasIntrinsicDelta,
  WIDGET_PAIRED_MARKS,
  type CardMetric,
  type WidgetDefinition,
  type WidgetChannel,
  type WidgetChartRecipe,
  type WidgetDimension,
  type WidgetSurface,
  type WidgetWindow,
} from "@avermate/core"
import { FIXTURE_COMPARISON_ID, FIXTURE_MEMBER_ID } from "./card-matrix-fixture"

/**
 * Every card this app can be asked to draw, generated rather than listed.
 *
 * A card is a measure, a grouping and a mark, and the registry already knows
 * which of those go together — so the matrix is a walk over
 * `widgetCompatibleRecipes`, not a hand-kept list that goes stale the day a recipe
 * is added. Adding a capability adds its cards here, and to the test page, with
 * nothing to remember.
 *
 * Three dimensions, because a card's look is decided in three places and only
 * one of them is the mark:
 *
 * - **The measure, grouping and mark** pick the body. `cardMatrix` walks all of
 *   them.
 * - **The surface** picks between two renderings of that body: a dashboard card
 *   is a glance and an insights card is a study, so the same list is a measured
 *   ranking on one and a plain series list on the other, and the same series is a
 *   reading over a sparkline or a full chart. `expanded` is that switch, and
 *   three of the renderer's bodies are only reachable through it.
 * - **The visualization options** decide the rest, and the defaults are a small
 *   corner of them. The dashboard's own average card is a *line with its axes
 *   turned off* — no separate mark, just an option — so a matrix built from
 *   defaults alone would not contain the app's most common card.
 *   `cardMatrixVariants` covers the options that change what you see.
 *
 * What no definition can reach is the data: a streak burns only while it is
 * alive, a goal reddens only when it cannot be met, and an anomaly card is drawn only
 * when a recent mark is actually unusual — the fixture's widest departure is under a
 * standard deviation and a half, so it reads "nothing out of the ordinary" here, which is
 * the card working. Those three need the account to be in that state.
 */

export interface MatrixCard {
  /** Stable across renders, so React keys and the page's anchors agree. */
  key: string
  title: string
  span: 1 | 2 | 3 | 4
  accent: string | null
  surface: WidgetSurface
  /** The insights rendering: a study rather than a glance. */
  expanded: boolean
  definition: WidgetDefinition
}

/**
 * Every body `WidgetBody` can render, and a card that reaches it.
 *
 * Declared here and cross-checked against the renderer by `card-matrix.test.ts`,
 * so a body added to `widget-view.tsx` fails the test until this list accounts
 * for it. That check is the reason the list is written out rather than inferred:
 * "is every card format on the page?" is otherwise a question nobody can answer
 * twice.
 */
export const CARD_BODIES: Readonly<Record<string, string>> = {
  WidgetStructuredResult: "lastGrade · value, worstSubject · value",
  WidgetScalarValue: "average · value, passRate · gauge",
  WidgetTrend: "average · line, on overview — a reading over a sparkline",
  WidgetSeriesChart: "subjectRanking · bar; average · line on insights",
  WidgetSeriesList: "subjectRanking · list, on insights",
  WidgetSeriesTable: "subjectRanking · table",
  WidgetBoxPlot: "distribution · boxplot",
  CardHeatmap: "gradeCount · heatmap weekly",
  MiniDistribution: "distribution · histogram, on overview",
  RankingList: "subjectRanking · list, on overview",
  CardWaffle: "distribution · waffle",
  CardStrip: "distribution · strip — every mark as its own tick",
  CardTreemap: "weightBreakdown · treemap — where the average comes from",
  CardWaterfall: "contributions · waterfall — why the average moved",
  CardBand: "projectionBand · band — where the average could end up",
  CardFacets: "average · facets — one panel per subject",
  CardDensity: "distribution · violin and ridgeline, one shape per group",
  CardDifference:
    "average · difference-area — the average against the median, gap shaded",
  CardRadar: "average · radar — one spoke per subject, on one ring",
  CardRegression:
    "average · regression — the fitted line, its band and what it explains",
  CardSunburst: "weightBreakdown · sunburst — the same tree, as rings",
  CardScatter:
    "consistency × improvement · scatter — steadiness against progress, by subject",
  CardControl:
    "controlBand · control-chart — the run of marks against its own spread",
  CardFriendCurves:
    "friendCurves · line — your average and a friend's, over the year",
  CardSubjectComparison:
    "friendSubjects · table — your subjects and a friend's, side by side",
}

/**
 * The channel, pointed at what the analysis actually declared.
 *
 * X takes the dimension and Y the measure, which is what every one-dimensional card
 * means. Naming them by id rather than guessing a field is the whole change: a channel
 * that pointed at nothing used to compile and draw an empty card.
 */
function encodingFor(
  analysis: WidgetDefinition["analysis"],
  channel: "x" | "y"
): WidgetChannel | null {
  const fields = widgetChannelFields(analysis, channel)
  // X takes the dimension, Y the measure's *value* — not the last field offered. The list
  // now runs `[measure, measure.count, measure.delta]`, so taking the last one pointed
  // every chart's y axis at its sample size: measured on the bench, an average card read
  // "1,000.00 / 20", which is fifty marks formatted as a mark out of twenty.
  const field =
    channel === "x"
      ? fields.at(0)
      : (fields.find((item) => !item.includes(".")) ?? fields.at(0))
  if (!field) return null
  return {
    field,
    type: widgetChannelIsDimension(analysis, field)
      ? analysis.dimensions.find((item) => item.id === field)?.kind === "time"
        ? "temporal"
        : "nominal"
      : "quantitative",
  }
}

const DIMENSION_ID = "group"
const MEASURE_ID = "measure"

const GROUPINGS: Record<string, WidgetDimension[]> = {
  none: [],
  time: [
    {
      id: DIMENSION_ID,
      kind: "time",
      grain: "week",
      accumulation: "running",
      fill: "observed",
    },
  ],
  subject: [
    {
      id: DIMENSION_ID,
      kind: "subject",
      level: "all",
      limit: 10,
      includeCategories: false,
    },
  ],
  // The dimension the audit asked for and the compiler refused until a result carried a
  // kind of its own. Untyped results kept, because the fixture has some and so does every
  // real year.
  "assessment-type": [
    { id: DIMENSION_ID, kind: "assessment-type", includeUntyped: true },
  ],
}

/** Short enough to sit in a card's header at any width. */
const GROUPING_LABEL: Record<string, string> = {
  none: "",
  time: " · weekly",
  subject: " · by subject",
  "assessment-type": " · by kind",
}

/**
 * A goal card measures a goal, so it needs one named; a scope or a window that
 * names subjects or a period needs those too. The page passes the account's own,
 * so the variants below describe real cards rather than plausible ones.
 */
export interface MatrixOptions {
  goalId?: string | null
  /**
   * The comparison a cohort reading is read against, and the member one is about.
   *
   * Supplied the same way a goal is, and required for the same reason: the compiler
   * refuses a cohort card with no group, so a matrix that left it out would generate
   * refused definitions and report the compiler's correctness as a broken fixture.
   */
  groupId?: string | null
  memberId?: string | null
  subjectIds?: readonly string[]
  periodId?: string | null
  window?: WidgetWindow
  surface?: WidgetSurface
}

/**
 * The comparison a metric and mark actually need.
 *
 * Three cases, and all three are the compiler's rules rather than this file's
 * preferences — a matrix that generated definitions the compiler refuses would be a
 * broken fixture reported as a broken card:
 *
 * - a measure that only supports a previous window gets one (`contributions` has
 *   nothing to decompose without it)
 * - a slope arrow or a dumbbell needs a pair, and a baseline is the comparison that
 *   works at every window
 * - everything else compares against nothing
 */
function comparisonFor(
  metric: CardMetric,
  recipe: WidgetChartRecipe
): WidgetDefinition["analysis"]["comparison"] {
  const capability = widgetCapability(metric)
  if (!capability.comparisons.includes("none")) {
    return { kind: "previous-window" }
  }
  const mark = widgetMarkForRecipe(recipe)
  return mark !== null &&
    WIDGET_PAIRED_MARKS.includes(mark) &&
    !widgetMeasureHasIntrinsicDelta({ kind: "metric", metric, goalId: null })
    ? { kind: "baseline", value: 0.7 }
    : { kind: "none" }
}

/**
 * The window a metric can be read in.
 *
 * A whole year has no previous window — the compiler says so — so a measure that
 * requires one is read over a rolling month instead.
 */
function windowFor(metric: CardMetric): WidgetWindow {
  return widgetCapability(metric).comparisons.includes("none")
    ? { kind: "whole-year" }
    : { kind: "rolling-days", days: 30 }
}

/** The analysis's dimensions plus a subject split, for the two-dimension variants. */
function withSubjectSplit(definition: WidgetDefinition): WidgetDimension[] {
  return [
    ...definition.analysis.dimensions,
    {
      id: "split",
      kind: "subject",
      level: "root",
      includeCategories: false,
      limit: 8,
    },
  ]
}

/** The same card read at another time grain. */
function withTimeGrain(
  definition: WidgetDefinition,
  grain: Extract<WidgetDimension, { kind: "time" }>["grain"]
): WidgetDefinition {
  return {
    ...definition,
    analysis: {
      ...definition.analysis,
      dimensions: definition.analysis.dimensions.map((dimension) =>
        dimension.kind === "time" ? { ...dimension, grain } : dimension
      ),
    },
  }
}

function definitionFor(
  metric: CardMetric,
  requested: WidgetDimension[],
  recipe: WidgetChartRecipe,
  options: MatrixOptions = {},
  patch?: (definition: WidgetDefinition) => WidgetDefinition
): WidgetDefinition {
  const visualization = createWidgetVisualization(recipe, {
    dimensionId: DIMENSION_ID,
    measureId: MEASURE_ID,
  })
  const surface = options.surface ?? "overview"
  // Recipes that require a grouping get one. A facet grid is one panel per value of a
  // *second* dimension, and a ridgeline's rows *are* its groups — the compiler refuses both
  // without them, for the same reason it refuses a dumbbell with nothing to pair. The matrix
  // supplies what the recipe requires: a fixture that generates a refused definition is a
  // broken fixture reported as a broken card.
  const subjectSplit = {
    id: recipe === "facets" ? "split" : DIMENSION_ID,
    kind: "subject" as const,
    level: "root" as const,
    includeCategories: false,
    limit: 8,
  }
  const preparedDimensions =
    recipe === "facets" && requested.length < 2
      ? [...requested, subjectSplit]
      : recipe === "ridgeline" && requested.length === 0
        ? [subjectSplit]
        : requested
  // A radar's spokes have a declared readable cardinality. The shared subject fixture
  // asks for ten so rankings can exercise overflow; the radar must cap its own axis at
  // eight instead of turning that useful fixture into a definition the compiler refuses.
  const dimensions =
    recipe === "radar"
      ? preparedDimensions.map((dimension, index) =>
          index === 0 && dimension.kind === "subject"
            ? { ...dimension, limit: Math.min(8, Math.max(3, dimension.limit)) }
            : dimension
        )
      : preparedDimensions
  /**
   * A difference card is *two* readings, and the compiler asks for both the second measure
   * and names for the pair — unnamed, the legend says "average" twice.
   *
   * The pair is the average against the median, which is a card worth having rather than a
   * demonstration: where the two separate, a few results are doing the work.
   */
  const measures: WidgetDefinition["analysis"]["measures"] =
    recipe === "scatter"
      ? [
          {
            id: MEASURE_ID,
            label: "Steadiness",
            expression: {
              kind: "metric",
              metric: "consistency",
              goalId: null,
            },
          },
          {
            id: `${MEASURE_ID}2`,
            label: "Improvement",
            expression: {
              kind: "metric",
              metric: "improvement",
              goalId: null,
            },
          },
        ]
      : recipe === "difference-area"
        ? [
            {
              id: MEASURE_ID,
              label: "Average",
              expression: {
                kind: "metric",
                metric,
                goalId: options.goalId ?? null,
              },
            },
            {
              id: `${MEASURE_ID}2`,
              label: "Median",
              expression: { kind: "metric", metric: "median", goalId: null },
            },
          ]
        : [
            {
              id: MEASURE_ID,
              label: null,
              expression: {
                kind: "metric",
                metric,
                goalId: options.goalId ?? null,
                // Dropped by the parser on every metric that does not read them, so
                // supplying them here costs nothing to the cards that are not about a group.
                groupId: options.groupId ?? FIXTURE_COMPARISON_ID,
                // One id for two relationships: a classmate is named through a group and a
                // friend through the friendship, and the fixture's friend *is* one of the
                // fixture's classmates, so a single id serves both benches.
                memberId: options.memberId ?? FIXTURE_MEMBER_ID,
              },
            },
          ]
  const analysis: WidgetDefinition["analysis"] = {
    measures,
    dimensions,
    // A slope arrow and a dumbbell draw a pair, and the compiler refuses them
    // without one — see `WIDGET_PAIRED_MARKS`. A baseline is the comparison that
    // works at every window, including the whole year this matrix uses, where a
    // previous window does not exist.
    comparison: comparisonFor(metric, recipe),
    transforms: [],
  }
  const base: WidgetDefinition = {
    apiVersion: WIDGET_DEFINITION_VERSION,
    query: {
      source: "grades",
      scope: { kind: "general" },
      window: options.window ?? windowFor(metric),
      filters: [],
    },
    analysis,
    visualization: {
      ...visualization,
      encoding: {
        ...visualization.encoding,
        x: encodingFor(analysis, "x"),
        y: encodingFor(analysis, "y"),
        facet:
          recipe === "facets" && dimensions[1]
            ? { field: dimensions[1].id, type: "nominal" }
            : visualization.encoding.facet,
      },
    },
    presentation: {
      mode: surface === "insights" ? "analytical" : "dashboard",
      responsiveBehavior: "adapt",
    },
  }

  return canonicalizeWidgetDefinition(patch ? patch(base) : base, { surface })
}

/**
 * The whole matrix, at one span and one surface.
 *
 * Ordered by measure so a scroll reads as a tour of the model rather than of the
 * alphabet, and every card is titled with what produced it — a card that looks
 * wrong on the page should be identifiable from the page.
 */
export function cardMatrix(
  span: MatrixCard["span"] = 1,
  options: MatrixOptions = {}
): MatrixCard[] {
  const surface = options.surface ?? "overview"
  const cards: MatrixCard[] = []

  for (const metric of CARD_METRICS) {
    const capability = widgetCapability(metric)
    if (!capability.surfaces.includes(surface)) continue
    for (const grouping of capability.groupings) {
      const dimensions = GROUPINGS[grouping]
      if (!dimensions) continue
      const recipes = widgetCompatibleRecipes(
        { kind: "metric", metric },
        dimensions
      )
      for (const recipe of recipes) {
        cards.push({
          key: `${surface}:${metric}:${grouping}:${recipe}`,
          title: `${metric} · ${recipe}${GROUPING_LABEL[grouping] ?? ""}`,
          span,
          accent: null,
          surface,
          expanded: surface === "insights",
          definition: definitionFor(metric, dimensions, recipe, options),
        })
      }
    }
  }

  return cards
}

/**
 * One card per result shape, for the arrangements that would be unreadable with
 * a hundred.
 *
 * Picked by shape rather than by taste: a scalar, a record, a streak, a goal, a
 * distribution, a categorical list and a time series are the bodies the renderer
 * has, and a layout that suits all of them suits everything.
 */
export function cardMatrixSample(
  span: MatrixCard["span"] = 1,
  options: MatrixOptions = {}
): MatrixCard[] {
  const wanted: Array<[CardMetric, keyof typeof GROUPINGS, WidgetChartRecipe]> =
    [
      ["average", "none", "value"],
      ["passRate", "none", "gauge"],
      ["lastGrade", "none", "value"],
      ["worstSubject", "none", "value"],
      ["activityStreak", "none", "value"],
      ["goalProgress", "none", "gauge"],
      ["distribution", "none", "histogram"],
      ["distribution", "none", "boxplot"],
      ["subjectRanking", "subject", "list"],
      ["subjectRanking", "subject", "bar"],
      ["subjectRanking", "subject", "table"],
      ["average", "time", "area"],
      ["average", "time", "line"],
      ["average", "time", "sparkline"],
      ["gradeCount", "time", "heatmap"],
      // The recipes and readings added on top of the eleven marks.
      ["subjectRanking", "subject", "lollipop"],
      ["mostImproved", "subject", "slope-arrow"],
      ["distribution", "none", "waffle"],
      ["leverage", "subject", "lollipop"],
      ["requiredResult", "none", "value"],
      ["coverage", "subject", "list"],
    ]
  const surface = options.surface ?? "overview"

  return wanted.map(([metric, grouping, recipe]) => ({
    key: `${surface}:${metric}:${grouping}:${recipe}`,
    title: `${metric} · ${recipe}`,
    span,
    accent: null,
    surface,
    expanded: surface === "insights",
    definition: definitionFor(
      metric,
      GROUPINGS[grouping] ?? [],
      recipe,
      options
    ),
  }))
}

/**
 * The same bodies with nothing to draw.
 *
 * A month in 1990 holds no grades for anybody, so every one of these lands on
 * the empty result — which has a layout of its own, and is the state a new
 * account sees on every card at once.
 */
export function cardMatrixEmpty(
  span: MatrixCard["span"] = 1,
  options: MatrixOptions = {}
): MatrixCard[] {
  return cardMatrixSample(span, {
    ...options,
    window: { kind: "date-range", from: "1990-09-01", to: "1990-09-30" },
  }).map((card) => ({
    ...card,
    key: `empty:${card.key}`,
    title: `empty · ${card.title}`,
  }))
}

interface Variant {
  title: string
  metric: CardMetric
  grouping: keyof typeof GROUPINGS
  mark: WidgetChartRecipe
  patch: (
    definition: WidgetDefinition,
    options: MatrixOptions
  ) => WidgetDefinition
}

type Visualization = WidgetDefinition["visualization"]

function withVisualization(
  definition: WidgetDefinition,
  visualization: Partial<Visualization>
): WidgetDefinition {
  return {
    ...definition,
    visualization: { ...definition.visualization, ...visualization },
  }
}

function withOptions(
  definition: WidgetDefinition,
  options: Visualization["options"]
): WidgetDefinition {
  return withVisualization(definition, { options })
}

const NO_AXES: Visualization["axes"] = {
  x: { visible: false, grid: false, label: null },
  y: { visible: false, grid: false, label: null },
}

/**
 * The options that change what you see.
 *
 * Not every field — a stroke width of three is not a format worth a card — but
 * every one that produces a different *kind* of picture: a stripped line is a
 * sparkline, a gauge without its number is a bar, a bar laid on its side is a
 * ranking, a threshold recolours the figure and writes a line under it.
 */
const VARIANTS: Variant[] = [
  {
    // The limitation the audit called out: a distribution *per subject*, which the registry
    // used to forbid outright.
    title: "violin · one shape per subject",
    metric: "distribution",
    grouping: "subject",
    mark: "violin",
    patch: (definition) => definition,
  },
  {
    title: "ridgeline · the same shapes, stacked",
    metric: "distribution",
    grouping: "subject",
    mark: "ridgeline",
    patch: (definition) => definition,
  },
  {
    title: "boxplot · one box per subject",
    metric: "distribution",
    grouping: "subject",
    mark: "boxplot",
    patch: (definition) => definition,
  },
  {
    // The weight tree read by level rather than by area. The recipe was declared from the
    // start and drew nothing, which is the one thing the registry promises cannot happen.
    title: "sunburst · the weight tree as rings",
    metric: "weightBreakdown",
    grouping: "none",
    mark: "sunburst",
    patch: (definition) => definition,
  },
  {
    // A trend arrow says "up". This says how fast, and how closely the results follow it —
    // the reading the app could compute and never showed.
    title: "regression · the line through the results",
    metric: "average",
    grouping: "time",
    mark: "regression",
    patch: (definition) => definition,
  },
  {
    // The dashboard's own radar, as a card: the chart existed and was not a recipe, so no
    // document could ask for it.
    title: "radar · one spoke per subject",
    metric: "average",
    grouping: "subject",
    mark: "radar",
    patch: (definition) => definition,
  },
  {
    // The run of marks against its own spread. The matrix's own walk reaches this measure
    // with the `value` recipe — the narrow reading — so the chart needs asking for.
    title: "control-chart · the marks against their own spread",
    metric: "controlBand",
    grouping: "none",
    mark: "control-chart",
    patch: (definition) => definition,
  },
  {
    // A DS and a colle are not the same event, and the year's average hides that.
    title: "bar · by kind of assessment",
    metric: "average",
    grouping: "assessment-type",
    mark: "bar",
    patch: (definition) => definition,
  },
  {
    title: "boxplot · the spread of each kind",
    metric: "distribution",
    grouping: "assessment-type",
    mark: "boxplot",
    patch: (definition) => definition,
  },
  {
    // The audit's own quadrant: which subjects are both improving and steady. Two
    // readings on two axes, which no single-measure document could describe at any width.
    title: "scatter · steadiness against progress",
    metric: "consistency",
    grouping: "subject",
    mark: "scatter",
    patch: (definition) => definition,
  },
  {
    // The chart a one-measure document could not describe: the average against the median,
    // and the ground between them shaded by which is on top.
    title: "difference-area · average against median",
    metric: "average",
    grouping: "time",
    mark: "difference-area",
    patch: (definition) => definition,
  },
  {
    // The grid the audit calls the biggest gain after composable dimensions: one panel
    // per subject, all on one scale.
    title: "facets · one panel per subject",
    metric: "average",
    grouping: "time",
    mark: "facets",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        dimensions: withSubjectSplit(definition),
      },
      visualization: {
        ...definition.visualization,
        encoding: {
          ...definition.visualization.encoding,
          facet: { field: "split", type: "nominal" },
        },
      },
    }),
  },
  {
    // Two dimensions, stacked: the composition over time a single grouping could not
    // describe at all.
    title: "bar · stacked by subject (time × subject)",
    metric: "average",
    grouping: "time",
    mark: "bar",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        dimensions: withSubjectSplit(definition),
      },
      visualization: {
        ...definition.visualization,
        options: {
          kind: "bar",
          orientation: "vertical",
          stacked: true,
          cornerRadius: 3,
        },
        encoding: {
          ...definition.visualization.encoding,
          series: { field: "split", type: "nominal" },
        },
        legend: { visible: true, position: "bottom" },
      },
    }),
  },
  {
    // The grain a day bucket cannot express: one point per mark, in the order they were
    // sat, so two results on one afternoon stay two results.
    title: "line · one point per result (event grain)",
    metric: "average",
    grouping: "time",
    mark: "line",
    patch: (definition) => withTimeGrain(definition, "event"),
  },
  {
    title: "bar · by period",
    metric: "average",
    grouping: "time",
    mark: "bar",
    patch: (definition) => withTimeGrain(definition, "period"),
  },
  {
    // Marks sliced by where they land rather than by which subject they belong to.
    title: "bar · by grade band",
    metric: "gradeCount",
    grouping: "subject",
    mark: "bar",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        dimensions: [
          {
            id: DIMENSION_ID,
            kind: "grade-band",
            thresholds: [0.4, 0.5, 0.6, 0.7, 0.8],
          },
        ],
      },
    }),
  },
  {
    title: "bar · passed against failed",
    metric: "gradeCount",
    grouping: "subject",
    mark: "bar",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        dimensions: [
          {
            id: DIMENSION_ID,
            kind: "status",
            values: ["passed", "failed"],
          },
        ],
      },
    }),
  },
  {
    // The shape a single grouping could not describe: one measure, two axes, one series
    // per subject. The analysis declares the split and the encoding only chooses which
    // channel shows it — see the time dimension's second entry.
    title: "line · a series per subject (time × subject)",
    metric: "average",
    grouping: "time",
    mark: "line",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        dimensions: [
          ...definition.analysis.dimensions,
          {
            id: "split",
            kind: "subject",
            level: "root",
            includeCategories: false,
            limit: 8,
          },
        ],
      },
      visualization: {
        ...definition.visualization,
        encoding: {
          ...definition.visualization.encoding,
          series: { field: "split", type: "nominal" },
        },
        legend: { visible: true, position: "bottom" },
      },
    }),
  },
  {
    title: "area · axes off (the dashboard's own sparkline)",
    metric: "average",
    grouping: "time",
    mark: "area",
    patch: (definition) => withVisualization(definition, { axes: NO_AXES }),
  },
  {
    title: "line · axes off",
    metric: "average",
    grouping: "time",
    mark: "line",
    patch: (definition) => withVisualization(definition, { axes: NO_AXES }),
  },
  {
    title: "bar · axes off",
    metric: "gradeCount",
    grouping: "time",
    mark: "bar",
    patch: (definition) => withVisualization(definition, { axes: NO_AXES }),
  },
  {
    title: "value · no delta, no trend",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) =>
      withOptions(definition, {
        kind: "value",
        showDelta: false,
        trendIndicator: false,
      }),
  },
  {
    title: "value · delta only",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) =>
      withOptions(definition, {
        kind: "value",
        showDelta: true,
        trendIndicator: false,
      }),
  },
  {
    title: "value · trend arrow only",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) =>
      withOptions(definition, {
        kind: "value",
        showDelta: false,
        trendIndicator: true,
      }),
  },
  {
    title: "value · thresholds with labels",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) =>
      withVisualization(definition, {
        thresholds: [
          { value: 0, color: "var(--band-poor)", label: "Below target" },
          { value: 0.5, color: "var(--band-fair)", label: "Passing" },
          { value: 0.7, color: "var(--band-excellent)", label: "On track" },
        ],
      }),
  },
  {
    title: "value · no decimals",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) =>
      withVisualization(definition, {
        format: { decimals: 0, unit: "auto", compact: false },
      }),
  },
  {
    title: "value · as a percentage",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) =>
      withVisualization(definition, {
        format: { decimals: 1, unit: "percent", compact: false },
      }),
  },
  {
    title: "value · compact",
    metric: "gradeCount",
    grouping: "none",
    mark: "value",
    patch: (definition) =>
      withVisualization(definition, {
        format: { decimals: 0, unit: "count", compact: true },
      }),
  },
  {
    title: "gauge · thick track",
    metric: "passRate",
    grouping: "none",
    mark: "gauge",
    patch: (definition) =>
      withOptions(definition, {
        kind: "gauge",
        showValue: true,
        thickness: 14,
      }),
  },
  {
    title: "gauge · bar alone, no number",
    metric: "passRate",
    grouping: "none",
    mark: "gauge",
    patch: (definition) =>
      withOptions(definition, {
        kind: "gauge",
        showValue: false,
        thickness: "auto",
      }),
  },
  {
    title: "gauge · filled from half the scale",
    metric: "average",
    grouping: "none",
    mark: "gauge",
    patch: (definition) =>
      withVisualization(definition, {
        scale: {
          x: { reverse: false },
          y: { zero: false, min: 0.5, max: 1, reverse: false },
        },
      }),
  },
  {
    title: "line · linear curve with points",
    metric: "average",
    grouping: "time",
    mark: "line",
    patch: (definition) =>
      withOptions(definition, {
        kind: "line",
        curve: "linear",
        points: true,
        strokeWidth: 2,
      }),
  },
  {
    title: "line · step curve",
    metric: "average",
    grouping: "time",
    mark: "line",
    patch: (definition) =>
      withOptions(definition, {
        kind: "line",
        curve: "step",
        points: false,
        strokeWidth: 2,
      }),
  },
  {
    title: "area · opaque fill with points",
    metric: "average",
    grouping: "time",
    mark: "area",
    patch: (definition) =>
      withOptions(definition, {
        kind: "area",
        curve: "monotone",
        points: true,
        opacity: 0.6,
      }),
  },
  {
    title: "bar · horizontal",
    metric: "subjectRanking",
    grouping: "subject",
    mark: "bar",
    patch: (definition) =>
      withOptions(definition, {
        kind: "bar",
        orientation: "horizontal",
        stacked: false,
        cornerRadius: 4,
      }),
  },
  {
    title: "bar · square corners",
    metric: "subjectRanking",
    grouping: "subject",
    mark: "bar",
    patch: (definition) =>
      withOptions(definition, {
        kind: "bar",
        orientation: "vertical",
        stacked: false,
        cornerRadius: 0,
      }),
  },
  {
    title: "dot · large",
    metric: "subjectRanking",
    grouping: "subject",
    mark: "dot",
    patch: (definition) => withOptions(definition, { kind: "dot", size: 12 }),
  },
  {
    title: "histogram · five bins",
    metric: "distribution",
    grouping: "none",
    mark: "histogram",
    patch: (definition) =>
      withOptions(definition, { kind: "histogram", bins: 5 }),
  },
  {
    title: "histogram · twenty bins",
    metric: "distribution",
    grouping: "none",
    mark: "histogram",
    patch: (definition) =>
      withOptions(definition, { kind: "histogram", bins: 20 }),
  },
  {
    title: "boxplot · outliers hidden",
    metric: "distribution",
    grouping: "none",
    mark: "boxplot",
    patch: (definition) =>
      withOptions(definition, { kind: "boxplot", showOutliers: false }),
  },
  {
    title: "heatmap · sequential",
    metric: "gradeCount",
    grouping: "time",
    mark: "heatmap",
    patch: (definition) =>
      withOptions(definition, { kind: "heatmap", colorScheme: "sequential" }),
  },
  {
    title: "heatmap · diverging",
    metric: "gradeCount",
    grouping: "time",
    mark: "heatmap",
    patch: (definition) =>
      withOptions(definition, { kind: "heatmap", colorScheme: "diverging" }),
  },
  {
    title: "table · three rows",
    metric: "subjectRanking",
    grouping: "subject",
    mark: "table",
    patch: (definition) => withOptions(definition, { kind: "table", rows: 3 }),
  },
  {
    title: "list · names only",
    metric: "subjectRanking",
    grouping: "subject",
    mark: "list",
    patch: (definition) =>
      withOptions(definition, { kind: "list", rows: 8, showValues: false }),
  },
  {
    title: "line · y from zero",
    metric: "average",
    grouping: "time",
    mark: "line",
    patch: (definition) =>
      withVisualization(definition, {
        scale: {
          x: { reverse: false },
          y: { zero: true, min: null, max: null, reverse: false },
        },
      }),
  },
  {
    title: "line · y reversed",
    metric: "average",
    grouping: "time",
    mark: "line",
    patch: (definition) =>
      withVisualization(definition, {
        scale: {
          x: { reverse: false },
          y: { zero: false, min: null, max: null, reverse: true },
        },
      }),
  },
  {
    title: "line · legend on top",
    metric: "average",
    grouping: "time",
    mark: "line",
    patch: (definition) =>
      withVisualization(definition, {
        legend: { visible: true, position: "top" },
      }),
  },
  {
    title: "value · against the previous window",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        comparison: { kind: "previous-window" },
      },
    }),
  },
  {
    // Two terms, named outright. The comparison the model carried and the evaluator
    // ignored, so a card asking for it was read over its own window instead.
    title: "value · the first term against the second",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        comparison: {
          kind: "window-pair",
          left: { kind: "period", periodId: "fixture-t1" },
          right: { kind: "period", periodId: "fixture-t2" },
          alignment: "period",
        },
      },
    }),
  },
  {
    title: "bar · each subject, first term against second",
    metric: "average",
    grouping: "subject",
    mark: "bar",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        comparison: {
          kind: "window-pair",
          left: { kind: "period", periodId: "fixture-t1" },
          right: { kind: "period", periodId: "fixture-t2" },
          alignment: "period",
        },
      },
    }),
  },
  {
    // The two options that were saved and read by nobody.
    title: "dumbbell · both ends labelled",
    metric: "mostImproved",
    grouping: "subject",
    mark: "dumbbell",
    patch: (definition) =>
      withOptions(definition, {
        kind: "dumbbell",
        size: 12,
        showLabels: true,
      }),
  },
  {
    title: "slope-arrow · with the change written",
    metric: "mostImproved",
    grouping: "subject",
    mark: "slope-arrow",
    patch: (definition) =>
      withOptions(definition, { kind: "slope-arrow", showLabels: true }),
  },
  {
    title: "value · against a baseline",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        comparison: { kind: "baseline", value: 0.7 },
      },
    }),
  },
  {
    title: "line · four-point moving average",
    metric: "average",
    grouping: "time",
    mark: "line",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        transforms: [{ kind: "moving-average", points: 4 }],
      },
    }),
  },
  {
    title: "bar · cumulative",
    metric: "gradeCount",
    grouping: "time",
    mark: "bar",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        transforms: [{ kind: "cumulative" }],
      },
    }),
  },
  {
    title: "list · ascending, limited to four",
    metric: "subjectRanking",
    grouping: "subject",
    mark: "list",
    patch: (definition) => ({
      ...definition,
      analysis: {
        ...definition.analysis,
        transforms: [
          { kind: "sort", direction: "ascending" },
          { kind: "limit", count: 4 },
        ],
      },
    }),
  },
  {
    title: "value · the last five grades",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) => ({
      ...definition,
      query: { ...definition.query, window: { kind: "last-grades", count: 5 } },
    }),
  },
  {
    title: "value · a rolling thirty days",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) => ({
      ...definition,
      query: {
        ...definition.query,
        window: { kind: "rolling-days", days: 30 },
      },
    }),
  },
  {
    title: "value · the active period",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) => ({
      ...definition,
      query: { ...definition.query, window: { kind: "active-period" } },
    }),
  },
  {
    title: "value · one named period",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition, options) =>
      options.periodId
        ? {
            ...definition,
            query: {
              ...definition.query,
              window: { kind: "period", periodId: options.periodId },
            },
          }
        : definition,
  },
  {
    title: "value · two subjects only",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition, options) =>
      options.subjectIds?.length
        ? {
            ...definition,
            query: {
              ...definition.query,
              scope: {
                kind: "subjects",
                subjectIds: options.subjectIds.slice(0, 2),
                includeDescendants: true,
              },
            },
          }
        : definition,
  },
  {
    title: "value · passed grades only",
    metric: "average",
    grouping: "none",
    mark: "value",
    patch: (definition) => ({
      ...definition,
      query: {
        ...definition.query,
        filters: [{ kind: "passed", value: true }],
      },
    }),
  },
  {
    title: "value · above 15, and annotated",
    metric: "gradeCount",
    grouping: "none",
    mark: "value",
    patch: (definition) => ({
      ...definition,
      query: {
        ...definition.query,
        filters: [
          { kind: "grade-ratio", operator: "gte", value: 0.75 },
          { kind: "has-note", value: true },
        ],
      },
    }),
  },
]

/** Every option variant, at one span. */
export function cardMatrixVariants(
  span: MatrixCard["span"] = 1,
  options: MatrixOptions = {}
): MatrixCard[] {
  const surface = options.surface ?? "overview"

  return VARIANTS.map((variant, index) => ({
    key: `variant:${index}:${variant.metric}:${variant.mark}`,
    title: `${variant.metric} · ${variant.title}`,
    span,
    accent: null,
    surface,
    expanded: surface === "insights",
    definition: definitionFor(
      variant.metric,
      GROUPINGS[variant.grouping] ?? [],
      variant.mark,
      options,
      (definition) => variant.patch(definition, options)
    ),
  }))
}
