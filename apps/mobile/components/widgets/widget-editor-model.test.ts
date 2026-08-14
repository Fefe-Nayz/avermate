import { describe, expect, test } from "bun:test";
import {
  WIDGET_LIMITS,
  compileWidgetDefinition,
  createWidgetDefinition,
  type WidgetDefinitionV1,
  type WidgetFilter,
  type WidgetFormula,
} from "@avermate/core";
import {
  preservesRawWidgetDraft,
  resolveWidgetEditorChange,
} from "./widget-editor-model";

describe("widget editor model", () => {
  test("keeps an over-complex formula visible and invalid instead of replacing it with zero", () => {
    let formula: WidgetFormula = { kind: "literal", value: 1 };
    for (let depth = 0; depth <= WIDGET_LIMITS.formulaDepth; depth += 1) {
      formula = { kind: "unary", operation: "absolute", operand: formula };
    }
    const definition = createWidgetDefinition("overview");
    definition.analysis.measure = {
      kind: "formula",
      formula,
      valueType: "number",
    };

    expect(preservesRawWidgetDraft(definition, "overview")).toBe(true);
    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    });
    expect(
      (resolved.analysis.measure as { formula: WidgetFormula }).formula,
    ).toEqual(formula);
  });

  test("keeps a temporarily cleared literal value visible and blocks saving", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measure = {
      kind: "formula",
      formula: { kind: "literal", value: null } as unknown as WidgetFormula,
      valueType: "number",
    };

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    });
    const compiled = compileWidgetDefinition(resolved, { surface: "overview" });

    expect(preservesRawWidgetDraft(definition, "overview")).toBe(true);
    expect(
      (resolved.analysis.measure as { formula: { value: unknown } }).formula
        .value,
    ).toBeNull();
    expect(compiled.valid).toBe(false);
    expect(compiled.plan).toBeNull();
    expect(
      compiled.issues.some(
        (issue) => issue.path === "analysis.measure.formula.value",
      ),
    ).toBe(true);
  });

  test("keeps the complete raw tree for non-complexity formula issues", () => {
    const definition = createWidgetDefinition("overview");
    const formula = {
      kind: "binary",
      operation: "add",
      left: { kind: "literal", value: null },
      right: { kind: "literal", value: 7 },
    } as unknown as WidgetFormula;
    definition.analysis.measure = {
      kind: "formula",
      formula,
      valueType: "number",
    };

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    });

    expect(
      (resolved.analysis.measure as { formula: WidgetFormula }).formula,
    ).toBe(formula);
    expect(
      compileWidgetDefinition(resolved, { surface: "overview" }).valid,
    ).toBe(false);
  });

  test("keeps a numeric filter while its value is temporarily empty", () => {
    const definition = createWidgetDefinition("overview");
    definition.query.filters = [
      {
        kind: "grade-ratio",
        operator: "gte",
        value: null,
      } as unknown as WidgetFilter,
    ];

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    });
    const compiled = compileWidgetDefinition(resolved, { surface: "overview" });

    expect(resolved.query.filters).toHaveLength(1);
    expect(
      (resolved.query.filters[0] as unknown as { value: unknown }).value,
    ).toBeNull();
    expect(compiled.valid).toBe(false);
    expect(compiled.plan).toBeNull();
  });

  test("keeps a cleared threshold available for retyping", () => {
    const definition = createWidgetDefinition("overview");
    definition.visualization.thresholds = [
      {
        value: null,
        color: "#2563EB",
        label: "Target",
      } as unknown as WidgetDefinitionV1["visualization"]["thresholds"][number],
    ];

    const cleared = resolveWidgetEditorChange(definition, {
      surface: "overview",
    });
    expect(cleared.visualization.thresholds).toHaveLength(1);
    expect(
      compileWidgetDefinition(cleared, { surface: "overview" }).valid,
    ).toBe(false);

    const retyped: WidgetDefinitionV1 = {
      ...cleared,
      visualization: {
        ...cleared.visualization,
        thresholds: [{ value: 0.75, color: "#2563EB", label: "Target" }],
      },
    };
    const resolved = resolveWidgetEditorChange(retyped, {
      surface: "overview",
    });

    expect(
      compileWidgetDefinition(resolved, { surface: "overview" }).valid,
    ).toBe(true);
    expect(resolved.visualization.thresholds).toEqual([
      { value: 0.75, color: "#2563eb", label: "Target" },
    ]);
  });

  test("preserves both ends of an invalid scale domain", () => {
    const definition = createWidgetDefinition("insights");
    definition.visualization.scale.y.min = 10;
    definition.visualization.scale.y.max = 2;

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "insights",
    });

    expect(resolved.visualization.scale.y).toMatchObject({ min: 10, max: 2 });
    expect(
      compileWidgetDefinition(resolved, { surface: "insights" }).valid,
    ).toBe(false);
  });

  test("canonicalizes incompatible fields after a metric transition", () => {
    const definition = createWidgetDefinition("insights");
    definition.analysis.measure = {
      kind: "metric",
      metric: "lastGrade",
      goalId: null,
    };

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "insights",
    });
    expect(resolved.analysis.groupBy).toEqual({ kind: "none" });
    expect(resolved.visualization.mark).toBe("value");
    expect(
      compileWidgetDefinition(resolved, { surface: "insights" }).valid,
    ).toBe(true);
  });

  test("canonicalizes goal progress to its owned query and gauge", () => {
    const definition = createWidgetDefinition("overview");
    definition.analysis.measure = {
      kind: "metric",
      metric: "goalProgress",
      goalId: "goal-1",
    };

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    });
    expect(resolved.query.scope).toEqual({ kind: "general" });
    expect(resolved.analysis.groupBy).toEqual({ kind: "none" });
    expect(resolved.visualization.mark).toBe("gauge");
    expect(
      compileWidgetDefinition(resolved, { surface: "overview" }).valid,
    ).toBe(true);
  });
});
