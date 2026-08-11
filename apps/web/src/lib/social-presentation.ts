export const SOCIAL_PROFILE_FIELDS = [
  "displayName",
  "avatar",
  "bio",
  "educationBand",
] as const

export type SocialProfileField = (typeof SOCIAL_PROFILE_FIELDS)[number]

export const SOCIAL_METRICS = [
  "normalizedAverage",
  "median",
  "trendBand",
  "passRateBand",
  "gradeCountBand",
  "genericGoalProgress",
] as const

export type SocialMetric = (typeof SOCIAL_METRICS)[number]

export type SocialExposure = "aggregate_only" | "member_visible" | "ranking"

export function socialProfileFieldSourceLabel(
  field: SocialProfileField
): string {
  switch (field) {
    case "displayName":
      return "Display name"
    case "avatar":
      return "Profile picture"
    case "bio":
      return "Bio"
    case "educationBand":
      return "Education level"
  }
}

export function socialMetricSourceLabel(metric: SocialMetric): string {
  switch (metric) {
    case "normalizedAverage":
      return "Normalized average"
    case "median":
      return "Median result"
    case "trendBand":
      return "Trend range"
    case "passRateBand":
      return "Success-rate range"
    case "gradeCountBand":
      return "Activity range"
    case "genericGoalProgress":
      return "Goal progress range"
  }
}

export function socialExposureSourceLabel(exposure: SocialExposure): string {
  switch (exposure) {
    case "aggregate_only":
      return "Group aggregate only"
    case "member_visible":
      return "Visible to participating members"
    case "ranking":
      return "Eligible for an optional ranking"
  }
}

export function isSocialProfileField(
  value: string
): value is SocialProfileField {
  return (SOCIAL_PROFILE_FIELDS as readonly string[]).includes(value)
}

export function isSocialMetric(value: string): value is SocialMetric {
  return (SOCIAL_METRICS as readonly string[]).includes(value)
}
