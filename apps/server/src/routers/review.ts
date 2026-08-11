import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { grades, yearReviewViews, years } from "../db/schema";
import { protectedProcedure } from "../lib/orpc";
import { requireYear } from "../lib/ownership";

/**
 * Year in review.
 *
 * The story itself is assembled on the client from the year snapshot it
 * already holds. The one thing it cannot know is where the user stands against
 * everybody else, so that is all this router computes — plus the bookkeeping
 * that keeps the recap from re-announcing itself every visit.
 */

/** Enough of a year to be worth telling a story about. */
const MINIMUM_GRADES = 5;

export const reviewRouter = {
  /**
   * Availability and the activity percentile. The original recap ranked the
   * habit of recording results, never the result itself; that is both more
   * encouraging and avoids turning classmates' academic performance into a
   * leaderboard. Only the anonymous rank leaves this handler.
   */
  status: protectedProcedure
    .input(z.object({ yearId: z.string(), reviewKey: z.string().default("annual") }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);

      const [{ count = 0 } = {}] = await db
        .select({ count: sql<number>`count(*)` })
        .from(grades)
        .where(eq(grades.yearId, input.yearId));

      if (count < MINIMUM_GRADES) {
        return { available: false, topPercentile: 0, seen: false, gradeCount: count };
      }

      const [seenRow] = await db
        .select({ id: yearReviewViews.id })
        .from(yearReviewViews)
        .where(
          and(
            eq(yearReviewViews.userId, userId),
            eq(yearReviewViews.yearId, input.yearId),
            eq(yearReviewViews.reviewKey, input.reviewKey),
          ),
        )
        .limit(1);

      const windowEnd = new Date();
      const windowStart = new Date(windowEnd);
      windowStart.setDate(windowStart.getDate() - 365);
      const activity = await db
        .select({
          userId: grades.userId,
          total: sql<number>`count(*)`,
        })
        .from(grades)
        .where(
          and(
            gte(grades.passedAt, windowStart),
            lte(grades.passedAt, windowEnd),
          ),
        )
        .groupBy(grades.userId);

      const ranked = activity
        .map((row) => ({ userId: row.userId, total: Number(row.total) }))
        .filter((row) => row.total >= MINIMUM_GRADES)
        .sort((left, right) => right.total - left.total);
      const rank = ranked.findIndex((row) => row.userId === userId);
      const topPercentile =
        rank < 0 || ranked.length === 0
          ? 0
          : ranked.length === 1
            ? 1
            : Math.max(1, Math.ceil(((rank + 1) / ranked.length) * 100));

      return {
        available: true,
        topPercentile,
        seen: Boolean(seenRow),
        gradeCount: count,
      };
    }),

  markSeen: protectedProcedure
    .input(z.object({ yearId: z.string(), reviewKey: z.string().default("annual") }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      await db
        .insert(yearReviewViews)
        .values({
          userId,
          yearId: input.yearId,
          reviewKey: input.reviewKey,
        })
        .onConflictDoNothing();
      return { ok: true };
    }),

  /** Years the recap can be told for, newest first. */
  eligibleYears: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const rows = await db
      .select({
        yearId: years.id,
        name: years.name,
        startsAt: years.startsAt,
        endsAt: years.endsAt,
        total: sql<number>`count(${grades.id})`,
      })
      .from(years)
      .leftJoin(grades, eq(grades.yearId, years.id))
      .where(eq(years.userId, userId))
      .groupBy(years.id);

    return rows
      .filter((row) => row.total >= MINIMUM_GRADES)
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  }),
};
