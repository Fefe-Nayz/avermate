import { describe, expect, test } from "bun:test";
import { createUnauthorizedSessionHandler } from "./auth-unauthorized";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("mobile 401 session recovery", () => {
  test("coalesces concurrent 401s and expires one session exactly once", async () => {
    let identity = "user:expired";
    let refreshes = 0;
    let expirations = 0;
    let clears = 0;
    let redirects = 0;
    const refresh = deferred<boolean>();
    const handler = createUnauthorizedSessionHandler({
      clearExpiredIdentity: async (userId) => {
        expect(userId).toBe("expired");
        clears += 1;
      },
      expireSession: async () => {
        expirations += 1;
      },
      getIdentity: () => identity,
      redirectToSignIn: () => {
        redirects += 1;
      },
      refreshSession: async () => {
        refreshes += 1;
        return refresh.promise;
      },
      setAnonymousIdentity: () => {
        identity = "anonymous";
      },
    });

    const outcomes = [handler(), handler(), handler()];
    expect(refreshes).toBe(1);
    refresh.resolve(false);
    expect(await Promise.all(outcomes)).toEqual([
      "expired-session",
      "expired-session",
      "expired-session",
    ]);
    expect({ clears, expirations, redirects, identity }).toEqual({
      clears: 1,
      expirations: 1,
      redirects: 1,
      identity: "anonymous",
    });
  });

  test("keeps a refreshed session mounted and rate-limits retry storms", async () => {
    let now = 1_000;
    let refreshes = 0;
    let expired = false;
    const handler = createUnauthorizedSessionHandler({
      clearExpiredIdentity: async () => undefined,
      expireSession: async () => {
        expired = true;
      },
      getIdentity: () => "user:active",
      now: () => now,
      redirectToSignIn: () => undefined,
      refreshSession: async () => {
        refreshes += 1;
        return true;
      },
      setAnonymousIdentity: () => undefined,
    });

    expect(await handler()).toBe("active-session");
    expect(await handler()).toBe("active-session");
    expect(refreshes).toBe(1);
    expect(expired).toBe(false);

    now += 2_001;
    expect(await handler()).toBe("active-session");
    expect(refreshes).toBe(2);
  });

  test("does not expire a different account that arrived during refresh", async () => {
    let identity = "user:first";
    let expired = false;
    const refresh = deferred<boolean>();
    const handler = createUnauthorizedSessionHandler({
      clearExpiredIdentity: async () => undefined,
      expireSession: async () => {
        expired = true;
      },
      getIdentity: () => identity,
      redirectToSignIn: () => undefined,
      refreshSession: () => refresh.promise,
      setAnonymousIdentity: () => {
        identity = "anonymous";
      },
    });

    const outcome = handler();
    identity = "user:second";
    refresh.resolve(false);
    expect(await outcome).toBe("ignored");
    expect(expired).toBe(false);
    expect(identity).toBe("user:second");
  });
});
