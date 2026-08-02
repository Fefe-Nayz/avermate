import {
  activityStreaks,
  averageOverTime,
  consistency,
  dayRange,
  distribution,
  gradeRatios,
  improvement,
  median,
  passRate,
  passStreaks,
  projectedRatio,
  rankByConsistency,
  rankByImprovement,
  rankGrades,
  rankSubjects,
  standardDeviation,
  trend,
  type DistributionBucket,
  type SeriesPoint,
} from "./analytics";
import { SubjectGraph, gradeRatio, type Scope } from "./graph";
import { planGoal, type Goal, type GoalPlan } from "./goals";
import type { Ratio, Subject } from "./types";

/**
 * Dashboard cards.
 *
 * A card is data, not code: the user picks a metric, points it at something,
 * and chooses how it should look. The evaluator turns that into a small tagged
 * value the UI knows how to render, so adding a metric never means adding a
 * component and rearranging a dashboard never means a migration.
 */

export const CARD_METRICS = [
  "average",
  "averageTrend",
  "projection",
  "gradeCount",
  "lastGrade",
  "bestGrade",
  "worstGrade",
  "bestSubject",
  "worstSubject",
  "subjectRanking",
  "passRate",
  "median",
  "spread",
  "consistency",
  "improvement",
  "mostImproved",
  "steadiest",
  "passStreak",
  "activityStreak",
  "distribution",
  "goalProgress",
] as const;

export type CardMetric = (typeof CARD_METRICS)[number];

export type CardTargetKind = "general" | "subject" | "custom";

export interface CardTarget {
  kind: CardTargetKind;
  /** Subject id or custom-average id; `null` for the general average. */
  referenceId: string | null;
}

export type CardDisplay = "value" | "sparkline" | "chart" | "list" | "gauge";

export interface CardSpec {
  id: string;
  metric: CardMetric;
  target: CardTarget;
  display: CardDisplay;
  /** Column span in the dashboard grid. */
  span: 1 | 2 | 3 | 4;
  /** `null` falls back to the metric's own localised name. */
  title: string | null;
  /** Named accent from the theme, e.g. "chart-2". `null` uses the default. */
  accent: string | null;
  /** Goal to read, when `metric === "goalProgress"`. */
  goalId: string | null;
  sortOrder: number;
  hidden: boolean;
}

export interface CardContext {
  /** Graph restricted to the period the dashboard is showing. */
  graph: SubjectGraph;
  /** Same subjects, used for time series that walk back through the period. */
  subjects: readonly Subject[];
  scope: Scope | null;
  /** Window the dashboard covers, used for trends and sparklines. */
  from: Date;
  to: Date;
  passingRatio: number;
  goals: readonly Goal[];
  /** Expected remaining assessments per subject, for goal cards. */
  remaining?: (subjectId: string) => number;
  /** Resolves a custom average id to its own graph and scope. */
  resolveTarget: (target: CardTarget) => {
    graph: SubjectGraph;
    subjects: readonly Subject[];
    scope: Scope | null;
    subjectId: string | null;
  } | null;
}

export type CardResult =
  | { kind: "empty" }
  | {
      kind: "ratio";
      ratio: Ratio;
      delta: number | null;
      series: SeriesPoint[] | null;
    }
  | { kind: "count"; count: number; series: SeriesPoint[] | null }
  | { kind: "percent"; ratio: Ratio }
  | { kind: "scalar"; value: number | null; unit: "ratio" | "days" | "count" }
  | {
      kind: "subject";
      subjectId: string;
      name: string;
      ratio: Ratio;
      delta: number | null;
    }
  | {
      kind: "grade";
      gradeId: string;
      name: string;
      subjectId: string;
      subjectName: string;
      ratio: number;
      at: Date;
    }
  | {
      kind: "list";
      items: Array<{
        id: string;
        label: string;
        ratio: number | null;
        delta: number | null;
      }>;
    }
  | { kind: "distribution"; buckets: DistributionBucket[]; total: number }
  | { kind: "streak"; current: number; longest: number; alive: boolean }
  | { kind: "goal"; plan: GoalPlan };

const SERIES_POINTS = 24;

function seriesFor(context: CardContext, subjectId: string | null): SeriesPoint[] {
  const span = Math.max(
    1,
    Math.round(
      (context.to.getTime() - context.from.getTime()) / (24 * 60 * 60 * 1000),
    ),
  );
  const step = Math.max(1, Math.ceil(span / SERIES_POINTS));
  return averageOverTime(
    context.subjects,
    dayRange(context.from, context.to, step),
    subjectId,
    context.scope,
  );
}

/**
 * Compute one card. Anything the metric cannot answer — no grades yet, a
 * deleted subject, a goal that vanished — comes back as `empty` rather than a
 * throw, because a dashboard is a collection of independent readings.
 */
export function evaluateCard(
  spec: CardSpec,
  context: CardContext,
): CardResult {
  const resolved = context.resolveTarget(spec.target);
  if (!resolved) return { kind: "empty" };

  const { graph, scope, subjectId } = resolved;
  const localContext: CardContext = {
    ...context,
    graph,
    subjects: resolved.subjects,
    scope,
  };

  switch (spec.metric) {
    case "average": {
      const ratio = graph.ratio(subjectId, scope);
      if (ratio === null) return { kind: "empty" };
      const series =
        spec.display === "value" ? null : seriesFor(localContext, subjectId);
      const first = series?.find((point) => point.ratio !== null)?.ratio ?? null;
      return {
        kind: "ratio",
        ratio,
        delta: first === null ? null : ratio - first,
        series,
      };
    }

    case "averageTrend": {
      const series = seriesFor(localContext, subjectId);
      const slope = trend(series);
      if (slope === null) return { kind: "empty" };
      return { kind: "scalar", value: slope, unit: "ratio" };
    }

    case "projection": {
      const series = seriesFor(localContext, subjectId);
      const projected = projectedRatio(series, Math.round(SERIES_POINTS / 3));
      if (projected === null) return { kind: "empty" };
      const current = graph.ratio(subjectId, scope);
      return {
        kind: "ratio",
        ratio: projected,
        delta: current === null ? null : projected - current,
        series,
      };
    }

    case "gradeCount": {
      const count = graph.allGrades(subjectId ?? undefined).length;
      if (count === 0) return { kind: "empty" };
      return { kind: "count", count, series: null };
    }

    case "lastGrade": {
      const grades = graph.allGrades(subjectId ?? undefined);
      const last = grades.at(-1);
      if (!last) return { kind: "empty" };
      const ratio = gradeRatio(last);
      if (ratio === null) return { kind: "empty" };
      const subject = graph.byId(last.subjectId);
      return {
        kind: "grade",
        gradeId: last.id,
        name: last.name,
        subjectId: last.subjectId,
        subjectName: subject?.name ?? "",
        ratio,
        at: last.passedAt,
      };
    }

    case "bestGrade":
    case "worstGrade": {
      const ranked = rankGrades(graph, subjectId ?? undefined);
      const entry = spec.metric === "bestGrade" ? ranked[0] : ranked.at(-1);
      if (!entry) return { kind: "empty" };
      return {
        kind: "grade",
        gradeId: entry.grade.id,
        name: entry.grade.name,
        subjectId: entry.subject.id,
        subjectName: entry.subject.name,
        ratio: entry.ratio,
        at: entry.grade.passedAt,
      };
    }

    case "bestSubject":
    case "worstSubject": {
      const ranked = rankSubjects(graph).filter(
        (entry) => entry.subject.id !== subjectId,
      );
      const entry = spec.metric === "bestSubject" ? ranked[0] : ranked.at(-1);
      if (!entry) return { kind: "empty" };
      const general = graph.ratio(subjectId, scope);
      return {
        kind: "subject",
        subjectId: entry.subject.id,
        name: entry.subject.name,
        ratio: entry.ratio,
        delta: general === null ? null : entry.ratio - general,
      };
    }

    case "subjectRanking": {
      const ranked = rankSubjects(graph);
      if (ranked.length === 0) return { kind: "empty" };
      const general = graph.ratio(null, scope);
      return {
        kind: "list",
        items: ranked.map((entry) => ({
          id: entry.subject.id,
          label: entry.subject.name,
          ratio: entry.ratio,
          delta: general === null ? null : entry.ratio - general,
        })),
      };
    }

    case "mostImproved":
    case "steadiest": {
      const ranked =
        spec.metric === "mostImproved"
          ? rankByImprovement(graph).map((entry) => ({
              id: entry.subject.id,
              label: entry.subject.name,
              ratio: null,
              delta: entry.delta,
            }))
          : rankByConsistency(graph).map((entry) => ({
              id: entry.subject.id,
              label: entry.subject.name,
              ratio: entry.consistency,
              delta: null,
            }));
      if (ranked.length === 0) return { kind: "empty" };
      return { kind: "list", items: ranked };
    }

    case "passRate": {
      const ratios = gradeRatios(graph, subjectId ?? undefined);
      const rate = passRate(ratios, context.passingRatio);
      if (rate === null) return { kind: "empty" };
      return { kind: "percent", ratio: rate };
    }

    case "median": {
      const value = median(gradeRatios(graph, subjectId ?? undefined));
      if (value === null) return { kind: "empty" };
      return { kind: "ratio", ratio: value, delta: null, series: null };
    }

    case "spread": {
      const value = standardDeviation(
        gradeRatios(graph, subjectId ?? undefined),
      );
      if (value === null) return { kind: "empty" };
      return { kind: "scalar", value, unit: "ratio" };
    }

    case "consistency": {
      const value = consistency(gradeRatios(graph, subjectId ?? undefined));
      if (value === null) return { kind: "empty" };
      return { kind: "percent", ratio: value };
    }

    case "improvement": {
      const value = improvement(gradeRatios(graph, subjectId ?? undefined));
      if (value === null) return { kind: "empty" };
      return { kind: "scalar", value, unit: "ratio" };
    }

    case "passStreak": {
      const streaks = passStreaks(
        graph.allGrades(subjectId ?? undefined),
        context.passingRatio,
      );
      if (streaks.longest.length === 0) return { kind: "empty" };
      return {
        kind: "streak",
        current: streaks.current.length,
        longest: streaks.longest.length,
        alive: streaks.current.length > 0,
      };
    }

    case "activityStreak": {
      const streaks = activityStreaks(graph.allGrades(subjectId ?? undefined));
      if (streaks.longest.length === 0) return { kind: "empty" };
      return {
        kind: "streak",
        current: streaks.current.length,
        longest: streaks.longest.length,
        alive: streaks.current.length > 0,
      };
    }

    case "distribution": {
      const ratios = gradeRatios(graph, subjectId ?? undefined);
      if (ratios.length === 0) return { kind: "empty" };
      return {
        kind: "distribution",
        buckets: distribution(ratios),
        total: ratios.length,
      };
    }

    case "goalProgress": {
      const goal = context.goals.find((item) => item.id === spec.goalId);
      if (!goal) return { kind: "empty" };
      const series = seriesFor(localContext, subjectId);
      const plan = planGoal(goal, graph, subjectId, scope, {
        projection: projectedRatio(series, Math.round(SERIES_POINTS / 3)),
        remaining: context.remaining,
      });
      return { kind: "goal", plan };
    }

    default:
      return { kind: "empty" };
  }
}

/** The dashboard a brand-new year starts with. Deliberately short. */
export function defaultCards(): CardSpec[] {
  const base = {
    target: { kind: "general", referenceId: null } as CardTarget,
    title: null,
    accent: null,
    goalId: null,
    hidden: false,
  };

  return [
    {
      ...base,
      id: "average",
      metric: "average",
      display: "sparkline",
      span: 2,
      sortOrder: 0,
    },
    {
      ...base,
      id: "best-subject",
      metric: "bestSubject",
      display: "value",
      span: 1,
      sortOrder: 1,
    },
    {
      ...base,
      id: "worst-subject",
      metric: "worstSubject",
      display: "value",
      span: 1,
      sortOrder: 2,
    },
    {
      ...base,
      id: "last-grade",
      metric: "lastGrade",
      display: "value",
      span: 1,
      sortOrder: 3,
    },
    {
      ...base,
      id: "pass-rate",
      metric: "passRate",
      display: "gauge",
      span: 1,
      sortOrder: 4,
    },
    {
      ...base,
      id: "ranking",
      metric: "subjectRanking",
      display: "list",
      span: 2,
      sortOrder: 5,
    },
  ];
}

/** Displays that make sense for a metric, so the editor never offers nonsense. */
export function allowedDisplays(metric: CardMetric): CardDisplay[] {
  switch (metric) {
    case "average":
    case "projection":
      return ["value", "sparkline", "chart"];
    case "median":
      return ["value"];
    case "passRate":
    case "consistency":
      return ["value", "gauge"];
    case "subjectRanking":
    case "mostImproved":
    case "steadiest":
      return ["list"];
    case "distribution":
      return ["chart"];
    case "goalProgress":
      return ["gauge", "chart"];
    case "gradeCount":
      return ["value", "sparkline"];
    default:
      return ["value"];
  }
}
