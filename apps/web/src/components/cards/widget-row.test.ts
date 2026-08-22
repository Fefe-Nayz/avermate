import { describe, expect, test } from "bun:test"
import {
  createWidgetDefinition,
  WIDGET_DEFINITION_VERSION,
} from "@avermate/core"
import type { DashboardCardRow } from "@/components/year/year-provider"
import { resolveWidgetRow } from "./widget-row"

const row: DashboardCardRow = {
  id: "card",
  surface: "overview",
  goalId: null,
  span: 2,
  title: null,
  accent: null,
  sortOrder: 0,
  hidden: false,
  definitionVersion: null,
  definitionJson: null,
}

const withDefinition = (
  definitionJson: DashboardCardRow["definitionJson"]
): DashboardCardRow => ({
  ...row,
  definitionVersion: WIDGET_DEFINITION_VERSION,
  definitionJson,
})

describe("reading one persisted card", () => {
  test("reads the stored definition", () => {
    const definition = createWidgetDefinition("overview")
    definition.query.window = { kind: "whole-year" }

    const resolved = resolveWidgetRow(withDefinition(definition))

    expect(resolved.definition?.query.window).toEqual({ kind: "whole-year" })
    expect(resolved.issues).toEqual([])
  })

  test("reports a row it cannot read rather than becoming another card", () => {
    // This is the divergence that made the editor and the dashboard disagree.
    // A row that failed to compile used to fall back to the old `metric` /
    // `display` columns and be drawn by a *different component*, so the same
    // card was one thing in the grid and another in its own editor. There is
    // now one representation, and a row that cannot be read says so.
    const resolved = resolveWidgetRow(withDefinition({ apiVersion: 999 }))

    expect(resolved.definition).toBeNull()
    expect(resolved.issues.length).toBeGreaterThan(0)
  })

  test("does not read the old semantic columns at all", () => {
    // The row above carries `metric: "passRate"` and `display: "gauge"`. Under
    // the dual-read that alone produced a working pass-rate gauge.
    expect(resolveWidgetRow(row).definition).toBeNull()
  })

  test("refuses a definition version this build does not know", () => {
    const resolved = resolveWidgetRow({
      ...row,
      // One past the version this build knows.
      definitionVersion: WIDGET_DEFINITION_VERSION + 1,
      definitionJson: createWidgetDefinition("overview"),
    })

    expect(resolved.definition).toBeNull()
  })
})
