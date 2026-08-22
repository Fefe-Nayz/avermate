import { WIDGET_LIMITS } from "./widget-types";
import type {
  WidgetChartMark,
  WidgetDefinition,
  WidgetResultShape,
  WidgetSurface,
  WidgetVisualization,
} from "./widget-types";

/**
 * What a card *is*, as a product decision, and how much room that decision needs.
 *
 * The mark is not that decision. `line` covers both the dashboard's average card
 * — a reading with a curve under it, no axes, no apparatus — and a full study of
 * eight subjects over a year, and those two want different widths, different
 * heights, different legends and different fallbacks. The layout knew none of it:
 * `minColumns` read `CardSpec.display`, a four-way projection of the mark
 * (`value | gauge | chart | list`), so a radar, a treemap, a table, a sparkline
 * and an eight-series chart all asked for the same floor.
 *
 * A recipe names the intent, and carries the policy with it. Two rules make the
 * policy safe to hand to the packer and to drag-and-drop:
 *
 * - It is a pure function of the *definition*, never of the current result. A
 *   card must not change width because a new grade arrived — that would move
 *   rows under the reader's finger and invalidate a drag mid-gesture. So
 *   `maxSeriesByProfile` is a budget the renderer spends on presentation
 *   ("top 3 and Others"), not an input to the layout.
 * - It is total. Every recipe has a descriptor, and a recipe with no renderer on
 *   a platform says so, so the compiler can refuse it rather than saving a card
 *   that will render blank there.
 */

export const WIDGET_RECIPES = [
  // Readings.
  "value",
  "gauge",
  "bullet",
  // Series.
  "sparkline",
  "line",
  "area",
  "bar",
  "dot",
  "regression",
  "difference-area",
  "projection-band",
  "control-chart",
  // Two measures against each other.
  "scatter",
  // Rankings and comparisons.
  "ranking",
  "lollipop",
  "slope-arrow",
  "dumbbell",
  "waterfall",
  // Distributions.
  "histogram",
  "strip",
  "boxplot",
  "violin",
  "ridgeline",
  "waffle",
  // Matrices and shapes.
  "heatmap",
  "calendar",
  "treemap",
  "sunburst",
  "radar",
  // Tabular and composite.
  "table",
  "list",
  "facets",
] as const;

export type WidgetChartRecipe = (typeof WIDGET_RECIPES)[number];

/**
 * How wide the card actually is, in pixels, as opposed to how many columns it
 * spans.
 *
 * Two cards of two columns are not the same width: the dashboard's pane, the
 * editor's aside and a phone all divide their columns differently. Presentation
 * inside a card — labels, axes, density, how many series are worth drawing —
 * belongs to the physical width, and only the column count belongs to the grid.
 *
 * These thresholds decide nothing about order or topology, which is why they can
 * be measured at runtime without putting the layout at the mercy of a resize.
 */
export const WIDGET_CONTAINER_PROFILES = [
  "micro",
  "compact",
  "standard",
  "wide",
  "hero",
] as const;

export type WidgetContainerProfile = (typeof WIDGET_CONTAINER_PROFILES)[number];

const PROFILE_FLOORS: ReadonlyArray<readonly [WidgetContainerProfile, number]> =
  [
    ["hero", 640],
    ["wide", 420],
    ["standard", 280],
    ["compact", 180],
    ["micro", 0],
  ];

export function widgetContainerProfile(width: number): WidgetContainerProfile {
  for (const [profile, floor] of PROFILE_FLOORS) {
    if (width >= floor) return profile;
  }
  return "micro";
}

/**
 * The height a body needs before it says anything.
 *
 * A row is as tall as the tallest card in it, so these are requests rather than
 * sizes: the row grants the maximum any of its cards asked for, and the others
 * spend the surplus. Expressed as tiers rather than pixels because a card must
 * ask for a *class* of height — a free pixel number per card is how a grid ends
 * up with rows that differ by four pixels for no reason anybody can see.
 */
export const WIDGET_HEIGHT_TIERS = [
  "short",
  "regular",
  "chart",
  "analytical",
] as const;

export type WidgetHeightTier = (typeof WIDGET_HEIGHT_TIERS)[number];

/** Pixel floor per tier. The row takes the largest its cards request. */
export const WIDGET_HEIGHT_TIER_PIXELS: Readonly<
  Record<WidgetHeightTier, number>
> = Object.freeze({
  short: 112,
  regular: 168,
  chart: 216,
  analytical: 304,
});

/** Series worth drawing at each width, before the renderer folds the rest away. */
export interface WidgetSeriesBudget {
  micro: number;
  compact: number;
  standard: number;
  wide: number;
  hero: number;
}

export type WidgetLegendPolicy = "never" | "inline" | "wide-only" | "always";

export interface WidgetLayoutPolicy {
  /**
   * The narrowest this recipe may be drawn, per grid width.
   *
   * Keyed by the grid's column count because a floor of two means "half" on a
   * four-column grid and "everything" on a two-column one, and only the second
   * of those is ever right for a card that merely wants room for an axis.
   */
  minColumns: Readonly<Record<1 | 2 | 3 | 4, 1 | 2 | 3 | 4>>;
  /** What it would take if nothing else competed for the row. */
  preferredColumns: 1 | 2 | 3 | 4;
  minHeightTier: WidgetHeightTier;
  /** Width ÷ height the body reads best at, for the recipes that care. */
  preferredAspectRatio?: number;
  maxSeriesByProfile: WidgetSeriesBudget;
  /** What to draw instead when the card is narrower than `minColumns` allows. */
  compactFallback?: WidgetChartRecipe;
  legend: WidgetLegendPolicy;
}

export type WidgetRendererSupport = "native" | "fallback" | "unsupported";

export interface WidgetRecipeDescriptor {
  id: WidgetChartRecipe;
  labelKey: string;
  /** Result shapes this recipe can draw. A mismatch is a compile error. */
  acceptedResults: readonly WidgetResultShape[];
  supportsComparison: boolean;
  supportsMultipleSeries: boolean;
  supportsFacets: boolean;
  layout: WidgetLayoutPolicy;
  renderers: Readonly<Record<"web" | "mobile", WidgetRendererSupport>>;
  /**
   * What to draw instead on a platform that has no renderer for this recipe.
   *
   * Deliberately *not* `compactFallback`, which answers a different question. The
   * width chain runs from the elaborate to the compact — a histogram falls back to
   * a strip — and following it here would send a strip on a phone back to the
   * histogram it is the fallback *for*. One chain answering two questions is one
   * chain that is wrong about one of them.
   */
  platformFallback?: WidgetChartRecipe;
  surfaces: readonly WidgetSurface[];
}

const ALL_SURFACES: readonly WidgetSurface[] = [
  "overview",
  "subject",
  "grade",
  "insights",
];

/** A single reading: one series at every width, and no legend anywhere. */
const SINGLE: WidgetSeriesBudget = {
  micro: 1,
  compact: 1,
  standard: 1,
  wide: 1,
  hero: 1,
};

/** A chart that splits: one line on a phone, everything on a wide card. */
const SPLIT: WidgetSeriesBudget = {
  micro: 1,
  compact: 2,
  standard: 4,
  wide: WIDGET_LIMITS.series,
  hero: WIDGET_LIMITS.series,
};

function policy(
  minColumns: WidgetLayoutPolicy["minColumns"],
  preferredColumns: WidgetLayoutPolicy["preferredColumns"],
  minHeightTier: WidgetHeightTier,
  rest: Partial<
    Omit<
      WidgetLayoutPolicy,
      "minColumns" | "preferredColumns" | "minHeightTier"
    >
  > = {},
): WidgetLayoutPolicy {
  return {
    minColumns,
    preferredColumns,
    minHeightTier,
    maxSeriesByProfile: rest.maxSeriesByProfile ?? SINGLE,
    legend: rest.legend ?? "never",
    ...(rest.preferredAspectRatio === undefined
      ? {}
      : { preferredAspectRatio: rest.preferredAspectRatio }),
    ...(rest.compactFallback === undefined
      ? {}
      : { compactFallback: rest.compactFallback }),
  };
}

/**
 * Fits anywhere: one column on every grid.
 *
 * Reserved for readings and for the recipes built as narrow fallbacks. The
 * eleven recipes that existed before this table keep `HALF` — the floor the old
 * `minColumns` gave everything that was not a value or a gauge — so introducing
 * the policy changes no card's width. Relaxing one of them is a product decision
 * with its own evidence, not a side effect of moving the rule.
 */
const ANY_WIDTH = { 1: 1, 2: 1, 3: 1, 4: 1 } as const;
/** Wants half a wide grid, and all of a narrow one. */
const HALF = { 1: 1, 2: 2, 3: 2, 4: 2 } as const;
/** Wants three quarters: a shape that cannot be read in a sliver. */
const MOST = { 1: 1, 2: 2, 3: 3, 4: 3 } as const;
/** Wants the whole row. */
const FULL = { 1: 1, 2: 2, 3: 3, 4: 4 } as const;

function descriptor(
  id: WidgetChartRecipe,
  acceptedResults: readonly WidgetResultShape[],
  layout: WidgetLayoutPolicy,
  rest: Partial<
    Pick<
      WidgetRecipeDescriptor,
      | "supportsComparison"
      | "supportsMultipleSeries"
      | "supportsFacets"
      | "renderers"
      | "platformFallback"
      | "surfaces"
    >
  > = {},
): WidgetRecipeDescriptor {
  return {
    id,
    labelKey: `widget.recipe.${id}`,
    acceptedResults,
    supportsComparison: rest.supportsComparison ?? true,
    supportsMultipleSeries: rest.supportsMultipleSeries ?? false,
    supportsFacets: rest.supportsFacets ?? false,
    layout,
    renderers: rest.renderers ?? { web: "native", mobile: "native" },
    ...(rest.platformFallback === undefined
      ? {}
      : { platformFallback: rest.platformFallback }),
    surfaces: rest.surfaces ?? ALL_SURFACES,
  };
}

const NOT_BUILT: Readonly<Record<"web" | "mobile", WidgetRendererSupport>> =
  Object.freeze({ web: "unsupported", mobile: "unsupported" });

/**
 * Every recipe, with its policy and its honest availability.
 *
 * The `unsupported` entries are deliberate and not aspirational clutter: the
 * compiler reads them, so a card can never be saved against a recipe this build
 * cannot draw. That is the difference between a roadmap and a silent blank card,
 * and it is why the registry is the first thing built rather than the last.
 */
const descriptors = [
  descriptor(
    "value",
    ["scalar", "record", "streak"],
    policy(ANY_WIDTH, 1, "short"),
  ),
  descriptor("gauge", ["scalar", "goal"], policy(ANY_WIDTH, 1, "short")),
  // Drawn today, and that is why it is `native` rather than pending: a gauge
  // carrying thresholds already renders as a value, a filled track and the
  // threshold's own label. Declaring it unsupported would have made the compiler
  // refuse cards that work. What a dedicated renderer adds later is the target
  // marker and the qualitative bands behind the bar.
  descriptor(
    "bullet",
    ["scalar", "goal"],
    policy(ANY_WIDTH, 1, "short", { legend: "inline" }),
  ),

  // `short`, not `regular`, and the difference is 56px on every average card on the
  // dashboard. A sparkline is a reading with scenery under it: the number takes about forty
  // pixels, the curve insists on fifty-six, and the fill runs to the card's bottom edge.
  // That is a hundred and twelve — measured, not assumed. Asking for a regular body made
  // every one of them taller than it had been before the tiers existed, which is a change
  // to the dashboard nobody asked for.
  descriptor(
    "sparkline",
    ["temporal-series"],
    policy(HALF, 2, "short", { maxSeriesByProfile: SINGLE }),
  ),
  descriptor(
    "line",
    // Friend curves are already an interval-series (two named paths on one time axis),
    // and the line renderer is their native consumer.
    ["temporal-series", "categorical-series", "interval-series"],
    policy(HALF, 2, "chart", {
      maxSeriesByProfile: SPLIT,
      legend: "wide-only",
      compactFallback: "sparkline",
    }),
    { supportsMultipleSeries: true, supportsFacets: true },
  ),
  descriptor(
    "area",
    ["temporal-series"],
    policy(HALF, 2, "chart", {
      maxSeriesByProfile: SPLIT,
      legend: "wide-only",
      compactFallback: "sparkline",
    }),
    { supportsMultipleSeries: true, supportsFacets: true },
  ),
  descriptor(
    "bar",
    ["temporal-series", "categorical-series", "distribution"],
    policy(HALF, 2, "chart", {
      maxSeriesByProfile: SPLIT,
      legend: "wide-only",
      compactFallback: "lollipop",
    }),
    { supportsMultipleSeries: true, supportsFacets: true },
  ),
  descriptor(
    "dot",
    ["temporal-series", "categorical-series"],
    policy(HALF, 2, "chart", {
      maxSeriesByProfile: SPLIT,
      legend: "wide-only",
      compactFallback: "lollipop",
    }),
    { supportsMultipleSeries: true, supportsFacets: true },
  ),
  descriptor(
    "regression",
    ["temporal-series"],
    policy(HALF, 3, "chart", { legend: "wide-only", compactFallback: "line" }),
    {
      renderers: { web: "native", mobile: "unsupported" },
      // Narrow, the band closes to a stroke and the reading under it wraps to three lines:
      // a line chart is the honest small version, and the trend is still visible in it.
      platformFallback: "line",
    },
  ),
  // The ground between two readings needs width to *be* ground: below half a grid the fill is
  // a hairline and the pair reads as one wobbly line, so the fallback is the delta as a
  // number — which is the same comparison, said instead of drawn.
  /**
   * Two measures against each other, one point per group.
   *
   * The chart the audit's "cohérence contre progression" quadrant needs, and the one no
   * single-measure document could describe at any width: both axes are readings, and the
   * *dimension* is which point is which. Square, because a quadrant read on a wide flat
   * box exaggerates one axis over the other, and needs room for its labels — narrow, it
   * becomes a ranking of the vertical measure, which is the honest small version.
   */
  descriptor(
    "scatter",
    ["categorical-series"],
    policy(MOST, 3, "analytical", {
      preferredAspectRatio: 1,
      compactFallback: "bar",
    }),
    {
      supportsMultipleSeries: true,
      renderers: { web: "native", mobile: "unsupported" },
      platformFallback: "bar",
    },
  ),
  descriptor(
    "difference-area",
    ["temporal-series"],
    policy(HALF, 3, "chart", { legend: "inline", compactFallback: "line" }),
    {
      supportsMultipleSeries: true,
      renderers: { web: "native", mobile: "unsupported" },
      platformFallback: "line",
    },
  ),
  /**
   * The run of marks against the spread it has been running at.
   *
   * Needs width for the same reason a strip does — every mark is a point on the x axis —
   * and falls back to the reading rather than to a projection band, which is a different
   * claim entirely.
   */
  descriptor(
    "control-chart",
    ["interval-series"],
    policy(HALF, 3, "chart", { legend: "never", compactFallback: "line" }),
    {
      renderers: { web: "native", mobile: "unsupported" },
      // A line keeps the observations and their centre on the same time axis. Falling
      // to a value here used to hand an interval result to a scalar renderer: the value
      // projection only exists when `value` is the *stored* recipe and the evaluator can
      // perform it before rendering.
      platformFallback: "line",
    },
  ),
  descriptor(
    "projection-band",
    // Its own result shape: a low, a middle and a high at every step, plus the kind of
    // interval it is. On a narrow card the reading is the middle and the range in
    // words — a two-pixel band says nothing. A line still consumes the interval result;
    // a value would require an evaluator projection that cannot happen after rendering.
    ["interval-series"],
    policy(HALF, 3, "chart", { legend: "inline", compactFallback: "line" }),
    {
      renderers: { web: "native", mobile: "unsupported" },
      platformFallback: "line",
    },
  ),

  descriptor(
    "ranking",
    ["categorical-series"],
    policy(HALF, 2, "regular", { legend: "never" }),
  ),
  // Drawn on web as a stem and a head; mobile falls through to its bar chart,
  // which is readable but not this shape.
  descriptor(
    "lollipop",
    ["categorical-series"],
    policy(ANY_WIDTH, 2, "regular", { legend: "never" }),
    { renderers: { web: "native", mobile: "fallback" } },
  ),
  // Drawn on web as a tail, a shaft and a head per row; mobile falls through to
  // its bar chart.
  descriptor(
    "slope-arrow",
    ["categorical-series"],
    policy(ANY_WIDTH, 2, "regular", { legend: "inline" }),
    { renderers: { web: "native", mobile: "fallback" } },
  ),
  // Two ends per row, so it needs the width a pair of numbers takes; below that the
  // lollipop shows where each subject stands now, which is the half of the reading
  // that still fits.
  descriptor(
    "dumbbell",
    ["categorical-series"],
    policy(HALF, 2, "regular", {
      legend: "inline",
      compactFallback: "lollipop",
    }),
    { renderers: { web: "native", mobile: "fallback" } },
  ),
  // Its own result shape, because the steps are chained rather than independent. Not
  // drawn on the phone yet; there a lollipop of the same contributions keeps the
  // sizes and loses the accumulation.
  descriptor(
    "waterfall",
    ["waterfall"],
    // A stored lollipop can ask the evaluator to project contribution steps into a flat
    // frame. A renderer-time fallback cannot: it already holds a waterfall result. Until
    // result transformations are part of the render contract, preserving the recipe is
    // the only shape-safe narrow behaviour.
    policy(HALF, 3, "chart", { legend: "inline" }),
    {
      renderers: { web: "native", mobile: "unsupported" },
    },
  ),

  descriptor(
    "histogram",
    ["distribution"],
    policy(HALF, 2, "regular", { compactFallback: "strip" }),
  ),
  // Built on the web, not on the phone. A platform without it draws the same
  // distribution as a histogram — the shape a strip is honest about on few marks,
  // but the same reading — rather than drawing nothing.
  descriptor("strip", ["distribution"], policy(ANY_WIDTH, 1, "short"), {
    renderers: { web: "native", mobile: "unsupported" },
    platformFallback: "histogram",
  }),
  descriptor("boxplot", ["distribution"], policy(HALF, 2, "regular")),
  // A shape needs room to have one: below half a grid the outline is a sliver and the box
  // plot says the same five numbers legibly, which is why it is the fallback rather than a
  // narrower violin.
  descriptor(
    "violin",
    ["distribution"],
    policy(HALF, 3, "chart", { compactFallback: "boxplot" }),
    {
      renderers: { web: "native", mobile: "unsupported" },
      platformFallback: "boxplot",
    },
  ),
  // Rows down one axis, so it needs both the width for the axis and the height for the rows:
  // the audit puts it at three or four columns and forbids it below. A narrow card gets the
  // box plots, which say the same five numbers per group without the shapes.
  descriptor(
    "ridgeline",
    ["distribution"],
    policy(MOST, 4, "analytical", { compactFallback: "boxplot" }),
    {
      renderers: { web: "native", mobile: "unsupported" },
      platformFallback: "boxplot",
    },
  ),
  // Drawn on web as a counted grid of cells; mobile falls through to its
  // histogram.
  descriptor(
    "waffle",
    ["distribution", "categorical-series"],
    policy(ANY_WIDTH, 1, "regular", { legend: "inline" }),
    { renderers: { web: "native", mobile: "fallback" } },
  ),

  descriptor(
    "heatmap",
    ["temporal-series", "categorical-series"],
    policy(HALF, 2, "regular", { legend: "wide-only" }),
  ),
  // Web draws it: a day-grained heatmap lays weeks across and weekdays down, the
  // shape every contribution graph uses. Mobile still draws the flat matrix, so
  // it is `fallback` — the card is readable there, just not as a calendar.
  descriptor(
    "calendar",
    ["temporal-series"],
    policy(HALF, 3, "regular", {
      legend: "wide-only",
      compactFallback: "heatmap",
    }),
    { renderers: { web: "native", mobile: "fallback" } },
  ),
  descriptor(
    "treemap",
    ["hierarchy"],
    // Squarified area needs both dimensions, so it asks for the height a chart gets
    // and reads best near square. Below half a grid a ranking of the same weights
    // is the reading that survives — the branch is lost, the shares are not.
    policy(HALF, 3, "chart", {
      preferredAspectRatio: 1,
    }),
    {
      renderers: { web: "native", mobile: "unsupported" },
    },
  ),
  descriptor(
    "sunburst",
    ["hierarchy"],
    policy(MOST, 4, "analytical", {
      preferredAspectRatio: 1,
      compactFallback: "treemap",
    }),
    {
      renderers: { web: "native", mobile: "unsupported" },
      // Rings need a square; a treemap fills whatever box it is given, which is why it is
      // both the narrow fallback and the phone's.
      platformFallback: "treemap",
    },
  ),
  // Square, because the ring is bound by the shorter side of its box: a wide, flat radar is
  // a small ring with empty margins either side of it. Narrow, it becomes a lollipop — the
  // same readings on an axis a reader can still walk.
  descriptor(
    "radar",
    ["categorical-series"],
    policy(MOST, 3, "analytical", {
      preferredAspectRatio: 1,
      compactFallback: "lollipop",
    }),
    {
      renderers: { web: "native", mobile: "unsupported" },
      platformFallback: "lollipop",
    },
  ),

  descriptor(
    "table",
    ["temporal-series", "categorical-series", "records"],
    policy(HALF, 3, "regular", { legend: "never" }),
  ),
  descriptor(
    "list",
    ["temporal-series", "categorical-series", "records"],
    policy(HALF, 2, "regular", { legend: "never" }),
  ),
  // A grid of small charts needs the whole row: four panels in a quarter-width card are
  // four charts nobody can read. Below that the fallback draws the same data as one chart
  // with every series on it — busier, and still true.
  descriptor(
    "facets",
    ["temporal-series", "categorical-series", "distribution"],
    policy(FULL, 4, "analytical", {
      maxSeriesByProfile: SPLIT,
      compactFallback: "line",
    }),
    {
      supportsFacets: true,
      supportsMultipleSeries: true,
      renderers: { web: "native", mobile: "unsupported" },
      platformFallback: "line",
    },
  ),
] satisfies WidgetRecipeDescriptor[];

export const WIDGET_RECIPE_DESCRIPTORS: ReadonlyMap<
  WidgetChartRecipe,
  WidgetRecipeDescriptor
> = new Map(descriptors.map((entry) => [entry.id, entry]));

if (WIDGET_RECIPE_DESCRIPTORS.size !== WIDGET_RECIPES.length) {
  throw new Error("Every widget recipe must have exactly one descriptor");
}

export function widgetRecipeDescriptor(
  recipe: WidgetChartRecipe,
): WidgetRecipeDescriptor {
  const descriptor = WIDGET_RECIPE_DESCRIPTORS.get(recipe);
  if (!descriptor) throw new Error(`Unknown widget recipe: ${recipe}`);
  return descriptor;
}

export function widgetRecipeLayout(
  recipe: WidgetChartRecipe,
): WidgetLayoutPolicy {
  return widgetRecipeDescriptor(recipe).layout;
}

/**
 * The base mark a renderer draws this recipe with, or `null` when it needs one no
 * renderer has as a primitive.
 *
 * The one direction that remains. The document stores the *recipe* — a product decision
 * — and a renderer asks this for the shape to draw; the reverse derivation, guessing a
 * recipe from a stored mark, is gone with the mark. Several recipes share a mark on
 * purpose: a sparkline and a study are both lines, and what separates them is the
 * apparatus around them.
 */
export function widgetMarkForRecipe(
  recipe: WidgetChartRecipe,
): WidgetChartMark | null {
  switch (recipe) {
    case "value":
      return "value";
    case "gauge":
    case "bullet":
      return "gauge";
    case "sparkline":
    case "line":
      return "line";
    case "area":
      return "area";
    case "bar":
      return "bar";
    case "dot":
      return "dot";
    case "histogram":
      return "histogram";
    case "boxplot":
      return "boxplot";
    case "heatmap":
    case "calendar":
      return "heatmap";
    case "table":
      return "table";
    case "ranking":
    case "list":
      return "list";
    case "lollipop":
      return "lollipop";
    case "waffle":
      return "waffle";
    case "slope-arrow":
      return "slope-arrow";
    case "strip":
      return "strip";
    case "dumbbell":
      return "dumbbell";
    case "treemap":
      return "treemap";
    case "waterfall":
      return "waterfall";
    case "projection-band":
      return "band";
    case "control-chart":
      return "control";
    case "facets":
      return "facets";
    case "violin":
      return "violin";
    case "ridgeline":
      return "ridgeline";
    case "difference-area":
      return "difference-area";
    case "scatter":
      return "scatter";
    case "radar":
      return "radar";
    case "regression":
      return "regression";
    case "sunburst":
      return "sunburst";
    default:
      // Everything else needs a mark this build cannot draw. The descriptor's
      // `renderers` already says so, so this returning null is not a surprise
      // discovered at render time.
      return null;
  }
}

/**
 * The mark a definition is drawn with.
 *
 * One call, so no renderer re-derives it and none of them disagree. A recipe with no mark
 * cannot be selected, so the fallback here is unreachable rather than a default.
 */
export function widgetDefinitionMark(
  definition: Pick<WidgetDefinition, "visualization">,
): WidgetChartMark {
  return widgetMarkForRecipe(definition.visualization.recipe) ?? "value";
}

/** True when this build can actually draw the recipe on that platform. */
export function widgetRecipeAvailable(
  recipe: WidgetChartRecipe,
  platform: "web" | "mobile",
): boolean {
  return widgetRecipeDescriptor(recipe).renderers[platform] !== "unsupported";
}

/**
 * The recipe this platform will actually draw, given the one that was asked for.
 *
 * The audit's rule, in one function: *the choice of renderer follows the
 * capabilities that are really supported.* Three ways a card can ask for
 * something a platform cannot draw, and all three end here rather than in a
 * renderer's `default:` branch:
 *
 * - the recipe has no renderer on this platform at all (`unsupported`)
 * - it has one, but only a generic one (`fallback`) — a treemap drawn as a
 *   ranking is still the same reading, and better than nothing
 * - the card is narrower than the recipe's policy allows, which
 *   `widgetRecipeAtWidth` already answers
 *
 * Follows `compactFallback` in every case, because a recipe's declared fallback
 * is *the* answer to "what else says this" — a violin falls to a box plot, a
 * treemap to a ranking — and reusing it here keeps one chain instead of two that
 * can disagree. Bounded by the number of recipes, so a cycle cannot hang a render,
 * and it returns the last recipe reached rather than throwing: a card that draws
 * the wrong shape is a bug worth seeing, a card that crashes the dashboard is not.
 *
 * `native` on the way in means this returns what it was given, which is the case
 * every existing card takes.
 */
export function widgetRecipeForPlatform(
  recipe: WidgetChartRecipe,
  platform: "web" | "mobile",
  resultShape: WidgetResultShape,
  options: { allowGeneric?: boolean } = {},
): WidgetChartRecipe {
  const acceptable = options.allowGeneric ?? true;
  let current = recipe;
  for (let step = 0; step < WIDGET_RECIPES.length; step += 1) {
    const descriptor = widgetRecipeDescriptor(current);
    // The stored recipe is checked by the compiler. Keeping the guard here makes the
    // renderer boundary self-defending when called with hand-written data: resolution
    // may never walk *from* a recipe that cannot consume the result it was handed.
    if (!descriptor.acceptedResults.includes(resultShape)) return recipe;
    const support = descriptor.renderers[platform];
    if (support === "native") return current;
    if (support === "fallback" && acceptable) return current;
    // The platform's own fallback first, because it answers exactly this
    // question; the width chain only stands in when a recipe names no other.
    const fallback =
      descriptor.platformFallback ?? descriptor.layout.compactFallback;
    if (!fallback || fallback === current) return current;
    // A fallback substitutes presentation, not data. It receives the exact result the
    // stored recipe was evaluated into, so following an incompatible target would be a
    // renderer type error disguised as graceful degradation.
    if (
      !widgetRecipeDescriptor(fallback).acceptedResults.includes(resultShape)
    ) {
      return current;
    }
    current = fallback;
  }
  return current;
}

/**
 * The visualization a platform should actually draw, for the definition it was given.
 *
 * The one call a renderer needs to make: it resolves the stored recipe against what this
 * platform can draw. Identity — the same object, not a copy — whenever the recipe is
 * drawable, which is every card that can be saved today; a renderer adopts this without
 * changing a single card's appearance.
 *
 * Only the *recipe* is substituted. The renderer then asks `widgetMarkForRecipe` for the
 * shape, so a degraded card is drawn as the fallback recipe rather than as a mark
 * borrowed from it — which is what keeps a sparkline from becoming a full line chart on
 * its way through here.
 */
export function widgetVisualizationForPlatform(
  definition: Pick<WidgetDefinition, "visualization" | "analysis">,
  platform: "web" | "mobile",
  resultShape: WidgetResultShape,
): WidgetVisualization {
  const asked = definition.visualization.recipe;
  const drawable = widgetRecipeForPlatform(asked, platform, resultShape);
  return drawable === asked
    ? definition.visualization
    : { ...definition.visualization, recipe: drawable };
}

/**
 * Series worth drawing at a measured width.
 *
 * Presentation only: the renderer folds the rest into "and N more" or a
 * selection. Nothing here may reach the packer, or a resize would repack the
 * grid and a card would change columns because a window moved.
 */
export function widgetSeriesBudget(
  recipe: WidgetChartRecipe,
  profile: WidgetContainerProfile,
): number {
  return widgetRecipeDescriptor(recipe).layout.maxSeriesByProfile[profile];
}

/**
 * The recipe to draw when the card is narrower than the policy wants.
 *
 * Follows the chain — a violin falls back to a box plot, a box plot fits
 * anywhere — and stops at the first recipe that fits, or at the last one that
 * has no fallback of its own. Bounded by the number of recipes, so a cycle in
 * the table cannot hang a render.
 */
export function widgetRecipeAtWidth(
  recipe: WidgetChartRecipe,
  columns: 1 | 2 | 3 | 4,
  gridColumns: 1 | 2 | 3 | 4,
  resultShape: WidgetResultShape,
): WidgetChartRecipe {
  let current = recipe;
  for (let step = 0; step < WIDGET_RECIPES.length; step += 1) {
    const layout = widgetRecipeLayout(current);
    if (columns >= layout.minColumns[gridColumns]) return current;
    const fallback = layout.compactFallback;
    if (!fallback || fallback === current) return current;
    if (
      !widgetRecipeDescriptor(fallback).acceptedResults.includes(resultShape)
    ) {
      return current;
    }
    current = fallback;
  }
  return current;
}
