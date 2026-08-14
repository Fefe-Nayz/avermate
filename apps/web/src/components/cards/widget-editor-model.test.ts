import { describe, expect, test } from "bun:test"
import {
  WIDGET_LIMITS,
  compileWidgetDefinition,
  createWidgetDefinition,
  createWidgetVisualization,
  type WidgetFormula,
} from "@avermate/core"
import { resolveWidgetEditorChange } from "./widget-editor-model"

describe("widget editor model", () => {
  test("keeps an over-budget formula visible and invalid", () => {
    let formula: WidgetFormula = { kind: "literal", value: 1 }
    for (let depth = 0; depth <= WIDGET_LIMITS.formulaDepth; depth += 1) {
      formula = { kind: "unary", operation: "absolute", operand: formula }
    }
    const definition = createWidgetDefinition("overview")
    definition.analysis.measure = {
      kind: "formula",
      formula,
      valueType: "number",
    }

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    })
    expect(resolved.analysis.measure).toMatchObject({ kind: "formula" })
    expect(
      (resolved.analysis.measure as { formula: WidgetFormula }).formula
    ).toEqual(formula)
    expect(
      compileWidgetDefinition(resolved, { surface: "overview" }).valid
    ).toBe(false)
  })

  test("keeps a temporarily empty number leaf and blocks compilation", () => {
    const definition = createWidgetDefinition("overview")
    definition.analysis.measure = {
      kind: "formula",
      formula: { kind: "literal", value: null } as unknown as WidgetFormula,
      valueType: "number",
    }

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    })
    const compiled = compileWidgetDefinition(resolved, { surface: "overview" })

    expect(
      (resolved.analysis.measure as { formula: { value: unknown } }).formula
        .value
    ).toBeNull()
    expect(compiled.valid).toBe(false)
    expect(compiled.plan).toBeNull()
    expect(
      compiled.issues.some(
        (issue) => issue.path === "analysis.measure.formula.value"
      )
    ).toBe(true)
  })

  test("keeps an invalid numeric filter in the collection", () => {
    const definition = createWidgetDefinition("overview")
    definition.query.filters = [
      {
        kind: "grade-ratio",
        operator: "gte",
        value: null,
      } as unknown as (typeof definition.query.filters)[number],
    ]

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    })

    expect(
      (resolved.query.filters[0] as unknown as { value: unknown }).value
    ).toBeNull()
    expect(
      compileWidgetDefinition(resolved, { surface: "overview" }).valid
    ).toBe(false)
  })

  test("keeps an invalid threshold in the collection", () => {
    const definition = createWidgetDefinition("overview")
    definition.visualization.thresholds = [
      { value: null, color: "#15803d", label: "Target" } as unknown as {
        value: number
        color: string | null
        label: string | null
      },
    ]

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    })

    expect(
      (resolved.visualization.thresholds[0] as unknown as { value: unknown })
        .value
    ).toBeNull()
    expect(
      compileWidgetDefinition(resolved, { surface: "overview" }).valid
    ).toBe(false)
  })

  test("preserves both ends of an invalid scale domain", () => {
    const definition = createWidgetDefinition("insights")
    definition.visualization.scale.y.min = 10
    definition.visualization.scale.y.max = 2

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "insights",
    })

    expect(resolved.visualization.scale.y).toMatchObject({ min: 10, max: 2 })
    expect(
      compileWidgetDefinition(resolved, { surface: "insights" }).valid
    ).toBe(false)
  })

  test("canonicalizes time and line when switching to latest grade", () => {
    const definition = createWidgetDefinition("overview")
    definition.analysis.groupBy = {
      kind: "time",
      interval: "week",
      accumulation: "running",
    }
    definition.visualization = createWidgetVisualization("line")
    definition.analysis.measure = {
      kind: "metric",
      metric: "lastGrade",
      goalId: null,
    }

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    })

    expect(resolved.analysis.groupBy).toEqual({ kind: "none" })
    expect(resolved.visualization.mark).toBe("value")
    expect(
      compileWidgetDefinition(resolved, { surface: "overview" }).valid
    ).toBe(true)
  })

  test("canonicalizes owned query and gauge when switching to a goal", () => {
    const definition = createWidgetDefinition("overview")
    definition.query.filters = [
      { kind: "grade-ratio", operator: "gte", value: 0.5 },
    ]
    definition.analysis.groupBy = {
      kind: "time",
      interval: "week",
      accumulation: "running",
    }
    definition.visualization = createWidgetVisualization("line")
    definition.analysis.measure = {
      kind: "metric",
      metric: "goalProgress",
      goalId: "goal",
    }

    const resolved = resolveWidgetEditorChange(definition, {
      surface: "overview",
    })

    expect(resolved.query.filters).toEqual([])
    expect(resolved.analysis.groupBy).toEqual({ kind: "none" })
    expect(resolved.visualization.mark).toBe("gauge")
    expect(
      compileWidgetDefinition(resolved, { surface: "overview" }).valid
    ).toBe(true)
  })
})
