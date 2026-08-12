import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { socialGroups, socialNotifications, socialReports } from "../../db/schema";
import { badRequest, notFound, protectedProcedure } from "../../lib/orpc";
import { identities } from "./shared";

export const socialNotificationsRouter = {
  list: protectedProcedure
    .input(
      z
        .object({ unreadOnly: z.boolean().default(false) })
        .default({ unreadOnly: false }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const rows = await db
        .select()
        .from(socialNotifications)
        .where(
          and(
            eq(socialNotifications.userId, userId),
            ...(input.unreadOnly ? [isNull(socialNotifications.readAt)] : []),
          ),
        )
        .orderBy(desc(socialNotifications.createdAt))
        .limit(100);
      const named = await identities(
        rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])),
      );
      return rows.map((row) => {
        const actor = row.actorUserId ? named.get(row.actorUserId) : null;
        return {
          id: row.id,
          kind: row.kind,
          entityType: row.entityType,
          entityId: row.entityId,
          actor: actor
            ? { name: actor.name, avatar: actor.avatar }
            : null,
          safeParams: JSON.parse(row.safeParams) as Record<string, string>,
          readAt: row.readAt,
          createdAt: row.createdAt,
        };
      });
    }),

  unreadCount: protectedProcedure.handler(async ({ context }) => {
    const rows = await db
      .select({ id: socialNotifications.id })
      .from(socialNotifications)
      .where(
        and(
          eq(socialNotifications.userId, context.session.user.id),
          isNull(socialNotifications.readAt),
        ),
      );
    return { count: rows.length };
  }),

  markRead: protectedProcedure
    .input(z.object({ notificationId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const [updated] = await db
        .update(socialNotifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(socialNotifications.id, input.notificationId),
            eq(socialNotifications.userId, context.session.user.id),
            isNull(socialNotifications.readAt),
          ),
        )
        .returning({ id: socialNotifications.id });
      if (!updated) notFound("Notification");
      return { read: true };
    }),

  markAllRead: protectedProcedure.handler(async ({ context }) => {
    await db
      .update(socialNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(socialNotifications.userId, context.session.user.id),
          isNull(socialNotifications.readAt),
        ),
      );
    return { read: true };
  }),
};

export const socialReportsRouter = {
  create: protectedProcedure
    .input(
      z
        .object({
          targetUserId: z.string().min(1).optional(),
          groupId: z.string().min(1).optional(),
          category: z.enum([
            "harassment",
            "privacy",
            "impersonation",
            "unsafe_content",
            "other",
          ]),
          message: z.string().trim().min(10).max(2000),
        })
        .refine((value) => value.targetUserId || value.groupId, {
          message: "A report needs a person or a group",
        }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (input.targetUserId === userId) {
        badRequest("An account cannot report itself");
      }
      if (input.groupId) {
        const [group] = await db
          .select({ id: socialGroups.id })
          .from(socialGroups)
          .where(eq(socialGroups.id, input.groupId))
          .limit(1);
        if (!group) notFound("Group");
      }
      const [report] = await db
        .insert(socialReports)
        .values({
          reporterUserId: userId,
          targetUserId: input.targetUserId ?? null,
          groupId: input.groupId ?? null,
          category: input.category,
          message: input.message,
        })
        .returning({ id: socialReports.id });
      return { id: report?.id ?? null };
    }),

  mine: protectedProcedure.handler(async ({ context }) => {
    const rows = await db
      .select({
        id: socialReports.id,
        category: socialReports.category,
        status: socialReports.status,
        createdAt: socialReports.createdAt,
        resolvedAt: socialReports.resolvedAt,
      })
      .from(socialReports)
      .where(eq(socialReports.reporterUserId, context.session.user.id))
      .orderBy(desc(socialReports.createdAt))
      .limit(50);
    return rows;
  }),
};
