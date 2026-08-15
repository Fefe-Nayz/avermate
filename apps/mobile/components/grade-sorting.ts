import { gradeRatio, type Grade, type Subject } from "@avermate/core";

export type GradeSortKey = "date" | "oldest" | "best" | "worst" | "coefficient";
export type ChildSortKey = "custom" | "name" | "best" | "coefficient";

/** Expects newest-first input; "date" returns it untouched. */
export function sortGrades(
  rows: readonly Grade[],
  sort: GradeSortKey,
): readonly Grade[] {
  switch (sort) {
    case "oldest":
      return [...rows].reverse();
    case "best":
      return [...rows].sort(
        (a, b) => (gradeRatio(b) ?? -1) - (gradeRatio(a) ?? -1),
      );
    case "worst":
      // Unratable grades sink to the bottom instead of posing as worst.
      return [...rows].sort(
        (a, b) => (gradeRatio(a) ?? 2) - (gradeRatio(b) ?? 2),
      );
    case "coefficient":
      return [...rows].sort((a, b) => b.coefficient - a.coefficient);
    default:
      return rows;
  }
}

/** Matches on the grade's name and its subject's name, case-insensitively. */
export function filterGrades(
  rows: readonly Grade[],
  query: string,
  subjectNameOf: (subjectId: string) => string | undefined,
): readonly Grade[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((grade) =>
    `${grade.name} ${subjectNameOf(grade.subjectId) ?? ""}`
      .toLowerCase()
      .includes(needle),
  );
}

/** "custom" keeps the caller's (user-arranged) order untouched. */
export function sortChildren(
  children: readonly Subject[],
  sort: ChildSortKey,
  ratioOf: (subjectId: string) => number | null,
): readonly Subject[] {
  switch (sort) {
    case "name":
      return [...children].sort((a, b) => a.name.localeCompare(b.name));
    case "best":
      return [...children].sort(
        (a, b) => (ratioOf(b.id) ?? -1) - (ratioOf(a.id) ?? -1),
      );
    case "coefficient":
      return [...children].sort((a, b) => b.coefficient - a.coefficient);
    default:
      return children;
  }
}
