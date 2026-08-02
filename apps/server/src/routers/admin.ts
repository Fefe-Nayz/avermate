import { and, desc, eq, gte, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  announcements,
  feedback,
  grades,
  sessions,
  subjects,
  users,
  years,
} from "../db/schema";
import { adminProcedure, notFound, protectedProcedure } from "../lib/orpc";
import { isAdmin } from "../lib/admin";

/**
 * Buckets a timestamp column by day, for the activity charts.
 * Drizzle's `mode: "timestamp"` stores seconds, so `unixepoch` reads it
 * directly — dividing by 1000 first lands every row in January 1970.
 */
const dayOf = (column: unknown) =>
  sql<string>`date(${column}, 'unixepoch')`;

function since(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

export const adminRouter = {
  /**
   * Deliberately open to any signed-in user: the answer is "no" for most of
   * them, and the navigation needs to know that without a failed request.
   */
  access: protectedProcedure.handler(({ context }) => ({
    isAdmin: isAdmin(context.session.user),
  })),

  overview: adminProcedure
    .input(z.object({ days: z.number().int().min(7).max(365).default(30) }))
    .handler(async ({ input }) => {
      const from = since(input.days);

      const [
        [totals = { users: 0, years: 0, subjects: 0, grades: 0 }],
        signups,
        gradeActivity,
        activeSessions,
        openFeedback,
      ] = await Promise.all([
        db
          .select({
            users: sql<number>`(select count(*) from ${users})`,
            years: sql<number>`(select count(*) from ${years})`,
            subjects: sql<number>`(select count(*) from ${subjects})`,
            grades: sql<number>`(select count(*) from ${grades})`,
          })
          .from(sql`(select 1)`),
        db
          .select({ day: dayOf(users.createdAt), count: sql<number>`count(*)` })
          .from(users)
          .where(gte(users.createdAt, from))
          .groupBy(dayOf(users.createdAt)),
        db
          .select({ day: dayOf(grades.createdAt), count: sql<number>`count(*)` })
          .from(grades)
          .where(gte(grades.createdAt, from))
          .groupBy(dayOf(grades.createdAt)),
        db
          .select({ count: sql<number>`count(distinct ${sessions.userId})` })
          .from(sessions)
          .where(gte(sessions.updatedAt, since(7))),
        db
          .select({ count: sql<number>`count(*)` })
          .from(feedback)
          .where(eq(feedback.status, "open")),
      ]);

      return {
        totals,
        signups,
        gradeActivity,
        weeklyActiveUsers: activeSessions[0]?.count ?? 0,
        openFeedback: openFeedback[0]?.count ?? 0,
      };
    }),

  users: adminProcedure
    .input(
      z.object({
        query: z.string().trim().max(120).default(""),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ input }) => {
      const filter = input.query
        ? or(
            like(users.email, `%${input.query}%`),
            like(users.name, `%${input.query}%`),
            like(users.id, `%${input.query}%`),
          )
        : undefined;

      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          emailVerified: users.emailVerified,
          role: users.role,
          banned: users.banned,
          banReason: users.banReason,
          createdAt: users.createdAt,
          years: sql<number>`(select count(*) from ${years} where ${years.userId} = ${users.id})`,
          grades: sql<number>`(select count(*) from ${grades} where ${grades.userId} = ${users.id})`,
        })
        .from(users)
        .where(filter)
        .orderBy(desc(users.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total = 0 } = {}] = await db
        .select({ total: sql<number>`count(*)` })
        .from(users)
        .where(filter);

      return { users: rows, total };
    }),

  user: adminProcedure
    .input(z.object({ userId: z.string() }))
    .handler(async ({ input }) => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!user) notFound("User");

      const [yearRows, sessionRows] = await Promise.all([
        db.select().from(years).where(eq(years.userId, user.id)),
        db
          .select({
            id: sessions.id,
            createdAt: sessions.createdAt,
            updatedAt: sessions.updatedAt,
            userAgent: sessions.userAgent,
            ipAddress: sessions.ipAddress,
          })
          .from(sessions)
          .where(eq(sessions.userId, user.id))
          .orderBy(desc(sessions.updatedAt))
          .limit(10),
      ]);

      return { user, years: yearRows, sessions: sessionRows };
    }),

  setRole: adminProcedure
    .input(z.object({ userId: z.string(), role: z.enum(["user", "admin"]) }))
    .handler(async ({ input }) => {
      const [updated] = await db
        .update(users)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(users.id, input.userId))
        .returning();
      return updated;
    }),

  setBanned: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        banned: z.boolean(),
        reason: z.string().trim().max(200).nullable().default(null),
      }),
    )
    .handler(async ({ input }) => {
      const [updated] = await db
        .update(users)
        .set({
          banned: input.banned,
          banReason: input.banned ? input.reason : null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, input.userId))
        .returning();

      // A suspension that leaves live sessions running is not a suspension.
      if (input.banned) {
        await db.delete(sessions).where(eq(sessions.userId, input.userId));
      }
      return updated;
    }),

  deleteUser: adminProcedure
    .input(z.object({ userId: z.string(), confirmation: z.string() }))
    .handler(async ({ input }) => {
      if (input.confirmation !== input.userId) {
        notFound("User");
      }
      await db.delete(users).where(eq(users.id, input.userId));
      return { ok: true };
    }),

  announcements: adminProcedure.handler(() =>
    db.select().from(announcements).orderBy(desc(announcements.createdAt)),
  ),

  createAnnouncement: adminProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(120),
        message: z.string().trim().min(1).max(2000),
        tone: z.enum(["info", "success", "warning", "danger"]).default("info"),
        active: z.boolean().default(true),
        startsAt: z.coerce.date().nullable().default(null),
        endsAt: z.coerce.date().nullable().default(null),
      }),
    )
    .handler(async ({ context, input }) => {
      const [created] = await db
        .insert(announcements)
        .values({ ...input, createdByUserId: context.session.user.id })
        .returning();
      return created;
    }),

  updateAnnouncement: adminProcedure
    .input(
      z.object({
        announcementId: z.string(),
        title: z.string().trim().min(1).max(120).optional(),
        message: z.string().trim().min(1).max(2000).optional(),
        tone: z.enum(["info", "success", "warning", "danger"]).optional(),
        active: z.boolean().optional(),
        startsAt: z.coerce.date().nullable().optional(),
        endsAt: z.coerce.date().nullable().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const { announcementId, ...patch } = input;
      const [updated] = await db
        .update(announcements)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(announcements.id, announcementId))
        .returning();
      return updated;
    }),

  deleteAnnouncement: adminProcedure
    .input(z.object({ announcementId: z.string() }))
    .handler(async ({ input }) => {
      await db
        .delete(announcements)
        .where(eq(announcements.id, input.announcementId));
      return { ok: true };
    }),

  feedback: adminProcedure
    .input(
      z.object({
        status: z.enum(["open", "closed", "all"]).default("open"),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .handler(({ input }) =>
      db
        .select({
          id: feedback.id,
          kind: feedback.kind,
          subject: feedback.subject,
          message: feedback.message,
          context: feedback.context,
          status: feedback.status,
          createdAt: feedback.createdAt,
          userId: feedback.userId,
          userEmail: users.email,
          userName: users.name,
        })
        .from(feedback)
        .innerJoin(users, eq(feedback.userId, users.id))
        .where(
          input.status === "all"
            ? undefined
            : and(eq(feedback.status, input.status)),
        )
        .orderBy(desc(feedback.createdAt))
        .limit(input.limit),
    ),

  setFeedbackStatus: adminProcedure
    .input(
      z.object({
        feedbackId: z.string(),
        status: z.enum(["open", "closed"]),
      }),
    )
    .handler(async ({ input }) => {
      const [updated] = await db
        .update(feedback)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(feedback.id, input.feedbackId))
        .returning();
      return updated;
    }),
};
