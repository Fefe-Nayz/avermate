export type PeriodMappingStatus = "mapped" | "unmatched" | "ambiguous"

interface PeriodMappingShape {
  matchStatus: PeriodMappingStatus
  periodId: string | null
}

export function periodMappingsNeedingReview<T extends PeriodMappingShape>(
  mappings: readonly T[]
) {
  return mappings.filter(
    (mapping) => mapping.matchStatus !== "mapped" || !mapping.periodId
  )
}

export function linkedPeriodMappings<T extends PeriodMappingShape>(
  mappings: readonly T[]
) {
  return mappings.filter(
    (mapping) => mapping.matchStatus === "mapped" && Boolean(mapping.periodId)
  )
}

export function periodMappingReviewCounts(
  mappings: readonly PeriodMappingShape[]
) {
  return mappings.reduce(
    (counts, mapping) => {
      if (mapping.matchStatus === "ambiguous") counts.ambiguous += 1
      else if (mapping.matchStatus === "unmatched" || !mapping.periodId) {
        counts.unmatched += 1
      }
      return counts
    },
    { unmatched: 0, ambiguous: 0 }
  )
}
