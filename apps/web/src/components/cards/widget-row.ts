import {
  CARD_METRICS,
  compileWidgetDefinition,
  legacyCardToWidgetDefinition,
  type CardDisplay,
  type CardMetric,
  type CardSpec,
  type WidgetDefinitionV1,
  type WidgetSurface,
  type WidgetValidationIssue,
} from "@avermate/core"
import type { DashboardCardRow } from "@/components/year/year-provider"

const CARD_DISPLAYS = ["value", "sparkline", "chart", "list", "gauge"] as const

function metric(value: string): CardMetric {
  return CARD_METRICS.includes(value as CardMetric)
    ? (value as CardMetric)
    : "average"
}

function display(value: string): CardDisplay {
  return CARD_DISPLAYS.includes(value as CardDisplay)
    ? (value as CardDisplay)
    : "value"
}

function targetKind(value: string): "general" | "subject" | "custom" {
  return value === "subject" || value === "custom" ? value : "general"
}

function surface(value: string): WidgetSurface {
  return value === "subject" || value === "grade" || value === "insights"
    ? value
    : "overview"
}

export interface ResolvedWidgetRow {
  definition: WidgetDefinitionV1
  source: "v1" | "legacy"
  issues: WidgetValidationIssue[]
}

export function widgetEvaluationMode(source: ResolvedWidgetRow["source"]): {
  legacy: boolean
  v1: boolean
} {
  return { legacy: source === "legacy", v1: source === "v1" }
}

export function legacyCardSpec(row: DashboardCardRow): CardSpec {
  return {
    id: row.id,
    metric: metric(row.metric),
    target: {
      kind: targetKind(row.targetKind),
      referenceId: row.targetId,
    },
    goalId: row.goalId,
    display: display(row.display),
    span: Math.min(4, Math.max(1, row.span)) as CardSpec["span"],
    title: row.title,
    accent: row.accent,
    sortOrder: row.sortOrder,
    hidden: row.hidden,
  }
}

/**
 * Dual-read one persisted card during the V1 rollout.
 *
 * Invalid JSON never takes the whole surface down. The old columns remain a
 * complete, deterministic fallback until the migration has proven itself on
 * every client and every stored row.
 */
export function resolveWidgetRow(row: DashboardCardRow): ResolvedWidgetRow {
  const rowSurface = surface(row.surface)
  if (row.definitionVersion === 1 && row.definitionJson) {
    const compiled = compileWidgetDefinition(row.definitionJson, {
      surface: rowSurface,
    })
    if (compiled.valid && compiled.plan) {
      return {
        definition: compiled.plan.definition,
        source: "v1",
        issues: [],
      }
    }

    return {
      definition: legacyDefinition(row),
      source: "legacy",
      issues: compiled.issues,
    }
  }

  return { definition: legacyDefinition(row), source: "legacy", issues: [] }
}

function legacyDefinition(row: DashboardCardRow): WidgetDefinitionV1 {
  return legacyCardToWidgetDefinition({
    metric: metric(row.metric),
    targetKind: targetKind(row.targetKind),
    targetId: row.targetId,
    goalId: row.goalId,
    display: display(row.display),
  })
}
