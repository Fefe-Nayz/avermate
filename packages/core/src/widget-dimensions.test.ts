import { describe, expect, test } from "bun:test";
import { compileWidgetDefinition } from "./widget-definition";
import { createWidgetDefinition } from "./widget-defaults";
import { resolveWidgetFlow } from "./widget-flow";
import { WIDGET_LIMITS } from "./widget-types";
import type { WidgetDefinition, WidgetFlowField } from "./widget-types";

/**
 * The groupings, as something a person can compose.
 *
 * The model has carried a *list* of dimensions since the second version, the evaluator
 * walks two of them and the renderers draw the result — a series per subject, stacked
 * bars, a facet grid. None of it was reachable from a screen: the editor had one choice
 * over `analysis.dimensions.0.kind` and five options hanging off it, so a second grouping
 * could only be written by hand or generated. This is about the list being composable.
 */

const context = { surface: "insights" as const };

/** One field of the resolved flow, wherever its section put it. */
const field = (definition: WidgetDefinition, id: string) => {
  const flow = resolveWidgetFlow(definition, context);
  return [...flow.definition, ...flow.visualization]
    .flatMap((section) => section.fields)
    .find((item: WidgetFlowField) => item.id === id);
};

const withDimensions = (
  definition: WidgetDefinition,
  dimensions: WidgetDefinition["analysis"]["dimensions"],
): WidgetDefinition => ({
  ...definition,
  analysis: { ...definition.analysis, dimensions },
});

describe("the grouping control", () => {
  test("is a list, bounded by the model's own ceiling", () => {
    const control = field(createWidgetDefinition("insights"), "dimensions");

    expect(control?.collection?.maxItems).toBe(WIDGET_LIMITS.dimensions);
    // Nothing is not an error: an ungrouped analysis has *no* dimension, which a list says
    // by being empty. The old control had to spell it as a `none` value.
    expect(control?.collection?.minItems).toBe(0);
  });

  test("offers only the groupings the measure can actually use", () => {
    const definition = createWidgetDefinition("insights");
    const average = field(definition, "dimensions")
      ?.collection?.variants.map((variant) => variant.value)
      .sort();

    expect(average).toContain("time");
    expect(average).toContain("subject");

    // A reading with no grouping at all — the same gate the single choice had. Offering a
    // split the compiler then refuses reads as the editor being broken.
    const record = withDimensions(
      {
        ...definition,
        analysis: {
          ...definition.analysis,
          measures: [
            {
              id: "measure",
              label: null,
              expression: {
                kind: "metric",
                metric: "lastGrade",
                goalId: null,
              },
            },
          ],
        },
      },
      [],
    );

    expect(field(record, "dimensions")?.collection?.variants).toEqual([]);
  });

  test("offers only second axes the evaluator can cross with the first", () => {
    const time = field(createWidgetDefinition("insights"), "dimensions")
      ?.collection?.addVariants?.map((variant) => variant.value);
    expect(time).toContain("subject");
    expect(time).toContain("status");
    expect(time).not.toContain("time");
    expect(time).not.toContain("period");

    const subject = field(
      withDimensions(createWidgetDefinition("insights"), [
        {
          id: "group",
          kind: "subject",
          level: "all",
          includeCategories: false,
          limit: 10,
        },
      ]),
      "dimensions",
    )?.collection;
    // A subject can be crossed with properties of its own marks, but never with another
    // subject or a second temporal axis.
    expect(subject?.variants.map((variant) => variant.value)).toContain(
      "subject",
    );
    expect(subject?.addVariants?.map((variant) => variant.value).sort()).toEqual(
      ["assessment-type", "grade-band", "status"],
    );

    const status = field(
      withDimensions(createWidgetDefinition("insights"), [
        {
          id: "group",
          kind: "status",
          values: ["passed", "failed", "missing"],
        },
      ]),
      "dimensions",
    )?.collection?.addVariants?.map((variant) => variant.value);
    expect(status).toContain("grade-band");
    expect(status).not.toContain("subject");
    expect(status).not.toContain("time");
    expect(status).not.toContain("period");
  });

  test("keeps a time grouping's own options with it", () => {
    const time = field(createWidgetDefinition("insights"), "dimensions")
      ?.collection?.variants.find((variant) => variant.value === "time");

    expect(time?.fields.map((item) => item.path).sort()).toEqual([
      "accumulation",
      "fill",
      "grain",
    ]);
    // Reachable at last: a point per result and a bucket per period were evaluable and
    // drawable all along, and the flat control offered neither.
    const grains = time?.fields.find((item) => item.path === "grain")?.options;
    expect(grains?.map((option) => option.value)).toEqual([
      "event",
      "day",
      "week",
      "month",
      "period",
    ]);
  });

  test("hides the options an event grain has no answer for", () => {
    const time = field(createWidgetDefinition("insights"), "dimensions")
      ?.collection?.variants.find((variant) => variant.value === "time");
    const accumulation = time?.fields.find(
      (item) => item.path === "accumulation",
    );

    // Conditions inside an item are read against the item, so this is the grain beside it.
    expect(accumulation?.visibleWhen).toEqual({
      kind: "not",
      condition: { kind: "equals", path: "grain", value: "event" },
    });
  });
});

describe("what the list makes composable", () => {
  const twoDimensions = withDimensions(createWidgetDefinition("insights"), [
    {
      id: "group",
      kind: "time",
      grain: "week",
      accumulation: "running",
      fill: "observed",
    },
    {
      id: "group2",
      kind: "subject",
      level: "root",
      includeCategories: false,
      limit: 8,
    },
  ]);

  test("compiles a second grouping", () => {
    const compiled = compileWidgetDefinition(twoDimensions, {
      surface: "insights",
    });

    expect(compiled.valid).toBe(true);
    expect(compiled.plan?.definition.analysis.dimensions).toHaveLength(2);
  });

  test("gives the second grouping to the channels that split by one", () => {
    // A series and a facet name a dimension *after* the first — which is exactly what a
    // second grouping is for, and what no editor could produce until now.
    const series = field(twoDimensions, "encoding-series");

    expect(series?.options.map((option) => option.value)).toEqual(["group2"]);
    expect(series?.active).toBe(true);
  });

  test("an item needs no id of its own", () => {
    // The collection editor writes `{kind, …}` and nothing else; the ids the channels name
    // are the compiler's, derived from position.
    const compiled = compileWidgetDefinition(
      withDimensions(createWidgetDefinition("insights"), [
        { kind: "time", grain: "month" },
        { kind: "subject" },
      ] as unknown as WidgetDefinition["analysis"]["dimensions"]),
      { surface: "insights" },
    );

    expect(compiled.valid).toBe(true);
    expect(
      compiled.plan?.definition.analysis.dimensions.map((item) => item.id),
    ).toEqual(["group", "group2"]);
  });
});
