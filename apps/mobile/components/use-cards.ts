import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  estimateRemaining,
  evaluateCard,
  evaluateWidgetDefinition,
  type CardResult,
  type CardSpec,
  type CardMetric,
  type WidgetDefinitionV1,
  type WidgetEvaluationContext,
  type WidgetEvaluationResult,
  type WidgetSurface,
  type WidgetValidationIssue,
} from "@avermate/core";
import { useYear } from "@/components/year-provider";
import { orpc } from "@/lib/orpc";
import { t } from "@/lib/i18n";
import { timelineCutoffTimestamp } from "@/lib/timeline";
import {
  resolveWidgetRow,
  type StoredWidgetRow,
} from "@/components/widgets/widget-row";

export interface WidgetCardModel {
  id: string;
  surface: WidgetSurface;
  definition: WidgetDefinitionV1;
  legacySpec: CardSpec | null;
  source: "v1" | "legacy";
  issues: WidgetValidationIssue[];
  span: 1 | 2 | 3 | 4;
  title: string | null;
  accent: string | null;
  sortOrder: number;
  hidden: boolean;
}

function span(value: number): 1 | 2 | 3 | 4 {
  return Math.min(4, Math.max(1, Math.round(value))) as 1 | 2 | 3 | 4;
}

/**
 * Dual-read every stored card and evaluate the canonical V1 definition.
 * Legacy columns remain a deterministic fallback for old or invalid rows.
 */
export function useCards(surface: WidgetSurface = "overview") {
  const yearState = useYear();
  const query = useQuery({
    ...orpc.cards.list.queryOptions({
      input: { yearId: yearState.yearId ?? "", surface },
    }),
    enabled: Boolean(yearState.yearId),
  });

  const all = useMemo<WidgetCardModel[]>(
    () =>
      ((query.data ?? []) as unknown as StoredWidgetRow[]).map((row) => {
        const resolved = resolveWidgetRow(row, surface);
        return {
          id: row.id,
          surface,
          definition: resolved.definition,
          legacySpec: resolved.legacySpec,
          source: resolved.source,
          issues: resolved.issues,
          span: span(row.span),
          title: row.title,
          accent: row.accent,
          sortOrder: row.sortOrder,
          hidden: row.hidden,
        };
      }),
    [query.data, surface],
  );

  const results = useMemo(() => {
    const computed = new Map<string, WidgetEvaluationResult | CardResult>();
    const { year, period } = yearState;
    if (!year) return computed;

    const cutoff =
      timelineCutoffTimestamp(yearState.timelineDate) ?? yearState.now;
    const from = period.startAt;
    const boundedTo = new Date(Math.min(cutoff, period.endAt.getTime()));
    const to = boundedTo > from ? boundedTo : new Date(from.getTime() + 1);
    const context: WidgetEvaluationContext = {
      surface,
      graph: yearState.graph,
      subjects: yearState.graph.subjects,
      yearSubjects: yearState.yearGraph.subjects,
      scope: null,
      from,
      to,
      passingRatio: yearState.passingRatio,
      goals: yearState.goals,
      periods: yearState.periods,
      customAverages: yearState.customAverages,
      year: {
        startsAt: year.startsAt,
        endsAt: year.endsAt,
        scale: year.scale,
      },
      now: new Date(cutoff),
      remaining: estimateRemaining(yearState.graph, from, period.endAt),
      resolveTarget: (target) => {
        const resolved = yearState.resolve(target);
        if (!resolved) return null;
        return {
          graph: resolved.graph,
          subjects: resolved.graph.subjects,
          scope: resolved.scope,
          subjectId: resolved.subjectId,
        };
      },
    };

    for (const card of all) {
      computed.set(
        card.id,
        card.legacySpec
          ? evaluateCard(card.legacySpec, context)
          : evaluateWidgetDefinition(card.definition, context),
      );
    }
    return computed;
  }, [all, surface, yearState]);

  return {
    isLoading: query.isLoading,
    error: query.error,
    cards: all.filter((card) => !card.hidden),
    hidden: all.filter((card) => card.hidden),
    all,
    results,
  };
}

/** Metric names are resolved at call time so locale changes are immediate. */
export function metricLabel(metric: CardMetric): string {
  switch (metric) {
    case "average":
      return t("Average");
    case "averageTrend":
      return t("Trend");
    case "projection":
      return t("Where it lands");
    case "gradeCount":
      return t("Grades recorded");
    case "lastGrade":
      return t("Latest result");
    case "bestGrade":
      return t("Best result");
    case "worstGrade":
      return t("Worst result");
    case "bestSubject":
      return t("Strongest subject");
    case "worstSubject":
      return t("Weakest subject");
    case "subjectRanking":
      return t("Subjects ranked");
    case "passRate":
      return t("Pass rate");
    case "median":
      return t("Median result");
    case "spread":
      return t("Spread");
    case "consistency":
      return t("Consistency");
    case "improvement":
      return t("Improvement");
    case "mostImproved":
      return t("Most improved");
    case "steadiest":
      return t("Steadiest subjects");
    case "passStreak":
      return t("Passing streak");
    case "activityStreak":
      return t("Activity streak");
    case "distribution":
      return t("Spread of results");
    case "goalProgress":
      return t("Goal progress");
  }
}

export function metricHint(metric: CardMetric): string | undefined {
  switch (metric) {
    case "averageTrend":
      return t("How far the average has moved across the period");
    case "projection":
      return t("Where the current trend puts you at the end");
    case "spread":
      return t("How far a typical result sits from your average");
    case "consistency":
      return t("How tightly your results cluster");
    case "improvement":
      return t("Second half of the period against the first");
    case "passStreak":
      return t("Consecutive results at or above the passing mark");
    case "activityStreak":
      return t("Consecutive days with a grade recorded");
    default:
      return undefined;
  }
}
