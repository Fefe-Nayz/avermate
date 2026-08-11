import { describe, expect, test } from "bun:test"
import {
  isSocialMetric,
  isSocialProfileField,
  SOCIAL_METRICS,
  SOCIAL_PROFILE_FIELDS,
  socialExposureSourceLabel,
  socialMetricSourceLabel,
  socialProfileFieldSourceLabel,
} from "./social-presentation"

describe("social presentation allow-lists", () => {
  test("every profile field has user-facing copy", () => {
    expect(
      SOCIAL_PROFILE_FIELDS.map(socialProfileFieldSourceLabel)
    ).not.toContain("")
    expect(isSocialProfileField("email")).toBeFalse()
    expect(isSocialProfileField("displayName")).toBeTrue()
  })

  test("every derived metric has user-facing copy", () => {
    expect(SOCIAL_METRICS.map(socialMetricSourceLabel)).not.toContain("")
    expect(isSocialMetric("rawGrades")).toBeFalse()
    expect(isSocialMetric("normalizedAverage")).toBeTrue()
  })

  test("all exposures explain their audience", () => {
    expect(
      (["aggregate_only", "member_visible", "ranking"] as const).map(
        socialExposureSourceLabel
      )
    ).toEqual([
      "Group aggregate only",
      "Visible to participating members",
      "Eligible for an optional ranking",
    ])
  })
})
