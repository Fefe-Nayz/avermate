import { describe, expect, test } from "bun:test";
import {
  socialAppIsAccessible,
  socialCoreIsAccessible,
  socialRequiresGuardian,
  socialSetupIsAccessible,
  type SocialEligibilityView,
} from "./social-model";

const active: SocialEligibilityView = {
  enabled: true,
  status: "active",
  ageBand: "adult",
  guardianRequired: false,
  guardianVerified: false,
  canUseSocial: true,
  policyVersion: "2026-07-28",
  profileStatus: "active",
  revision: 1,
};

describe("mobile social access", () => {
  test("fails closed for missing, unknown, frozen and disabled responses", () => {
    expect(socialAppIsAccessible(undefined)).toBe(false);
    expect(socialAppIsAccessible({ ...active, ageBand: "unknown" })).toBe(false);
    expect(socialAppIsAccessible({ ...active, status: "frozen" })).toBe(false);
    expect(socialAppIsAccessible({ ...active, enabled: false })).toBe(false);
    expect(socialAppIsAccessible({ ...active, profileStatus: "off" })).toBe(false);
  });

  test("only unlocks the app for the fully active server decision", () => {
    expect(socialAppIsAccessible(active)).toBe(true);
    expect(socialSetupIsAccessible({ ...active, status: "consent_required" })).toBe(
      true,
    );
  });

  test("keeps groups available when the optional friend profile is off", () => {
    expect(
      socialCoreIsAccessible({
        ...active,
        profileStatus: "off",
      }),
    ).toBe(true);
    expect(
      socialAppIsAccessible({
        ...active,
        profileStatus: "off",
      }),
    ).toBe(false);
  });

  test("recognises under-15 joint-consent gates", () => {
    expect(
      socialRequiresGuardian({
        ...active,
        ageBand: "under15",
        status: "guardian_required",
        guardianRequired: true,
      }),
    ).toBe(true);
    expect(
      socialRequiresGuardian({
        ...active,
        ageBand: "under15",
        status: "active",
        guardianRequired: true,
        guardianVerified: true,
      }),
    ).toBe(false);
  });
});
