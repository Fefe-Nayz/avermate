import { ORPCError, os } from "@orpc/server";
import { isAdmin } from "./admin";
import type { Context, Session } from "./context";

const base = os.$context<Context>();

export const publicProcedure = base;

/** Everything behind a sign-in. Narrows `context.session` to non-null. */
export const protectedProcedure = base.use(async ({ context, next }) => {
  if (!context.session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
  }
  if (context.session.user.banned) {
    throw new ORPCError("FORBIDDEN", {
      message: context.session.user.banReason ?? "This account is suspended",
    });
  }
  return next({
    context: { ...context, session: context.session as Session },
  });
});

export const adminProcedure = protectedProcedure.use(({ context, next }) => {
  if (!isAdmin(context.session.user)) {
    throw new ORPCError("FORBIDDEN", { message: "Administrator access required" });
  }
  return next({ context });
});

export function notFound(what: string): never {
  throw new ORPCError("NOT_FOUND", { message: `${what} not found` });
}

export function badRequest(message: string): never {
  throw new ORPCError("BAD_REQUEST", { message });
}
