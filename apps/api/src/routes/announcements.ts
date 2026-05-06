import { db } from "@/db";
import { announcementViews, announcements } from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
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

const announcementParamSchema = z.object({
  announcementId: z.string().min(1).max(64),
});

function isAnnouncementVisible(
  announcement: typeof announcements.$inferSelect,
  now: Date
) {
  if (!announcement.active) {
    return false;
  }

  if (announcement.startsAt && announcement.startsAt > now) {
    return false;
  }

  if (announcement.endsAt && announcement.endsAt < now) {
    return false;
  }

  return true;
}

app.get("/", async (c) => {
  const session = c.get("session");
  if (!session) throw new HTTPException(401);

  const now = new Date();
  const rows = await db.query.announcements.findMany({
    where: eq(announcements.active, true),
    orderBy: (announcements, { desc }) => [desc(announcements.createdAt)],
  });
  const visibleRows = rows.filter((announcement) =>
    isAnnouncementVisible(announcement, now)
  );

  if (visibleRows.length === 0) {
    return c.json({ announcements: [] });
  }

  const views = await db.query.announcementViews.findMany({
    where: and(
      eq(announcementViews.userId, session.user.id),
      inArray(
        announcementViews.announcementId,
        visibleRows.map((announcement) => announcement.id)
      )
    ),
  });
  const viewedAnnouncementIds = new Set(
    views.map((view) => view.announcementId)
  );

  return c.json({
    announcements: visibleRows
      .filter((announcement) => !viewedAnnouncementIds.has(announcement.id))
      .map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        message: announcement.message,
        tone: announcement.tone,
        startsAt: announcement.startsAt,
        endsAt: announcement.endsAt,
        createdAt: announcement.createdAt,
      })),
  });
});

app.get("/history", async (c) => {
  const session = c.get("session");
  if (!session) throw new HTTPException(401);

  const views = await db.query.announcementViews.findMany({
    where: eq(announcementViews.userId, session.user.id),
    orderBy: (announcementViews, { desc }) => [desc(announcementViews.viewedAt)],
  });

  if (views.length === 0) {
    return c.json({ announcements: [] });
  }

  const viewedAtByAnnouncementId = new Map(
    views.map((view) => [view.announcementId, view.viewedAt])
  );
  const rows = await db.query.announcements.findMany({
    where: inArray(
      announcements.id,
      views.map((view) => view.announcementId)
    ),
    orderBy: (announcements, { desc }) => [desc(announcements.createdAt)],
  });

  return c.json({
    announcements: rows.map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      message: announcement.message,
      tone: announcement.tone,
      active: announcement.active,
      startsAt: announcement.startsAt,
      endsAt: announcement.endsAt,
      createdAt: announcement.createdAt,
      updatedAt: announcement.updatedAt,
      viewedAt: viewedAtByAnnouncementId.get(announcement.id) ?? null,
    })),
  });
});

app.post(
  "/:announcementId/view",
  zValidator("param", announcementParamSchema),
  async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    const { announcementId } = c.req.valid("param");
    const announcement = await db.query.announcements.findFirst({
      where: eq(announcements.id, announcementId),
    });

    if (!announcement) {
      throw new HTTPException(404);
    }

    await db
      .insert(announcementViews)
      .values({
        announcementId,
        userId: session.user.id,
        viewedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [announcementViews.announcementId, announcementViews.userId],
      });

    return c.json({ viewed: true });
  }
);

export default app;
