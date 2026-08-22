import { collectWidgetReferences } from "./widget-definition";
import type { CardMetric } from "./cards";
import type {
  WidgetDefinition,
  WidgetFormula,
  WidgetScope,
  WidgetWindow,
} from "./widget-types";

export type TemplateSlotKind =
  | "subject"
  | "custom-average"
  | "goal"
  | "period"
  /**
   * The two a card can name that are not the installer's own rows.
   *
   * A published template used to carry its author's group and classmate straight into
   * everybody else's dashboard: ids nothing on the installing side resolves, so the card
   * arrived empty with no control offering to fix it. They are slots like the rest — the
   * installer says which of *their* groups, and which person inside it.
   */
  | "cohort"
  | "cohort-member"
  | "friend";

/** The privacy surface a friend-backed template slot has to be able to read. */
export type TemplateFriendRequirement =
  | "generalAverage"
  | "history"
  | "subjects";

export interface TemplateSlot {
  kind: TemplateSlotKind;
  /** The author's entity id embedded in the published definition. */
  placeholderId: string;
  /**
   * Friend ids alone are not enough to build an honest picker: each social metric is
   * protected by a different sharing lock. Optional only for compatibility with slots
   * produced before this metadata existed; newly collected friend slots always carry it.
   */
  friendRequirement?: TemplateFriendRequirement;
}

/** A slot's stable identity: the entity kind is part of it, not only its raw id. */
export function templateSlotKey(
  slot: Pick<
    TemplateSlot,
    "kind" | "placeholderId" | "friendRequirement"
  >,
): string {
  return slot.kind === "friend" && slot.friendRequirement
    ? JSON.stringify([
        slot.kind,
        slot.placeholderId,
        slot.friendRequirement,
      ])
    : JSON.stringify([slot.kind, slot.placeholderId]);
}

function friendRequirementForMetric(
  metric: CardMetric,
): TemplateFriendRequirement | null {
  switch (metric) {
    case "friendAverage":
      return "generalAverage";
    case "friendCurves":
      return "history";
    case "friendSubjects":
      return "subjects";
    default:
      return null;
  }
}

/**
 * A template's slots are simply the entity references its author left in the
 * definition: each one is an "essential option" the installer re-points at
 * an entity of their own before the card is created.
 */
export function templateSlots(definition: WidgetDefinition): TemplateSlot[] {
  const references = collectWidgetReferences(definition);
  const friendSlots = new Map<string, TemplateSlot>();
  for (const measure of definition.analysis.measures) {
    const expression = measure.expression;
    if (expression.kind !== "metric" || !expression.memberId) continue;
    const friendRequirement = friendRequirementForMetric(expression.metric);
    if (!friendRequirement) continue;
    const slot: TemplateSlot = {
      kind: "friend",
      placeholderId: expression.memberId,
      friendRequirement,
    };
    friendSlots.set(templateSlotKey(slot), slot);
  }
  return [
    ...references.subjectIds.map((placeholderId): TemplateSlot => ({
      kind: "subject",
      placeholderId,
    })),
    ...references.customAverageIds.map((placeholderId): TemplateSlot => ({
      kind: "custom-average",
      placeholderId,
    })),
    ...references.goalIds.map((placeholderId): TemplateSlot => ({
      kind: "goal",
      placeholderId,
    })),
    ...references.periodIds.map((placeholderId): TemplateSlot => ({
      kind: "period",
      placeholderId,
    })),
    ...references.cohortIds.map((placeholderId): TemplateSlot => ({
      kind: "cohort",
      placeholderId,
    })),
    ...references.cohortMemberIds.map((placeholderId): TemplateSlot => ({
      kind: "cohort-member",
      placeholderId,
    })),
    ...friendSlots.values(),
  ];
}

/**
 * Resolve every slot to an entity id: the explicit pick when there is one,
 * otherwise the first available entity of the right kind — which is what
 * makes a live preview meaningful before anyone touches a picker.
 */
export function resolveSlotMapping(
  slots: readonly TemplateSlot[],
  optionsByKind: Record<TemplateSlotKind, ReadonlyArray<{ value: string }>>,
  picks?: ReadonlyMap<string, string>,
  optionsForSlot?: (
    slot: TemplateSlot,
  ) => ReadonlyArray<{ value: string }> | undefined,
): Map<string, string> {
  const resolved = new Map<string, string>();
  const occurrences = new Map<string, number>();
  for (const slot of slots) {
    occurrences.set(
      slot.placeholderId,
      (occurrences.get(slot.placeholderId) ?? 0) + 1,
    );
  }
  for (const slot of slots) {
    const key = templateSlotKey(slot);
    const options = optionsForSlot?.(slot) ?? optionsByKind[slot.kind] ?? [];
    const requested =
      picks?.get(key) ??
      // Compatibility with callers written before slot kinds were part of the key.
      (occurrences.get(slot.placeholderId) === 1
        ? picks?.get(slot.placeholderId)
        : undefined);
    // A pick belongs to the option set that produced it. This matters for dependent
    // slots: after the class changes, a classmate from the old class may still be in the
    // caller's local state, but it is no longer a valid answer for this slot. Falling back
    // to the first current option keeps the preview and the installed definition on the
    // same coherent pair instead of persisting a card that can only evaluate to empty.
    const chosen =
      requested && options.some((option) => option.value === requested)
        ? requested
        : (options[0]?.value ?? "");
    if (!chosen) continue;
    resolved.set(key, chosen);
    // Preserve the old lookup for an unambiguous placeholder. A shared user id can be
    // both a classmate and a friend, so that alias must not exist when two kinds use it.
    if (occurrences.get(slot.placeholderId) === 1) {
      resolved.set(slot.placeholderId, chosen);
    }
  }
  return resolved;
}

function slotReplacement(
  mapping: ReadonlyMap<string, string>,
  kind: TemplateSlotKind,
  placeholderId: string,
  friendRequirement?: TemplateFriendRequirement,
): string {
  return (
    mapping.get(templateSlotKey({ kind, placeholderId, friendRequirement })) ??
    // A mapping persisted by the first friend-slot implementation did not name the
    // sharing surface. It is still safe for a definition with one friend requirement.
    (friendRequirement
      ? mapping.get(templateSlotKey({ kind, placeholderId }))
      : undefined) ??
    // Accept mappings produced by the old helper for definitions without ambiguous ids.
    mapping.get(placeholderId) ??
    placeholderId
  );
}

function substituteScope(
  scope: WidgetScope | undefined,
  mapping: ReadonlyMap<string, string>,
): WidgetScope | undefined {
  if (scope?.kind === "subjects") {
    return {
      ...scope,
      subjectIds: scope.subjectIds.map((id) =>
        slotReplacement(mapping, "subject", id),
      ),
    };
  }
  if (scope?.kind === "custom-average") {
    return {
      ...scope,
      averageId: slotReplacement(mapping, "custom-average", scope.averageId),
    };
  }
  return scope;
}

function substituteWindow(
  window: WidgetWindow | undefined,
  mapping: ReadonlyMap<string, string>,
): WidgetWindow | undefined {
  return window?.kind === "period"
    ? {
        ...window,
        periodId: slotReplacement(mapping, "period", window.periodId),
      }
    : window;
}

function substituteFormula(
  formula: WidgetFormula,
  mapping: ReadonlyMap<string, string>,
): WidgetFormula {
  switch (formula.kind) {
    case "metric":
      return {
        ...formula,
        ...(formula.scope
          ? { scope: substituteScope(formula.scope, mapping) }
          : {}),
        ...(formula.window
          ? { window: substituteWindow(formula.window, mapping) }
          : {}),
      };
    case "unary":
      return {
        ...formula,
        operand: substituteFormula(formula.operand, mapping),
      };
    case "binary":
    case "compare":
      return {
        ...formula,
        left: substituteFormula(formula.left, mapping),
        right: substituteFormula(formula.right, mapping),
      };
    case "conditional":
      return {
        ...formula,
        condition: substituteFormula(formula.condition, mapping),
        whenTrue: substituteFormula(formula.whenTrue, mapping),
        whenFalse: substituteFormula(formula.whenFalse, mapping),
      };
    default:
      return formula;
  }
}

/**
 * Swap the author's entity ids for the installer's picks. Ids are long
 * random identifiers, so a whole-document string substitution is exact; the
 * result is re-parsed fresh so no reference to the template's object leaks.
 */
export function substituteSlots(
  definition: WidgetDefinition,
  mapping: ReadonlyMap<string, string>,
): WidgetDefinition {
  const measures = definition.analysis.measures.map((entry) => {
    const expression = entry.expression;
    if (expression.kind === "formula") {
      return {
        ...entry,
        expression: {
          ...expression,
          formula: substituteFormula(expression.formula, mapping),
        },
      };
    }
    const friendRequirement = friendRequirementForMetric(expression.metric);
    const memberKind: TemplateSlotKind | null =
      expression.metric === "memberAverage"
        ? "cohort-member"
        : friendRequirement
          ? "friend"
          : null;
    return {
      ...entry,
      expression: {
        ...expression,
        ...(expression.goalId
          ? {
              goalId: slotReplacement(mapping, "goal", expression.goalId),
            }
          : {}),
        ...(expression.groupId
          ? {
              groupId: slotReplacement(
                mapping,
                "cohort",
                expression.groupId,
              ),
            }
          : {}),
        ...(memberKind && expression.memberId
          ? {
              memberId: slotReplacement(
                mapping,
                memberKind,
                expression.memberId,
                friendRequirement ?? undefined,
              ),
            }
          : {}),
      },
    };
  });
  const comparison = definition.analysis.comparison;
  return {
    ...definition,
    query: {
      ...definition.query,
      scope: substituteScope(definition.query.scope, mapping)!,
      window: substituteWindow(definition.query.window, mapping)!,
    },
    analysis: {
      ...definition.analysis,
      measures,
      comparison:
        comparison.kind === "window-pair"
          ? {
              ...comparison,
              left: substituteWindow(comparison.left, mapping)!,
              right: substituteWindow(comparison.right, mapping)!,
            }
          : comparison,
    },
  };
}
