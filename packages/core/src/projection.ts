import { quantile } from "./analytics";
import { gradeRatio, SubjectGraph, type Scope } from "./graph";
import type { Grade } from "./types";

/**
 * Where the average could end up, as scenarios.
 *
 * A band around a projection is the single easiest chart in this app to lie with, so
 * what this produces is named for what it is. Four different things get drawn the
 * same way and mean entirely different things:
 *
 * - a **range** band: the extremes, everything perfect against everything zero
 * - a **scenario** band: *if your next results look like X* — no model, no probability
 * - a **confidence** band: uncertainty about a fitted parameter
 * - a **prediction** band: where a future observation falls, with a stated coverage
 *
 * This is the second, and it is the only one honest to build from what the app knows.
 * The band comes from the reader's own past marks: each scenario replays the remaining
 * assessments at one of their own quantiles, so "optimistic" means *as well as your
 * best quarter has gone*, not a hoped-for number. There is no distribution assumed, no
 * coverage claimed, and nothing here may be labelled as confidence.
 *
 * The path is computed by pinning hypothetical marks and re-averaging — the same
 * `withPlanned` mechanism the goal planner uses — so a scenario is exactly what the
 * average *would say*, including every coefficient and every level of nesting. A
 * formula over a summary would drift from the app's own arithmetic.
 *
 * `low ≤ center ≤ high` holds by construction: the average is monotone in the marks
 * added, and the quantiles are ordered. It is asserted anyway, because the day that
 * stops being true the band must stop being drawn rather than be drawn upside down.
 */

/**
 * What a band *is*, and the four are not interchangeable.
 *
 * `control` is the fifth and the odd one out: the others describe where a reading could
 * *go*, and it describes where readings have *been*. Kept in the same vocabulary anyway,
 * because every renderer that draws a band has to say which of the five it is — and the
 * caption switch is exhaustive, so a new kind cannot be drawn unlabelled.
 */
export type IntervalKind =
  | "range"
  | "scenario"
  | "confidence"
  | "prediction"
  | "control";

export interface IntervalPoint {
  key: string;
  /** Assessments from now: 0 is today, 1 is after the next result. */
  step: number;
  low: number;
  center: number;
  high: number;
  /** The average as it actually stands, on the point where it is known. */
  observed: number | null;
}

export interface ProjectionBand {
  /** What the band *is*. Never widened to "confidence" by a renderer. */
  intervalKind: IntervalKind;
  points: IntervalPoint[];
  /** The quantiles the three scenarios replay, for a caption that says so. */
  quantiles: { low: number; center: number; high: number };
  /** How many marks the scenarios were drawn from. Few marks, weak scenarios. */
  sample: number;
}

/** Below this, past marks say too little to build a scenario from. */
export const PROJECTION_MINIMUM_SAMPLE = 3;

/** Assessments ahead worth drawing: past this a band is a wash rather than a path. */
export const PROJECTION_MAXIMUM_STEPS = 12;

/**
 * A scenario band from the reader's own past marks.
 *
 * `remaining` is the expected number of further assessments per subject — the goal
 * planner's own estimate — and the walk adds them one at a time in the order the
 * subjects come, so each step is "one more result". `null` when there is nothing to
 * project from: no average yet, no assessments left, or too few marks to have
 * quantiles worth the name.
 */
export function projectionBand(
  graph: SubjectGraph,
  remaining: (subjectId: string) => number,
  scope: Scope | null = null,
  quantiles: { low: number; center: number; high: number } = {
    low: 0.25,
    center: 0.5,
    high: 0.75,
  },
): ProjectionBand | null {
  const current = graph.ratio(null, scope);
  if (current === null) return null;

  const ratios = graph
    .allGrades()
    .map((grade) => gradeRatio(grade))
    .filter((ratio): ratio is number => ratio !== null);
  if (ratios.length < PROJECTION_MINIMUM_SAMPLE) return null;

  const low = quantile(ratios, quantiles.low);
  const center = quantile(ratios, quantiles.center);
  const high = quantile(ratios, quantiles.high);
  if (low === null || center === null || high === null) return null;

  // One planned assessment per step, taking the subjects in turn and stopping at the
  // count the planner expects for each. Weighted by the subject's usual coefficient,
  // because that is what the next result there will carry.
  const queue: Array<{ subjectId: string; coefficient: number }> = [];
  for (const subject of graph.contributorsOf(null)) {
    const count = Math.max(0, Math.round(remaining(subject.id)));
    const usual = usualCoefficient(graph.allGrades(subject.id));
    for (let index = 0; index < count; index += 1) {
      queue.push({ subjectId: subject.id, coefficient: usual });
    }
  }
  if (queue.length === 0) return null;

  const steps = Math.min(queue.length, PROJECTION_MAXIMUM_STEPS);
  const points: IntervalPoint[] = [
    {
      key: "0",
      step: 0,
      low: current,
      center: current,
      high: current,
      // Today is the one point that is not a scenario.
      observed: current,
    },
  ];

  for (let step = 1; step <= steps; step += 1) {
    const planned = queue.slice(0, step);
    const at = (ratio: number) =>
      plannedGraph(graph, planned, ratio).ratio(null, scope) ?? current;
    const point = {
      key: String(step),
      step,
      low: at(low),
      center: at(center),
      high: at(high),
      observed: null,
    };
    // Monotone in the mark added, so this holds — and if it ever does not, the band
    // is wrong rather than merely surprising, so it is not drawn.
    if (!(point.low <= point.center && point.center <= point.high)) return null;
    points.push(point);
  }

  return {
    intervalKind: "scenario",
    points,
    quantiles,
    sample: ratios.length,
  };
}

/**
 * The coefficient a subject's next result will most likely carry: the one its marks
 * usually carry. The median rather than the mean, so a single heavily weighted exam
 * does not set the weight of every future homework.
 */
function usualCoefficient(grades: readonly Grade[]): number {
  const coefficients = grades
    .map((grade) => grade.coefficient)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (coefficients.length === 0) return 1;
  return quantile(coefficients, 0.5) ?? 1;
}

const PLANNED_PREFIX = "__projected__";

/** The graph with `planned` hypothetical marks, all at `ratio`. */
function plannedGraph(
  graph: SubjectGraph,
  planned: ReadonlyArray<{ subjectId: string; coefficient: number }>,
  ratio: number,
): SubjectGraph {
  const bySubject = new Map<string, number[]>();
  for (const item of planned) {
    const list = bySubject.get(item.subjectId);
    if (list) list.push(item.coefficient);
    else bySubject.set(item.subjectId, [item.coefficient]);
  }
  return graph.withSubjects((subject) => {
    const coefficients = bySubject.get(subject.id);
    if (!coefficients) return subject;
    return {
      ...subject,
      grades: [
        ...subject.grades,
        ...coefficients.map((coefficient, index) => ({
          id: `${PLANNED_PREFIX}${subject.id}:${index}`,
          name: "",
          // Out of a hundred, so any ratio is expressible without rounding.
          value: ratio * 100,
          outOf: 100,
          coefficient,
          passedAt: new Date(0),
          createdAt: new Date(0),
          subjectId: subject.id,
          periodId: null,
          components: [],
        })),
      ],
    };
  });
}
