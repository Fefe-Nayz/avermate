export type UnauthorizedOutcome =
  | "active-session"
  | "expired-session"
  | "ignored";

export interface UnauthorizedSessionDependencies {
  clearExpiredIdentity: (userId: string) => Promise<void>;
  expireSession: () => Promise<void>;
  getIdentity: () => string;
  now?: () => number;
  redirectToSignIn: () => void;
  refreshSession: () => Promise<boolean>;
  setAnonymousIdentity: () => void;
}

/**
 * Collapse simultaneous RPC 401s into one authoritative Better Auth refresh.
 * A valid session is left mounted; an expired one moves atom + query cache to
 * anonymous exactly once before navigation. The short cooldown prevents each
 * retry in a failing request group from starting another session request.
 */
export function createUnauthorizedSessionHandler(
  dependencies: UnauthorizedSessionDependencies,
) {
  let inFlight: Promise<UnauthorizedOutcome> | null = null;
  let lastCheck: {
    at: number;
    identity: string;
    outcome: UnauthorizedOutcome;
  } | null = null;
  const clock = dependencies.now ?? Date.now;

  return function handleUnauthorized(): Promise<UnauthorizedOutcome> {
    const identity = dependencies.getIdentity();
    if (!identity.startsWith("user:")) return Promise.resolve("ignored");
    if (inFlight) return inFlight;
    if (lastCheck?.identity === identity && clock() - lastCheck.at < 2_000) {
      return Promise.resolve(lastCheck.outcome);
    }

    const checkedIdentity = identity;
    inFlight = (async () => {
      const active = await dependencies.refreshSession();
      // A sign-in/account switch completed while the refresh was in flight.
      if (dependencies.getIdentity() !== checkedIdentity) return "ignored";
      if (active) return "active-session";

      await dependencies.expireSession();
      if (dependencies.getIdentity() === checkedIdentity) {
        dependencies.setAnonymousIdentity();
        await dependencies
          .clearExpiredIdentity(checkedIdentity.slice("user:".length))
          .catch(() => undefined);
        dependencies.redirectToSignIn();
      }
      return "expired-session";
    })()
      .then((outcome) => {
        lastCheck = { at: clock(), identity: checkedIdentity, outcome };
        return outcome;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
