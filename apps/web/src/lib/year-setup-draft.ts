export const YEAR_SETUP_DRAFT_VERSION = 1 as const

export type YearSetupMode = "first" | "additional"
export type YearSetupStep = "year" | "preset" | "periods"
export type YearSetupPeriodTemplate =
  "trimesters" | "semesters" | "semesters-cumulative" | "quarters" | "none"

export interface YearSetupDraft {
  version: typeof YEAR_SETUP_DRAFT_VERSION
  idempotencyKey: string
  name: string
  startsAt: string
  endsAt: string
  scale: string
  presetId: string | null
  periodTemplate: YearSetupPeriodTemplate
  step: YearSetupStep
}

export interface DraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function yearSetupDraftKey(mode: YearSetupMode): string {
  return `avermate:year-setup:${mode}`
}

function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isTemplate(value: unknown): value is YearSetupPeriodTemplate {
  return (
    value === "trimesters" ||
    value === "semesters" ||
    value === "semesters-cumulative" ||
    value === "quarters" ||
    value === "none"
  )
}

function isStep(value: unknown): value is YearSetupStep {
  return value === "year" || value === "preset" || value === "periods"
}

export function parseYearSetupDraft(value: unknown): YearSetupDraft | null {
  if (!value || typeof value !== "object") return null
  const draft = value as Partial<YearSetupDraft>

  if (
    draft.version !== YEAR_SETUP_DRAFT_VERSION ||
    typeof draft.idempotencyKey !== "string" ||
    draft.idempotencyKey.length < 8 ||
    typeof draft.name !== "string" ||
    !isIsoDay(draft.startsAt) ||
    !isIsoDay(draft.endsAt) ||
    typeof draft.scale !== "string" ||
    (draft.presetId !== null && typeof draft.presetId !== "string") ||
    !isTemplate(draft.periodTemplate) ||
    !isStep(draft.step)
  ) {
    return null
  }

  return draft as YearSetupDraft
}

export function readYearSetupDraft(
  storage: DraftStorage,
  mode: YearSetupMode
): YearSetupDraft | null {
  const key = yearSetupDraftKey(mode)
  const serialized = storage.getItem(key)
  if (!serialized) return null

  try {
    const draft = parseYearSetupDraft(JSON.parse(serialized))
    if (!draft) storage.removeItem(key)
    return draft
  } catch {
    storage.removeItem(key)
    return null
  }
}

export function writeYearSetupDraft(
  storage: DraftStorage,
  mode: YearSetupMode,
  draft: YearSetupDraft
): void {
  storage.setItem(yearSetupDraftKey(mode), JSON.stringify(draft))
}

export function clearYearSetupDraft(
  storage: DraftStorage,
  mode: YearSetupMode
): void {
  storage.removeItem(yearSetupDraftKey(mode))
}
