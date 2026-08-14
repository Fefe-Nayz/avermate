"use client"

import { useMemo } from "react"
import {
  evaluateWidgetDefinition,
  type WidgetDefinitionV1,
  type WidgetEvaluationResult,
  type WidgetSurface,
} from "@avermate/core"
import { useGoalPlans } from "@/hooks/use-goal-plans"
import { useYear } from "@/components/year/year-provider"
import { widgetEvaluationTime } from "./widget-evaluation-time"

export function useWidgetResult(
  definition: WidgetDefinitionV1,
  surface: WidgetSurface,
  enabled = true
): WidgetEvaluationResult {
  const {
    graph,
    period,
    periods,
    yearGraph,
    year,
    passingRatio,
    goals,
    customAverages,
    resolve,
    now,
    timelineDate,
  } = useYear()
  const { remaining } = useGoalPlans()

  return useMemo(() => {
    if (!enabled || !year) return { kind: "empty", shape: "scalar" }
    const evaluationTime = widgetEvaluationTime(
      timelineDate,
      now,
      period.startAt,
      period.endAt
    )
    return evaluateWidgetDefinition(definition, {
      graph,
      subjects: graph.subjects,
      scope: null,
      from: evaluationTime.from,
      to: evaluationTime.to,
      passingRatio,
      goals,
      remaining,
      resolveTarget: (target) => {
        const resolved = resolve(target)
        if (!resolved) return null
        return {
          ...resolved,
          subjects: resolved.graph.subjects,
        }
      },
      year,
      yearSubjects: yearGraph.subjects,
      periods,
      customAverages,
      now: evaluationTime.now,
      surface,
    })
  }, [
    customAverages,
    definition,
    enabled,
    goals,
    graph,
    now,
    passingRatio,
    period.endAt,
    period.startAt,
    periods,
    remaining,
    resolve,
    surface,
    timelineDate,
    year,
    yearGraph.subjects,
  ])
}
