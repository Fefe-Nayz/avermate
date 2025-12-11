import { db } from "@/db";
import { grades } from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, gte, lte, sql } from "drizzle-orm";
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

app.get("/:yearId", zValidator("param", getYearReviewSchema), async (c) => {
  const session = c.get("session");
  if (!session) throw new HTTPException(401);

  const { yearId } = c.req.valid("param");

  const year = await getYearById(yearId);

  if (!year) {
    throw new HTTPException(404, { message: "Year not found" });
  }

  if (year?.userId !== session.user.id) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  // Use dynamic dates from the year's startDate and endDate
  const startDateMin = new Date(year.startDate);
  const startDateMax = new Date(year.endDate);

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

  return c.json({
    hasData: true,
    topPercentile,
  });
});

export default app;
