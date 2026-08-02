import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { announcementViews, announcements } from "../db/schema";
import { protectedProcedure } from "../lib/orpc";

export const announcementsRouter = {
  /** Live announcements the signed-in user has not dismissed yet. */
  active: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const now = new Date();

    const rows = await db
      .select()
      .from(announcements)
      .leftJoin(
        announcementViews,
        and(
          eq(announcementViews.announcementId, announcements.id),
          eq(announcementViews.userId, userId),
        ),
      )
      .where(
        and(
          eq(announcements.active, true),
          or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
          or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
        ),
      )
      .orderBy(desc(announcements.createdAt));

    return rows
      .filter((row) => row.announcement_views === null)
      .map((row) => row.announcements);
  }),

  history: protectedProcedure.handler(async () =>
    db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .limit(50),
  ),

  dismiss: protectedProcedure
    .input(z.object({ announcementId: z.string() }))
    .handler(async ({ context, input }) => {
      await db
        .insert(announcementViews)
        .values({
          announcementId: input.announcementId,
          userId: context.session.user.id,
        })
        .onConflictDoNothing();
      return { ok: true };
    }),
};
