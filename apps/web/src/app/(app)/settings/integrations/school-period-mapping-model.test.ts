import { describe, expect, test } from "bun:test"
import {
  linkedPeriodMappings,
  periodMappingReviewCounts,
  periodMappingsNeedingReview,
} from "./school-period-mapping-model"

describe("school period mapping review", () => {
  const mappings = [
    { matchStatus: "mapped" as const, periodId: "term-1", name: "T1" },
    { matchStatus: "unmatched" as const, periodId: null, name: "T2" },
    { matchStatus: "ambiguous" as const, periodId: null, name: "T3" },
    { matchStatus: "mapped" as const, periodId: null, name: "Deleted" },
  ]

  test("separates linked periods from every row that needs review", () => {
    expect(
      periodMappingsNeedingReview(mappings).map((row) => row.name)
    ).toEqual(["T2", "T3", "Deleted"])
    expect(linkedPeriodMappings(mappings).map((row) => row.name)).toEqual([
      "T1",
    ])
    expect(periodMappingReviewCounts(mappings)).toEqual({
      unmatched: 2,
      ambiguous: 1,
    })
  })
})
