import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { grades, subjects, yearReviewViews, years } from "../db/schema";
import { protectedProcedure } from "../lib/orpc";
import { requireYear } from "../lib/ownership";
import { SubjectGraph } from "@avermate/core";

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

async function generalRatioFor(yearId: string): Promise<number | null> {
  const [subjectRows, gradeRows] = await Promise.all([
    db.select().from(subjects).where(eq(subjects.yearId, yearId)),
    db.select().from(grades).where(eq(grades.yearId, yearId)),
  ]);

  const gradesBySubject = new Map<string, typeof gradeRows>();
  for (const grade of gradeRows) {
    const list = gradesBySubject.get(grade.subjectId);
    if (list) list.push(grade);
    else gradesBySubject.set(grade.subjectId, [grade]);
  }

  const graph = new SubjectGraph(
    subjectRows.map((subject) => ({
      id: subject.id,
      name: subject.name,
      shortName: subject.shortName,
      parentId: subject.parentId,
      coefficient: subject.coefficient,
      kind: subject.kind as "subject" | "category",
      isMain: subject.isMain,
      sortOrder: subject.sortOrder,
      grades: (gradesBySubject.get(subject.id) ?? []).map((grade) => ({
        id: grade.id,
        name: grade.name,
        value: grade.value,
        outOf: grade.outOf,
        coefficient: grade.coefficient,
        passedAt: grade.passedAt,
        createdAt: grade.createdAt,
        subjectId: grade.subjectId,
        periodId: grade.periodId,
        components: [],
      })),
    })),
  );

  return graph.ratio(null);
}

export const reviewRouter = {
  /**
   * Availability and the percentile. Comparing across users means reading
   * other people's years, so nothing identifying ever leaves this handler —
   * only the rank of one ratio among many.
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

      const mine = await generalRatioFor(input.yearId);
      let topPercentile = 0;

      if (mine !== null) {
        // Only years that are actually being used are worth comparing against;
        // a dormant account would otherwise flatter everybody.
        const activeYears = await db
          .select({ yearId: grades.yearId, total: sql<number>`count(*)` })
          .from(grades)
          .groupBy(grades.yearId)
          .having(sql`count(*) >= ${MINIMUM_GRADES}`);

        const ratios: number[] = [];
        for (const row of activeYears) {
          const ratio = await generalRatioFor(row.yearId);
          if (ratio !== null) ratios.push(ratio);
        }

        if (ratios.length > 1) {
          const below = ratios.filter((ratio) => ratio < mine).length;
          topPercentile = Math.max(
            1,
            Math.round(100 - (below / ratios.length) * 100),
          );
        }
      }

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
