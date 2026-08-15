/**
 * The slot logic is shared with the mobile app and lives in core; this
 * module keeps the historical import path for the web's call sites.
 */
export {
  resolveSlotMapping,
  substituteSlots,
  templateSlots,
  type TemplateSlot,
  type TemplateSlotKind,
} from "@avermate/core"
