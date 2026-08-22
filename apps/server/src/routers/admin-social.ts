import { and, count, desc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  friendships,
  groupMemberships,
  socialGroups,
  socialProfiles,
  socialReports,
  users,
} from "../db/schema";
import { adminProcedure, notFound } from "../lib/orpc";
import { identities } from "./social/shared";

/**
 * Moderation, and only moderation. The feature has no kill-switch and no
 * eligibility ledger any more — what an administrator does here is read
 * reports, hold or delete a group, and close the loop.
 */

const reportStatusSchema = z.enum([
  "open",
  "investigating",
  "resolved",
  "dismissed",
]);
const reportPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const adminSocialRouter = {
  socialOverview: adminProcedure.handler(async () => {
    const [friendshipCount, groupCount, openReports, sharingProfiles] =
      await Promise.all([
        db.select({ value: count() }).from(friendships),
        db.select({ value: count() }).from(socialGroups),
        db
          .select({ value: count() })
          .from(socialReports)
          .where(
            or(
              eq(socialReports.status, "open"),
              eq(socialReports.status, "investigating"),
            ),
          ),
        db.select({ value: count() }).from(socialProfiles),
      ]);
    return {
      friendships: friendshipCount[0]?.value ?? 0,
      groups: groupCount[0]?.value ?? 0,
      openReports: openReports[0]?.value ?? 0,
      profiles: sharingProfiles[0]?.value ?? 0,
    };
  }),

  socialGroups: adminProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(100).default(""),
          state: z.enum(["all", "active", "frozen"]).default("all"),
        })
        .default({ search: "", state: "all" }),
    )
    .handler(async ({ input }) => {
      const rows = await db
        .select({ group: socialGroups, ownerName: users.name })
        .from(socialGroups)
        .innerJoin(users, eq(users.id, socialGroups.ownerUserId))
        .where(
          and(
            ...(input.state === "all"
              ? []
              : [eq(socialGroups.state, input.state)]),
            ...(input.search
              ? [like(socialGroups.name, `%${input.search}%`)]
              : []),
          ),
        )
        .orderBy(desc(socialGroups.createdAt))
        .limit(200);
      return Promise.all(
        rows.map(async (row) => {
          const [members] = await db
            .select({ value: count() })
            .from(groupMemberships)
            .where(eq(groupMemberships.groupId, row.group.id));
          return {
            id: row.group.id,
            name: row.group.name,
            description: row.group.description,
            state: row.group.state,
            ownerName: row.ownerName,
            memberCount: members?.value ?? 0,
            createdAt: row.group.createdAt,
          };
        }),
      );
    }),

  setSocialGroupState: adminProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        state: z.enum(["active", "frozen"]),
      }),
    )
    .handler(async ({ input }) => {
      const [updated] = await db
        .update(socialGroups)
        .set({ state: input.state, updatedAt: new Date() })
        .where(eq(socialGroups.id, input.groupId))
        .returning({ id: socialGroups.id });
      if (!updated) notFound("Group");
      return { state: input.state };
    }),

  deleteSocialGroup: adminProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ input }) => {
      const [deleted] = await db
        .delete(socialGroups)
        .where(eq(socialGroups.id, input.groupId))
        .returning({ id: socialGroups.id });
      if (!deleted) notFound("Group");
      return { deleted: true };
    }),

  socialReports: adminProcedure
    .input(
      z
        .object({
          status: z
            .union([reportStatusSchema, z.literal("all")])
            .default("all"),
        })
        .default({ status: "all" }),
    )
    .handler(async ({ input }) => {
      const rows = await db
        .select()
        .from(socialReports)
        .where(
          and(
            ...(input.status === "all"
              ? []
              : [eq(socialReports.status, input.status)]),
          ),
        )
        .orderBy(desc(socialReports.createdAt))
        .limit(200);
      const named = await identities(
        rows.flatMap((row) => [
          row.reporterUserId,
          ...(row.targetUserId ? [row.targetUserId] : []),
          ...(row.assignedToUserId ? [row.assignedToUserId] : []),
        ]),
      );
      const groupIds = [
        ...new Set(rows.flatMap((row) => (row.groupId ? [row.groupId] : []))),
      ];
      const groups = new Map(
        groupIds.length === 0
          ? []
          : (
              await db
                .select({ id: socialGroups.id, name: socialGroups.name })
                .from(socialGroups)
                .where(or(...groupIds.map((id) => eq(socialGroups.id, id))))
            ).map((row) => [row.id, row.name] as const),
      );
      return rows.map((row) => ({
        id: row.id,
        category: row.category,
        message: row.message,
        status: row.status,
        priority: row.priority,
        createdAt: row.createdAt,
        resolvedAt: row.resolvedAt,
        reporter: named.get(row.reporterUserId)?.name ?? "",
        target: row.targetUserId
          ? (named.get(row.targetUserId)?.name ?? "")
          : null,
        targetUserId: row.targetUserId,
        groupId: row.groupId,
        groupName: row.groupId ? (groups.get(row.groupId) ?? null) : null,
        assignedTo: row.assignedToUserId
          ? (named.get(row.assignedToUserId)?.name ?? "")
          : null,
      }));
    }),

  updateSocialReport: adminProcedure
    .input(
      z.object({
        reportId: z.string().min(1),
        status: reportStatusSchema.optional(),
        priority: reportPrioritySchema.optional(),
        assignToMe: z.boolean().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const [updated] = await db
        .update(socialReports)
        .set({
          ...(input.status !== undefined
            ? {
                status: input.status,
                resolvedAt:
                  input.status === "resolved" || input.status === "dismissed"
                    ? new Date()
                    : null,
              }
            : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.assignToMe !== undefined
            ? {
                assignedToUserId: input.assignToMe
                  ? context.session.user.id
                  : null,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(socialReports.id, input.reportId))
        .returning({ id: socialReports.id });
      if (!updated) notFound("Report");
      return { updated: true };
    }),
};
