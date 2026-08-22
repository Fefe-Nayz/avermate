import { coefficientWeight, SubjectGraph, type Scope } from "./graph";

/**
 * Why the general average moved.
 *
 * The most-asked question this app can answer and the easiest one to answer
 * dishonestly. A waterfall of contributions is only worth drawing if the steps
 * *add up* to the change — otherwise it is a bar chart of plausible numbers — and
 * the naive decomposition does not add up as soon as anything but the marks
 * changed.
 *
 * The average is a weighted mean over the contributors — the subjects that weigh in
 * directly, with categories dissolved, see `contributorsOf`:
 *
 *     A = Σ nᵢ mᵢ        where nᵢ = wᵢ / Σw
 *
 * so the change is `Σ (nᵢ' mᵢ' − nᵢ mᵢ)`, and each term splits **exactly** into a
 * mark effect and a weight effect:
 *
 *     nᵢ' mᵢ' − nᵢ mᵢ  =  n̄ᵢ (mᵢ' − mᵢ)  +  m̄ᵢ (nᵢ' − nᵢ)
 *     with n̄ = (nᵢ + nᵢ') / 2 and m̄ = (mᵢ + mᵢ') / 2
 *
 * That identity is algebraic, not an approximation — the cross terms cancel — which
 * is what makes this a symmetric decomposition rather than a first-order one. It is
 * the audit's "separate the mark effect from the weighting effect" and its
 * "symmetric, Shapley-style decomposition" at the same time: for two factors the
 * Shapley value *is* the average of the two orderings, which is this.
 *
 * A subject present in only one window is the case that breaks naive formulas. Its
 * weight there is zero — it is not in that average at all — and its mark is unknown
 * rather than zero. Taking the unknown mark to be the known one puts the whole of
 * its effect in the weight term, which is the honest reading: *this subject entering
 * the average* moved it, and by how much its own level differs from everything else.
 * Substituting zero instead would invent a catastrophic result nobody sat.
 *
 * Nothing here is ever scaled to make the steps meet the total. If they do not, the
 * remainder is returned as its own step and says so.
 */

export interface ContributionStep {
  /** Subject id, or `RESIDUAL_KEY` for the step that is not a subject. */
  key: string;
  label: string;
  /** The whole effect of this subject on the change. */
  delta: number;
  /** The part of `delta` that is this subject's own marks moving. */
  markEffect: number;
  /** The part of `delta` that is its weight in the average changing. */
  weightEffect: number;
  /** Where this step starts and ends, so a bar can be drawn without re-summing. */
  start: number;
  end: number;
  role: "increase" | "decrease" | "residual";
  /** Its normalised weight before and after, for a reader who asks why. */
  weightBefore: number;
  weightAfter: number;
  /** Its own average before and after, `null` where it had none. */
  averageBefore: number | null;
  averageAfter: number | null;
}

export interface ContributionBreakdown {
  startValue: number;
  endValue: number;
  steps: ContributionStep[];
}

export const RESIDUAL_KEY = "__residual__";

/** Tighter than any number a reader sees, loose enough for floating point. */
export const CONTRIBUTION_TOLERANCE = 1e-9;

interface Side {
  weight: number;
  normalised: number;
  average: number | null;
  label: string;
}

/**
 * Every contributor's normalised weight and own average, for one window.
 *
 * Only the contributors that *have* an average: the mean skips the others, so their
 * weight is not in the denominator either. Getting that wrong is what makes a
 * decomposition miss by the weight of every unassessed subject.
 */
function sideOf(graph: SubjectGraph, scope: Scope | null): Map<string, Side> {
  const entries: Array<[string, Side]> = [];
  let total = 0;
  for (const subject of graph.contributorsOf(null)) {
    const average = graph.ratio(subject.id, scope);
    if (average === null) continue;
    const weight = graph.coefficientOf(subject, scope);
    if (weight === 0) continue;
    total += weight;
    entries.push([
      subject.id,
      { weight, normalised: 0, average, label: subject.name },
    ]);
  }
  return new Map(
    entries.map(([id, side]) => [
      id,
      { ...side, normalised: total === 0 ? 0 : side.weight / total },
    ]),
  );
}

export function contributionBreakdown(
  before: SubjectGraph,
  after: SubjectGraph,
  scope: Scope | null = null,
): ContributionBreakdown | null {
  const startValue = before.ratio(null, scope);
  const endValue = after.ratio(null, scope);
  if (startValue === null || endValue === null) return null;

  const left = sideOf(before, scope);
  const right = sideOf(after, scope);
  const keys = [...new Set([...left.keys(), ...right.keys()])];

  const raw = keys.map((key) => {
    const from = left.get(key);
    const to = right.get(key);
    const weightBefore = from?.normalised ?? 0;
    const weightAfter = to?.normalised ?? 0;
    // An unknown mark is taken to be the known one, which puts the whole of an
    // entering or leaving subject's effect in the weight term. See the note above.
    const averageBefore = from?.average ?? to?.average ?? 0;
    const averageAfter = to?.average ?? from?.average ?? 0;
    const meanWeight = (weightBefore + weightAfter) / 2;
    const meanAverage = (averageBefore + averageAfter) / 2;
    const markEffect = meanWeight * (averageAfter - averageBefore);
    const weightEffect = meanAverage * (weightAfter - weightBefore);
    return {
      key,
      label: to?.label ?? from?.label ?? key,
      markEffect,
      weightEffect,
      delta: markEffect + weightEffect,
      weightBefore,
      weightAfter,
      averageBefore: from?.average ?? null,
      averageAfter: to?.average ?? null,
    };
  });

  // Biggest movers first: a waterfall is read as an explanation, and the largest
  // step is the explanation. Ties by name so the order is not the map's.
  raw.sort(
    (a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label),
  );

  const change = endValue - startValue;
  const explained = raw.reduce((sum, step) => sum + step.delta, 0);
  const residual = change - explained;

  const steps: ContributionStep[] = [];
  let cursor = startValue;
  for (const step of raw) {
    const end = cursor + step.delta;
    steps.push({
      ...step,
      start: cursor,
      end,
      role: step.delta >= 0 ? "increase" : "decrease",
    });
    cursor = end;
  }
  // Never adjusted into place: an unexplained remainder is shown as one.
  if (Math.abs(residual) > CONTRIBUTION_TOLERANCE) {
    steps.push({
      key: RESIDUAL_KEY,
      label: RESIDUAL_KEY,
      delta: residual,
      markEffect: 0,
      weightEffect: 0,
      start: cursor,
      end: cursor + residual,
      role: "residual",
      weightBefore: 0,
      weightAfter: 0,
      averageBefore: null,
      averageAfter: null,
    });
  }

  return { startValue, endValue, steps };
}
