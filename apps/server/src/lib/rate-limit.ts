import { ORPCError } from "@orpc/server";
import { lt, sql } from "drizzle-orm";
import { db } from "../db";
import { rateLimits } from "../db/schema";
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

/**
 * Atomically reserves a database-backed fixed-window slot. This is required at
 * external-provider boundaries because process-local counters reset on deploy
 * and do not coordinate multiple server instances.
 */
export async function reserveDurableRateLimit(input: {
  subject: string;
  action: string;
  limit: number;
  windowMs: number;
  now?: Date;
  database?: Pick<typeof db, "insert" | "delete">;
}): Promise<void> {
  const now = input.now ?? new Date();
  const startedAtMs =
    Math.floor(now.getTime() / input.windowMs) * input.windowMs;
  const windowStart = new Date(startedAtMs);
  const expiresAt = new Date(startedAtMs + input.windowMs);
  const target = input.database ?? db;

  const [reservation] = await target
    .insert(rateLimits)
    .values({
      subjectHash: hashOpaque(input.subject),
      action: input.action.slice(0, 200),
      windowStart,
      expiresAt,
      count: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        rateLimits.subjectHash,
        rateLimits.action,
        rateLimits.windowStart,
      ],
      set: {
        count: sql`${rateLimits.count} + 1`,
        expiresAt,
        updatedAt: now,
      },
    })
    .returning({ count: rateLimits.count });

  // Opportunistic bounded cleanup is deliberately after the atomic reserve;
  // cleanup failure must not turn a denied request into an allowed one.
  if (reservation?.count === 1) {
    await Promise.resolve(
      target.delete(rateLimits).where(lt(rateLimits.expiresAt, now)),
    ).catch(() => undefined);
  }
  if (!reservation || reservation.count > input.limit) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "Too many requests. Try again later.",
    });
  }
}
