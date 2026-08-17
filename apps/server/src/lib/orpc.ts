import { ORPCError, os } from "@orpc/server";
import { isAdmin } from "./admin";
import { assertVerifiedUser, isSuspensionActive } from "./access-policy";
import type { Context, Session } from "./context";

const base = os.$context<Context>();

export const publicProcedure = base;

/** Everything behind a verified sign-in. Narrows `context.session` to non-null. */
export const protectedProcedure = base.use(async ({ context, next }) => {
  if (!context.session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
  }
  if (isSuspensionActive(context.session.user)) {
    throw new ORPCError("FORBIDDEN", {
      message: context.session.user.banReason ?? "This account is suspended",
    });
  }
  assertVerifiedUser(context.session.user);
  return next({
    context: { ...context, session: context.session as Session },
  });
});

export const adminProcedure = protectedProcedure.use(({ context, next }) => {
  if (!isAdmin(context.session.user)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Administrator access required",
    });
  }
  return next({ context });
});

export function notFound(what: string): never {
  throw new ORPCError("NOT_FOUND", { message: `${what} not found` });
}

export function badRequest(message: string): never {
  throw new ORPCError("BAD_REQUEST", { message });
}

/**
 * The write was well-formed but the state it assumed has moved on.
 *
 * Its own status because a client has to be able to tell it apart from a rejection:
 * a bad request means stop and fix the payload, a conflict means reload and let the
 * person see what changed. Answering both with `BAD_REQUEST` left the only sensible
 * client behaviour — refetch and say so — indistinguishable from a bug.
 */
export function conflict(message: string): never {
  throw new ORPCError("CONFLICT", { message });
}
