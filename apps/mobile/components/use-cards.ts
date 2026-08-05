import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  estimateRemaining,
  evaluateCard,
  type CardMetric,
  type CardResult,
  type CardSpec,
} from "@avermate/core";
import { useYear } from "@/components/year-provider";
import { orpc } from "@/lib/orpc";
import { t } from "@/lib/i18n";

/**
 * The dashboard's cards, computed.
 *
 * A card is data — a metric, something to point it at, and how it should look —
 * so this hook is the whole feature: fetch the specs, hand each one the year
 * already in memory, and get back a small tagged value the UI knows how to
 * draw. Adding a metric never means adding a screen.
 */
export function useCards(surface: "overview" | "subject" | "grade" = "overview") {
  const {
    yearId,
    graph,
    subjects,
    period,
    year,
    goals,
    passingRatio,
    resolve,
  } = useYear();

  const query = useQuery({
    ...orpc.cards.list.queryOptions({
      input: { yearId: yearId ?? "", surface },
    }),
    enabled: Boolean(yearId),
  });

  const specs = useMemo(
    () => (query.data ?? []) as unknown as CardSpec[],
    [query.data],
  );

  const results = useMemo(() => {
    if (!year) return new Map<string, CardResult>();

    const from = period.startAt;
    const to = new Date(Math.min(Date.now(), period.endAt.getTime()));

    const context = {
      graph,
      subjects,
      scope: null,
      from,
      to: to > from ? to : new Date(from.getTime() + 1),
      passingRatio,
      goals,
      remaining: estimateRemaining(graph, from, period.endAt),
      resolveTarget: (target: { kind: "general" | "subject" | "custom"; referenceId: string | null }) => {
        const resolved = resolve(target);
        if (!resolved) return null;
        return {
          graph: resolved.graph,
          subjects: resolved.graph.subjects,
          scope: resolved.scope,
          subjectId: resolved.subjectId,
        };
      },
    };

    const computed = new Map<string, CardResult>();
    for (const spec of specs) {
      computed.set(spec.id, evaluateCard(spec, context));
    }
    return computed;
  }, [specs, graph, subjects, period, year, goals, passingRatio, resolve]);

  return {
    isLoading: query.isLoading,
    specs: specs.filter((spec) => !spec.hidden),
    hidden: specs.filter((spec) => spec.hidden),
    results,
  };
}

/**
 * Metric names, written out.
 *
 * A function rather than a map so the strings are read at call time and follow
 * a language change — the same reason `t()` is not a hook here.
 */
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

/** What each metric actually measures, for the editor. */
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
