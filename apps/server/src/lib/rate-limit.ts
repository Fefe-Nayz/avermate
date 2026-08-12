import { ORPCError } from "@orpc/server";
import { hashOpaque } from "./social-policy";

/**
 * A fixed-window limiter in process memory. This replaced a database-backed
 * one whose table belonged to the retired social-privacy machinery; the only
 * remaining consumer is feedback submission, where "one server restart
 * forgets the window" is an acceptable failure mode.
 */
const windows = new Map<string, { startedAt: number; count: number }>();

export function reserveRateLimit(input: {
  subject: string;
  action: string;
  limit: number;
  windowMs: number;
  now?: Date;
}): void {
  const now = (input.now ?? new Date()).getTime();
  const startedAt = Math.floor(now / input.windowMs) * input.windowMs;
  const key = `${hashOpaque(input.subject)}:${input.action}`;

  // Opportunistic cleanup keeps the map bounded without a timer.
  if (windows.size > 10_000) {
    for (const [existingKey, window] of windows) {
      if (window.startedAt + input.windowMs * 2 < now) {
        windows.delete(existingKey);
      }
    }
  }

  const current = windows.get(key);
  if (!current || current.startedAt !== startedAt) {
    windows.set(key, { startedAt, count: 1 });
    return;
  }
  if (current.count >= input.limit) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "Too many requests. Try again later.",
    });
  }
  current.count += 1;
}
