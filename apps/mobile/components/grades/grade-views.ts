import type { Grade, Subject, SubjectGraph } from "@avermate/core";

/**
 * The pure half of the grades views: everything the calendar and the table
 * compute before anything is drawn. Kept free of react-native imports so the
 * unit tests can exercise the exact code the screens run.
 *
 * Date arithmetic is done in local time on purpose, mirroring the web's
 * calendar: a grade sat late in the evening belongs to the day the student
 * remembers sitting it, not to its UTC date.
 */

export type GradesView = "timeline" | "table" | "calendar";

export const GRADES_VIEWS: readonly GradesView[] = [
  "timeline",
  "table",
  "calendar",
];

/** Whatever storage hands back, narrowed to a real view. */
export function asGradesView(value: string | null | undefined): GradesView {
  return value === "table" || value === "calendar" ? value : "timeline";
}

// ------------------------------------------------------------------ calendar

/** A local calendar day, as a stable key. Never `toISOString` — that shifts. */
export function dayKey(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/** Grades bucketed by the local day they were sat. */
export function groupGradesByDay(
  grades: readonly Grade[],
): Map<string, Grade[]> {
  const byDay = new Map<string, Grade[]>();
  for (const grade of grades) {
    const key = dayKey(grade.passedAt);
    const list = byDay.get(key);
    if (list) list.push(grade);
    else byDay.set(key, [grade]);
  }
  return byDay;
}

export function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

/** Works on month starts; the day always lands on the 1st, so nothing clamps. */
export function addMonths(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * The days a month grid has to draw — whole weeks, as rows, so the grid stays
 * rectangular and the weekday columns line up. Day cells are built from the
 * week start by day offset, which keeps the maths safe across DST changes.
 */
export function monthMatrix(month: Date, weekStartsOn: 0 | 1): Date[][] {
  const first = startOfMonth(month);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);

  const weeks: Date[][] = [];
  let cursor = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  while (cursor.getTime() <= last.getTime()) {
    const week: Date[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      week.push(
        new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate() + offset,
        ),
      );
    }
    weeks.push(week);
    cursor = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 7,
    );
  }
  return weeks;
}

/** How many days of the visible month actually carry results. */
export function monthResultDays(
  weeks: readonly (readonly Date[])[],
  byDay: ReadonlyMap<string, readonly Grade[]>,
  month: Date,
): number {
  let count = 0;
  for (const week of weeks) {
    for (const day of week) {
      if (sameMonth(day, month) && byDay.has(dayKey(day))) count += 1;
    }
  }
  return count;
}

/**
 * The day of the most recent result, or the fallback when there is none. The
 * calendar opens here rather than on today: a student looking at a finished
 * term should not have to page backwards.
 */
export function latestGradeDay(grades: readonly Grade[], fallback: Date): Date {
  let latest: Date | null = null;
  for (const grade of grades) {
    if (latest === null || grade.passedAt > latest) latest = grade.passedAt;
  }
  return latest ?? fallback;
}

// --------------------------------------------------------------------- table

export interface GradeTableRow {
  subject: Subject;
  depth: number;
}

/**
 * One row per subject, in hierarchy order, filtered the way the web table
 * filters: a subject stays when its own name matches or when any of its
 * grades does — so searching for a test title keeps its subject visible.
 */
export function gradeTableRows(
  graph: SubjectGraph,
  query: string,
): GradeTableRow[] {
  const needle = query.trim().toLocaleLowerCase();
  return graph
    .flatten()
    .filter((subject) => {
      if (!needle) return true;
      return (
        subject.name.toLocaleLowerCase().includes(needle) ||
        subject.grades.some((grade) =>
          grade.name.toLocaleLowerCase().includes(needle),
        )
      );
    })
    .map((subject) => ({ subject, depth: graph.depthOf(subject.id) }));
}

/** The order a row's badges read in: most recent result first. */
export function newestFirst(grades: readonly Grade[]): Grade[] {
  return [...grades].sort(
    (left, right) => right.passedAt.getTime() - left.passedAt.getTime(),
  );
}
