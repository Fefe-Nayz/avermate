"use client"

import { useMemo } from "react"
import {
  evaluateWidgetDefinition,
  widgetSocialNeeds,
  type WidgetDefinition,
  type WidgetEvaluationResult,
  type WidgetSurface,
} from "@avermate/core"
import { useCohorts, useFriends } from "@/hooks/use-cohorts"
import { useGoalPlans } from "@/hooks/use-goal-plans"
import { useYear } from "@/components/year/year-provider"
import { widgetEvaluationTime } from "./widget-evaluation-time"

/** Stored comparison ids that have to be resolved to cohort endpoint group ids. */
export function widgetCohortComparisonIds(
  definition: WidgetDefinition | null
): string[] {
  if (!definition) return []
  return [
    ...new Set(
      definition.analysis.measures.flatMap((measure) => {
        const expression = measure.expression
        return expression.kind === "metric" && expression.groupId
          ? [expression.groupId]
          : []
      })
    ),
  ]
}

export function useWidgetResult(
  /** `null` for a row this build cannot read — see `resolveWidgetRow`. */
  definition: WidgetDefinition | null,
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
    gradeTypes,
    resolve,
    now,
    timelineDate,
  } = useYear()
  const { remaining } = useGoalPlans()
  /**
   * The groups this reader may be compared against.
   *
   * On the context rather than fetched by the card, so a dashboard of six cards comparing
   * against the same class loads it once — and so the figures are *never* part of a saved
   * definition. A card names a comparison; the numbers arrive here.
   */
  const needs = useMemo(
    () =>
      definition
        ? widgetSocialNeeds(definition)
        : { cohorts: false, friends: false },
    [definition]
  )
  const comparisonIds = useMemo(
    () => widgetCohortComparisonIds(definition),
    [definition]
  )
  const { cohorts } = useCohorts({
    enabled: enabled && needs.cohorts,
    comparisonIds,
  })
  const { friends } = useFriends({ enabled: enabled && needs.friends })

  return useMemo(() => {
    if (!enabled || !year || !definition)
      return { kind: "empty", shape: "scalar" }
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
      // The names the type dimension labels its buckets with; only the year knows them.
      gradeTypes,
      now: evaluationTime.now,
      surface,
      cohorts,
      friends,
    })
  }, [
    cohorts,
    customAverages,
    definition,
    enabled,
    friends,
    goals,
    gradeTypes,
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
