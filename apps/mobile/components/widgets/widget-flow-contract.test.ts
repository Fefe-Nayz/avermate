import { describe, expect, test } from "bun:test";
import { createWidgetDefinition, resolveWidgetFlow } from "@avermate/core";

function field(flow: ReturnType<typeof resolveWidgetFlow>, id: string) {
  return [...flow.definition, ...flow.visualization]
    .flatMap((section) => section.fields)
    .find((item) => item.id === id);
}

describe("mobile widget flow contract", () => {
  test("uses the core-compatible mark and encoding options", () => {
    const definition = createWidgetDefinition("insights");
    const flow = resolveWidgetFlow(definition, { surface: "insights" });

    // Recipes rather than marks: the document stores what a card *is*, so the editor
    // offers that. Several recipes share a mark — a sparkline is a line without its
    // apparatus, a calendar is a heatmap of every day — and each is its own choice now.
    expect(field(flow, "mark")?.options.map((item) => item.value)).toEqual([
      "sparkline",
      "line",
      "area",
      "bar",
      "dot",
      // A fitted line with its band and its R². Time axis only — a slope over categories
      // would be "per subject", a rate about the order they happen to be in.
      "regression",
      // Two readings and the ground between them. Offered here because the *model* allows
      // it — the compiler then asks for the second measure — and drawn on the phone as the
      // gap read as a number, which is its platform fallback.
      "difference-area",
      "heatmap",
      "calendar",
      // Offered by the model; the phone falls back to a single chart with every series
      // on it, which its own recipe descriptor says.
      "facets",
    ]);
    // Nothing to split by: a series names a dimension after the first, and this card
    // has one.
    expect(field(flow, "encoding-series")?.options).toEqual([]);
    expect(field(flow, "legend")).toBeUndefined();
  });

  test("reveals legend controls only after a real color encoding", () => {
    const definition = createWidgetDefinition("insights");
    definition.visualization.encoding.color = {
      field: "measure",
      type: "quantitative",
    };
    definition.visualization.legend.visible = true;
    const flow = resolveWidgetFlow(definition, { surface: "insights" });

    expect(field(flow, "legend")?.active).toBe(true);
    expect(field(flow, "legend-position")?.active).toBe(true);
  });

  test("keeps formulas outside the metric provider while exposing the formula tree", () => {
    const definition = createWidgetDefinition("overview");
    const metricFlow = resolveWidgetFlow(definition, { surface: "overview" });
    expect(
      field(metricFlow, "metric")?.options.some(
        (item) => item.value === "formula",
      ),
    ).toBe(false);

    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: {
          kind: "formula",
      formula: { kind: "literal", value: 1 },
      valueType: "number",
        },
      },
    ];
    const formulaFlow = resolveWidgetFlow(definition, { surface: "overview" });
    expect(field(formulaFlow, "formula")?.collection?.minItems).toBe(1);
    expect(field(formulaFlow, "formula")?.active).toBe(true);
  });

  test("lets a goal own its scope and time window", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measures = [
      {
        id: "measure",
        label: null,
        expression: { kind: "metric", metric: "goalProgress", goalId: "goal-1" },
      },
    ];
    const flow = resolveWidgetFlow(definition, {
      surface: "overview",
      options: { goals: [{ value: "goal-1", messageKey: "Target" }] },
    });

    expect(field(flow, "goal")?.active).toBe(true);
    expect(field(flow, "scope")).toBeUndefined();
    expect(field(flow, "window")).toBeUndefined();
    expect(field(flow, "filters")).toBeUndefined();
    // A goal *does* get a choice now: a plain gauge or a bullet, which is a gauge that
    // draws its target and its bands. The document says which rather than the shape
    // following from whether a threshold happens to be set.
    expect(field(flow, "mark")?.options.map((item) => item.value)).toEqual([
      "gauge",
      "bullet",
    ]);
    expect(flow.prunedDefinition.visualization.recipe).toBe("gauge");
  });
});
