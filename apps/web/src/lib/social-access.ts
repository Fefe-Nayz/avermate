export type SocialEligibilityStatus =
  | "feature_disabled"
  | "age_unknown"
  | "consent_required"
  | "guardian_required"
  | "verification_expired"
  | "active"
  | "frozen"

export interface SocialEligibilityView {
  enabled: boolean
  status: SocialEligibilityStatus
  reason: SocialEligibilityStatus
  ageBand: "unknown" | "under15" | "15to17" | "adult"
  guardianRequired: boolean
  guardianVerified: boolean
  canUseSocial: boolean
  policyVersion: string
  profileStatus: "off" | "active" | "frozen"
  revision: number
}

/**
 * Social must fail closed. A missing/unknown response never makes navigation
 * visible and never unlocks a route while hydration is still in flight.
 */
export function socialFeatureIsKnown(
  eligibility: SocialEligibilityView | null | undefined
): boolean {
  return Boolean(
    eligibility?.enabled &&
    eligibility.status !== "feature_disabled" &&
    eligibility.status !== "age_unknown" &&
    eligibility.ageBand !== "unknown"
  )
}

export function socialAppIsAccessible(
  eligibility: SocialEligibilityView | null | undefined
): boolean {
  return Boolean(
    socialFeatureIsKnown(eligibility) &&
    eligibility?.canUseSocial &&
    eligibility.status === "active" &&
    eligibility.profileStatus === "active"
  )
}

/** Group consent does not require enabling friend discovery/profile fields. */
export function socialGroupIsAccessible(
  eligibility: SocialEligibilityView | null | undefined
): boolean {
  return Boolean(
    eligibility?.enabled &&
    eligibility.canUseSocial &&
    eligibility.status === "active" &&
    eligibility.profileStatus !== "frozen"
  )
}

export function socialSetupIsAccessible(
  eligibility: SocialEligibilityView | null | undefined
): boolean {
  return Boolean(
    eligibility?.enabled && eligibility.status !== "feature_disabled"
  )
}

export function socialRequiresGuardian(
  eligibility: SocialEligibilityView | null | undefined
): boolean {
  return Boolean(
    eligibility?.guardianRequired &&
    !eligibility.guardianVerified &&
    (eligibility.status === "guardian_required" ||
      eligibility.status === "verification_expired")
  )
}
