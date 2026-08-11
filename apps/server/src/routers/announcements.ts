import { and, desc, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { announcementViews, announcements } from "../db/schema";
import { notFound, protectedProcedure } from "../lib/orpc";

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

  history: protectedProcedure.handler(async ({ context }) => {
    const now = new Date();
    const rows = await db
      .select()
      .from(announcements)
      .leftJoin(
        announcementViews,
        and(
          eq(announcementViews.announcementId, announcements.id),
          eq(announcementViews.userId, context.session.user.id),
        ),
      )
      .where(
        or(
          and(
            eq(announcements.active, true),
            or(
              isNull(announcements.startsAt),
              lte(announcements.startsAt, now),
            ),
            or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
          ),
          isNotNull(announcementViews.id),
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
            ...announcement,
            dismissed,
            seen: dismissed,
            currentlyActive,
            seenAt: row.announcement_views?.seenAt ?? null,
          };
        })
        // Drafts and scheduled messages are admin-only. A dismissed message is
        // retained after expiry so the user's inbox remains an honest history.
        .filter(
          (announcement) =>
            announcement.currentlyActive || announcement.dismissed,
        )
    );
  }),

  dismiss: protectedProcedure
    .input(z.object({ announcementId: z.string() }))
    .handler(async ({ context, input }) => {
      const now = new Date();
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
          ),
        )
        .limit(1);
      if (!announcement) notFound("Active announcement");

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
