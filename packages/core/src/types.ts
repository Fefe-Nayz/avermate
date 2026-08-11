/**
 * Domain types shared by the server and the web client.
 *
 * Everything here is plain data: the engine never touches the database or the
 * network, so the exact same code computes an average on a Next.js server
 * component, in the browser while the user drags a coefficient slider, and in
 * a unit test.
 */

/** A single weighted piece of a composite grade (e.g. "written" inside "midterm"). */
export interface GradeComponent {
  id: string;
  name: string;
  /** Points obtained, on this component's own `outOf` scale. */
  value: number;
  /** Maximum reachable points. Must be > 0 to count. */
  outOf: number;
  /** Relative weight inside the parent grade. */
  coefficient: number;
  sortOrder: number;
}

export interface Grade {
  id: string;
  name: string;
  /** Points obtained, on this grade's own `outOf` scale. */
  value: number;
  /** Maximum reachable points. A grade with `outOf <= 0` is ignored. */
  outOf: number;
  /** Relative weight inside its subject. */
  coefficient: number;
  passedAt: Date;
  createdAt: Date;
  subjectId: string;
  periodId: string | null;
  /** Free-form remark the user attached to the result. */
  note?: string | null;
  /**
   * When set, `value`/`outOf` are derived from these parts. Kept on the grade
   * so a reader never has to recompute to display the headline number.
   */
  components: GradeComponent[];
}

/**
 * How a subject participates in its parent's average.
 *
 * - `subject`: counted once, with its own coefficient, using its own average.
 * - `category`: transparent. Its children are lifted into the parent and
 *   weighted there individually. The category still shows an average of its
 *   own — it is a grouping in the UI, not a level of averaging.
 */
export type SubjectKind = "subject" | "category";

export interface Subject {
  id: string;
  name: string;
  /** Optional abbreviation used where space is tight (charts, mobile chips). */
  shortName: string | null;
  parentId: string | null;
  /** Weight inside the parent. Ignored when `kind === "category"`. */
  coefficient: number;
  kind: SubjectKind;
  /** Surfaced on the dashboard as a headline subject. */
  isMain: boolean;
  sortOrder: number;
  grades: Grade[];
}

export interface Period {
  id: string;
  name: string;
  startAt: Date;
  endAt: Date;
  /**
   * A cumulative period restarts nothing: it includes every grade from the
   * start of the year up to its own end (a "semester 2 including semester 1").
   */
  isCumulative: boolean;
  sortOrder: number;
}

export interface Year {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  /** Display scale for averages. 20 in France, 100 elsewhere, 4 for a GPA. */
  scale: number;
  /** Default `outOf` proposed when adding a grade. */
  defaultOutOf: number;
  /** Ratio at or above which a result counts as a pass, in 0..1. */
  passingRatio: number;
  /** Decimal places used when displaying averages. */
  decimals: number;
  /** Explicit user order. Optional for imported/plain calculation fixtures. */
  sortOrder?: number;
  /** Archived years stay recoverable but leave the everyday year picker. */
  archivedAt?: Date | null;
}

export interface CustomAverageEntry {
  subjectId: string;
  /** `null` keeps the subject's own coefficient. */
  coefficient: number | null;
  /** Pull every descendant of this subject in as well. */
  includeChildren: boolean;
}

export interface CustomAverage {
  id: string;
  name: string;
  entries: CustomAverageEntry[];
  isMain: boolean;
  sortOrder: number;
}

/** Identifies what an average is computed over. */
export type AverageTarget =
  | { type: "general" }
  | { type: "subject"; subjectId: string }
  | { type: "custom"; averageId: string };

/** Ratio in 0..1, or `null` when nothing weighs in. */
export type Ratio = number | null;

export const GENERAL_SUBJECT_ID = "__general__";
