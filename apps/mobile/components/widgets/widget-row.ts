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
} from "@avermate/core";

const CARD_DISPLAYS = ["value", "sparkline", "chart", "list", "gauge"] as const;

export interface StoredWidgetRow {
  id: string;
  surface: string;
  metric: string;
  targetKind: string;
  targetId: string | null;
  goalId: string | null;
  display: string;
  span: number;
  title: string | null;
  accent: string | null;
  sortOrder: number;
  hidden: boolean;
  definitionVersion: number | null;
  definitionJson: unknown | null;
}

export interface ResolvedWidgetRow {
  definition: WidgetDefinitionV1;
  legacySpec: CardSpec | null;
  source: "v1" | "legacy";
  issues: WidgetValidationIssue[];
}

function metric(value: string): CardMetric {
  return CARD_METRICS.includes(value as CardMetric)
    ? (value as CardMetric)
    : "average";
}

function display(value: string): CardDisplay {
  return CARD_DISPLAYS.includes(value as CardDisplay)
    ? (value as CardDisplay)
    : "value";
}

function targetKind(value: string): "general" | "subject" | "custom" {
  return value === "subject" || value === "custom" ? value : "general";
}

function legacyDefinition(row: StoredWidgetRow): WidgetDefinitionV1 {
  return legacyCardToWidgetDefinition({
    metric: metric(row.metric),
    targetKind: targetKind(row.targetKind),
    targetId: row.targetId,
    goalId: row.goalId,
    display: display(row.display),
  });
}

/** Preserves the exact legacy evaluation/display contract until a card is edited. */
export function legacyWidgetSpec(row: StoredWidgetRow): CardSpec {
  return {
    id: row.id,
    metric: metric(row.metric),
    target: {
      kind: targetKind(row.targetKind),
      referenceId: row.targetId,
    },
    display: display(row.display),
    span: Math.min(4, Math.max(1, Math.round(row.span))) as 1 | 2 | 3 | 4,
    title: row.title,
    accent: row.accent,
    goalId: row.goalId,
    sortOrder: row.sortOrder,
    hidden: row.hidden,
  };
}

/** Invalid persisted V1 data degrades to the complete legacy projection. */
export function resolveWidgetRow(
  row: StoredWidgetRow,
  surface: WidgetSurface,
): ResolvedWidgetRow {
  if (row.definitionVersion === 1 && row.definitionJson) {
    const compiled = compileWidgetDefinition(row.definitionJson, { surface });
    if (compiled.valid && compiled.plan) {
      return {
        definition: compiled.plan.definition,
        legacySpec: null,
        source: "v1",
        issues: [],
      };
    }
    return {
      definition: legacyDefinition(row),
      legacySpec: legacyWidgetSpec(row),
      source: "legacy",
      issues: compiled.issues,
    };
  }
  return {
    definition: legacyDefinition(row),
    legacySpec: legacyWidgetSpec(row),
    source: "legacy",
    issues: [],
  };
}
