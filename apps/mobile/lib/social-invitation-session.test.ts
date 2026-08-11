import { afterEach, describe, expect, test } from "bun:test";
import {
  clearHeldSocialInvitations,
  discardSocialInvitation,
  holdSocialInvitation,
  peekSocialInvitation,
  socialInvitationPath,
  takeSocialInvitation,
} from "./social-invitation-session";

afterEach(clearHeldSocialInvitations);

describe("ephemeral social invitation continuation", () => {
  test("keeps the token behind an unrelated in-memory flow id", () => {
    const token = "secret/token-that-must-not-enter-navigation-setup";
    const id = holdSocialInvitation("friend", token, 1_000);
    expect(id).not.toContain(token);
    expect(peekSocialInvitation(id, 1_001)?.token).toBe(token);
    expect(socialInvitationPath(takeSocialInvitation(id, 1_002)!)).toBe(
      "/social/invitation#kind=friend&token=secret%2Ftoken-that-must-not-enter-navigation-setup",
    );
    expect(peekSocialInvitation(id, 1_003)).toBeNull();
  });

  test("expires fail-closed and never survives a process reset", () => {
    const id = holdSocialInvitation("group", "opaque", 1_000);
    expect(peekSocialInvitation(id, 1_000 + 30 * 60 * 1_000)).toBeNull();
    const second = holdSocialInvitation("group", "other", 5_000);
    clearHeldSocialInvitations();
    expect(peekSocialInvitation(second, 5_001)).toBeNull();
  });

  test("can be explicitly discarded when onboarding is cancelled", () => {
    const id = holdSocialInvitation("friend", "cancelled", 1_000);
    discardSocialInvitation(id);
    expect(peekSocialInvitation(id, 1_001)).toBeNull();
  });
});
