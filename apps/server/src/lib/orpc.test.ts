import { describe, expect, test } from "bun:test";
import { assertVerifiedUser, isSuspensionActive } from "./access-policy";

describe("protected application access", () => {
  test("accepts verified identities", () => {
    expect(() => assertVerifiedUser({ emailVerified: true })).not.toThrow();
  });

  test("rejects legacy unverified sessions", () => {
    expect(() => assertVerifiedUser({ emailVerified: false })).toThrow(
      "Verify your email address before using Avermate",
    );
  });

  test("enforces permanent and future suspensions but releases expired ones", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");

    expect(isSuspensionActive({ banned: false }, now)).toBe(false);
    expect(isSuspensionActive({ banned: true, banExpires: null }, now)).toBe(
      true,
    );
    expect(
      isSuspensionActive(
        { banned: true, banExpires: "2026-08-11T12:01:00.000Z" },
        now,
      ),
    ).toBe(true);
    expect(
      isSuspensionActive(
        { banned: true, banExpires: "2026-08-11T11:59:00.000Z" },
        now,
      ),
    ).toBe(false);
  });
});
