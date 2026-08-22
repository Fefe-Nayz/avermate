export interface GradeManagement {
  mode: "provider" | "user"
  syncState: "managed" | "missing" | "dismissed" | "detached"
  externalId: string | null
  provider: string | null
  providerLabel: string | null
  connectionStatus:
    "pending" | "active" | "error" | "revoked" | "disconnected" | null
  gradesAuthority: boolean
  sourceValue: number | null
  sourceOutOf: number | null
  significant: boolean
  lockedFields: string[]
  editableFields: string[]
}

export interface GradeComponentPatch {
  name: string
  value: number
  outOf: number
  coefficient: number
}

export interface GradeEditPatch {
  name: string
  subjectId: string
  value: number
  outOf: number
  coefficient: number
  bonus: number
  passedAt: Date
  typeId: string | null
  note: string | null
  excludedFromAverage: boolean
  components: GradeComponentPatch[]
}

/**
 * Provider results accept only local overlays.
 *
 * Keeping this projection outside the component makes the write boundary explicit and
 * testable: even a stale form value cannot accidentally rewrite the provider's mark,
 * subject or timestamp.
 */
export function gradeUpdateInput(
  gradeId: string,
  management: GradeManagement | undefined,
  patch: GradeEditPatch
) {
  if (management?.mode === "provider") {
    return {
      gradeId,
      bonus: patch.bonus,
      note: patch.note,
      typeId: patch.typeId,
      excludedFromAverage: patch.excludedFromAverage,
    }
  }

  return { gradeId, ...patch }
}

export function gradeFieldIsLocked(
  management: GradeManagement | undefined,
  field: string
): boolean {
  return (
    management?.mode === "provider" && management.lockedFields.includes(field)
  )
}

export function gradeFieldNeedsValidation(
  management: GradeManagement | undefined,
  field: string
): boolean {
  return !gradeFieldIsLocked(management, field)
}
