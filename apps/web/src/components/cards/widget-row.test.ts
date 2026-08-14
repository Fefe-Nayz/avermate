import { describe, expect, test } from "bun:test"
import { createWidgetDefinition } from "@avermate/core"
import type { DashboardCardRow } from "@/components/year/year-provider"
import {
  legacyCardSpec,
  resolveWidgetRow,
  widgetEvaluationMode,
} from "./widget-row"

const row: DashboardCardRow = {
  id: "card",
  surface: "overview",
  metric: "passRate",
  targetKind: "general",
  targetId: null,
  goalId: null,
  display: "gauge",
  span: 2,
  title: null,
  accent: null,
  sortOrder: 0,
  hidden: false,
  definitionVersion: null,
  definitionJson: null,
}

describe("persisted widget dual-read", () => {
  test("adapts legacy cards without changing their intent", () => {
    const resolved = resolveWidgetRow(row)

    expect(resolved.source).toBe("legacy")
    expect(resolved.definition.analysis.measure).toEqual({
      kind: "metric",
      metric: "passRate",
      goalId: null,
    })
    expect(resolved.definition.visualization.mark).toBe("gauge")
  })

  test("keeps the exact legacy display while the V1 adapter is only a fallback", () => {
    const legacy = { ...row, display: "sparkline" }

    expect(resolveWidgetRow(legacy).source).toBe("legacy")
    expect(legacyCardSpec(legacy).display).toBe("sparkline")
    expect(widgetEvaluationMode("legacy")).toEqual({ legacy: true, v1: false })
  })

  test("prefers a valid V1 definition", () => {
    const definition = createWidgetDefinition("overview")
    definition.query.window = { kind: "whole-year" }
    const resolved = resolveWidgetRow({
      ...row,
      definitionVersion: 1,
      definitionJson: definition,
    })

    expect(resolved.source).toBe("v1")
    expect(widgetEvaluationMode(resolved.source)).toEqual({
      legacy: false,
      v1: true,
    })
    expect(resolved.definition.query.window).toEqual({ kind: "whole-year" })
  })

  test("falls back to legacy columns when V1 data is corrupt", () => {
    const resolved = resolveWidgetRow({
      ...row,
      definitionVersion: 1,
      definitionJson: { apiVersion: 999 },
    })

    expect(resolved.source).toBe("legacy")
    expect(resolved.issues.length).toBeGreaterThan(0)
    expect(resolved.definition.analysis.measure).toMatchObject({
      metric: "passRate",
    })
  })
})
