import {
  GENERAL_SUBJECT_ID,
  type CustomAverage,
  type Grade,
  type Period,
  type Ratio,
  type Subject,
  type Year,
} from "./types";

/**
 * Overrides applied on top of the graph. Custom averages use `coefficients`;
 * "what if" simulations and the goal planner use `ratios` to pin a subject to a
 * hypothetical result and read the effect at the top.
 */
export interface Scope {
  readonly coefficients?: ReadonlyMap<string, number>;
  /** Forces a subject's own average, ignoring its grades and children. */
  readonly ratios?: ReadonlyMap<string, number>;
}

const EMPTY_SUBJECTS: readonly Subject[] = Object.freeze([]);

/**
 * A mark as a fraction of what it was out of, bonus included.
 *
 * The bonus is extra points on this mark's own scale — "+1 on that test" — because that
 * is the unit the person writing it down is thinking in, and it needs no knowledge of
 * the year to be meaningful.
 *
 * Clamped to 0..1 like every other ratio in the package. A 20/20 with a point of bonus
 * is still full marks: every reading downstream — bands, distributions, projections, the
 * scale of a chart — is built on that range, and letting one mark out at 1.05 would put
 * a point outside its own axis.
 */
export function gradeRatio(
  grade: Pick<Grade, "value" | "outOf"> & {
    bonus?: number | null;
    excludedFromAverage?: boolean;
    syncExcludedFromAverage?: boolean;
  },
): number | null {
  if (grade.excludedFromAverage || grade.syncExcludedFromAverage) return null;
  if (!Number.isFinite(grade.value) || !Number.isFinite(grade.outOf))
    return null;
  if (grade.outOf <= 0) return null;
  const bonus = Number.isFinite(grade.bonus ?? 0) ? (grade.bonus ?? 0) : 0;
  return clampRatio((grade.value + bonus) / grade.outOf);
}

/** The package's one clamp, kept local so `graph` does not import `format`. */
function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function coefficientWeight(value: number | null | undefined): number {
  return weight(value);
}

function weight(value: number | null | undefined): number {
  if (value === null || value === undefined) return 1;
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * The subject hierarchy plus every derived reading of it.
 *
 * Built once per (subjects, period) pair and then queried freely: averages are
 * memoised per scope, so a dashboard asking for forty different numbers still
 * walks the tree once.
 */
/**
 * What the general average is made of, when it is not the whole year.
 *
 * A year can nominate one of its custom averages to *be* its general average — a prépa
 * whose real headline is "moyenne des écrits", say. Expressed as the set of subjects that
 * average covers plus its coefficient overrides, rather than as a value, so the
 * substitution survives everything that derives a graph: a period filter, a simulation,
 * a card's own scope.
 *
 * Here rather than at the thirty-odd places that ask for `ratio(null)`, because every one
 * of them is asking the same question — what is this reader's average — and the answer
 * should not depend on which of them is asking.
 */
export interface GeneralAverageSource {
  /** Every subject the substituted average covers, descendants included. */
  readonly subjects: ReadonlySet<string>;
  readonly coefficients?: ReadonlyMap<string, number>;
}

export interface SubjectGraphOptions {
  /**
   * The year's scale, needed only for bonus points.
   *
   * A subject's bonus is in points — "+0.5" — and turning that into a ratio is the one
   * thing the graph cannot work out for itself. Absent, a bonus is ignored rather than
   * guessed at: a wrong scale would move an average silently, and no bonus at all is at
   * least the number the marks say.
   */
  readonly scale?: number;
  /** Extra points on whatever the general reading turns out to be. */
  readonly generalBonus?: number | null;
  readonly general?: GeneralAverageSource;
}

export class SubjectGraph {
  readonly subjects: readonly Subject[];
  readonly options: SubjectGraphOptions;

  private readonly byIdMap = new Map<string, Subject>();
  private readonly childrenMap = new Map<string | null, Subject[]>();
  private readonly depthMap = new Map<string, number>();
  private readonly contributorCache = new Map<string, readonly Subject[]>();
  private readonly ratioCaches = new Map<Scope | null, Map<string, Ratio>>();
  private rootContributorCache: readonly Subject[] | null = null;

  private generalGraph: SubjectGraph | null = null;
  private readonly mergedScopes = new Map<Scope | null, Scope>();

  constructor(subjects: readonly Subject[], options: SubjectGraphOptions = {}) {
    this.subjects = subjects;
    this.options = options;

    for (const subject of subjects) {
      this.byIdMap.set(subject.id, subject);
    }

    for (const subject of subjects) {
      // A parent that was deleted — or filtered out by a custom average —
      // would strand its children in an unreachable branch. Re-rooting keeps
      // their grades counting, at top level, with their own coefficient.
      const parentId =
        subject.parentId && this.byIdMap.has(subject.parentId)
          ? subject.parentId
          : null;
      const siblings = this.childrenMap.get(parentId);
      if (siblings) siblings.push(subject);
      else this.childrenMap.set(parentId, [subject]);
    }

    for (const siblings of this.childrenMap.values()) {
      siblings.sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );
    }
  }

  // ---------------------------------------------------------------- structure

  get roots(): readonly Subject[] {
    return this.childrenMap.get(null) ?? EMPTY_SUBJECTS;
  }

  byId(id: string): Subject | undefined {
    return this.byIdMap.get(id);
  }

  has(id: string): boolean {
    return this.byIdMap.has(id);
  }

  childrenOf(id: string | null): readonly Subject[] {
    return this.childrenMap.get(id) ?? EMPTY_SUBJECTS;
  }

  /** Distance from the root, 0-based. */
  depthOf(id: string): number {
    const cached = this.depthMap.get(id);
    if (cached !== undefined) return cached;

    let depth = 0;
    let current = this.byIdMap.get(id);
    const seen = new Set<string>();
    while (current && current.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = this.byIdMap.get(current.parentId);
      if (!parent) break;
      depth += 1;
      current = parent;
    }

    this.depthMap.set(id, depth);
    return depth;
  }

  /** Nearest ancestor first. */
  ancestorsOf(id: string): Subject[] {
    const ancestors: Subject[] = [];
    const seen = new Set<string>([id]);
    let current = this.byIdMap.get(id);
    while (current?.parentId && !seen.has(current.parentId)) {
      const parent = this.byIdMap.get(current.parentId);
      if (!parent) break;
      ancestors.push(parent);
      seen.add(parent.id);
      current = parent;
    }
    return ancestors;
  }

  descendantsOf(id: string): Subject[] {
    const out: Subject[] = [];
    const stack = [...this.childrenOf(id)];
    while (stack.length > 0) {
      const subject = stack.pop() as Subject;
      out.push(subject);
      stack.push(...this.childrenOf(subject.id));
    }
    return out;
  }

  /** Depth-first walk in display order. */
  flatten(rootId: string | null = null): Subject[] {
    const out: Subject[] = [];
    const visit = (parentId: string | null) => {
      for (const subject of this.childrenOf(parentId)) {
        out.push(subject);
        visit(subject.id);
      }
    };
    visit(rootId);
    return out;
  }

  /** Every grade in the graph (or in one sub-tree), oldest first. */
  allGrades(subjectId?: string): Grade[] {
    const pool =
      subjectId === undefined
        ? [...this.subjects]
        : [
            this.byIdMap.get(subjectId),
            ...this.descendantsOf(subjectId),
          ].filter((s): s is Subject => Boolean(s));

    const grades = pool.flatMap((subject) => subject.grades);
    grades.sort((a, b) => a.passedAt.getTime() - b.passedAt.getTime());
    return grades;
  }

  /**
   * The subjects that actually weigh into `subject`'s average: direct children,
   * except that a category is replaced by whatever sits underneath it. That is
   * what makes a category a grouping rather than a level of averaging.
   */
  contributorsOf(subjectId: string | null): readonly Subject[] {
    if (subjectId === null) {
      if (!this.rootContributorCache) {
        this.rootContributorCache = this.collectContributors(null);
      }
      return this.rootContributorCache;
    }

    const cached = this.contributorCache.get(subjectId);
    if (cached) return cached;

    const contributors = this.collectContributors(subjectId);
    this.contributorCache.set(subjectId, contributors);
    return contributors;
  }

  private collectContributors(rootId: string | null): readonly Subject[] {
    const contributors: Subject[] = [];
    const guard = new Set<string>(rootId === null ? [] : [rootId]);

    const walk = (parentId: string | null) => {
      for (const child of this.childrenOf(parentId)) {
        if (child.kind === "category" && !guard.has(child.id)) {
          guard.add(child.id);
          walk(child.id);
          continue;
        }
        if (child.kind === "category") continue;
        contributors.push(child);
      }
    };
    walk(rootId);

    return contributors;
  }

  // ----------------------------------------------------------------- averages

  /** The coefficient this subject weighs in with, after any scope override. */
  coefficientOf(subject: Subject, scope: Scope | null): number {
    const override = scope?.coefficients?.get(subject.id);
    if (override !== undefined) return weight(override);
    return weight(subject.coefficient);
  }

  /**
   * Weighted result of a subject as a ratio in 0..1.
   * `null` as the id means the general average across the whole year.
   */
  ratio(subjectId: string | null, scope: Scope | null = null): Ratio {
    let cache = this.ratioCaches.get(scope);
    if (!cache) {
      cache = new Map();
      this.ratioCaches.set(scope, cache);
    }

    const key = subjectId ?? GENERAL_SUBJECT_ID;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const result = this.computeRatio(subjectId, scope, new Set());
    cache.set(key, result);
    return result;
  }

  private computeRatio(
    subjectId: string | null,
    scope: Scope | null,
    visiting: Set<string>,
  ): Ratio {
    if (subjectId !== null) {
      const pinned = scope?.ratios?.get(subjectId);
      if (pinned !== undefined) return pinned;
      if (visiting.has(subjectId)) return null;
      visiting.add(subjectId);
    }

    /**
     * The general reading, when the year nominated an average to stand in for it.
     *
     * Delegated to a subset graph rather than reimplemented: `resolveCustomAverage`
     * already decides what "the subjects of this average" means — re-rooting a deep
     * sub-subject, dissolving categories the average did not take — and two answers to
     * that question would eventually disagree.
     */
    if (subjectId === null && this.options.general) {
      const source = this.options.general;
      this.generalGraph ??= new SubjectGraph(
        this.subjects.filter((item) => source.subjects.has(item.id)),
        // Not the general source itself, or it would substitute inside itself forever.
        // The bonus does travel: it is a bonus on the reader's general average, whatever
        // that average turns out to be made of.
        { scale: this.options.scale, generalBonus: this.options.generalBonus },
      );
      return this.generalGraph.ratio(null, this.scopeWith(scope, source));
    }

    let weighted = 0;
    let total = 0;

    const subject = subjectId === null ? null : this.byIdMap.get(subjectId);
    if (subjectId !== null && !subject) {
      visiting.delete(subjectId);
      return null;
    }

    if (subject) {
      for (const grade of subject.grades) {
        const ratio = gradeRatio(grade);
        if (ratio === null) continue;
        const coefficient = weight(grade.coefficient);
        if (coefficient === 0) continue;
        weighted += ratio * coefficient;
        total += coefficient;
      }
    }

    // The general average behaves like a category sitting above the roots:
    // root categories dissolve into it, root subjects weigh in individually.
    for (const child of this.contributorsOf(subjectId)) {
      const childRatio = this.computeRatio(child.id, scope, visiting);
      if (childRatio === null) continue;
      const coefficient = this.coefficientOf(child, scope);
      if (coefficient === 0) continue;
      weighted += childRatio * coefficient;
      total += coefficient;
    }

    if (subjectId !== null) visiting.delete(subjectId);
    if (total === 0) return null;
    return this.withBonus(weighted / total, subject ?? null);
  }

  /**
   * A ratio with its bonus points added.
   *
   * In points of the year's scale, because that is what somebody typing "+0.5" means —
   * so without a scale there is nothing to convert and the marks stand alone, which is
   * stated on `SubjectGraphOptions.scale`.
   */
  private withBonus(ratio: number, subject: Subject | null): number {
    const scale = this.options.scale;
    if (!scale || !Number.isFinite(scale) || scale <= 0) return ratio;
    const points = subject
      ? (subject.bonus ?? 0)
      : (this.options.generalBonus ?? 0);
    if (!Number.isFinite(points) || points === 0) return ratio;
    return clampRatio(ratio + points / scale);
  }

  /**
   * The caller's scope with the substituted average's coefficients laid over it.
   *
   * The average's own weights win: they are its definition, while a caller's scope is a
   * question being asked *of* it. Cached per caller scope because the ratio cache is
   * keyed by scope identity, and a fresh object each call would both miss the cache and
   * grow it without bound.
   */
  private scopeWith(scope: Scope | null, source: GeneralAverageSource): Scope {
    const cached = this.mergedScopes.get(scope);
    if (cached) return cached;
    const coefficients = new Map(scope?.coefficients ?? []);
    for (const [id, value] of source.coefficients ?? [])
      coefficients.set(id, value);
    const merged: Scope = { coefficients, ratios: scope?.ratios };
    this.mergedScopes.set(scope, merged);
    return merged;
  }

  /**
   * A graph restricted to `ids`. Subjects whose parent fell away are re-rooted,
   * so a custom average can pick a single deep sub-subject and have it weigh in
   * at top level. Grades come along untouched.
   */
  subset(ids: ReadonlySet<string>): SubjectGraph {
    /**
     * The scale travels; the substituted general average does not.
     *
     * A subset is a different universe — the subjects of one custom average, or the
     * part of a year somebody shares — and its general reading is *its own*. Carrying
     * the year's nomination in would have every subset answer with an average made of
     * subjects it does not contain, which is null at best and somebody else's number at
     * worst. The bonus points stay, because they belong to the subjects and the year.
     */
    return new SubjectGraph(
      this.subjects.filter((subject) => ids.has(subject.id)),
      { scale: this.options.scale },
    );
  }

  /** A graph with `mutate` applied to matching subjects — used by simulations. */
  withSubjects(map: (subject: Subject) => Subject): SubjectGraph {
    return new SubjectGraph(this.subjects.map(map), this.options);
  }
}

// -------------------------------------------------------------------- helpers

export interface ResolvedCustomAverage {
  graph: SubjectGraph;
  scope: Scope;
}

/**
 * Resolve a custom average against the year's graph: keep the chosen subjects
 * (plus whole sub-trees where asked for), and carry the coefficient overrides.
 */
export function resolveCustomAverage(
  graph: SubjectGraph,
  custom: CustomAverage,
): ResolvedCustomAverage {
  const include = new Set<string>();
  const coefficients = new Map<string, number>();

  for (const entry of custom.entries) {
    if (!graph.has(entry.subjectId)) continue;
    include.add(entry.subjectId);
    if (entry.coefficient !== null) {
      coefficients.set(entry.subjectId, entry.coefficient);
    }
    if (entry.includeChildren) {
      for (const descendant of graph.descendantsOf(entry.subjectId)) {
        include.add(descendant.id);
      }
    }
  }

  /**
   * The average's own bonus rides on the subset's general reading, which is what this
   * average *is*. `subset` carries the year's options forward, so the scale is already
   * there; only the bonus is the average's own rather than the year's.
   */
  const subset = graph.subset(include);
  return {
    graph: custom.bonus
      ? new SubjectGraph(subset.subjects, {
          ...subset.options,
          generalBonus: custom.bonus,
        })
      : subset,
    scope: { coefficients },
  };
}

/**
 * The subjects a custom average covers, for a year that nominated one as its general
 * average. The same walk `resolveCustomAverage` makes, without building a graph — the
 * substitution is expressed as a set so it can be handed to the graph at construction.
 */
export function generalAverageSource(
  graph: SubjectGraph,
  custom: CustomAverage,
): GeneralAverageSource {
  const subjects = new Set<string>();
  const coefficients = new Map<string, number>();
  for (const entry of custom.entries) {
    if (!graph.has(entry.subjectId)) continue;
    subjects.add(entry.subjectId);
    if (entry.coefficient !== null) {
      coefficients.set(entry.subjectId, entry.coefficient);
    }
    if (entry.includeChildren) {
      for (const descendant of graph.descendantsOf(entry.subjectId)) {
        subjects.add(descendant.id);
      }
    }
  }
  return { subjects, coefficients };
}

/** Ratio → the year's display scale (0.875 → 17.5/20 or 87.5/100). */
export function toScale(ratio: Ratio, scale: number): number | null {
  if (ratio === null) return null;
  return ratio * scale;
}

/**
 * Grades belonging to a period. A cumulative period reaches back to the start
 * of the year; a regular one keeps to its own window. An explicit `periodId`
 * always wins over dates — the user's own filing is the source of truth.
 */
export function gradesInPeriod(
  grades: readonly Grade[],
  period: Period | null,
  year: Pick<Year, "startsAt" | "endsAt"> | null,
): Grade[] {
  if (!period || period.id === FULL_YEAR_PERIOD_ID) return [...grades];

  const from = period.isCumulative
    ? (year?.startsAt ?? new Date(0))
    : period.startAt;
  const to = period.endAt;

  return grades.filter((grade) => {
    if (grade.periodId) {
      if (grade.periodId === period.id) return true;
      if (!period.isCumulative) return false;
      return grade.passedAt.getTime() <= to.getTime();
    }
    const at = grade.passedAt.getTime();
    return at >= from.getTime() && at <= to.getTime();
  });
}

/** A copy of `subjects` whose grades are restricted to `period`. */
export function restrictToPeriod(
  subjects: readonly Subject[],
  period: Period | null,
  year: Pick<Year, "startsAt" | "endsAt"> | null,
): Subject[] {
  if (!period || period.id === FULL_YEAR_PERIOD_ID) return [...subjects];
  return subjects.map((subject) => ({
    ...subject,
    grades: gradesInPeriod(subject.grades, period, year),
  }));
}

/** The implicit "whole year" period, always offered alongside the real ones. */
export const FULL_YEAR_PERIOD_ID = "__full_year__";

export function fullYearPeriod(
  year: Pick<Year, "startsAt" | "endsAt" | "generalBonus">,
  name: string,
): Period {
  return {
    id: FULL_YEAR_PERIOD_ID,
    name,
    startAt: year.startsAt,
    endAt: year.endsAt,
    isCumulative: true,
    generalBonus: year.generalBonus ?? 0,
    sortOrder: Number.MAX_SAFE_INTEGER,
  };
}

export function isFullYear(period: Period | null | undefined): boolean {
  return period?.id === FULL_YEAR_PERIOD_ID;
}

/** The period a date falls into, preferring non-cumulative ones. */
export function periodAt(periods: readonly Period[], at: Date): Period | null {
  const time = at.getTime();
  const matches = periods.filter(
    (period) =>
      period.id !== FULL_YEAR_PERIOD_ID &&
      time >= period.startAt.getTime() &&
      time <= period.endAt.getTime(),
  );
  if (matches.length === 0) return null;
  const specific = matches.filter((period) => !period.isCumulative);
  return (specific[0] ?? matches[0]) as Period;
}
