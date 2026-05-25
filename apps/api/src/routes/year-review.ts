import { db } from "@/db";
import { grades, yearReviewViews } from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getYearById } from "./years";

const app = new Hono<{
  Variables: {
    session: {
      user: User;
      session: Session;
    } | null;
  };
}>();

const getYearReviewSchema = z.object({
  yearId: z.string().min(1),
});

const getYearReviewQuerySchema = z.object({
  reviewKey: z.string().min(1).max(120).optional(),
});

const markYearReviewViewedSchema = z.object({
  reviewKey: z.string().min(1).max(120),
});

app.get(
  "/:yearId",
  zValidator("param", getYearReviewSchema),
  zValidator("query", getYearReviewQuerySchema),
  async (c) => {
  const session = c.get("session");
  if (!session) throw new HTTPException(401);

  const { yearId } = c.req.valid("param");
  const { reviewKey } = c.req.valid("query");

  const year = await getYearById(yearId);

  if (!year) {
    throw new HTTPException(404, { message: "Year not found" });
  }

  if (year?.userId !== session.user.id) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  // Use the last 365 days
  const startDateMax = new Date();
  const startDateMin = new Date();
  startDateMin.setDate(startDateMin.getDate() - 365);

  // Calculate top percentile - this requires data from all users so it must stay server-side
  const userCounts = await db
    .select({
      userId: grades.userId,
      count: sql<number>`count(*)`
    })
    .from(grades)
    .where(
      and(
        gte(grades.passedAt, startDateMin),
        lte(grades.passedAt, startDateMax)
      )
    )
    .groupBy(grades.userId);

  const finalCounts = userCounts.map(u => ({ userId: u.userId, count: Number(u.count) }));

  // Sort descending by count
  finalCounts.sort((a, b) => b.count - a.count);

  const myRankIndex = finalCounts.findIndex(u => u.userId === session.user.id);
  let topPercentile = 0;

  if (myRankIndex !== -1 && finalCounts.length > 0) {
    const percent = ((myRankIndex + 1) / finalCounts.length) * 100;
    topPercentile = finalCounts.length === 1 ? 1 : Math.ceil(percent);
  }

  if (topPercentile < 1) topPercentile = 1;

  const view = reviewKey
    ? await db.query.yearReviewViews.findFirst({
        where: and(
          eq(yearReviewViews.userId, session.user.id),
          eq(yearReviewViews.yearId, year.id),
          eq(yearReviewViews.reviewKey, reviewKey)
        ),
      })
    : null;

  return c.json({
    hasData: true,
    topPercentile,
    viewed: Boolean(view),
  });
});

app.post(
  "/:yearId/viewed",
  zValidator("param", getYearReviewSchema),
  zValidator("json", markYearReviewViewedSchema),
  async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    const { yearId } = c.req.valid("param");
    const { reviewKey } = c.req.valid("json");
    const year = await getYearById(yearId);

    if (!year) {
      throw new HTTPException(404, { message: "Year not found" });
    }

    if (year.userId !== session.user.id) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    await db
      .insert(yearReviewViews)
      .values({
        userId: session.user.id,
        yearId: year.id,
        reviewKey,
        clickedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [
          yearReviewViews.userId,
          yearReviewViews.yearId,
          yearReviewViews.reviewKey,
        ],
      });

    return c.json({ viewed: true });
  }
);

export default app;
