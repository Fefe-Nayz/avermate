import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  groupInvitations,
  groupMemberships,
  socialGroups,
} from "../../db/schema";
import { badRequest, notFound, protectedProcedure } from "../../lib/orpc";
import {
  GROUP_INVITATION_TTL_MS,
  hashOpaque,
  issueOpaqueToken,
} from "../../lib/social-policy";
import { blocked, generalAverageOf, identities, identity, notify } from "./shared";

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
      const members = await Promise.all(
        memberships.map(async (row) => {
          const who = named.get(row.userId);
          const shares = !frozen && row.shareAverage;
          const academic = shares ? await generalAverageOf(row.userId) : null;
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
      }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertActive(access.group);
      assertOwner(access);
      await db
        .update(socialGroups)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
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
