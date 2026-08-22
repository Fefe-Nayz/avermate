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

/**
 * A kind of assessment, as the year defines it.
 *
 * The template a result was written from — its name, and the parts of a result it fills in
 * ahead of time. Carried into the core because a card can group by it: "how do I do on
 * orals against written papers" is a question about the *type*, and the evaluator needs
 * the name to label a bucket with.
 */
export interface GradeType {
  id: string;
  name: string;
  titlePrefix: string;
  coefficient: number;
  outOf: number;
  accent: string | null;
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
  /** Local overlay: keep the result visible without including it in averages. */
  excludedFromAverage?: boolean;
  /** Provider gate: ignored while its synchronized source is inactive or stale. */
  syncExcludedFromAverage?: boolean;
  passedAt: Date;
  createdAt: Date;
  subjectId: string;
  periodId: string | null;
  /**
   * The kind of assessment this was, where the year defines any.
   *
   * `null` on every result written before a year had types, and on any whose type was
   * deleted — a result outlives its template. Optional on the type so that a caller
   * building a grade by hand, and every fixture in this package, need not think about it.
   */
  typeId?: string | null;
  /**
   * Extra points on this result's own scale.
   *
   * A mark of 14/20 with a bonus of 1 reads as 15/20. Kept apart from `value` rather than
   * folded into it because the two are different facts — what was scored, and what was
   * added — and only the first is what the paper said.
   */
  bonus?: number | null;
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
  /**
   * Extra points on the year's scale, added to this subject's average.
   *
   * The scale is the year's, so the graph needs to be told it — see
   * `SubjectGraphOptions.scale`. Points rather than a ratio because that is the unit the
   * reader is given them in.
   */
  bonus?: number | null;
  /** Period-specific bonus points, keyed by period id. */
  periodBonuses?: Readonly<Record<string, number>>;
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
  /** Extra points on the general average for this period only. */
  generalBonus?: number | null;
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
  /**
   * A custom average nominated to be this year's general average, if any.
   *
   * The reading itself is arranged on the graph — see `SubjectGraphOptions.general` —
   * so this is the year's *statement of intent*, and the host resolves it. An id naming
   * an average that no longer exists resolves to nothing, and the general average is the
   * whole year again.
   */
  mainAverageId?: string | null;
  /** Extra points on this year's scale, added to the general average. */
  generalBonus?: number | null;
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
  /** Extra points on the year's scale, added to this average. */
  bonus?: number | null;
  /** @deprecated Custom averages never replace the general average. */
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
