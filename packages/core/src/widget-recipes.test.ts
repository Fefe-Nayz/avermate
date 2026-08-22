import { describe, expect, test } from "bun:test";
import { cardColumns } from "./cards";
import {
  WIDGET_CONTAINER_PROFILES,
  WIDGET_HEIGHT_TIERS,
  WIDGET_HEIGHT_TIER_PIXELS,
  WIDGET_RECIPES,
  widgetContainerProfile,
  widgetMarkForRecipe,
  widgetRecipeAtWidth,
  widgetRecipeAvailable,
  widgetRecipeDescriptor,
  widgetRecipeForPlatform,
  widgetRecipeLayout,
  widgetSeriesBudget,
  widgetVisualizationForPlatform,
  type WidgetChartRecipe,
} from "./widget-recipes";
import { widgetRecipeSelectable } from "./widget-registry";
import {
  createWidgetDefinition,
  createWidgetVisualization,
} from "./widget-defaults";
import { compileWidgetDefinition } from "./widget-definition";
import type { WidgetChartMark, WidgetDefinition } from "./widget-types";

const GRIDS = [1, 2, 3, 4] as const;

function definition(
  recipe: WidgetChartRecipe,
  overrides: {
    axes?: boolean;
    dimensions?: WidgetDefinition["analysis"]["dimensions"];
    thresholds?: number;
  } = {},
): Pick<WidgetDefinition, "visualization" | "analysis"> {
  const visualization = createWidgetVisualization(recipe);
  return {
    visualization: {
      ...visualization,
      axes:
        overrides.axes === false
          ? {
              x: { visible: false, grid: false, label: null },
              y: { visible: false, grid: false, label: null },
            }
          : visualization.axes,
      thresholds: Array.from({ length: overrides.thresholds ?? 0 }, (_, i) => ({
        value: i / 4,
        color: null,
        label: null,
      })),
    },
    analysis: {
      measures: [
        {
          id: "measure",
          label: null,
          expression: { kind: "metric", metric: "average", goalId: null },
        },
      ],
      dimensions: overrides.dimensions ?? [],
      comparison: { kind: "none" },
      transforms: [],
    },
  };
}

/**
 * The layout policy is handed to the packer and to drag-and-drop, and both are
 * only correct while it is total, pure and bounded. These are the invariants the
 * old four-way `display` switch satisfied by accident of being tiny; a table of
 * thirty recipes needs them checked.
 */
describe("widget recipes", () => {
  test("every recipe has a descriptor, and every descriptor a recipe", () => {
    for (const recipe of WIDGET_RECIPES) {
      expect(widgetRecipeDescriptor(recipe).id).toBe(recipe);
    }
    expect(new Set(WIDGET_RECIPES).size).toBe(WIDGET_RECIPES.length);
  });

  test("a floor is never wider than the grid it is asked about", () => {
    for (const recipe of WIDGET_RECIPES) {
      const { minColumns, preferredColumns } = widgetRecipeLayout(recipe);
      for (const grid of GRIDS) {
        const floor = minColumns[grid];
        expect(floor, `${recipe} on ${grid}`).toBeGreaterThanOrEqual(1);
        expect(floor, `${recipe} on ${grid}`).toBeLessThanOrEqual(grid);
      }
      // A floor may not exceed what the recipe would ask for unprompted.
      expect(minColumns[4], recipe).toBeLessThanOrEqual(preferredColumns);
      // Wider grids never ask for less room than narrower ones.
      expect(minColumns[1]).toBeLessThanOrEqual(minColumns[2]);
      expect(minColumns[2]).toBeLessThanOrEqual(minColumns[3]);
      expect(minColumns[3]).toBeLessThanOrEqual(minColumns[4]);
    }
  });

  test("the width a card draws at stays inside the grid", () => {
    for (const recipe of WIDGET_RECIPES) {
      for (const grid of GRIDS) {
        for (const span of GRIDS) {
          const drawn = cardColumns({ recipe, span }, grid);
          expect(
            drawn,
            `${recipe} span ${span} on ${grid}`,
          ).toBeGreaterThanOrEqual(1);
          expect(
            drawn,
            `${recipe} span ${span} on ${grid}`,
          ).toBeLessThanOrEqual(grid);
        }
      }
    }
  });

  test("the policy is the same object shape however often it is asked", () => {
    for (const recipe of WIDGET_RECIPES) {
      expect(widgetRecipeLayout(recipe)).toEqual(widgetRecipeLayout(recipe));
    }
  });

  /**
   * The fallback chain is followed at render time, so a cycle would hang a
   * paint rather than fail a build. Bounded traversal plus a terminating chain
   * is what makes it safe.
   */
  test("narrowing a card terminates, and lands on something that fits", () => {
    for (const recipe of WIDGET_RECIPES) {
      for (const grid of GRIDS) {
        for (const columns of GRIDS) {
          if (columns > grid) continue;
          const fallback = widgetRecipeLayout(recipe).compactFallback;
          const shape = fallback
            ? (widgetRecipeDescriptor(recipe).acceptedResults.find((item) =>
                widgetRecipeDescriptor(fallback).acceptedResults.includes(item),
              ) ?? widgetRecipeDescriptor(recipe).acceptedResults[0]!)
            : widgetRecipeDescriptor(recipe).acceptedResults[0]!;
          const drawn = widgetRecipeAtWidth(recipe, columns, grid, shape);
          const layout = widgetRecipeLayout(drawn);
          const fits = columns >= layout.minColumns[grid];
          // Either it fits, or it is the end of the chain and nothing narrower
          // exists *for this result shape* — never an endless walk and never an
          // incompatible renderer.
          const next = layout.compactFallback;
          const hasCompatibleNext =
            next !== undefined &&
            widgetRecipeDescriptor(next).acceptedResults.includes(shape);
          expect(fits || !hasCompatibleNext).toBe(true);
          expect(widgetRecipeDescriptor(drawn).acceptedResults).toContain(
            shape,
          );
        }
      }
    }
  });

  test("a fallback is never wider than what it stands in for", () => {
    for (const recipe of WIDGET_RECIPES) {
      const layout = widgetRecipeLayout(recipe);
      const fallback = layout.compactFallback;
      if (!fallback) continue;
      const narrower = widgetRecipeLayout(fallback);
      for (const grid of GRIDS) {
        expect(
          narrower.minColumns[grid],
          `${fallback} standing in for ${recipe} on ${grid}`,
        ).toBeLessThanOrEqual(layout.minColumns[grid]);
      }
    }
  });

  /**
   * The recipe is *stored* now, so there is nothing to derive and nothing to round-trip:
   * what remains is that every recipe a card can be saved as has a mark for the renderer
   * to draw, and that a recipe with no mark cannot be selected at all.
   */
  test("a selectable recipe always has a mark to draw it", () => {
    for (const recipe of WIDGET_RECIPES) {
      const mark = widgetMarkForRecipe(recipe);
      if (mark === null) {
        expect(widgetRecipeSelectable(recipe), recipe).toBe(false);
      } else {
        expect(WIDGET_RECIPES, recipe).toContain(recipe);
      }
    }
  });

  /**
   * The invariant that matters: anything a V1 document can *save* must render on
   * every platform. The converse is not required — a recipe may be drawn on web
   * before it has a mark of its own, and `mobile: "fallback"` says a card is
   * readable there without claiming the recipe's own renderer exists.
   *
   * "Renders" is the resolved answer, not the recipe as written: a strip has no
   * mobile renderer and names the histogram as its platform fallback, which is the
   * same distribution drawn another way. What must never happen is a saveable card
   * resolving to something a platform still cannot draw.
   */
  test("platform resolution never hands a renderer an incompatible result", () => {
    for (const recipe of WIDGET_RECIPES) {
      if (!widgetRecipeSelectable(recipe)) continue;
      for (const platform of ["web", "mobile"] as const) {
        const shape = widgetRecipeDescriptor(recipe).acceptedResults[0]!;
        const drawn = widgetRecipeForPlatform(recipe, platform, shape);
        expect(widgetRecipeDescriptor(drawn).acceptedResults, drawn).toContain(
          shape,
        );
        // A shape-changing fallback is not graceful degradation. Where no renderer can
        // consume the result, resolution preserves the authored recipe; if it moves, the
        // target is the last compatible recipe reached. It may itself have no renderer
        // when the compatible chain runs out (sunburst → treemap on mobile), but it may
        // never claim a renderer by changing the result's meaning.
        expect(widgetMarkForRecipe(drawn), `${recipe} on ${platform}`).not.toBe(
          null,
        );
      }
    }
  });

  test("a recipe with no renderer cannot be selected", () => {
    for (const recipe of WIDGET_RECIPES) {
      if (widgetRecipeAvailable(recipe, "web")) continue;
      // It may well have a mark — a mark lands before its renderer — but no
      // measure may offer it until something can draw it.
      expect(widgetRecipeSelectable(recipe), recipe).toBe(false);
    }
  });

  test("wider containers never draw fewer series", () => {
    for (const recipe of WIDGET_RECIPES) {
      let previous = 0;
      for (const profile of WIDGET_CONTAINER_PROFILES) {
        const budget = widgetSeriesBudget(recipe, profile);
        expect(budget, `${recipe} at ${profile}`).toBeGreaterThanOrEqual(1);
        expect(budget, `${recipe} at ${profile}`).toBeGreaterThanOrEqual(
          previous,
        );
        previous = budget;
      }
    }
  });

  test("container profiles are ordered and total", () => {
    expect(widgetContainerProfile(0)).toBe("micro");
    expect(widgetContainerProfile(179)).toBe("micro");
    expect(widgetContainerProfile(180)).toBe("compact");
    expect(widgetContainerProfile(279)).toBe("compact");
    expect(widgetContainerProfile(280)).toBe("standard");
    expect(widgetContainerProfile(419)).toBe("standard");
    expect(widgetContainerProfile(420)).toBe("wide");
    expect(widgetContainerProfile(639)).toBe("wide");
    expect(widgetContainerProfile(640)).toBe("hero");
    expect(widgetContainerProfile(4000)).toBe("hero");
  });

  test("height tiers grow with their names", () => {
    let previous = 0;
    for (const tier of WIDGET_HEIGHT_TIERS) {
      const pixels = WIDGET_HEIGHT_TIER_PIXELS[tier];
      expect(pixels, tier).toBeGreaterThan(previous);
      previous = pixels;
    }
  });

  /**
   * The refactor's own guarantee: moving the floor from `display` to the recipe
   * must not have moved a single card. `value` and `gauge` were the only
   * displays that fitted in one column; everything else took the old floor.
   */
  test("reproduces the width the old display switch gave", () => {
    const oldFloor = (display: string, columns: number) => {
      if (columns <= 1) return 1;
      if (display === "value" || display === "gauge") return 1;
      return columns <= 2 ? columns : Math.min(2, columns);
    };
    const pairs: Array<[string, WidgetChartRecipe]> = [
      ["value", "value"],
      ["gauge", "gauge"],
      ["sparkline", "sparkline"],
      ["chart", "line"],
      ["chart", "area"],
      ["chart", "bar"],
      ["chart", "dot"],
      ["chart", "histogram"],
      ["chart", "boxplot"],
      ["chart", "heatmap"],
      ["list", "ranking"],
      ["list", "list"],
      ["list", "table"],
    ];
    for (const [display, recipe] of pairs) {
      for (const grid of GRIDS) {
        expect(
          widgetRecipeLayout(recipe).minColumns[grid],
          `${display} → ${recipe} on ${grid}`,
        ).toBe(oldFloor(display, grid) as 1 | 2 | 3 | 4);
      }
    }
  });
});

/**
 * The audit's rule that the choice of renderer must follow the capabilities really
 * supported, rather than a renderer discovering at draw time that it has no branch
 * for the mark it was handed.
 */
describe("renderer resolution", () => {
  const PLATFORMS = ["web", "mobile"] as const;

  test("every recipe resolves to one the platform can draw", () => {
    for (const platform of PLATFORMS) {
      for (const recipe of WIDGET_RECIPES) {
        const resolved = widgetRecipeForPlatform(
          recipe,
          platform,
          widgetRecipeDescriptor(recipe).acceptedResults[0]!,
        );
        // Either the platform has a renderer for it, or the chain ran out — and if
        // it ran out, the recipe it stopped on is the one that has no fallback of
        // its own. What must never happen is resolving *away* from a drawable
        // recipe onto one that is not.
        if (widgetRecipeAvailable(recipe, platform)) {
          expect(
            widgetRecipeAvailable(resolved, platform),
            `${recipe} on ${platform}`,
          ).toBe(true);
        }
      }
    }
  });

  test("a recipe with a renderer is returned as it is", () => {
    for (const platform of PLATFORMS) {
      for (const recipe of WIDGET_RECIPES) {
        if (widgetRecipeDescriptor(recipe).renderers[platform] !== "native") {
          continue;
        }
        expect(
          widgetRecipeForPlatform(
            recipe,
            platform,
            widgetRecipeDescriptor(recipe).acceptedResults[0]!,
          ),
        ).toBe(recipe);
      }
    }
  });

  test("refusing the generic renderer keeps walking the chain", () => {
    // A recipe declared `fallback` is drawn by something generic. Asked for a
    // native renderer only, resolution walks past it — unless the chain ends
    // there, in which case the generic drawing is the best answer available and
    // returning it beats returning nothing. `lollipop` on mobile is that case: it
    // is itself the compact fallback for the bars and dots above it.
    for (const platform of PLATFORMS) {
      for (const recipe of WIDGET_RECIPES) {
        if (widgetRecipeDescriptor(recipe).renderers[platform] !== "fallback") {
          continue;
        }
        const strict = widgetRecipeForPlatform(
          recipe,
          platform,
          widgetRecipeDescriptor(recipe).acceptedResults[0]!,
          { allowGeneric: false },
        );
        const terminal =
          widgetRecipeLayout(recipe).compactFallback === undefined;
        if (terminal) {
          expect(strict, `${recipe} on ${platform}`).toBe(recipe);
        } else {
          expect(strict, `${recipe} on ${platform}`).not.toBe(recipe);
        }
      }
    }
  });

  test("every selectable recipe already has a web renderer", () => {
    // The property that makes this resolution a guard rather than a behaviour
    // change: nothing a user can save today needs it.
    for (const recipe of WIDGET_RECIPES) {
      if (!widgetRecipeSelectable(recipe)) continue;
      expect(
        widgetRecipeForPlatform(
          recipe,
          "web",
          widgetRecipeDescriptor(recipe).acceptedResults[0]!,
        ),
        recipe,
      ).toBe(recipe);
    }
  });

  test("hands back the very same visualization when nothing degrades", () => {
    // Identity, not a copy: a renderer calls this on every render, and a fresh object
    // each time would defeat every memo downstream of it.
    const sparkline = definition("sparkline");
    expect(
      widgetVisualizationForPlatform(sparkline, "web", "temporal-series"),
    ).toBe(sparkline.visualization);
    expect(
      widgetVisualizationForPlatform(sparkline, "web", "temporal-series")
        .recipe,
    ).toBe("sparkline");
  });

  test("substitutes the recipe, never the mark, when it does degrade", () => {
    // A strip has no mobile renderer and names the histogram as its platform fallback.
    // What comes back is the *histogram recipe* — the renderer then asks it for a mark —
    // rather than a strip carrying a borrowed mark, which is how a card ends up drawn as
    // something its own recipe does not describe.
    const strip = definition("strip");
    const drawn = widgetVisualizationForPlatform(
      strip,
      "mobile",
      "distribution",
    );
    expect(drawn.recipe).toBe("histogram");
    expect(widgetMarkForRecipe(drawn.recipe)).toBe("histogram");
  });

  test("stops a width fallback that cannot consume the materialised shape", () => {
    // A bar may be temporal or categorical; lollipop is only categorical. The same
    // fallback declaration therefore moves one result and preserves the other.
    expect(widgetRecipeAtWidth("bar", 1, 4, "categorical-series")).toBe(
      "lollipop",
    );
    expect(widgetRecipeAtWidth("bar", 1, 4, "temporal-series")).toBe("bar");
  });

  test("uses only same-shape platform fallbacks", () => {
    expect(
      widgetRecipeForPlatform("difference-area", "mobile", "temporal-series"),
    ).toBe("line");
    expect(
      widgetRecipeForPlatform("scatter", "mobile", "categorical-series"),
    ).toBe("bar");
    // No mobile hierarchy consumer exists yet. Keeping the authored recipe is explicit
    // unsupported behaviour; calling a categorical lollipop a hierarchy was the bug.
    expect(widgetRecipeForPlatform("treemap", "mobile", "hierarchy")).toBe(
      "treemap",
    );
  });

  test("the compiler enforces acceptedResults beyond shared marks", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      {
        id: "friend",
        label: null,
        expression: {
          kind: "metric",
          metric: "friendSubjects",
          goalId: null,
          memberId: "friend-a",
        },
      },
    ];
    // `ranking` and `list` share the list mark, but only list declares that it consumes
    // the structured records result.
    definition.visualization.recipe = "ranking";

    expect(
      compileWidgetDefinition(definition, { surface: "overview" }).issues,
    ).toContainEqual({
      path: "visualization.recipe",
      code: "unsupported",
      messageKey: "widget.error.mark-incompatible",
    });
  });
});
