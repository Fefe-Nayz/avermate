import {
  WIDGET_DEFINITION_VERSION,
  compileWidgetDefinition,
  type WidgetDefinition,
  type WidgetSurface,
  type WidgetValidationIssue,
} from "@avermate/core"
import type { DashboardCardRow } from "@/components/year/year-provider"

function surface(value: string): WidgetSurface {
  return value === "subject" || value === "grade" || value === "insights"
    ? value
    : "overview"
}

export interface ResolvedWidgetRow {
  /**
   * `null` when the row carries nothing this build can read — no definition, a
   * version from the future, or JSON that fails to compile.
   */
  definition: WidgetDefinition | null
  issues: WidgetValidationIssue[]
}

/**
 * Read one persisted card.
 *
 * There used to be a second answer here. A row whose definition was missing or
 * unreadable fell back to the old `metric` / `targetKind` / `display` columns and
 * was rendered by a different component, which is how the same card could look
 * one way on the dashboard and another way in its own editor: the grid drew
 * whichever of the two the row happened to resolve to, and the editor always drew
 * the definition. Two renderers, one card, no way to tell from the screen which
 * you were looking at.
 *
 * The definition is now the only representation, so that divergence cannot exist:
 * both surfaces run the same renderer over the same document. A row that fails to
 * compile is a broken row and says so, rather than quietly becoming a different
 * card.
 */
export function resolveWidgetRow(row: DashboardCardRow): ResolvedWidgetRow {
  if (
    row.definitionVersion !== WIDGET_DEFINITION_VERSION ||
    !row.definitionJson
  )
    return { definition: null, issues: [] }

  const compiled = compileWidgetDefinition(row.definitionJson, {
    surface: surface(row.surface),
  })
  if (compiled.valid && compiled.plan) {
    return { definition: compiled.plan.definition, issues: [] }
  }
  return { definition: null, issues: compiled.issues }
}
