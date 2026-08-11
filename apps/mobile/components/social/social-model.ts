export const SOCIAL_PROFILE_FIELDS = [
  "displayName",
  "avatar",
  "bio",
  "educationBand",
] as const;

export type SocialProfileField = (typeof SOCIAL_PROFILE_FIELDS)[number];

export const SOCIAL_METRICS = [
  "normalizedAverage",
  "median",
  "trendBand",
  "passRateBand",
  "gradeCountBand",
  "genericGoalProgress",
] as const;

export type SocialMetric = (typeof SOCIAL_METRICS)[number];
export type SocialExposure = "aggregate_only" | "member_visible" | "ranking";
export type SocialEligibilityStatus =
  | "feature_disabled"
  | "age_unknown"
  | "consent_required"
  | "guardian_required"
  | "verification_expired"
  | "active"
  | "frozen";

export interface SocialEligibilityView {
  enabled: boolean;
  status: SocialEligibilityStatus;
  ageBand: "unknown" | "under15" | "15to17" | "adult";
  guardianRequired: boolean;
  guardianVerified: boolean;
  canUseSocial: boolean;
  policyVersion: string;
  profileStatus: "off" | "active" | "frozen";
  revision: number;
}

/** Missing data must never unlock a social route during a cold cache load. */
export function socialAppIsAccessible(
  eligibility: SocialEligibilityView | null | undefined,
): boolean {
  return Boolean(
    eligibility?.enabled &&
      eligibility.status === "active" &&
      eligibility.ageBand !== "unknown" &&
      eligibility.canUseSocial &&
      eligibility.profileStatus === "active",
  );
}

/** Groups and safety tools require consent, but never force a friend profile on. */
export function socialCoreIsAccessible(
  eligibility: SocialEligibilityView | null | undefined,
): boolean {
  return Boolean(
    eligibility?.enabled &&
      eligibility.status === "active" &&
      eligibility.ageBand !== "unknown" &&
      eligibility.canUseSocial &&
      eligibility.profileStatus !== "frozen",
  );
}

export function socialSetupIsAccessible(
  eligibility: SocialEligibilityView | null | undefined,
): boolean {
  return Boolean(
    eligibility?.enabled && eligibility.status !== "feature_disabled",
  );
}

export function socialRequiresGuardian(
  eligibility: SocialEligibilityView | null | undefined,
): boolean {
  return Boolean(
    eligibility?.guardianRequired &&
      !eligibility.guardianVerified &&
      (eligibility.status === "guardian_required" ||
        eligibility.status === "verification_expired"),
  );
}

export function isSocialMetric(value: string): value is SocialMetric {
  return (SOCIAL_METRICS as readonly string[]).includes(value);
}

export function isSocialProfileField(
  value: string,
): value is SocialProfileField {
  return (SOCIAL_PROFILE_FIELDS as readonly string[]).includes(value);
}
