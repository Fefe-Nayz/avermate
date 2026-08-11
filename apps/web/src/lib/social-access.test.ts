import { describe, expect, test } from "bun:test"
import {
  socialAppIsAccessible,
  socialFeatureIsKnown,
  socialGroupIsAccessible,
  socialRequiresGuardian,
  socialSetupIsAccessible,
  type SocialEligibilityView,
} from "./social-access"

const active: SocialEligibilityView = {
  enabled: true,
  status: "active",
  reason: "active",
  ageBand: "adult",
  guardianRequired: false,
  guardianVerified: false,
  canUseSocial: true,
  policyVersion: "2026-08",
  profileStatus: "active",
  revision: 1,
}

describe("social access fails closed", () => {
  test("missing, disabled and unknown eligibility stay hidden", () => {
    expect(socialFeatureIsKnown(undefined)).toBeFalse()
    expect(
      socialFeatureIsKnown({
        ...active,
        enabled: false,
        status: "feature_disabled",
        reason: "feature_disabled",
        canUseSocial: false,
      })
    ).toBeFalse()
    expect(
      socialFeatureIsKnown({
        ...active,
        status: "age_unknown",
        reason: "age_unknown",
        ageBand: "unknown",
        canUseSocial: false,
        profileStatus: "off",
      })
    ).toBeFalse()
  })

  test("only a fully active profile unlocks the social app", () => {
    expect(socialAppIsAccessible(active)).toBeTrue()
    expect(
      socialAppIsAccessible({ ...active, profileStatus: "off" })
    ).toBeFalse()
    expect(
      socialAppIsAccessible({
        ...active,
        status: "frozen",
        reason: "frozen",
        canUseSocial: false,
        profileStatus: "frozen",
      })
    ).toBeFalse()
  })

  test("setup is available without making social navigation public", () => {
    const unknown: SocialEligibilityView = {
      ...active,
      status: "age_unknown",
      reason: "age_unknown",
      ageBand: "unknown",
      canUseSocial: false,
      profileStatus: "off",
    }
    expect(socialSetupIsAccessible(unknown)).toBeTrue()
    expect(socialFeatureIsKnown(unknown)).toBeFalse()
  })

  test("under-15 access waits for a verified guardian", () => {
    const child: SocialEligibilityView = {
      ...active,
      status: "guardian_required",
      reason: "guardian_required",
      ageBand: "under15",
      guardianRequired: true,
      guardianVerified: false,
      canUseSocial: false,
      profileStatus: "off",
    }
    expect(socialRequiresGuardian(child)).toBeTrue()
    expect(socialAppIsAccessible(child)).toBeFalse()
  })

  test("group consent does not force a discoverable friend profile", () => {
    expect(
      socialGroupIsAccessible({
        ...active,
        profileStatus: "off",
      })
    ).toBe(true)
    expect(socialGroupIsAccessible({ ...active, canUseSocial: false })).toBe(
      false
    )
  })
})
