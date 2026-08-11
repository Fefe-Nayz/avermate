import { SubjectGraph, type Scope, gradeRatio } from "./graph";
import type { Grade, Ratio, Subject } from "./types";

// ------------------------------------------------------------------- helpers

function withoutGrade(graph: SubjectGraph, gradeId: string): SubjectGraph {
  return graph.withSubjects((subject) =>
    subject.grades.some((grade) => grade.id === gradeId)
      ? {
          ...subject,
          grades: subject.grades.filter((grade) => grade.id !== gradeId),
        }
      : subject,
  );
}

function withoutSubtree(graph: SubjectGraph, subjectId: string): SubjectGraph {
  const removed = new Set([
    subjectId,
    ...graph.descendantsOf(subjectId).map((subject) => subject.id),
  ]);
  return new SubjectGraph(
    graph.subjects.filter((subject) => !removed.has(subject.id)),
  );
}

function ratioDelta(after: Ratio, before: Ratio): number | null {
  if (after === null || before === null) return null;
  return after - before;
}

// -------------------------------------------------------------------- impacts

export interface Impact {
  /** Signed change in ratio caused by the thing being measured. */
  delta: number | null;
  /** The average as it stands. */
  withValue: Ratio;
  /** The average this target would have without it. */
  withoutValue: Ratio;
}

/**
 * How much a single grade moves an average. Removing the grade and comparing is
 * the only honest way to answer it — the weighting is hierarchical, so a grade's
 * "contribution" is not a term you can read off the formula.
 */
export function gradeImpact(
  graph: SubjectGraph,
  gradeId: string,
  target: string | null = null,
  scope: Scope | null = null,
): Impact {
  const withValue = graph.ratio(target, scope);
  const withoutValue = withoutGrade(graph, gradeId).ratio(target, scope);
  return {
    delta: ratioDelta(withValue, withoutValue),
    withValue,
    withoutValue,
  };
}

/** How much a whole subject (and its sub-tree) moves an average. */
export function subjectImpact(
  graph: SubjectGraph,
  subjectId: string,
  target: string | null = null,
  scope: Scope | null = null,
): Impact {
  const withValue = graph.ratio(target, scope);
  const withoutValue = withoutSubtree(graph, subjectId).ratio(target, scope);
  return {
    delta: ratioDelta(withValue, withoutValue),
    withValue,
    withoutValue,
  };
}

// ---------------------------------------------------------------- time series

export interface SeriesPoint {
  date: Date;
  ratio: Ratio;
}

/** Evenly spaced days between two dates, inclusive, normalised to midnight. */
export function dayRange(from: Date, to: Date, step = 1): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + step);
  }
  if (dates.length === 0) dates.push(new Date(from));
  return dates;
}

/**
 * The average as it stood on each date — grades taken later simply do not
 * exist yet. This is a running state of the year, not a moving window.
 */
export function averageOverTime(
  subjects: readonly Subject[],
  dates: readonly Date[],
  target: string | null = null,
  scope: Scope | null = null,
): SeriesPoint[] {
  return dates.map((date) => {
    const cutoff = date.getTime();
    const snapshot = subjects.map((subject) => ({
      ...subject,
      grades: subject.grades.filter(
        (grade) => grade.passedAt.getTime() <= cutoff,
      ),
    }));
    return { date, ratio: new SubjectGraph(snapshot).ratio(target, scope) };
  });
}

/** Least-squares slope of a series, per point. `null` when under-determined. */
export function trend(points: readonly SeriesPoint[]): number | null {
  const defined = points.filter(
    (point): point is { date: Date; ratio: number } => point.ratio !== null,
  );
  if (defined.length < 2) return null;

  const n = defined.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  defined.forEach((point, index) => {
    sumX += index;
    sumY += point.ratio;
    sumXY += index * point.ratio;
    sumXX += index * index;
  });

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  return (n * sumXY - sumX * sumY) / denominator;
}

/** Fitted line over a series, useful as a chart overlay. */
export function trendLine(points: readonly SeriesPoint[]): SeriesPoint[] {
  const defined = points
    .map((point, index) => ({ ...point, index }))
    .filter((point) => point.ratio !== null);
  if (defined.length < 2) return [];

  const slope = trend(points);
  if (slope === null) return [];

  const meanIndex =
    defined.reduce((sum, point) => sum + point.index, 0) / defined.length;
  const meanRatio =
    defined.reduce((sum, point) => sum + (point.ratio as number), 0) /
    defined.length;
  const intercept = meanRatio - slope * meanIndex;

  return points.map((point, index) => ({
    date: point.date,
    ratio: intercept + slope * index,
  }));
}

/**
 * A piecewise least-squares trend over real timestamps.
 *
 * `subdivisions = 1` is a single global trend. Higher values split the
 * observations into equally sized chronological groups, which reveals local
 * changes without turning the trend into a moving average. Missing readings
 * remain missing outside the first/last observed sample, and predictions are
 * clamped to a valid ratio so a chart can never draw beyond the grading scale.
 */
export function segmentedTrendLine(
  points: readonly SeriesPoint[],
  subdivisions = 1,
): SeriesPoint[] {
  const observed = points
    .map((point, index) => ({
      date: point.date,
      index,
      ratio: point.ratio,
      timestamp: point.date.getTime(),
    }))
    .filter(
      (
        point,
      ): point is {
        date: Date;
        index: number;
        ratio: number;
        timestamp: number;
      } => point.ratio !== null && Number.isFinite(point.timestamp),
    );

  if (observed.length < 2) return [];

  const firstTimestamp = observed[0]?.timestamp ?? 0;
  const normalised = observed.map((point) => ({
    ...point,
    x: (point.timestamp - firstTimestamp) / 86_400_000,
  }));
  const segmentCount = Math.min(
    normalised.length,
    Math.max(1, Math.round(subdivisions)),
  );

  const segments: Array<{
    endX: number;
    intercept: number;
    slope: number;
  }> = [];

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const start = Math.floor((segment * normalised.length) / segmentCount);
    const end = Math.max(
      start,
      Math.floor(((segment + 1) * normalised.length) / segmentCount) - 1,
    );
    const sample = normalised.slice(start, end + 1);
    if (sample.length === 0) continue;

    const count = sample.length;
    const sumX = sample.reduce((sum, point) => sum + point.x, 0);
    const sumY = sample.reduce((sum, point) => sum + point.ratio, 0);
    const sumXY = sample.reduce((sum, point) => sum + point.x * point.ratio, 0);
    const sumXX = sample.reduce((sum, point) => sum + point.x * point.x, 0);
    const denominator = count * sumXX - sumX * sumX;
    const slope =
      denominator === 0 ? 0 : (count * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / count;
    segments.push({
      endX: sample.at(-1)?.x ?? 0,
      intercept,
      slope,
    });
  }

  const firstIndex = observed[0]?.index ?? 0;
  const lastIndex = observed.at(-1)?.index ?? points.length - 1;

  return points.map((point, index) => {
    if (index < firstIndex || index > lastIndex || segments.length === 0) {
      return { date: point.date, ratio: null };
    }

    const x = (point.date.getTime() - firstTimestamp) / 86_400_000;
    const segment =
      segments.find((candidate) => x <= candidate.endX) ?? segments.at(-1);
    const prediction = segment
      ? segment.intercept + segment.slope * x
      : Number.NaN;
    return {
      date: point.date,
      ratio: Number.isFinite(prediction)
        ? Math.min(1, Math.max(0, prediction))
        : null,
    };
  });
}

/** Rolling mean over the last `window` grades of a subject. */
export function movingAverage(
  grades: readonly Grade[],
  window = 3,
): SeriesPoint[] {
  const ordered = [...grades].sort(
    (a, b) => a.passedAt.getTime() - b.passedAt.getTime(),
  );

  return ordered.map((grade, index) => {
    const slice = ordered.slice(Math.max(0, index - window + 1), index + 1);
    let weighted = 0;
    let total = 0;
    for (const item of slice) {
      const ratio = gradeRatio(item);
      if (ratio === null) continue;
      const coefficient = item.coefficient > 0 ? item.coefficient : 1;
      weighted += ratio * coefficient;
      total += coefficient;
    }
    return {
      date: grade.passedAt,
      ratio: total === 0 ? null : weighted / total,
    };
  });
}

// --------------------------------------------------------------- distribution

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values) as number;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

/** Ratios of every grade under a subject, in chronological order. */
export function gradeRatios(graph: SubjectGraph, subjectId?: string): number[] {
  return graph
    .allGrades(subjectId)
    .map((grade) => gradeRatio(grade))
    .filter((ratio): ratio is number => ratio !== null);
}

export interface DistributionBucket {
  /** Lower bound of the bucket as a ratio. */
  from: number;
  /** Upper bound (exclusive, except for the last bucket). */
  to: number;
  count: number;
}

export function distribution(
  ratios: readonly number[],
  buckets = 5,
): DistributionBucket[] {
  const size = 1 / buckets;
  const result: DistributionBucket[] = Array.from(
    { length: buckets },
    (_, index) => ({
      from: index * size,
      to: (index + 1) * size,
      count: 0,
    }),
  );

  for (const ratio of ratios) {
    const index = Math.min(buckets - 1, Math.max(0, Math.floor(ratio / size)));
    (result[index] as DistributionBucket).count += 1;
  }

  return result;
}

/** Share of results at or above the passing mark, in 0..1. */
export function passRate(
  ratios: readonly number[],
  passingRatio: number,
): number | null {
  if (ratios.length === 0) return null;
  const passed = ratios.filter((ratio) => ratio >= passingRatio).length;
  return passed / ratios.length;
}

/**
 * Improvement between the first and second half of a subject's results.
 * Positive means the later half went better.
 */
export function improvement(ratios: readonly number[]): number | null {
  if (ratios.length < 2) return null;
  const middle = Math.floor(ratios.length / 2);
  const first = mean(ratios.slice(0, middle));
  const second = mean(ratios.slice(middle));
  if (first === null || second === null) return null;
  return second - first;
}

/**
 * Consistency in 0..1: 1 means every result landed on the same mark. Derived
 * from the spread, so it reads the same way for a strong and a weak student.
 */
export function consistency(ratios: readonly number[]): number | null {
  const deviation = standardDeviation(ratios);
  if (deviation === null) return null;
  return Math.max(0, 1 - deviation * 2);
}

/** Pearson correlation between two same-length series. */
export function correlation(
  a: readonly number[],
  b: readonly number[],
): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;

  const meanA = mean(a.slice(0, n)) as number;
  const meanB = mean(b.slice(0, n)) as number;

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < n; index += 1) {
    const deltaA = (a[index] as number) - meanA;
    const deltaB = (b[index] as number) - meanB;
    covariance += deltaA * deltaB;
    varianceA += deltaA * deltaA;
    varianceB += deltaB * deltaB;
  }

  if (varianceA === 0 || varianceB === 0) return null;
  return covariance / Math.sqrt(varianceA * varianceB);
}

/**
 * Where the year is heading if the current trend holds, clamped to 0..1.
 * Deliberately conservative: it extrapolates the running average, not the last
 * result, so one bad day does not rewrite the forecast.
 */
export function projectedRatio(
  series: readonly SeriesPoint[],
  stepsAhead: number,
): number | null {
  const slope = trend(series);
  const last = [...series].reverse().find((point) => point.ratio !== null);
  if (slope === null || !last || last.ratio === null)
    return last?.ratio ?? null;
  return Math.min(1, Math.max(0, last.ratio + slope * stepsAhead));
}

// ------------------------------------------------------------------- rankings

export interface SubjectRanking {
  subject: Subject;
  ratio: number;
}

/** Every subject that carries a result, best first. */
export function rankSubjects(
  graph: SubjectGraph,
  options: { includeCategories?: boolean } = {},
): SubjectRanking[] {
  const rankings: SubjectRanking[] = [];

  for (const subject of graph.subjects) {
    if (!options.includeCategories && subject.kind === "category") continue;
    const ratio = graph.ratio(subject.id);
    if (ratio === null) continue;
    rankings.push({ subject, ratio });
  }

  rankings.sort((a, b) => b.ratio - a.ratio);
  return rankings;
}

export interface GradeRanking {
  grade: Grade;
  subject: Subject;
  ratio: number;
}

export function rankGrades(
  graph: SubjectGraph,
  subjectId?: string,
): GradeRanking[] {
  const rankings: GradeRanking[] = [];

  for (const grade of graph.allGrades(subjectId)) {
    const ratio = gradeRatio(grade);
    if (ratio === null) continue;
    const subject = graph.byId(grade.subjectId);
    if (!subject) continue;
    rankings.push({ grade, subject, ratio });
  }

  rankings.sort((a, b) => b.ratio - a.ratio);
  return rankings;
}

/** Subjects ranked by how far they moved between the two halves of the year. */
export function rankByImprovement(graph: SubjectGraph): Array<{
  subject: Subject;
  delta: number;
}> {
  const results: Array<{ subject: Subject; delta: number }> = [];

  for (const subject of graph.subjects) {
    if (subject.kind === "category") continue;
    const ratios = gradeRatios(graph, subject.id);
    const delta = improvement(ratios);
    if (delta === null) continue;
    results.push({ subject, delta });
  }

  results.sort((a, b) => b.delta - a.delta);
  return results;
}

/** Subjects ranked by how tightly their results cluster, steadiest first. */
export function rankByConsistency(graph: SubjectGraph): Array<{
  subject: Subject;
  consistency: number;
}> {
  const results: Array<{ subject: Subject; consistency: number }> = [];

  for (const subject of graph.subjects) {
    if (subject.kind === "category") continue;
    const ratios = gradeRatios(graph, subject.id);
    if (ratios.length < 2) continue;
    const score = consistency(ratios);
    if (score === null) continue;
    results.push({ subject, consistency: score });
  }

  results.sort((a, b) => b.consistency - a.consistency);
  return results;
}

// -------------------------------------------------------------------- streaks

export interface Streak {
  length: number;
  from: Date | null;
  to: Date | null;
}

/**
 * Longest run of consecutive results at or above the passing mark, and the run
 * that is still alive today.
 */
export function passStreaks(
  grades: readonly Grade[],
  passingRatio: number,
): { current: Streak; longest: Streak } {
  const ordered = [...grades].sort(
    (a, b) => a.passedAt.getTime() - b.passedAt.getTime(),
  );

  let current: Streak = { length: 0, from: null, to: null };
  let longest: Streak = { length: 0, from: null, to: null };

  for (const grade of ordered) {
    const ratio = gradeRatio(grade);
    if (ratio === null) continue;

    if (ratio >= passingRatio) {
      current = {
        length: current.length + 1,
        from: current.length === 0 ? grade.passedAt : current.from,
        to: grade.passedAt,
      };
      if (current.length > longest.length) longest = { ...current };
    } else {
      current = { length: 0, from: null, to: null };
    }
  }

  return { current, longest };
}

/** Longest run of consecutive calendar days on which a grade was recorded. */
export function activityStreaks(grades: readonly Grade[]): {
  current: Streak;
  longest: Streak;
} {
  const days = [
    ...new Set(
      grades.map((grade) => {
        const day = new Date(grade.passedAt);
        day.setHours(0, 0, 0, 0);
        return day.getTime();
      }),
    ),
  ].sort((a, b) => a - b);

  const DAY = 24 * 60 * 60 * 1000;
  let current: Streak = { length: 0, from: null, to: null };
  let longest: Streak = { length: 0, from: null, to: null };

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index] as number;
    const previous = index > 0 ? (days[index - 1] as number) : null;

    if (previous !== null && day - previous === DAY) {
      current = {
        length: current.length + 1,
        from: current.from,
        to: new Date(day),
      };
    } else {
      current = { length: 1, from: new Date(day), to: new Date(day) };
    }

    if (current.length > longest.length) longest = { ...current };
  }

  const lastDay = days.at(-1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (lastDay === undefined || today.getTime() - lastDay > DAY) {
    current = { length: 0, from: null, to: null };
  }

  return { current, longest };
}

/** Grades per calendar day, for a contribution-graph style heatmap. */
export function activityByDay(grades: readonly Grade[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const grade of grades) {
    const day = new Date(grade.passedAt);
    day.setHours(0, 0, 0, 0);
    const key = day.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
