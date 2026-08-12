import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  customAverageEntries,
  customAverages,
  groupInvitations,
  groupMemberships,
  periods,
  socialGroups,
  subjects,
  years,
} from "../../db/schema";
import { newId } from "../../lib/id";
import { badRequest, notFound, protectedProcedure } from "../../lib/orpc";
import {
  GROUP_INVITATION_TTL_MS,
  hashOpaque,
  issueOpaqueToken,
} from "../../lib/social-policy";
import { blocked, groupFigures, identities, identity, notify } from "./shared";

/**
 * A group is a named room whose members compare general averages. Joining
 * is one link, sharing is one switch, and the leaderboard shows everyone
 * who left the switch on — real values, no minimum head-count.
 */

const nameSchema = z.string().trim().min(2).max(100);
const descriptionSchema = z.string().trim().max(500);

async function groupAccess(groupId: string, userId: string) {
  const [row] = await db
    .select({ group: socialGroups, membership: groupMemberships })
    .from(socialGroups)
    .innerJoin(groupMemberships, eq(groupMemberships.groupId, socialGroups.id))
    .where(
      and(eq(socialGroups.id, groupId), eq(groupMemberships.userId, userId)),
    )
    .limit(1);
  if (!row) notFound("Group");
  return row;
}

function assertActive(group: typeof socialGroups.$inferSelect) {
  if (group.state !== "active") {
    throw new ORPCError("FORBIDDEN", {
      message: "This group is on an administrative hold",
    });
  }
}

function assertOwner(access: Awaited<ReturnType<typeof groupAccess>>) {
  if (access.membership.role !== "owner") {
    throw new ORPCError("FORBIDDEN", { message: "Group owner access required" });
  }
}

/** What the common configuration contains, for the join/adopt cards. */
async function sharedSetupSummary(sharedSetupYearId: string | null) {
  if (!sharedSetupYearId) return null;
  const [year] = await db
    .select()
    .from(years)
    .where(eq(years.id, sharedSetupYearId))
    .limit(1);
  if (!year) return null;
  const [subjectRows, averageRows, periodRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(subjects)
      .where(eq(subjects.yearId, year.id)),
    db
      .select({ value: count() })
      .from(customAverages)
      .where(eq(customAverages.yearId, year.id)),
    db
      .select({ value: count() })
      .from(periods)
      .where(eq(periods.yearId, year.id)),
  ]);
  return {
    yearName: year.name,
    scale: year.scale,
    subjectCount: subjectRows[0]?.value ?? 0,
    averageCount: averageRows[0]?.value ?? 0,
    periodCount: periodRows[0]?.value ?? 0,
  };
}

async function memberCountOf(groupId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(groupMemberships)
    .where(eq(groupMemberships.groupId, groupId));
  return row?.value ?? 0;
}

export const socialGroupsRouter = {
  create: protectedProcedure
    .input(
      z.object({
        name: nameSchema,
        description: descriptionSchema.default(""),
        kind: z.enum(["friends", "study", "class"]).default("friends"),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [group] = await db
        .insert(socialGroups)
        .values({
          ownerUserId: userId,
          name: input.name,
          description: input.description,
          kind: input.kind,
        })
        .returning();
      if (!group) badRequest("The group could not be created");
      await db.insert(groupMemberships).values({
        groupId: group.id,
        userId,
        role: "owner",
      });
      return { id: group.id };
    }),

  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const rows = await db
      .select({ group: socialGroups, membership: groupMemberships })
      .from(groupMemberships)
      .innerJoin(socialGroups, eq(socialGroups.id, groupMemberships.groupId))
      .where(eq(groupMemberships.userId, userId))
      .orderBy(desc(socialGroups.createdAt));
    return Promise.all(
      rows.map(async (row) => ({
        id: row.group.id,
        name: row.group.name,
        description: row.group.description,
        kind: row.group.kind,
        state: row.group.state,
        role: row.membership.role,
        shareAverage: row.membership.shareAverage,
        memberCount: await memberCountOf(row.group.id),
        createdAt: row.group.createdAt,
      })),
    );
  }),

  get: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      const memberships = await db
        .select()
        .from(groupMemberships)
        .where(eq(groupMemberships.groupId, input.groupId))
        .orderBy(groupMemberships.createdAt);
      const named = await identities(memberships.map((row) => row.userId));

      const frozen = access.group.state !== "active";
      const sharedSetup = await sharedSetupSummary(
        access.group.sharedSetupYearId,
      );
      const figureOptions = {
        comparedSubjectName: access.group.comparedSubjectName,
        includeTrend: access.group.showTrend,
        includeGradeCount: access.group.showGradeCount,
      };
      const members = await Promise.all(
        memberships.map(async (row) => {
          const who = named.get(row.userId);
          const shares = !frozen && row.shareAverage;
          const academic = shares
            ? await groupFigures(row.userId, figureOptions)
            : null;
          return {
            membershipId: row.id,
            userId: row.userId,
            name: who?.name ?? "",
            avatar: who?.avatar ?? null,
            handle: who?.handle ?? null,
            role: row.role,
            shareAverage: row.shareAverage,
            joinedAt: row.createdAt,
            average: academic?.average ?? null,
            scale: academic?.scale ?? null,
            decimals: academic?.decimals ?? null,
            trend: academic?.trend ?? null,
            gradeCount: academic?.gradeCount ?? null,
          };
        }),
      );

      const shared = members.filter((member) => member.average !== null);
      const groupAverage =
        shared.length === 0
          ? null
          : shared.reduce((total, member) => total + (member.average ?? 0), 0) /
            shared.length;

      return {
        id: access.group.id,
        name: access.group.name,
        description: access.group.description,
        kind: access.group.kind,
        comparedSubjectName: access.group.comparedSubjectName,
        showTrend: access.group.showTrend,
        showGradeCount: access.group.showGradeCount,
        sharedSetupYearId: access.group.sharedSetupYearId,
        sharedSetup,
        state: access.group.state,
        ownerUserId: access.group.ownerUserId,
        createdAt: access.group.createdAt,
        viewer: {
          membershipId: access.membership.id,
          role: access.membership.role,
          shareAverage: access.membership.shareAverage,
        },
        members,
        /** Mean of the shared ratios; every member weighs the same. */
        groupAverage,
        sharingCount: shared.length,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        name: nameSchema.optional(),
        description: descriptionSchema.optional(),
        kind: z.enum(["friends", "study", "class"]).optional(),
        comparedSubjectName: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .nullable()
          .optional(),
        showTrend: z.boolean().optional(),
        showGradeCount: z.boolean().optional(),
        sharedSetupYearId: z.string().min(1).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertActive(access.group);
      assertOwner(access);
      if (input.sharedSetupYearId) {
        const [owned] = await db
          .select({ id: years.id })
          .from(years)
          .where(
            and(
              eq(years.id, input.sharedSetupYearId),
              eq(years.userId, context.session.user.id),
            ),
          )
          .limit(1);
        if (!owned) notFound("Year");
      }
      await db
        .update(socialGroups)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.comparedSubjectName !== undefined
            ? { comparedSubjectName: input.comparedSubjectName }
            : {}),
          ...(input.showTrend !== undefined
            ? { showTrend: input.showTrend }
            : {}),
          ...(input.showGradeCount !== undefined
            ? { showGradeCount: input.showGradeCount }
            : {}),
          ...(input.sharedSetupYearId !== undefined
            ? { sharedSetupYearId: input.sharedSetupYearId }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(socialGroups.id, input.groupId));
      return { updated: true };
    }),

  delete: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      await db.delete(socialGroups).where(eq(socialGroups.id, input.groupId));
      return { deleted: true };
    }),

  leave: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      if (access.membership.role === "owner") {
        if ((await memberCountOf(input.groupId)) > 1) {
          badRequest(
            "Transfer or remove the other members first, or delete the group",
          );
        }
        await db
          .delete(socialGroups)
          .where(eq(socialGroups.id, input.groupId));
        return { left: true };
      }
      await db
        .delete(groupMemberships)
        .where(eq(groupMemberships.id, access.membership.id));
      return { left: true };
    }),

  setSharing: protectedProcedure
    .input(z.object({ groupId: z.string().min(1), shareAverage: z.boolean() }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      await db
        .update(groupMemberships)
        .set({ shareAverage: input.shareAverage, updatedAt: new Date() })
        .where(eq(groupMemberships.id, access.membership.id));
      return { shareAverage: input.shareAverage };
    }),

  /**
   * Copy the group's common configuration — year settings, periods, the
   * subject tree, custom averages — into a fresh year of the caller's own.
   * Grades never travel, and nothing links back: adopting is a copy, so a
   * member owns their year completely afterwards.
   */
  adoptSetup: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        name: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertActive(access.group);
      if (!access.group.sharedSetupYearId) {
        badRequest("This group has no common configuration");
      }
      const [reference] = await db
        .select()
        .from(years)
        .where(eq(years.id, access.group.sharedSetupYearId ?? ""))
        .limit(1);
      if (!reference) notFound("Year");

      const [subjectRows, periodRows, averageRows] = await Promise.all([
        db.select().from(subjects).where(eq(subjects.yearId, reference.id)),
        db.select().from(periods).where(eq(periods.yearId, reference.id)),
        db
          .select()
          .from(customAverages)
          .where(eq(customAverages.yearId, reference.id)),
      ]);
      const entryRows =
        averageRows.length === 0
          ? []
          : await db
              .select()
              .from(customAverageEntries)
              .where(
                inArray(
                  customAverageEntries.averageId,
                  averageRows.map((row) => row.id),
                ),
              );

      const [created] = await db
        .insert(years)
        .values({
          name: input.name?.trim() || reference.name,
          startsAt: reference.startsAt,
          endsAt: reference.endsAt,
          scale: reference.scale,
          defaultOutOf: reference.defaultOutOf,
          passingRatio: reference.passingRatio,
          decimals: reference.decimals,
          userId,
        })
        .returning();
      if (!created) badRequest("The year could not be created");

      // Ids are drawn up front so parent links and average entries can be
      // remapped in one pass — the schema deliberately has no subject FK.
      const subjectIds = new Map(
        subjectRows.map((row) => [row.id, newId("sub")]),
      );
      if (subjectRows.length > 0) {
        await db.insert(subjects).values(
          subjectRows.map((row) => ({
            id: subjectIds.get(row.id),
            name: row.name,
            shortName: row.shortName,
            parentId: row.parentId
              ? (subjectIds.get(row.parentId) ?? null)
              : null,
            coefficient: row.coefficient,
            kind: row.kind,
            isMain: row.isMain,
            sortOrder: row.sortOrder,
            yearId: created.id,
            userId,
          })),
        );
      }
      if (periodRows.length > 0) {
        await db.insert(periods).values(
          periodRows.map((row) => ({
            name: row.name,
            startAt: row.startAt,
            endAt: row.endAt,
            isCumulative: row.isCumulative,
            sortOrder: row.sortOrder,
            yearId: created.id,
            userId,
          })),
        );
      }
      for (const average of averageRows) {
        const [copied] = await db
          .insert(customAverages)
          .values({
            name: average.name,
            isMain: average.isMain,
            sortOrder: average.sortOrder,
            yearId: created.id,
            userId,
          })
          .returning({ id: customAverages.id });
        if (!copied) continue;
        const entries = entryRows.filter(
          (entry) =>
            entry.averageId === average.id && subjectIds.has(entry.subjectId),
        );
        if (entries.length > 0) {
          await db.insert(customAverageEntries).values(
            entries.map((entry) => ({
              averageId: copied.id,
              subjectId: subjectIds.get(entry.subjectId) as string,
              coefficient: entry.coefficient,
              includeChildren: entry.includeChildren,
            })),
          );
        }
      }
      return { yearId: created.id };
    }),

  removeMember: protectedProcedure
    .input(
      z.object({ groupId: z.string().min(1), membershipId: z.string().min(1) }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      if (input.membershipId === access.membership.id) {
        badRequest("Use leave or delete for your own membership");
      }
      const [removed] = await db
        .delete(groupMemberships)
        .where(
          and(
            eq(groupMemberships.id, input.membershipId),
            eq(groupMemberships.groupId, input.groupId),
          ),
        )
        .returning({ userId: groupMemberships.userId });
      if (!removed) notFound("Member");
      await notify({
        userId: removed.userId,
        actorUserId: context.session.user.id,
        kind: "group_removed",
        entityType: "group",
        entityId: input.groupId,
        safeParams: { groupName: access.group.name },
      });
      return { removed: true };
    }),
};

export const socialGroupInvitationsRouter = {
  create: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertActive(access.group);
      const { token, tokenHash, tokenPrefix } = issueOpaqueToken();
      const expiresAt = new Date(Date.now() + GROUP_INVITATION_TTL_MS);
      const [invitation] = await db
        .insert(groupInvitations)
        .values({
          groupId: input.groupId,
          createdByUserId: userId,
          tokenHash,
          tokenPrefix,
          expiresAt,
        })
        .returning();
      if (!invitation) badRequest("The invitation could not be created");
      return { id: invitation.id, token, tokenPrefix, expiresAt };
    }),

  list: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      const rows = await db
        .select()
        .from(groupInvitations)
        .where(
          and(
            eq(groupInvitations.groupId, input.groupId),
            isNull(groupInvitations.revokedAt),
            gt(groupInvitations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(groupInvitations.createdAt));
      const named = await identities(rows.map((row) => row.createdByUserId));
      return rows.map((row) => ({
        id: row.id,
        tokenPrefix: row.tokenPrefix,
        expiresAt: row.expiresAt,
        useCount: row.useCount,
        createdAt: row.createdAt,
        createdBy: named.get(row.createdByUserId)?.name ?? "",
      }));
    }),

  revoke: protectedProcedure
    .input(
      z.object({ groupId: z.string().min(1), invitationId: z.string().min(1) }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      const [updated] = await db
        .update(groupInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(groupInvitations.id, input.invitationId),
            eq(groupInvitations.groupId, input.groupId),
            isNull(groupInvitations.revokedAt),
          ),
        )
        .returning({ id: groupInvitations.id });
      if (!updated) notFound("Invitation");
      return { revoked: true };
    }),

  preview: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [invitation] = await db
        .select()
        .from(groupInvitations)
        .where(eq(groupInvitations.tokenHash, hashOpaque(input.token)))
        .limit(1);
      if (
        !invitation ||
        invitation.revokedAt ||
        invitation.expiresAt < new Date()
      ) {
        notFound("Invitation");
      }
      const [group] = await db
        .select()
        .from(socialGroups)
        .where(eq(socialGroups.id, invitation.groupId))
        .limit(1);
      if (!group || group.state !== "active") notFound("Invitation");
      const [inviter, memberCount, existing] = await Promise.all([
        identity(invitation.createdByUserId),
        memberCountOf(group.id),
        db
          .select({ id: groupMemberships.id })
          .from(groupMemberships)
          .where(
            and(
              eq(groupMemberships.groupId, group.id),
              eq(groupMemberships.userId, userId),
            ),
          )
          .limit(1),
      ]);
      return {
        group: {
          name: group.name,
          description: group.description,
          kind: group.kind,
          comparedSubjectName: group.comparedSubjectName,
          hasSharedSetup: Boolean(group.sharedSetupYearId),
          memberCount,
        },
        inviter: inviter
          ? { name: inviter.name, avatar: inviter.avatar }
          : null,
        alreadyMember: existing.length > 0,
        expiresAt: invitation.expiresAt,
      };
    }),

  accept: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [invitation] = await db
        .select()
        .from(groupInvitations)
        .where(eq(groupInvitations.tokenHash, hashOpaque(input.token)))
        .limit(1);
      if (
        !invitation ||
        invitation.revokedAt ||
        invitation.expiresAt < new Date()
      ) {
        notFound("Invitation");
      }
      const [group] = await db
        .select()
        .from(socialGroups)
        .where(eq(socialGroups.id, invitation.groupId))
        .limit(1);
      if (!group || group.state !== "active") notFound("Invitation");
      if (await blocked(userId, group.ownerUserId)) notFound("Invitation");

      const [existing] = await db
        .select({ id: groupMemberships.id })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, group.id),
            eq(groupMemberships.userId, userId),
          ),
        )
        .limit(1);
      if (existing) return { groupId: group.id, joined: false };

      await db.insert(groupMemberships).values({
        groupId: group.id,
        userId,
        role: "member",
      });
      await db
        .update(groupInvitations)
        .set({ useCount: invitation.useCount + 1 })
        .where(eq(groupInvitations.id, invitation.id));
      if (group.ownerUserId !== userId) {
        await notify({
          userId: group.ownerUserId,
          actorUserId: userId,
          kind: "group_joined",
          entityType: "group",
          entityId: group.id,
          safeParams: { groupName: group.name },
        });
      }
      return { groupId: group.id, joined: true };
    }),
};
