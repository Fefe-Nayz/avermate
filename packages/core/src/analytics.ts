import { linearFit } from "./regression";
import {
  SubjectGraph,
  type Scope,
  type SubjectGraphOptions,
  gradeRatio,
} from "./graph";
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

/**
 * Where one grade stands among its peers.
 *
 * A mark on its own says almost nothing: 14 is a triumph in one class and a
 * disappointment in another, and the only reader who knows which is the student.
 * A position does say something, and it needs no interpretation.
 *
 * `subjectId` narrows the field to one subject and its descendants; omitting it
 * ranks against every grade the graph holds, which on a period-restricted graph
 * means every grade of that period.
 */
export interface GradeStanding {
  /** Position counting from the best, 1-based. */
  rank: number;
  /** How many grades were ranked, this one included. */
  total: number;
}

export function gradeStanding(
  graph: SubjectGraph,
  gradeId: string,
  subjectId?: string,
): GradeStanding | null {
  const ranked = rankGrades(graph, subjectId);
  const index = ranked.findIndex((entry) => entry.grade.id === gradeId);
  if (index < 0) return null;
  return { rank: index + 1, total: ranked.length };
}

/**
 * What fraction of its subject's weight one grade carries.
 *
 * The stored coefficient is the wrong number to show anybody: "weight 2" is
 * meaningless without the other coefficients, and a student reading it cannot
 * tell whether this mark decided the term or barely registered. A share can be
 * read on its own — and it is the explanation for the impact figures, which
 * otherwise arrive from nowhere.
 *
 * Only the grade's *own* subject: a share of an ancestor's average is not a
 * fraction of anything, because the hierarchy re-weights at every level. That
 * question is what `gradeImpact` answers, honestly, by removing the grade.
 */
export function gradeWeightShare(
  graph: SubjectGraph,
  gradeId: string,
): number | null {
  for (const subject of graph.subjects) {
    const grade = subject.grades.find((item) => item.id === gradeId);
    if (!grade) continue;
    if (gradeRatio(grade) === null) return null;
    // Grades that do not count carry no weight, so they are not in the total
    // either — otherwise a mark out of zero would dilute every share.
    const total = subject.grades.reduce(
      (sum, item) =>
        gradeRatio(item) === null ? sum : sum + Math.max(0, item.coefficient),
      0,
    );
    if (total <= 0) return null;
    return Math.max(0, grade.coefficient) / total;
  }
  return null;
}

/**
 * The grades either side of this one in the same subject, and the ones sharing
 * its day.
 *
 * A result is an event in a sequence, and a page showing one result with no way
 * to reach the next is a dead end. Ordered by the day sat rather than the day
 * entered, because that is the order the student lived them.
 *
 * "Either side" means either side *in time*, not in the sorted array: a grade sat
 * the same day is a companion, not a step, so it belongs to `sameDay` and nowhere
 * else. Letting it be `next` as well listed it twice on the same screen and made
 * "next" mean whichever of two simultaneous results happened to sort first — which
 * is no meaning at all.
 */
export interface GradeNeighbours {
  previous: Grade | null;
  next: Grade | null;
  /** Other grades of the same subject sat on the same day. */
  sameDay: Grade[];
}

export function gradeNeighbours(
  graph: SubjectGraph,
  gradeId: string,
): GradeNeighbours {
  const empty: GradeNeighbours = { previous: null, next: null, sameDay: [] };
  const subject = graph.subjects.find((item) =>
    item.grades.some((grade) => grade.id === gradeId),
  );
  if (!subject) return empty;

  // Ties fall back to entry order and then to id, so the walk is stable rather
  // than however the array happened to arrive.
  const ordered = [...subject.grades].sort(
    (left, right) =>
      left.passedAt.getTime() - right.passedAt.getTime() ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  const current = ordered.find((grade) => grade.id === gradeId);
  if (!current) return empty;

  const day = (date: Date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = day(current.passedAt);

  return {
    previous:
      ordered.filter((grade) => day(grade.passedAt) < today).at(-1) ?? null,
    next: ordered.find((grade) => day(grade.passedAt) > today) ?? null,
    sameDay: ordered.filter(
      (grade) => grade.id !== gradeId && day(grade.passedAt) === today,
    ),
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
 * The days an average can actually move: one date per day that received a
 * grade — clamped into the window, deduplicated — plus the window's two
 * ends. An average is a step function of grade events, not a daily signal:
 * sampling it on a calendar grid invented points between notes and merged
 * the days that had several. The start anchors the time axis (its point
 * stays null until something is graded, and inherits earlier grades when
 * they exist), the end carries the line to "now". Each event sits at the
 * end of its day so every grade of that day counts into its own point,
 * which is also what keeps two same-day grades one single event.
 */
export function averageEventDates(
  subjects: readonly Subject[],
  from: Date,
  to: Date,
  target: string | null = null,
): Date[] {
  const graph = new SubjectGraph(subjects);
  const start = from.getTime();
  const end = to.getTime();
  const days = new Set<number>([start, end]);
  for (const grade of graph.allGrades(target ?? undefined)) {
    const day = new Date(grade.passedAt);
    day.setHours(23, 59, 59, 999);
    days.add(Math.min(Math.max(day.getTime(), start), end));
  }
  return [...days].sort((a, b) => a - b).map((time) => new Date(time));
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
  graphOptions: SubjectGraphOptions = {},
): SeriesPoint[] {
  return dates.map((date) => {
    const cutoff = date.getTime();
    const snapshot = subjects.map((subject) => ({
      ...subject,
      grades: subject.grades.filter(
        (grade) => grade.passedAt.getTime() <= cutoff,
      ),
    }));
    return {
      date,
      ratio: new SubjectGraph(snapshot, graphOptions).ratio(target, scope),
    };
  });
}

/**
 * Least-squares slope of a series, per point. `null` when under-determined.
 *
 * One line of arithmetic, in `linearFit`, which also carries the two things this signature
 * cannot return: how much of the variation the line explains, and how uncertain it is. A
 * caller who needs those asks for the fit; a caller who needs "up or down, how fast" —
 * every trend arrow in the app — asks here.
 */
export function trend(points: readonly SeriesPoint[]): number | null {
  const defined = points.filter(
    (point): point is { date: Date; ratio: number } => point.ratio !== null,
  );
  // The x axis is the *position* in the series, not the date: consecutive readings, evenly
  // spaced. That is what the callers of this have always meant by "per point".
  return (
    linearFit(defined.map((point, index) => ({ x: index, y: point.ratio })))
      ?.slope ?? null
  );
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

/**
 * A quantile by linear interpolation between the two nearest ranks.
 *
 * One definition, used by every dispersion estimator below, because the quartiles
 * of a short list differ by several tenths between the common conventions and a
 * card that reported a different spread from the box plot beside it would be
 * reporting a choice of formula as a fact about the marks.
 */
export function quantile(
  values: readonly number[],
  fraction: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] as number;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, fraction));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return (
    (sorted[lower] as number) * (1 - weight) +
    (sorted[upper] as number) * weight
  );
}

/** Highest minus lowest: the whole span, and the estimator an outlier owns. */
export function range(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  return Math.max(...values) - Math.min(...values);
}

/**
 * The width of the middle half.
 *
 * Ignores the tails by construction, which is what makes it the honest answer for
 * "how much do my marks usually move" — one catastrophic paper doubles a standard
 * deviation and leaves this untouched.
 */
export function interquartileRange(values: readonly number[]): number | null {
  if (values.length < 4) return null;
  const low = quantile(values, 0.25);
  const high = quantile(values, 0.75);
  return low === null || high === null ? null : high - low;
}

/**
 * Median absolute deviation, scaled to be comparable with a standard deviation.
 *
 * The 1.4826 factor makes it the same number as the standard deviation when the
 * marks are normally distributed, so the two estimators can be offered as
 * alternatives in one card without the reading jumping when the choice changes.
 */
export function medianAbsoluteDeviation(
  values: readonly number[],
): number | null {
  if (values.length < 3) return null;
  const centre = median(values);
  if (centre === null) return null;
  const deviations = values.map((value) => Math.abs(value - centre));
  const spread = median(deviations);
  return spread === null ? null : spread * 1.4826;
}

/**
 * How a spread is measured.
 *
 * A standard deviation is the one everybody knows and the one a single bad paper
 * owns: one 2/20 in a term of fourteens doubles it, and the card then reports a
 * catastrophe as a habit. The other three answer the question actually being
 * asked — *how much do my marks usually move* — so the estimator is the card's
 * choice rather than this file's, and the card says which one it used.
 */
export type WidgetDispersion =
  | "standard-deviation"
  | "range"
  | "interquartile-range"
  | "median-absolute-deviation";

export const WIDGET_DISPERSIONS: readonly WidgetDispersion[] = [
  "standard-deviation",
  "range",
  "interquartile-range",
  "median-absolute-deviation",
];

/**
 * A dispersion by the named estimator, or `null` below its own minimum sample.
 *
 * The minimum is the estimator's, not a policy: two marks for a deviation or a
 * range, three for a median absolute deviation, four for a middle half. Below it
 * the number exists arithmetically and means nothing, so it is not returned.
 */
export function dispersionOf(
  values: readonly number[],
  estimator: WidgetDispersion,
): number | null {
  switch (estimator) {
    case "range":
      return range(values);
    case "interquartile-range":
      return interquartileRange(values);
    case "median-absolute-deviation":
      return medianAbsoluteDeviation(values);
    default:
      return standardDeviation(values);
  }
}

/**
 * The smallest sample the named estimator means anything on.
 *
 * Read from the estimators themselves — each returns `null` below its own
 * minimum — so a card that reports "4 marks needed" cannot disagree with the
 * function that refused to answer.
 */
export function dispersionMinimum(estimator: WidgetDispersion): number {
  switch (estimator) {
    case "interquartile-range":
      return 4;
    case "median-absolute-deviation":
      return 3;
    default:
      return 2;
  }
}

/**
 * A smooth shape over a set of marks, sampled on a grid.
 *
 * The primitive behind a violin and a ridgeline, and — as the audit says — *not* a chart of
 * its own: nobody asks to see a kernel density estimate of their marks. What they ask is
 * "where do my results cluster", and a violin answers it by giving that shape a width.
 *
 * Gaussian kernel, Silverman's rule for the bandwidth, and a floor on it so a set of nearly
 * identical marks gets a narrow shape rather than a spike of infinite height. The estimate
 * is *bounded to the scale*: a density that leaks past full marks would draw a subject
 * scoring above twenty out of twenty.
 *
 * `null` below `DENSITY_MINIMUM_SAMPLE`, and that refusal is the honest half of the feature.
 * A smooth curve over three marks looks like knowledge and is an interpolation; the audit is
 * explicit that a violin must not be drawn there, and this is where that is enforced rather
 * than left to a renderer to remember.
 */
export const DENSITY_MINIMUM_SAMPLE = 6;

export interface DensityPoint {
  /** A ratio in 0..1. */
  at: number;
  /** Relative height. Comparable within one estimate, not across two. */
  density: number;
}

export function kernelDensity(
  values: readonly number[],
  samples = 24,
): DensityPoint[] | null {
  if (values.length < DENSITY_MINIMUM_SAMPLE) return null;
  const deviation = standardDeviation(values);
  const spread = interquartileRange(values);
  if (deviation === null) return null;

  // Silverman: 0.9 · min(σ, IQR/1.34) · n^(-1/5). The IQR term is what stops one
  // catastrophic paper widening the whole shape.
  const robust =
    spread === null ? deviation : Math.min(deviation, spread / 1.34);
  const bandwidth = Math.max(
    // A floor of half a point on a scale of twenty: below that the curve is a spike, and a
    // spike says "certainty" about a set of marks that are merely close together.
    0.025,
    0.9 * robust * Math.pow(values.length, -1 / 5),
  );

  const points: DensityPoint[] = [];
  for (let index = 0; index < samples; index += 1) {
    const at = index / (samples - 1);
    let sum = 0;
    for (const value of values) {
      const z = (at - value) / bandwidth;
      sum += Math.exp(-0.5 * z * z);
    }
    points.push({
      at,
      density: sum / (values.length * bandwidth * Math.sqrt(2 * Math.PI)),
    });
  }
  return points;
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
export function rankByImprovement(
  graph: SubjectGraph,
  options: { includeCategories?: boolean } = {},
): Array<{
  subject: Subject;
  delta: number;
}> {
  const results: Array<{ subject: Subject; delta: number }> = [];

  for (const subject of graph.subjects) {
    if (!options.includeCategories && subject.kind === "category") continue;
    const ratios = gradeRatios(graph, subject.id);
    const delta = improvement(ratios);
    if (delta === null) continue;
    results.push({ subject, delta });
  }

  results.sort((a, b) => b.delta - a.delta);
  return results;
}

/** Subjects ranked by how tightly their results cluster, steadiest first. */
export function rankByConsistency(
  graph: SubjectGraph,
  options: { includeCategories?: boolean } = {},
): Array<{
  subject: Subject;
  consistency: number;
}> {
  const results: Array<{ subject: Subject; consistency: number }> = [];

  for (const subject of graph.subjects) {
    if (!options.includeCategories && subject.kind === "category") continue;
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
