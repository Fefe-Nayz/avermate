import { describe, expect, test } from "bun:test";
import {
  fragmentFromInvitationUrl,
  parseSocialInvitationFragment,
  socialInvitationFragment,
} from "./social-invitation-link";

const token = "abcdefghijklmnopqrstuvwxyzABCDE_1234567890-xyz";

describe("native neutral social invitation links", () => {
  test("parses only allow-listed fragment kinds and opaque tokens", () => {
    expect(
      parseSocialInvitationFragment(`#kind=friend&token=${token}`),
    ).toEqual({ kind: "friend", token });
    expect(parseSocialInvitationFragment(`#kind=group&token=${token}`)).toEqual(
      {
        kind: "group",
        token,
      },
    );
    expect(
      parseSocialInvitationFragment(`#kind=admin&token=${token}`),
    ).toBeNull();
    expect(
      parseSocialInvitationFragment("#kind=friend&token=short"),
    ).toBeNull();
  });

  test("serializes a fragment that never enters the HTTP path", () => {
    const fragment = socialInvitationFragment({ kind: "group", token });
    expect(fragment).toBe(`#kind=group&token=${token}`);
    expect(
      fragmentFromInvitationUrl(
        `https://avermate.fr/social/invitation${fragment}`,
      ),
    ).toBe(fragment);
  });
});
