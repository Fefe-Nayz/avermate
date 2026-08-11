import { and, desc, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { announcementViews, announcements } from "../db/schema";
import { announcementAudienceCondition } from "../lib/announcement-audience";
import { notFound, protectedProcedure } from "../lib/orpc";

const announcementScopeInput = z
  .object({ yearId: z.string().min(1).optional() })
  .optional();

function announcementForUser(announcement: typeof announcements.$inferSelect) {
  return {
    id: announcement.id,
    title: announcement.title,
    message: announcement.message,
    tone: announcement.tone,
    startsAt: announcement.startsAt,
    endsAt: announcement.endsAt,
    createdAt: announcement.createdAt,
    updatedAt: announcement.updatedAt,
  };
}

export const announcementsRouter = {
  /** Live announcements the signed-in user has not dismissed yet. */
  active: protectedProcedure
    .input(announcementScopeInput)
    .handler(async ({ context, input }) => {
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
            or(
              isNull(announcements.startsAt),
              lte(announcements.startsAt, now),
            ),
            or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
            announcementAudienceCondition(userId, input?.yearId),
          ),
        )
        .orderBy(desc(announcements.createdAt));

      return rows
        .filter((row) => row.announcement_views === null)
        .map((row) => announcementForUser(row.announcements));
    }),

  history: protectedProcedure
    .input(announcementScopeInput)
    .handler(async ({ context, input }) => {
      const now = new Date();
      const userId = context.session.user.id;
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
            announcementAudienceCondition(userId, input?.yearId),
            or(
              and(
                eq(announcements.active, true),
                or(
                  isNull(announcements.startsAt),
                  lte(announcements.startsAt, now),
                ),
                or(
                  isNull(announcements.endsAt),
                  gte(announcements.endsAt, now),
                ),
              ),
              isNotNull(announcementViews.id),
            ),
          ),
        )
        .orderBy(desc(announcements.createdAt))
        .limit(50);

      return (
        rows
          .map((row) => {
            const dismissed = row.announcement_views !== null;
            const announcement = row.announcements;
            const currentlyActive =
              announcement.active &&
              (!announcement.startsAt || announcement.startsAt <= now) &&
              (!announcement.endsAt || announcement.endsAt >= now);
            return {
              ...announcementForUser(announcement),
              dismissed,
              seen: dismissed,
              currentlyActive,
              seenAt: row.announcement_views?.seenAt ?? null,
            };
          })
          // Drafts and scheduled messages are admin-only. A dismissed message
          // is retained after expiry only while its audience still matches.
          .filter(
            (announcement) =>
              announcement.currentlyActive || announcement.dismissed,
          )
      );
    }),

  dismiss: protectedProcedure
    .input(
      z.object({
        announcementId: z.string(),
        yearId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const now = new Date();
      const userId = context.session.user.id;
      const [announcement] = await db
        .select({ id: announcements.id })
        .from(announcements)
        .where(
          and(
            eq(announcements.id, input.announcementId),
            eq(announcements.active, true),
            or(
              isNull(announcements.startsAt),
              lte(announcements.startsAt, now),
            ),
            or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
            announcementAudienceCondition(userId, input.yearId),
          ),
        )
        .limit(1);
      if (!announcement) notFound("Active announcement");

      await db
        .insert(announcementViews)
        .values({
          announcementId: input.announcementId,
          userId,
        })
        .onConflictDoNothing();
      return { ok: true };
    }),
};
