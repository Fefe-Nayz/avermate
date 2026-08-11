import { describe, expect, test } from "bun:test";
import { localUserKey } from "./local-settings";

describe("account-scoped local settings", () => {
  test("never gives two identities the same preference key", () => {
    expect(localUserKey("student-a", "theme")).not.toBe(
      localUserKey("student-b", "theme"),
    );
  });

  test("normalises keys for SecureStore without losing their namespace", () => {
    expect(localUserKey("oauth:user/1", "current period")).toBe(
      "avermate.user.oauth_user_1.current_period",
    );
  });
});
