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

    expect(field(flow, "mark")?.options.map((item) => item.value)).toEqual([
      "line",
      "area",
      "bar",
      "dot",
      "heatmap",
    ]);
    expect(field(flow, "encoding-series")?.options).toEqual([
      { value: "category", messageKey: "widget.encoding.category" },
    ]);
    expect(field(flow, "legend")).toBeUndefined();
  });

  test("reveals legend controls only after a real color encoding", () => {
    const definition = createWidgetDefinition("insights");
    definition.visualization.encoding.color = {
      field: "value",
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

    definition.analysis.measure = {
      kind: "formula",
      formula: { kind: "literal", value: 1 },
      valueType: "number",
    };
    const formulaFlow = resolveWidgetFlow(definition, { surface: "overview" });
    expect(field(formulaFlow, "formula")?.collection?.minItems).toBe(1);
    expect(field(formulaFlow, "formula")?.active).toBe(true);
  });

  test("lets a goal own its scope and time window", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measure = {
      kind: "metric",
      metric: "goalProgress",
      goalId: "goal-1",
    };
    const flow = resolveWidgetFlow(definition, {
      surface: "overview",
      options: { goals: [{ value: "goal-1", messageKey: "Target" }] },
    });

    expect(field(flow, "goal")?.active).toBe(true);
    expect(field(flow, "scope")).toBeUndefined();
    expect(field(flow, "window")).toBeUndefined();
    expect(field(flow, "filters")).toBeUndefined();
    expect(field(flow, "mark")).toBeUndefined();
    expect(flow.prunedDefinition.visualization.mark).toBe("gauge");
  });
});
