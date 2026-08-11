import { describe, expect, test } from "bun:test"
import {
  parseGuardianConsentHandoff,
  parseGuardianConsentFragment,
  parseSocialInvitationFragment,
  parseSocialInvitationHandoff,
  serializeGuardianConsentHandoff,
  serializeSocialInvitationHandoff,
  socialInvitationFromLegacyPath,
} from "./social-invitation"

const token = "abcdefghijklmnopqrstuvwxyzABCDE_1234567890-xyz"

describe("private social invitation handoff", () => {
  test("parses only allow-listed fragment kinds and opaque tokens", () => {
    expect(
      parseSocialInvitationFragment(`#kind=friend&token=${token}`)
    ).toEqual({ kind: "friend", token })
    expect(parseSocialInvitationFragment(`#kind=group&token=${token}`)).toEqual(
      { kind: "group", token }
    )
    expect(
      parseSocialInvitationFragment(`#kind=admin&token=${token}`)
    ).toBeNull()
    expect(parseSocialInvitationFragment("#kind=friend&token=short")).toBeNull()
    expect(
      parseSocialInvitationFragment(
        `#kind=friend&token=${token}&next=https://evil.test`
      )
    ).toEqual({ kind: "friend", token })
  })

  test("round-trips a versioned session-only handoff", () => {
    const invitation = { kind: "group" as const, token }
    const stored = serializeSocialInvitationHandoff(invitation, 1_000)
    expect(parseSocialInvitationHandoff(stored, 1_000)).toEqual(invitation)
    expect(
      parseSocialInvitationHandoff(stored, 1_000 + 2 * 60 * 60 * 1_000 + 1)
    ).toBeNull()
    expect(parseSocialInvitationHandoff('{"version":2}')).toBeNull()
    expect(parseSocialInvitationHandoff("not json")).toBeNull()
  })

  test("accepts legacy path links only for compatibility", () => {
    expect(
      socialInvitationFromLegacyPath(`/social/friends/invitations/${token}`)
    ).toEqual({ kind: "friend", token })
    expect(
      socialInvitationFromLegacyPath(`/social/invitations/${token}`)
    ).toEqual({ kind: "group", token })
    expect(
      socialInvitationFromLegacyPath(`/social/invitations/${token}/extra`)
    ).toBeNull()
    expect(
      socialInvitationFromLegacyPath("//evil.test/social/invitations/x")
    ).toBeNull()
  })

  test("parses guardian tokens from fragments without identity data", () => {
    expect(parseGuardianConsentFragment(`#token=${token}`)).toBe(token)
    expect(
      parseGuardianConsentFragment("#token=short&email=child@example.com")
    ).toBeNull()
  })

  test("expires the guardian consent handoff kept in tab memory", () => {
    const stored = serializeGuardianConsentHandoff(token, 5_000)
    expect(parseGuardianConsentHandoff(stored, 5_000)).toBe(token)
    expect(
      parseGuardianConsentHandoff(stored, 5_000 + 2 * 60 * 60 * 1_000 + 1)
    ).toBeNull()
    expect(parseGuardianConsentHandoff(token, 5_000)).toBeNull()
  })
})
