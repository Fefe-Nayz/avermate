import { env } from "@/lib/env";
import { limitable } from "@/lib/limitable";
import type { Context, Next } from "hono";
import { getConnInfo } from "hono/bun";

const restrictedMethods = ["POST", "PATCH", "PUT", "DELETE"];

export async function ratelimit(c: Context, next: Next) {
  if (env.DISABLE_RATE_LIMIT) {
    return await next();
  }

  const info = getConnInfo(c);

  console.time("ratelimit");

  if (!info) {
    return await next();
  }

  const session = c.get("session");
  const forwardedFor = c.req.header("x-forwarded-for");
  const identifier =
    session?.user?.id || forwardedFor || info?.remote?.address || "anon";

  /**
   * Auth routes
   * - sign up
   * - sign in
   * - send email verification
   * - reset password
   */

  const path = c.req.path;

  let rule = "default";

  switch (path) {
    case "/api/auth/sign-up/email":
      rule = "authRestricted";
      break;

    case "/api/auth/sign-in/email":
      rule = "authRestricted";
      break;

    case "/api/auth/forget-password":
      rule = "emailRestricted";
      break;

    case "/api/auth/send-verification-email":
      rule = "emailRestricted";
      break;

    default:
      rule = restrictedMethods.includes(c.req.method)
        ? "restricted"
        : "default";
      break;
  }

  const { isExceeded, remaining, limit, resetIn } = await limitable.verify(
    identifier,
    rule
  );

  // Set rate limit headers
  c.header("RateLimit-Limit", limit.toString());
  c.header("RateLimit-Remaining", remaining.toString());
  c.header("RateLimit-Reset", resetIn.toString());

  console.timeEnd("ratelimit");

  if (isExceeded) {
    console.log(identifier, " is being rate limited for ", rule);
    return c.json(
      {
        code: "ERR_RATE_LIMIT_EXCEEDED",
        message: "You're being rate limited!",
      },
      429
    );
  }

  await next();
}
