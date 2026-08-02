import {
  activityByDay,
  activityStreaks,
  averageOverTime,
  dayRange,
  gradeRatios,
  improvement,
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
  /** Sum of every result as a ratio — the raw "how much you were graded". */
  ratioSum: number;
  average: number | null;
  /** Grades per ISO day, for the heatmap. */
  heatmap: Record<string, number>;
  busiestMonth: { month: string; count: number } | null;
  busiestWeekday: { weekday: number; count: number } | null;
  longestStreak: number;
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

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
  const graph = new SubjectGraph(subjects);
  const grades = graph.allGrades();

  const ratioSum = grades.reduce((sum, grade) => {
    const ratio = gradeRatio(grade);
    return ratio === null ? sum : sum + ratio;
  }, 0);

  const heatmapMap = activityByDay(grades);
  const heatmap: Record<string, number> = {};
  for (const [day, count] of heatmapMap) heatmap[day] = count;

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

  const horizon = year.endsAt.getTime() > now.getTime() ? now : year.endsAt;
  const series: SeriesPoint[] =
    grades.length > 0
      ? averageOverTime(subjects, dayRange(year.startsAt, horizon), null)
      : [];

  let primeTime: { date: Date; ratio: number } | null = null;
  for (const point of series) {
    if (point.ratio === null) continue;
    if (!primeTime || point.ratio > primeTime.ratio) {
      primeTime = { date: point.date, ratio: point.ratio };
    }
  }

  const topSubjects = rankSubjects(graph)
    .slice(0, 3)
    .map((entry) => ({
      subjectId: entry.subject.id,
      name: entry.subject.name,
      ratio: entry.ratio,
    }));

  let bestProgression: YearReview["bestProgression"] = null;
  for (const subject of subjects) {
    if (subject.kind === "category") continue;
    const delta = improvement(gradeRatios(graph, subject.id));
    if (delta === null || delta <= 0) continue;
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
    longestStreak: activityStreaks(grades).longest.length,
    primeTime,
    topSubjects,
    bestProgression,
    topPercentile,
    award: decideAward({
      graph,
      subjects,
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
    const key = date.toISOString().slice(0, 10);
    return { date: key, count: heatmap[key] ?? 0 };
  });
}
