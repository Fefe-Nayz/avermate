import {
  WIDGET_DEFINITION_VERSION,
  compileWidgetDefinition,
  type WidgetDefinition,
  type WidgetSurface,
  type WidgetValidationIssue,
} from "@avermate/core";

export interface StoredWidgetRow {
  id: string;
  surface: string;
  span: number;
  title: string | null;
  accent: string | null;
  sortOrder: number;
  hidden: boolean;
  definitionVersion: number | null;
  definitionJson: unknown | null;
}

export interface ResolvedWidgetRow {
  /**
   * `null` when the row carries nothing this build can read — no definition, a
   * version from the future, or JSON that fails to compile.
   */
  definition: WidgetDefinition | null;
  issues: WidgetValidationIssue[];
}

/**
 * Read one persisted card.
 *
 * There used to be a second answer: a row whose definition was missing or
 * unreadable fell back to the old `metric` / `targetKind` / `display` columns and
 * was drawn by a *different renderer*. Two renderers for one card means the same
 * card can look like two different things depending on which screen resolved it,
 * and that is exactly what happened. The definition is now the only
 * representation, and a row that cannot be read says so.
 */
export function resolveWidgetRow(
  row: StoredWidgetRow,
  surface: WidgetSurface,
): ResolvedWidgetRow {
  if (
    row.definitionVersion !== WIDGET_DEFINITION_VERSION ||
    !row.definitionJson
  ) {
    return { definition: null, issues: [] };
  }
  const compiled = compileWidgetDefinition(row.definitionJson, { surface });
  if (compiled.valid && compiled.plan) {
    return { definition: compiled.plan.definition, issues: [] };
  }
  return { definition: null, issues: compiled.issues };
}
