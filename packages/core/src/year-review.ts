import {
  averageOverTime,
  dayRange,
  gradeRatios,
  rankSubjects,
  standardDeviation,
  type SeriesPoint,
} from "./analytics";
import { SubjectGraph, gradeRatio } from "./graph";
import type { Subject, Year } from "./types";

/**
 * The end-of-year recap: a story the app tells once, so the numbers are picked
 * for what they say about a year rather than for what is cheap to compute.
 */

export type AwardKind =
  | "tourist"
  | "tightrope"
  | "comeback"
  | "allin"
  | "masterclass"
  | "unpredictable"
  | "precision"
  | "legend"
  | "avermatien";

export interface YearReview {
  gradeCount: number;
  /** Sum of every result as a ratio; multiply by the year's scale for points. */
  ratioSum: number;
  average: number | null;
  /** Grades per ISO day, for the heatmap. */
  heatmap: Record<string, number>;
  busiestMonth: { month: string; count: number } | null;
  busiestWeekday: { weekday: number; count: number } | null;
  longestStreak: number;
  /**
   * The real running average at each active day, reduced to a small set of
   * renderable points while always retaining the first, last and peak values.
   */
  averageSeries: YearReviewSeriesPoint[];
  /** The day the running average peaked. */
  primeTime: { date: Date; ratio: number } | null;
  topSubjects: Array<{ subjectId: string; name: string; ratio: number }>;
  bestProgression: { subjectId: string; name: string; delta: number } | null;
  /** Percentile among all users, filled in by the server. */
  topPercentile: number;
  award: AwardKind;
  /** First and last recorded result, to bookend the story. */
  firstGradeAt: Date | null;
  lastGradeAt: Date | null;
}

export interface YearReviewSeriesPoint {
  date: Date;
  ratio: number;
}

const MAX_REVIEW_SERIES_POINTS = 64;

/**
 * Evenly samples a running-average series without losing its actual peak.
 * Keeping this in core makes the SVG payload bounded on every client.
 */
export function decimateYearReviewSeries(
  points: readonly YearReviewSeriesPoint[],
  maximumPoints = MAX_REVIEW_SERIES_POINTS,
): YearReviewSeriesPoint[] {
  const limit = Math.max(3, Math.floor(maximumPoints));
  if (points.length <= limit) return [...points];

  let peakIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (
      (points[index]?.ratio ?? -Infinity) >
      (points[peakIndex]?.ratio ?? -Infinity)
    ) {
      peakIndex = index;
    }
  }

  const lastIndex = points.length - 1;
  const sampledIndexes = Array.from({ length: limit }, (_, index) =>
    Math.round((index * lastIndex) / (limit - 1)),
  );

  if (!sampledIndexes.includes(peakIndex)) {
    let replacement = 1;
    for (let index = 2; index < sampledIndexes.length - 1; index += 1) {
      if (
        Math.abs((sampledIndexes[index] ?? 0) - peakIndex) <
        Math.abs((sampledIndexes[replacement] ?? 0) - peakIndex)
      ) {
        replacement = index;
      }
    }
    sampledIndexes[replacement] = peakIndex;
    sampledIndexes.sort((left, right) => left - right);
  }

  return sampledIndexes.map((index) => points[index] as YearReviewSeriesPoint);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfLocalDay(date: Date): Date {
  const boundary = new Date(date);
  boundary.setHours(0, 0, 0, 0);
  return boundary;
}

function endOfLocalDay(date: Date): Date {
  const boundary = new Date(date);
  boundary.setHours(23, 59, 59, 999);
  return boundary;
}

function improvingAverageStreak(subjects: readonly Subject[]): number {
  const grades = new SubjectGraph(subjects).allGrades();
  let previousAverage: number | null = null;
  let current = 0;
  let longest = 0;
  let weightedSum = 0;
  let coefficientSum = 0;

  for (const grade of grades) {
    const ratio = gradeRatio(grade);
    if (ratio === null || grade.coefficient <= 0) continue;
    weightedSum += ratio * grade.coefficient;
    coefficientSum += grade.coefficient;
    const average = weightedSum / coefficientSum;
    if (previousAverage === null) {
      current = 1;
      longest = 1;
    } else if (average > previousAverage) {
      current += 1;
    } else if (average < previousAverage) {
      current = Math.max(0, current - 1);
    }
    longest = Math.max(longest, current);
    previousAverage = average;
  }

  return longest;
}

function pickBusiest<T extends string | number>(
  counts: Map<T, number>,
): { key: T; count: number } | null {
  let best: { key: T; count: number } | null = null;
  for (const [key, count] of counts) {
    if (!best || count > best.count) best = { key, count };
  }
  return best;
}

/** The average of everything recorded in the first month of the year. */
function firstMonthRatio(
  subjects: readonly Subject[],
  firstGradeAt: Date,
): number | null {
  const cutoff = new Date(firstGradeAt);
  cutoff.setMonth(cutoff.getMonth() + 1);

  const snapshot = subjects.map((subject) => ({
    ...subject,
    grades: subject.grades.filter(
      (grade) => grade.passedAt.getTime() <= cutoff.getTime(),
    ),
  }));
  return new SubjectGraph(snapshot).ratio(null);
}

function decideAward(input: {
  graph: SubjectGraph;
  subjects: readonly Subject[];
  average: number | null;
  gradeCount: number;
  firstGradeAt: Date | null;
}): AwardKind {
  const { graph, subjects, average, gradeCount, firstGradeAt } = input;
  if (average === null) return "tourist";

  const allRatios = gradeRatios(graph);
  const failedBadly = allRatios.filter((ratio) => ratio < 0.4).length;

  // Scraping through: hovering right at the pass line after several near-misses.
  if (average >= 0.5 && average <= 0.55 && failedBadly >= 3) return "tightrope";

  if (firstGradeAt) {
    const start = firstMonthRatio(subjects, firstGradeAt);
    if (start !== null && average > start + 0.1) return "comeback";
  }

  const ranked = rankSubjects(graph);
  const best = ranked[0]?.ratio;
  const worst = ranked.at(-1)?.ratio;
  if (best !== undefined && worst !== undefined && best - worst > 0.25) {
    return "allin";
  }

  if (average > 0.75) return "masterclass";

  let scored = 0;
  let volatile = 0;
  let steady = 0;
  for (const subject of subjects) {
    if (subject.kind === "category") continue;
    const deviation = standardDeviation(gradeRatios(graph, subject.id));
    if (deviation === null) continue;
    scored += 1;
    if (deviation > 0.2) volatile += 1;
    if (deviation < 0.1) steady += 1;
  }

  if (scored > 0 && volatile / scored >= 0.25) return "unpredictable";
  if (scored > 0 && steady / scored >= 0.5) return "precision";
  if (gradeCount >= 40) return "legend";
  if (gradeCount >= 15) return "avermatien";

  return "tourist";
}

export function buildYearReview(
  subjects: readonly Subject[],
  year: Pick<Year, "startsAt" | "endsAt">,
  topPercentile: number,
  now: Date = new Date(),
): YearReview {
  const horizon = new Date(
    Math.min(endOfLocalDay(year.endsAt).getTime(), now.getTime()),
  );
  const startsAt = startOfLocalDay(year.startsAt).getTime();
  const endsAt = horizon.getTime();
  const reviewSubjects = subjects.map((subject) => ({
    ...subject,
    grades: subject.grades.filter((grade) => {
      const passedAt = grade.passedAt.getTime();
      return passedAt >= startsAt && passedAt <= endsAt;
    }),
  }));
  const graph = new SubjectGraph(reviewSubjects);
  const grades = graph.allGrades();

  const ratioSum = grades.reduce((sum, grade) => {
    const ratio = gradeRatio(grade);
    return ratio === null ? sum : sum + ratio;
  }, 0);

  const heatmap: Record<string, number> = {};
  for (const grade of grades) {
    const day = localDayKey(grade.passedAt);
    heatmap[day] = (heatmap[day] ?? 0) + 1;
  }

  const monthCounts = new Map<string, number>();
  const weekdayCounts = new Map<number, number>();
  for (const grade of grades) {
    const month = monthKey(grade.passedAt);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    const weekday = grade.passedAt.getDay();
    weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
  }

  const busiestMonthEntry = pickBusiest(monthCounts);
  const busiestWeekdayEntry = pickBusiest(weekdayCounts);

  const activeDays = new Map<string, Date>();
  for (const grade of grades) {
    const day = new Date(grade.passedAt);
    day.setHours(23, 59, 59, 999);
    activeDays.set(localDayKey(day), day);
  }
  const series: SeriesPoint[] =
    activeDays.size > 0
      ? averageOverTime(
          reviewSubjects,
          [...activeDays.values()].sort(
            (left, right) => left.getTime() - right.getTime(),
          ),
          null,
        )
      : [];
  const averageSeries = decimateYearReviewSeries(
    series.flatMap((point) =>
      point.ratio === null ? [] : [{ date: point.date, ratio: point.ratio }],
    ),
  );

  let primeTime: { date: Date; ratio: number } | null = null;
  for (const point of series) {
    if (point.ratio === null) continue;
    if (!primeTime || point.ratio > primeTime.ratio) {
      primeTime = { date: point.date, ratio: point.ratio };
    }
  }

  const topSubjects = rankSubjects(graph)
    .sort(
      (left, right) =>
        right.ratio - left.ratio ||
        right.subject.coefficient - left.subject.coefficient,
    )
    .slice(0, 3)
    .map((entry) => ({
      subjectId: entry.subject.id,
      name: entry.subject.name,
      ratio: entry.ratio,
    }));

  let bestProgression: YearReview["bestProgression"] = null;
  for (const subject of reviewSubjects) {
    if (subject.kind === "category") continue;
    const chronological = [...subject.grades]
      .sort((left, right) => left.passedAt.getTime() - right.passedAt.getTime())
      .flatMap((grade) => {
        const ratio = gradeRatio(grade);
        return ratio === null ? [] : [ratio];
      });
    if (chronological.length < 2) continue;
    const finalRatio = graph.ratio(subject.id);
    if (finalRatio === null) continue;
    const delta = finalRatio - (chronological[0] as number);
    if (delta <= 0) continue;
    if (!bestProgression || delta > bestProgression.delta) {
      bestProgression = { subjectId: subject.id, name: subject.name, delta };
    }
  }

  const average = graph.ratio(null);
  const firstGradeAt = grades[0]?.passedAt ?? null;
  const lastGradeAt = grades.at(-1)?.passedAt ?? null;

  return {
    gradeCount: grades.length,
    ratioSum,
    average,
    heatmap,
    busiestMonth: busiestMonthEntry
      ? { month: busiestMonthEntry.key, count: busiestMonthEntry.count }
      : null,
    busiestWeekday: busiestWeekdayEntry
      ? { weekday: busiestWeekdayEntry.key, count: busiestWeekdayEntry.count }
      : null,
    longestStreak: improvingAverageStreak(reviewSubjects),
    averageSeries,
    primeTime,
    topSubjects,
    bestProgression,
    topPercentile,
    award: decideAward({
      graph,
      subjects: reviewSubjects,
      average,
      gradeCount: grades.length,
      firstGradeAt,
    }),
    firstGradeAt,
    lastGradeAt,
  };
}

/** Dense day-by-day counts from year start to `until`, for the heatmap grid. */
export function heatmapDays(
  heatmap: Record<string, number>,
  from: Date,
  until: Date = new Date(),
): Array<{ date: string; count: number }> {
  return dayRange(from, until).map((date) => {
    const key = localDayKey(date);
    return { date: key, count: heatmap[key] ?? 0 };
  });
}
