import { ORPCError } from "@orpc/server";

export function assertVerifiedUser(user: { emailVerified: boolean }): void {
  if (!user.emailVerified) {
    throw new ORPCError("FORBIDDEN", {
      message: "Verify your email address before using Avermate",
    });
  }
}

type SuspensionState = {
  banned?: boolean | null;
  banExpires?: Date | string | number | null;
};

/** Better Auth keeps the audit flag after a timed suspension expires. */
export function isSuspensionActive(
  user: SuspensionState,
  now = new Date(),
): boolean {
  if (!user.banned) return false;
  if (!user.banExpires) return true;

  const expiresAt =
    user.banExpires instanceof Date
      ? user.banExpires.getTime()
      : new Date(user.banExpires).getTime();

  // A malformed legacy value must fail closed instead of silently restoring access.
  return !Number.isFinite(expiresAt) || expiresAt > now.getTime();
}
