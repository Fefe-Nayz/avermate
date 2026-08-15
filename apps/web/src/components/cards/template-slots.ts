import {
  collectWidgetReferences,
  type WidgetDefinitionV1,
} from "@avermate/core"

export type TemplateSlotKind = "subject" | "custom-average" | "goal" | "period"

export interface TemplateSlot {
  kind: TemplateSlotKind
  /** The author's entity id embedded in the published definition. */
  placeholderId: string
}

/**
 * A template's slots are simply the entity references its author left in the
 * definition: each one is an "essential option" the installer re-points at
 * an entity of their own before the card is created.
 */
export function templateSlots(definition: WidgetDefinitionV1): TemplateSlot[] {
  const references = collectWidgetReferences(definition)
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
  ]
}

/**
 * Resolve every slot to an entity id: the explicit pick when there is one,
 * otherwise the first available entity of the right kind — which is what
 * makes a live preview meaningful before anyone touches a picker.
 */
export function resolveSlotMapping(
  slots: readonly TemplateSlot[],
  optionsByKind: Record<TemplateSlotKind, ReadonlyArray<{ value: string }>>,
  picks?: ReadonlyMap<string, string>
): Map<string, string> {
  const resolved = new Map<string, string>()
  for (const slot of slots) {
    const chosen =
      picks?.get(slot.placeholderId) ?? optionsByKind[slot.kind][0]?.value ?? ""
    if (chosen) resolved.set(slot.placeholderId, chosen)
  }
  return resolved
}

/**
 * Swap the author's entity ids for the installer's picks. Ids are long
 * random identifiers, so a whole-document string substitution is exact; the
 * result is re-parsed fresh so no reference to the template's object leaks.
 */
export function substituteSlots(
  definition: WidgetDefinitionV1,
  mapping: ReadonlyMap<string, string>
): WidgetDefinitionV1 {
  let serialized = JSON.stringify(definition)
  for (const [placeholderId, replacementId] of mapping) {
    if (!replacementId || placeholderId === replacementId) continue
    serialized = serialized.replaceAll(
      JSON.stringify(placeholderId),
      JSON.stringify(replacementId)
    )
  }
  return JSON.parse(serialized) as WidgetDefinitionV1
}
