import { gradeRatio, type Grade, type Subject } from "@avermate/core"

export type GradeSortKey = "date" | "oldest" | "best" | "worst" | "coefficient"
export type ChildSortKey = "custom" | "name" | "best" | "coefficient"

/** Expects newest-first input; "date" returns it untouched. */
export function sortGrades(
  rows: readonly Grade[],
  sort: GradeSortKey
): readonly Grade[] {
  switch (sort) {
    case "oldest":
      return [...rows].reverse()
    case "best":
      return [...rows].sort(
        (a, b) => (gradeRatio(b) ?? -1) - (gradeRatio(a) ?? -1)
      )
    case "worst":
      // Unratable grades sink to the bottom instead of posing as worst.
      return [...rows].sort(
        (a, b) => (gradeRatio(a) ?? 2) - (gradeRatio(b) ?? 2)
      )
    case "coefficient":
      return [...rows].sort((a, b) => b.coefficient - a.coefficient)
    default:
      return rows
  }
}

/** Matches on the grade's name and its subject's name, case-insensitively. */
export function filterGrades(
  rows: readonly Grade[],
  query: string,
  subjectNameOf: (subjectId: string) => string | undefined
): readonly Grade[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((grade) =>
    `${grade.name} ${subjectNameOf(grade.subjectId) ?? ""}`
      .toLowerCase()
      .includes(needle)
  )
}

/**
 * The three orders, applied to whatever a row actually shows.
 *
 * Rows rather than subjects, because the two lists that offer this order do not
 * show a subject's own numbers. A custom average overrides the coefficient per
 * entry and scopes the ratio to its own selection, so sorting the underlying
 * `Subject` would rank by figures the reader cannot see. Sorting what is on
 * screen is the only version that agrees with the screen.
 */
export interface SortableRow {
  name: string
  coefficient: number
  ratio: number | null
}

/** "custom" keeps the caller's (user-arranged) order untouched. */
export function sortRows<T extends SortableRow>(
  rows: readonly T[],
  sort: ChildSortKey
): readonly T[] {
  switch (sort) {
    case "name":
      return [...rows].sort((a, b) => a.name.localeCompare(b.name))
    case "best":
      return [...rows].sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))
    case "coefficient":
      return [...rows].sort((a, b) => b.coefficient - a.coefficient)
    default:
      return rows
  }
}

/**
 * A subject list, ordered by the same rules.
 *
 * "custom" returns the very array it was given, not a copy of it: callers rely
 * on the identity to skip work, and building rows only to map straight back
 * would allocate twice for a no-op.
 */
export function sortChildren(
  children: readonly Subject[],
  sort: ChildSortKey,
  ratioOf: (subjectId: string) => number | null
): readonly Subject[] {
  if (sort === "custom") return children
  return sortRows(
    children.map((subject) => ({
      name: subject.name,
      coefficient: subject.coefficient,
      ratio: ratioOf(subject.id),
      subject,
    })),
    sort
  ).map((row) => row.subject)
}
