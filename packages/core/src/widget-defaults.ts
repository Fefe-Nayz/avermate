import type { CardDisplay } from "./cards";
import { widgetMarkForRecipe, type WidgetChartRecipe } from "./widget-recipes";
import { widgetCapability, widgetCompatibleRecipes } from "./widget-registry";
import {
  widgetPrimaryMeasure,
  WIDGET_DEFINITION_VERSION,
  WIDGET_GAUGE_THICKNESS,
} from "./widget-types";
import type {
  WidgetChartMark,
  WidgetDefinition,
  WidgetDimension,
  CardSemantics,
  WidgetMarkOptions,
  WidgetPreset,
  WidgetSurface,
  WidgetVisualization,
} from "./widget-types";

/** A mark's own option defaults, which the parser needs without a visualization. */
export function defaultMarkOptions(mark: WidgetChartMark): WidgetMarkOptions {
  switch (mark) {
    case "value":
      return { kind: "value", showDelta: true, trendIndicator: true };
    case "gauge":
      // Not a number: the default gauge is the responsive hairline, and saying
      // so is the whole point of the discriminant.
      return { kind: "gauge", showValue: true, thickness: "auto" };
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
    case "lollipop":
      return { kind: "lollipop", orientation: "horizontal", size: 8 };
    case "waffle":
      // Twenty, because a mark out of twenty is what this app measures.
      return { kind: "waffle", cells: 20 };
    case "slope-arrow":
      return { kind: "slope-arrow", showLabels: true };
    case "violin":
      // The box inside the shape: the outline says where the mass is, the box says where the
      // middle half is, and a reader wants both.
      return { kind: "violin", showBox: true, half: false };
    case "sunburst":
      // Two levels and a hair of space between the rings: the same depth the treemap
      // defaults to, because it is the depth this app's trees actually have.
      return { kind: "sunburst", depth: 2, ringPadding: 1 };
    case "regression":
      return {
        kind: "regression",
        showBand: true,
        showPoints: true,
        showReading: true,
      };
    case "radar":
      return { kind: "radar", fill: true, showPoints: true };
    case "control":
      return { kind: "control", showPoints: true, deviations: 2 };
    case "scatter":
      return { kind: "scatter", quadrants: true, showLabels: true, size: 8 };
    case "difference-area":
      // The lines over the fill: the fill is the reading, and the lines are what it is
      // between.
      return { kind: "difference-area", showLines: true, opacity: 0.22 };
    case "ridgeline":
      // A third of a row's height: enough overlap to read a shift, little enough that a row
      // still has its own baseline.
      return { kind: "ridgeline", overlap: 0.35 };
    case "facets":
      // A line per panel, two across: the shape a small multiple is usually a multiple
      // *of*, and the width a card has room for before the panels stop being readable.
      return {
        kind: "facets",
        inner: "line",
        columns: 2,
        sharedScale: true,
      };
    case "band":
      // Faint, because the middle is the reading and the band is its context.
      return { kind: "band", opacity: 0.18, showCenter: true };
    case "waterfall":
      // Five named causes and the rest folded: enough to act on, few enough to read.
      return { kind: "waterfall", steps: 5, showTotals: true };
    case "treemap":
      // A category and its subjects: the hierarchy this app actually has.
      return { kind: "treemap", depth: 2, showLabels: true };
    case "dumbbell":
      // Unlabelled by default: the pair is the reading, and two numbers per row
      // needs a wide card to stay legible.
      return { kind: "dumbbell", size: 10, showLabels: false };
    case "strip":
      // Ten pixels reads as a tick at every card width, and the median is what
      // turns a row of ticks into a reading.
      return { kind: "strip", tick: 10, showMedian: true };
  }
}

/**
 * A visualization for a recipe, with its channels pointed at the usual suspects.
 *
 * Takes the recipe now, not the mark: the recipe is what the document stores, and the
 * mark is derived from it for the option defaults. A recipe with no mark of its own gets
 * the neutral value options — nothing can select it yet, and a default that throws is
 * worse than a default that is ignored.
 *
 * `dimensionId` and `measureId` are the ids the channels point at, so a caller that
 * names its measure something other than the default gets an encoding that resolves.
 */
export function createWidgetVisualization(
  recipe: WidgetChartRecipe,
  ids: { dimensionId?: string; measureId?: string } = {},
): WidgetVisualization {
  const mark = widgetMarkForRecipe(recipe) ?? "value";
  const isSeries = ["line", "area", "bar", "dot"].includes(mark);
  const dimensionId = ids.dimensionId ?? WIDGET_DEFAULT_DIMENSION_ID;
  const measureId = ids.measureId ?? WIDGET_DEFAULT_MEASURE_ID;
  return {
    recipe,
    encoding: {
      x: isSeries ? { field: dimensionId, type: "temporal" } : null,
      y: isSeries ? { field: measureId, type: "quantitative" } : null,
      color: null,
      series: null,
      facet: null,
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

/**
 * The id a definition's single dimension carries unless it is named otherwise.
 *
 * Ids exist because a channel points at one, and a document with two dimensions needs to
 * tell them apart. A default keeps the common case — one dimension — readable in stored
 * JSON and in a test fixture.
 */
export const WIDGET_DEFAULT_DIMENSION_ID = "group";
export const WIDGET_DEFAULT_MEASURE_ID = "measure";

export function createWidgetDefinition(
  surface: WidgetSurface = "overview",
): WidgetDefinition {
  const recipe: WidgetChartRecipe = surface === "insights" ? "line" : "value";
  return {
    apiVersion: WIDGET_DEFINITION_VERSION,
    query: {
      source: "grades",
      scope: { kind: "general" },
      window: { kind: "active-period" },
      filters: [],
    },
    analysis: {
      measures: [
        {
          id: WIDGET_DEFAULT_MEASURE_ID,
          label: null,
          expression: { kind: "metric", metric: "average", goalId: null },
        },
      ],
      dimensions:
        surface === "insights"
          ? [
              {
                id: WIDGET_DEFAULT_DIMENSION_ID,
                kind: "time",
                grain: "week",
                accumulation: "running",
                fill: "observed",
              },
            ]
          : [],
      comparison: { kind: "none" },
      transforms: [],
    },
    visualization: createWidgetVisualization(recipe),
    presentation: {
      // A card on a dashboard, adapting to the width it is given: what every card was
      // before the choice existed, said out loud so a card can now choose otherwise.
      mode: surface === "insights" ? "analytical" : "dashboard",
      responsiveBehavior: "adapt",
    },
  };
}

/**
 * The legacy four-way display, as a recipe.
 *
 * `display` was a projection of the old mark and is the shape the dashboard's own card
 * rows still carry. It maps onto recipes directly now — which is the point: a sparkline
 * *is* its own recipe rather than "an area chart with the axes turned off and everyone
 * remembering why".
 */
function displayToRecipe(input: CardSemantics): WidgetChartRecipe {
  if (input.display === "value") return "value";
  if (input.display === "gauge") return "gauge";
  if (input.display === "list") return "list";
  if (input.metric === "distribution") return "histogram";
  if (input.display === "sparkline") return "sparkline";
  return input.display === "chart" ? "line" : "value";
}

/**
 * Strips a line of its apparatus, which is the whole difference between a
 * sparkline and a small chart.
 *
 * `sparkline` and `chart` used to compile to the same thing — a `line` with axes
 * and a y-grid — and the renderer drew them the same way: a study squeezed into a
 * 170px box, with no reading above it, where a card had shown "13.86 / 20" and a
 * curve. There is no new mark for this, because there was never a new *drawing*:
 * the axes are already in the model, and turning them off is the request.
 */
function stripAxes(visualization: WidgetVisualization): WidgetVisualization {
  return {
    ...visualization,
    axes: {
      x: { visible: false, grid: false, label: null },
      y: { visible: false, grid: false, label: null },
    },
  };
}

export function widgetDefinitionFromCard(
  input: CardSemantics,
): WidgetDefinition {
  const asked = displayToRecipe(input);
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
  const chartLike =
    asked === "line" || asked === "area" || asked === "sparkline";
  const dimensions: WidgetDimension[] =
    capability.groupings.includes("subject") &&
    ["subjectRanking", "mostImproved", "steadiest"].includes(input.metric)
      ? [
          {
            id: WIDGET_DEFAULT_DIMENSION_ID,
            kind: "subject",
            level: "all",
            includeCategories: false,
            limit: 10,
          },
        ]
      : chartLike && capability.groupings.includes("time")
        ? [
            {
              id: WIDGET_DEFAULT_DIMENSION_ID,
              kind: "time",
              grain: "week",
              accumulation: "running",
              fill: "observed",
            },
          ]
        : [];
  const compatible = widgetCompatibleRecipes(
    { kind: "metric", metric: input.metric },
    dimensions,
  );
  const recipe = compatible.includes(asked)
    ? asked
    : (compatible[0] ?? "value");
  const visualization = createWidgetVisualization(recipe);
  return {
    apiVersion: WIDGET_DEFINITION_VERSION,
    query: {
      source: "grades",
      scope,
      window: { kind: "active-period" },
      filters: [],
    },
    analysis: {
      measures: [
        {
          id: WIDGET_DEFAULT_MEASURE_ID,
          label: null,
          expression: {
            kind: "metric",
            metric: input.metric,
            goalId: input.goalId,
          },
        },
      ],
      dimensions,
      comparison: { kind: "none" },
      transforms: [],
    },
    // A sparkline *is* a line with its apparatus off, and the recipe says so — so the
    // axes come off here rather than the recipe being something else.
    visualization:
      recipe === "sparkline" ? stripAxes(visualization) : visualization,
    presentation: { mode: "dashboard", responsiveBehavior: "adapt" },
  };
}

function recipeToDisplay(recipe: WidgetChartRecipe): CardDisplay {
  const mark = widgetMarkForRecipe(recipe) ?? "value";
  if (recipe === "sparkline") return "sparkline";
  if (mark === "value") return "value";
  if (mark === "gauge") return "gauge";
  if (mark === "list" || mark === "table") return "list";
  // A lollipop and a slope arrow are rankings read as lists elsewhere in the
  // app; a waffle is a drawing. `display` is only the legacy projection now —
  // layout reads the recipe — so this needs to be reasonable, not precise.
  if (mark === "lollipop" || mark === "slope-arrow") return "list";
  return "chart";
}

export function cardSemanticsFromDefinition(
  definition: WidgetDefinition,
): CardSemantics {
  // The first measure: `CardSemantics` is the dashboard's one-reading shape, and a
  // definition with several has no single metric to report. `widgetPrimaryMeasure` is
  // the documented seam for that narrowing.
  const measure = widgetPrimaryMeasure(definition.analysis);
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
    display: recipeToDisplay(definition.visualization.recipe),
  };
}

function preset(
  key: string,
  metric: CardSemantics["metric"],
  recipe: WidgetChartRecipe,
  span: 1 | 2 | 3 | 4,
): WidgetPreset {
  const definition = widgetDefinitionFromCard({
    metric,
    targetKind: "general",
    targetId: null,
    goalId: null,
    display: recipeToDisplay(recipe),
  });
  const compatible = widgetCompatibleRecipes(
    widgetPrimaryMeasure(definition.analysis),
    definition.analysis.dimensions,
  );
  definition.visualization = createWidgetVisualization(
    compatible.includes(recipe) ? recipe : (compatible[0] ?? "value"),
  );
  const dimension = definition.analysis.dimensions[0];
  if (dimension?.kind === "subject") {
    definition.visualization.encoding.x = {
      field: dimension.id,
      type: "nominal",
    };
    definition.visualization.encoding.y = {
      field: WIDGET_DEFAULT_MEASURE_ID,
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
