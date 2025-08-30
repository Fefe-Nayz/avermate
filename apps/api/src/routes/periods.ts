import { db } from "@/db";
import { periods } from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

const app = new Hono<{
  Variables: {
    session: {
      user: User;
      session: Session;
    } | null;
  };
}>();

async function getPeriodById(periodId: string) {
  const period = await db.query.periods.findFirst({
    where: eq(periods.id, periodId),
  });
  return period;
}

/**
 * Get a period by id
 */

const getPeriodSchema = z.object({
  periodId: z.string().min(1).max(64),
});

app.get("/:periodId", zValidator("param", getPeriodSchema), async (c) => {
  const session = c.get("session");

  if (!session) throw new HTTPException(401);

  // If email isnt verified
  if (!session.user.emailVerified) {
    return c.json(
      { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
      403
    );
  }

  const { periodId } = c.req.valid("param");
  const period = await getPeriodById(periodId);
  if (!period) throw new HTTPException(404);
  if (period.userId !== session.user.id) throw new HTTPException(403);

  return c.json(period);
});

/**
 * Update a period by id
 */

const updatePeriodSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  // NEW FIELD
  isCumulative: z.boolean().optional(),
});

app.patch(
  "/:periodId",
  zValidator("param", getPeriodSchema),
  zValidator("json", updatePeriodSchema),
  async (c) => {
    const session = c.get("session");

    if (!session) throw new HTTPException(401);

    // If email isnt verified
    if (!session.user.emailVerified) {
      return c.json(
        {
          code: "EMAIL_NOT_VERIFIED",
          message: "Email verification is required",
        },
        403
      );
    }

    const { name, startAt, endAt, isCumulative } = c.req.valid("json");

    const { periodId } = c.req.valid("param");
    const period = await getPeriodById(periodId);
    if (!period) throw new HTTPException(404);
    if (period.userId !== session.user.id) throw new HTTPException(403);

    const updatedPeriod = await db
      .update(periods)
      .set({
        name,
        startAt: startAt ? new Date(startAt.getTime()) : undefined,
        endAt: endAt ? new Date(endAt.getTime()) : undefined,
        isCumulative
      })
      .where(and(eq(periods.id, periodId), eq(periods.userId, session.user.id)))
      .returning()
      .get();

    return c.json(updatedPeriod);
  }
);

/**
 * Delete a period by id
 */

const deletePeriodSchema = z.object({
  periodId: z.string().min(1).max(64),
});

app.delete("/:periodId", zValidator("param", deletePeriodSchema), async (c) => {
  const session = c.get("session");

  if (!session) throw new HTTPException(401);

  // If email isnt verified
  if (!session.user.emailVerified) {
    return c.json(
      { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
      403
    );
  }

  const { periodId } = c.req.valid("param");
  const period = await getPeriodById(periodId);
  if (!period) throw new HTTPException(404);
  if (period.userId !== session.user.id) throw new HTTPException(403);

  const deletedPeriod = await db
    .delete(periods)
    .where(and(eq(periods.id, periodId), eq(periods.userId, session.user.id)))
    .returning()
    .get();

  return c.json({ period: deletedPeriod });
});

export default app;
