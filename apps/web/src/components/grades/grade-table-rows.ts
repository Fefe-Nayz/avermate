import { gradeRatio, type Grade, type Subject } from "@avermate/core"

/**
 * What the grade table shows, once a search and an order have been applied.
 *
 * Both were half-done. The search kept a subject when *either* its name or one of
 * its grades matched, and then drew every grade it had — so typing the name of one
 * assessment answered with the whole term, which is the opposite of a search. And
 * the sort control on the page never reached this table at all: the badges were
 * hard-coded newest-first, so choosing "best result" changed the other two views
 * and silently did nothing here.
 *
 * Kept as a pure function because these are rules, not rendering: which grades a
 * query is asking about is exactly the kind of thing that should be checkable
 * without a browser.
 */

export type GradeOrder = "newest" | "oldest" | "best" | "worst"

export interface GradeTableRow {
  subject: Subject
  depth: number
  grades: Grade[]
  /**
   * Whether the subject itself answered the query.
   *
   * The distinction the search turns on: a subject that matched is being asked
   * about as a subject, so it keeps all its grades. One reached only through a
   * grade shows that grade and nothing else.
   */
  matchedSubject: boolean
}

function haystack(subject: Subject): string {
  return `${subject.name} ${subject.shortName ?? ""}`.toLocaleLowerCase()
}

/**
 * Grades in the asked-for order.
 *
 * Ties break on the day sat and then on id, so the order is the same on every
 * render rather than however the array arrived — a badge row that reshuffles
 * between renders reads as data changing.
 */
export function sortGrades(
  grades: readonly Grade[],
  order: GradeOrder
): Grade[] {
  const byDay = (left: Grade, right: Grade) =>
    left.passedAt.getTime() - right.passedAt.getTime() ||
    left.id.localeCompare(right.id)

  if (order === "newest") return [...grades].sort((a, b) => byDay(b, a))
  if (order === "oldest") return [...grades].sort(byDay)

  // A grade that does not count has no result to rank, so it goes last either
  // way rather than pretending to be a zero or a perfect score.
  const rank = (grade: Grade) => gradeRatio(grade)
  return [...grades].sort((left, right) => {
    const a = rank(left)
    const b = rank(right)
    if (a === null && b === null) return byDay(right, left)
    if (a === null) return 1
    if (b === null) return -1
    return (order === "best" ? b - a : a - b) || byDay(right, left)
  })
}

export function gradeTableRows(
  /** The tree as displayed, in display order. */
  flattened: ReadonlyArray<{ subject: Subject; depth: number }>,
  { query, order }: { query: string; order: GradeOrder }
): GradeTableRow[] {
  const needle = query.trim().toLocaleLowerCase()

  return flattened.flatMap(({ subject, depth }) => {
    const matchedSubject =
      needle.length === 0 || haystack(subject).includes(needle)
    const matching =
      needle.length === 0
        ? subject.grades
        : subject.grades.filter((grade) =>
            grade.name.toLocaleLowerCase().includes(needle)
          )

    // Named, or holding something named. A subject that is neither is not part
    // of the answer — including its ancestors, which is why the indent of a
    // matched child can look orphaned: it is, and saying so is honest.
    if (!matchedSubject && matching.length === 0) return []

    return [
      {
        subject,
        depth,
        matchedSubject,
        grades: sortGrades(matchedSubject ? subject.grades : matching, order),
      },
    ]
  })
}
