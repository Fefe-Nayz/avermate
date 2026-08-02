import { SubjectGraph, type Scope } from "./graph";
import type { Grade, Ratio, Subject } from "./types";

/**
 * Goal planning.
 *
 * The whole module rests on one property of the averaging engine: with the
 * coefficients fixed, an average is *affine* in any single input it depends on.
 * Pin a subject to 0 and read the top, pin it to 1 and read the top, and you
 * have the entire response curve — no search, no iteration, exact answers.
 *
 *     top(x) = top(0) + x · (top(1) − top(0))
 *
 * Everything below is that identity, inverted: "what does x have to be?"
 */

export type GoalScopeKind = "general" | "subject" | "custom";

export interface Goal {
  id: string;
  name: string;
  kind: GoalScopeKind;
  /** Subject or custom-average id, depending on `kind`. */
  referenceId: string | null;
  /** Target expressed as a ratio in 0..1. */
  targetRatio: number;
  /** Restricts the goal to one period. `null` means the whole year. */
  periodId: string | null;
  dueAt: Date | null;
  createdAt: Date;
  achievedAt: Date | null;
  /** Surfaced on the dashboard. */
  isPinned?: boolean;
  sortOrder?: number;
}

export type GoalStatus =
  | "achieved"
  /** Already impossible to miss, whatever happens next. */
  | "secured"
  | "on-track"
  | "at-risk"
  /** Not reachable any more, even with perfect results. */
  | "unreachable"
  | "no-data";

/** A hypothetical future assessment used to work out what is still needed. */
export interface PlannedAssessment {
  subjectId: string;
  coefficient: number;
  count: number;
}

export interface RequiredResult {
  /** Ratio needed on those assessments. Can exceed 1 — that is the point. */
  requiredRatio: number;
  achievable: boolean;
  /** True when even a zero keeps the goal, so nothing is actually required. */
  alreadySecured: boolean;
}

export interface Lever {
  subject: Subject;
  currentRatio: Ratio;
  /**
   * How far the tracked average moves when this subject goes from 0 to 1 —
   * its effective weight at the top, after every level of nesting.
   */
  leverage: number;
  /** Where this subject alone would have to land for the goal to be met. */
  requiredRatio: number | null;
  achievable: boolean;
  /** Gain if this subject reached the reference level (a realistic push). */
  realisticGain: number;
}

export interface GoalPlan {
  goal: Goal;
  status: GoalStatus;
  current: Ratio;
  target: number;
  /** Positive when there is still ground to cover. */
  gap: number | null;
  /** Best possible outcome if every remaining assessment were perfect. */
  ceiling: number | null;
  /** Worst possible outcome if every remaining assessment were a zero. */
  floor: number | null;
  /** Where the current trend lands, when there is enough history to fit one. */
  projection: number | null;
  /** What the next assessment in each candidate subject would have to be. */
  nextResults: Array<{ subject: Subject; coefficient: number } & RequiredResult>;
  /** "N more results at X" — the same answer read at several horizons. */
  horizons: Array<{ count: number } & RequiredResult>;
  /** Subjects ranked by how much a point there is worth at the top. */
  levers: Lever[];
  /** Plain-data advice the UI turns into localised sentences. */
  advice: GoalAdvice[];
}

export type GoalAdvice =
  | { kind: "achieved" }
  | { kind: "secured" }
  | { kind: "unreachable"; ceiling: number }
  | { kind: "no-data" }
  | { kind: "close"; gap: number }
  | { kind: "focus"; subjectId: string; leverage: number; requiredRatio: number }
  | { kind: "steady"; requiredRatio: number; count: number }
  | { kind: "protect"; subjectId: string; leverage: number }
  | { kind: "declining"; subjectId: string; delta: number };

// ---------------------------------------------------------------- primitives

function pinned(base: Scope | null, subjectId: string, value: number): Scope {
  const ratios = new Map(base?.ratios);
  ratios.set(subjectId, value);
  return { coefficients: base?.coefficients, ratios };
}

/**
 * The two ends of the response curve of `target` with respect to `subjectId`.
 * `null` when the subject does not reach the target at all.
 */
function endpoints(
  graph: SubjectGraph,
  target: string | null,
  subjectId: string,
  scope: Scope | null,
): { low: number; high: number } | null {
  const low = graph.ratio(target, pinned(scope, subjectId, 0));
  const high = graph.ratio(target, pinned(scope, subjectId, 1));
  if (low === null || high === null) return null;
  if (Math.abs(high - low) < 1e-12) return null;
  return { low, high };
}

/**
 * Invert the affine relation: the value `subjectId` must reach for `target` to
 * land exactly on `wanted`.
 */
export function requiredSubjectRatio(
  graph: SubjectGraph,
  target: string | null,
  subjectId: string,
  wanted: number,
  scope: Scope | null = null,
): number | null {
  const ends = endpoints(graph, target, subjectId, scope);
  if (!ends) return null;
  return (wanted - ends.low) / (ends.high - ends.low);
}

/** How much `target` moves when `subjectId` goes from 0 to 1. */
export function leverageOf(
  graph: SubjectGraph,
  target: string | null,
  subjectId: string,
  scope: Scope | null = null,
): number {
  const ends = endpoints(graph, target, subjectId, scope);
  return ends ? ends.high - ends.low : 0;
}

const PLANNED_PREFIX = "__planned__";

/** A graph with `count` hypothetical grades of ratio `ratio` added. */
function withPlanned(
  graph: SubjectGraph,
  planned: readonly PlannedAssessment[],
  ratio: number,
): SubjectGraph {
  const bySubject = new Map<string, PlannedAssessment[]>();
  for (const item of planned) {
    const list = bySubject.get(item.subjectId);
    if (list) list.push(item);
    else bySubject.set(item.subjectId, [item]);
  }

  return graph.withSubjects((subject) => {
    const items = bySubject.get(subject.id);
    if (!items) return subject;

    const extra: Grade[] = [];
    for (const item of items) {
      for (let index = 0; index < item.count; index += 1) {
        extra.push({
          id: `${PLANNED_PREFIX}${subject.id}:${extra.length}`,
          name: "",
          value: ratio * 100,
          outOf: 100,
          coefficient: item.coefficient,
          passedAt: new Date(),
          createdAt: new Date(),
          subjectId: subject.id,
          periodId: null,
          components: [],
        });
      }
    }

    return { ...subject, grades: [...subject.grades, ...extra] };
  });
}

/**
 * The ratio those planned assessments must all reach for `target` to hit
 * `wanted`. Affine again, so two probes are enough.
 */
export function requiredResult(
  graph: SubjectGraph,
  target: string | null,
  planned: readonly PlannedAssessment[],
  wanted: number,
  scope: Scope | null = null,
): RequiredResult | null {
  const low = withPlanned(graph, planned, 0).ratio(target, scope);
  const high = withPlanned(graph, planned, 1).ratio(target, scope);
  if (low === null || high === null) return null;
  if (Math.abs(high - low) < 1e-12) return null;

  const requiredRatio = (wanted - low) / (high - low);
  return {
    requiredRatio,
    achievable: requiredRatio <= 1 + 1e-9,
    alreadySecured: requiredRatio <= 0,
  };
}

// --------------------------------------------------------------------- plan

export interface PlanOptions {
  /** Subjects the user is likely to be assessed in next. Defaults to all. */
  candidateSubjects?: readonly Subject[];
  /** Typical coefficient of an upcoming assessment. */
  assumedCoefficient?: number;
  /** Horizons to report, in number of upcoming assessments. */
  horizons?: readonly number[];
  /** Series used to project the trend, when available. */
  projection?: number | null;
  /** Reference level a subject could realistically be pushed to. */
  realisticCeiling?: number;
  /**
   * How many more assessments each subject is expected to have. Declaring a
   * target unreachable is the strongest thing this module says, so it must be
   * measured against the results actually still to come — not against one.
   */
  remaining?: (subjectId: string) => number;
}

/**
 * Expected number of remaining assessments per subject, from the pace so far
 * and how much of the period is left. A subject graded five times in the first
 * two thirds of a year has about two and a half left.
 */
export function estimateRemaining(
  graph: SubjectGraph,
  from: Date,
  to: Date,
  now: Date = new Date(),
): (subjectId: string) => number {
  const span = to.getTime() - from.getTime();
  const elapsed = Math.min(
    Math.max(now.getTime() - from.getTime(), 0),
    span,
  );
  // Guard both ends: a period that has not started yet, and one already over.
  const progress = span <= 0 ? 1 : elapsed / span;
  const left = Math.max(0, 1 - progress);

  return (subjectId: string) => {
    const done = graph.allGrades(subjectId).length;
    if (done === 0) return progress > 0.9 ? 0 : 1;
    if (progress <= 0) return done;
    return Math.max(0, Math.round((done / progress) * left));
  };
}

function statusOf(
  current: Ratio,
  target: number,
  ceiling: number | null,
  floor: number | null,
  projection: number | null,
): GoalStatus {
  if (current === null) return "no-data";
  if (floor !== null && floor >= target - 1e-9) return "secured";
  if (current >= target - 1e-9) return "achieved";
  if (ceiling !== null && ceiling < target - 1e-9) return "unreachable";
  if (projection !== null && projection >= target - 1e-9) return "on-track";
  return "at-risk";
}

/**
 * Turn a goal into a plan: where you stand, what is still reachable, what the
 * next results have to be, and which subjects are worth the effort.
 */
export function planGoal(
  goal: Goal,
  graph: SubjectGraph,
  target: string | null,
  scope: Scope | null = null,
  options: PlanOptions = {},
): GoalPlan {
  const {
    assumedCoefficient = 1,
    horizons = [1, 2, 3, 5, 8],
    projection = null,
    realisticCeiling = 0.85,
  } = options;

  const current = graph.ratio(target, scope);
  const candidates = (
    options.candidateSubjects ??
    graph.subjects.filter((subject) => subject.kind !== "category")
  ).filter((subject) => leverageOf(graph, target, subject.id, scope) > 1e-9);

  // The ceiling and floor are what let the plan say "still possible" or
  // "already lost", so they are measured against the assessments genuinely
  // still to come rather than against a single hypothetical one.
  const countOf = options.remaining ?? (() => 1);
  const remaining: PlannedAssessment[] = candidates
    .map((subject) => ({
      subjectId: subject.id,
      coefficient: assumedCoefficient,
      count: Math.max(0, Math.round(countOf(subject.id))),
    }))
    .filter((item) => item.count > 0);
  const ceiling =
    remaining.length > 0
      ? withPlanned(graph, remaining, 1).ratio(target, scope)
      : current;
  const floor =
    remaining.length > 0
      ? withPlanned(graph, remaining, 0).ratio(target, scope)
      : current;

  const nextResults = candidates
    .map((subject) => {
      const required = requiredResult(
        graph,
        target,
        [{ subjectId: subject.id, coefficient: assumedCoefficient, count: 1 }],
        goal.targetRatio,
        scope,
      );
      return required
        ? { subject, coefficient: assumedCoefficient, ...required }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => a.requiredRatio - b.requiredRatio);

  const horizonResults = horizons
    .map((count) => {
      const spread: PlannedAssessment[] = candidates
        .slice(0, Math.max(1, Math.min(count, candidates.length)))
        .map((subject) => ({
          subjectId: subject.id,
          coefficient: assumedCoefficient,
          count: Math.max(
            1,
            Math.round(count / Math.max(1, Math.min(count, candidates.length))),
          ),
        }));
      const required = requiredResult(
        graph,
        target,
        spread,
        goal.targetRatio,
        scope,
      );
      return required ? { count, ...required } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const levers: Lever[] = candidates
    .map((subject) => {
      const leverage = leverageOf(graph, target, subject.id, scope);
      const currentRatio = graph.ratio(subject.id, scope);
      const requiredRatio = requiredSubjectRatio(
        graph,
        target,
        subject.id,
        goal.targetRatio,
        scope,
      );
      const reference = Math.max(currentRatio ?? 0, realisticCeiling);
      const realisticGain =
        currentRatio === null
          ? 0
          : Math.max(0, (reference - currentRatio) * leverage);

      return {
        subject,
        currentRatio,
        leverage,
        requiredRatio,
        achievable: requiredRatio !== null && requiredRatio <= 1 + 1e-9,
        realisticGain,
      };
    })
    .sort((a, b) => b.realisticGain - a.realisticGain || b.leverage - a.leverage);

  const status = statusOf(current, goal.targetRatio, ceiling, floor, projection);
  const gap = current === null ? null : goal.targetRatio - current;

  return {
    goal,
    status,
    current,
    target: goal.targetRatio,
    gap,
    ceiling,
    floor,
    projection,
    nextResults,
    horizons: horizonResults,
    levers,
    advice: adviseOn({ status, gap, ceiling, levers, horizons: horizonResults }),
  };
}

function adviseOn(input: {
  status: GoalStatus;
  gap: number | null;
  ceiling: number | null;
  levers: readonly Lever[];
  horizons: ReadonlyArray<{ count: number } & RequiredResult>;
}): GoalAdvice[] {
  const advice: GoalAdvice[] = [];

  if (input.status === "no-data") return [{ kind: "no-data" }];
  if (input.status === "secured") return [{ kind: "secured" }];
  if (input.status === "achieved") {
    advice.push({ kind: "achieved" });
    // Holding a result is its own task: name what would cost the most.
    const fragile = [...input.levers].sort((a, b) => b.leverage - a.leverage)[0];
    if (fragile) {
      advice.push({
        kind: "protect",
        subjectId: fragile.subject.id,
        leverage: fragile.leverage,
      });
    }
    return advice;
  }
  if (input.status === "unreachable") {
    return [{ kind: "unreachable", ceiling: input.ceiling ?? 0 }];
  }

  if (input.gap !== null && input.gap > 0 && input.gap < 0.01) {
    advice.push({ kind: "close", gap: input.gap });
  }

  for (const lever of input.levers.slice(0, 3)) {
    if (!lever.achievable || lever.requiredRatio === null) continue;
    if (lever.realisticGain <= 0) continue;
    advice.push({
      kind: "focus",
      subjectId: lever.subject.id,
      leverage: lever.leverage,
      requiredRatio: lever.requiredRatio,
    });
  }

  const reachable = input.horizons.find((horizon) => horizon.achievable);
  if (reachable) {
    advice.push({
      kind: "steady",
      requiredRatio: reachable.requiredRatio,
      count: reachable.count,
    });
  }

  return advice;
}
