import { useMemo } from "react";
import {
  SubjectGraph,
  averageOverTime,
  dayRange,
  estimateRemaining,
  planGoal,
  projectedRatio,
  restrictToPeriod,
  type Goal,
  type GoalPlan,
} from "@avermate/core";
import { useYear } from "@/components/year-provider";

/**
 * Goals, turned into plans.
 *
 * Everything expensive here is memoised on the graph, because the graph is
 * already memoised on the snapshot: moving between tabs recomputes nothing, and
 * recording a grade recomputes everything exactly once.
 */
export function useGoalPlans(): GoalPlan[] {
  const { goals, graph, subjects, periods, period, year, resolve } = useYear();

  return useMemo(() => {
    if (!year) return [];
    const scopedYear = year;

    return goals
      .map((goal) => planFor(goal))
      .filter((plan): plan is GoalPlan => plan !== null);

    function planFor(goal: Goal): GoalPlan | null {
      // A goal can be pinned to its own period, which is not necessarily the
      // one being viewed — "pass the first term" stays about the first term.
      const goalPeriod = goal.periodId
        ? (periods.find((item) => item.id === goal.periodId) ?? period)
        : null;

      const scopedSubjects = goalPeriod
        ? restrictToPeriod(subjects, goalPeriod, scopedYear)
        : subjects;
      const base = goalPeriod ? new SubjectGraph(scopedSubjects) : graph;

      const resolved = resolveIn(base, goal);
      if (!resolved) return null;

      const from = goalPeriod?.startAt ?? new Date(scopedYear.startsAt);
      const to = goalPeriod?.endAt ?? new Date(scopedYear.endsAt);
      const until = new Date(Math.min(Date.now(), to.getTime()));

      const series =
        until.getTime() > from.getTime()
          ? averageOverTime(
              base.subjects,
              dayRange(from, until, 7),
              resolved.subjectId,
              resolved.scope,
            )
          : [];

      return planGoal(goal, resolved.graph, resolved.subjectId, resolved.scope, {
        // Project to the end of the window rather than a fixed horizon: a goal
        // due in a fortnight and one due in June are not the same bet.
        projection: projectedRatio(
          series,
          Math.max(
            0,
            Math.round((to.getTime() - until.getTime()) / (7 * 86_400_000)),
          ),
        ),
        remaining: estimateRemaining(resolved.graph, from, to),
      });
    }

    /** `resolve` works on the viewed graph; a period-scoped goal needs its own. */
    function resolveIn(base: SubjectGraph, goal: Goal) {
      if (base === graph) {
        return resolve({ kind: goal.kind, referenceId: goal.referenceId });
      }
      if (goal.kind === "general") {
        return { graph: base, scope: null, subjectId: null };
      }
      if (goal.kind === "subject") {
        if (!goal.referenceId || !base.has(goal.referenceId)) return null;
        return { graph: base, scope: null, subjectId: goal.referenceId };
      }
      // Custom averages resolve against the viewed graph's definitions, which
      // are period-independent, so falling back to it is correct here.
      return resolve({ kind: goal.kind, referenceId: goal.referenceId });
    }
  }, [goals, graph, subjects, periods, period, year, resolve]);
}
