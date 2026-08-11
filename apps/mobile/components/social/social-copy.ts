import { t } from "@/lib/i18n";
import type {
  SocialExposure,
  SocialMetric,
  SocialProfileField,
} from "./social-model";

export function socialProfileFieldLabel(field: SocialProfileField): string {
  switch (field) {
    case "displayName":
      return t("Display name");
    case "avatar":
      return t("Profile picture");
    case "bio":
      return t("Bio");
    case "educationBand":
      return t("Education level");
  }
}

export function socialMetricLabel(metric: SocialMetric): string {
  switch (metric) {
    case "normalizedAverage":
      return t("Normalized average");
    case "median":
      return t("Median result");
    case "trendBand":
      return t("Trend range");
    case "passRateBand":
      return t("Success-rate range");
    case "gradeCountBand":
      return t("Activity range");
    case "genericGoalProgress":
      return t("Goal progress range");
  }
}

export function socialExposureLabel(exposure: SocialExposure): string {
  switch (exposure) {
    case "aggregate_only":
      return t("Group aggregate only");
    case "member_visible":
      return t("Visible to participating members");
    case "ranking":
      return t("Eligible for an optional ranking");
  }
}

export function groupTypeLabel(type: string): string {
  if (type === "class") return t("Class");
  if (type === "study_group") return t("Study group");
  return t("Friends group");
}

export function educationBandLabel(value: string): string {
  if (value === "middle_school") return t("Middle school");
  if (value === "high_school") return t("High school");
  if (value === "higher_education") return t("Higher education");
  if (value === "other") return t("Other education");
  return t("Not specified");
}
