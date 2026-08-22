"use client"

import { useCallback, useMemo } from "react"
import {
  averageOverTime,
  dayRange,
  estimateRemaining,
  planGoal,
  projectedRatio,
  type Goal,
  type GoalPlan,
} from "@avermate/core"
import { useYear } from "@/components/year/year-provider"

/**
 * Turns goals into plans, with the same assumptions everywhere.
 *
 * Two of those assumptions decide what the app tells someone: how many results
 * are still to come (which is what makes a target reachable or not) and where
 * the current trend is heading. Getting them from one place is what stops the
 * dashboard and the goal screen disagreeing about the same goal.
 */
export function useGoalPlans() {
  const { graph, subjects, period, year, resolve } = useYear()

  const window = useMemo(() => {
    const from = new Date(
      Math.max(
        new Date(period.startAt).getTime(),
        new Date(year?.startsAt ?? period.startAt).getTime()
      )
    )
    const to = new Date(period.endAt)
    return { from, to }
  }, [period, year])

  const remaining = useMemo(
    () => estimateRemaining(graph, window.from, window.to),
    [graph, window]
  )

  const plan = useCallback(
    (goal: Goal): GoalPlan | null => {
      const resolved = resolve({
        kind: goal.kind,
        referenceId: goal.referenceId,
      })
      if (!resolved) return null

      const until = new Date(Math.min(Date.now(), window.to.getTime()))
      let projection: number | null = null
      if (until > window.from) {
        const span =
          (until.getTime() - window.from.getTime()) / (24 * 60 * 60 * 1000)
        const series = averageOverTime(
          resolved.graph.subjects,
          dayRange(window.from, until, Math.max(1, Math.ceil(span / 40))),
          resolved.subjectId,
          resolved.scope,
          resolved.graph.options
        )
        projection = projectedRatio(series, 8)
      }

      return planGoal(
        goal,
        resolved.graph,
        resolved.subjectId,
        resolved.scope,
        {
          projection,
          remaining,
        }
      )
    },
    [resolve, remaining, window]
  )

  const plans = useCallback(
    (goals: readonly Goal[]): GoalPlan[] =>
      goals.map(plan).filter((item): item is GoalPlan => item !== null),
    [plan]
  )

  return { plan, plans, remaining, subjects }
}
