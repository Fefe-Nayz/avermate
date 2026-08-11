import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  friendCircleMembers,
  friendCircles,
  friendRequests,
  friendships,
  groupMemberships,
  socialAuditEvents,
  socialProfileGrants,
  socialProfiles,
  userBlocks,
} from "../../db/schema";
import { notFound, protectedProcedure } from "../../lib/orpc";
import {
  assertActiveProfile,
  audit,
  blocked,
  projectFriendProfile,
} from "./shared";

function circleDto(row: typeof friendCircles.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const socialCirclesRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    await assertActiveProfile(userId);
    const [circles, members, friendshipRows] = await Promise.all([
      db
        .select()
        .from(friendCircles)
        .where(eq(friendCircles.ownerUserId, userId))
        .orderBy(asc(friendCircles.name)),
      db
        .select({
          id: friendCircleMembers.id,
          circleId: friendCircleMembers.circleId,
          friendUserId: friendCircleMembers.friendUserId,
          createdAt: friendCircleMembers.createdAt,
        })
        .from(friendCircleMembers)
        .innerJoin(
          friendCircles,
          eq(friendCircles.id, friendCircleMembers.circleId),
        )
        .where(eq(friendCircles.ownerUserId, userId)),
      db
        .select()
        .from(friendships)
        .where(
          or(
            eq(friendships.userLowId, userId),
            eq(friendships.userHighId, userId),
          ),
        ),
    ]);
    const friendshipByUser = new Map(
      friendshipRows.map((row) => [
        row.userLowId === userId ? row.userHighId : row.userLowId,
        row.id,
      ]),
    );
    const identities = new Map(
      await Promise.all(
        [...new Set(members.map((row) => row.friendUserId))].map(
          async (friendUserId) =>
            [
              friendUserId,
              await projectFriendProfile(userId, friendUserId),
            ] as const,
        ),
      ),
    );
    return circles.map((circle) => ({
      ...circleDto(circle),
      members: members
        .filter((member) => member.circleId === circle.id)
        .map((member) => ({
          id: member.id,
          friendshipId: friendshipByUser.get(member.friendUserId) ?? null,
          createdAt: member.createdAt,
          profile: identities.get(member.friendUserId) ?? null,
        })),
    }));
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(60) }))
    .handler(async ({ context, input }) => {
      await assertActiveProfile(context.session.user.id);
      const [created] = await db
        .insert(friendCircles)
        .values({ ownerUserId: context.session.user.id, name: input.name })
        .returning();
      if (!created)
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Circle creation failed",
        });
      return circleDto(created);
    }),

  update: protectedProcedure
    .input(
      z.object({
        circleId: z.string().min(1),
        name: z.string().trim().min(1).max(60),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const [updated] = await db
        .update(friendCircles)
        .set({
          name: input.name,
          revision: sql`${friendCircles.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(friendCircles.id, input.circleId),
            eq(friendCircles.ownerUserId, context.session.user.id),
            eq(friendCircles.revision, input.expectedRevision),
          ),
        )
        .returning();
      if (!updated)
        throw new ORPCError("CONFLICT", {
          message: "The circle changed in another session",
        });
      return circleDto(updated);
    }),

  delete: protectedProcedure
    .input(
      z.object({
        circleId: z.string().min(1),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const [deleted] = await db
        .delete(friendCircles)
        .where(
          and(
            eq(friendCircles.id, input.circleId),
            eq(friendCircles.ownerUserId, context.session.user.id),
            eq(friendCircles.revision, input.expectedRevision),
          ),
        )
        .returning({ id: friendCircles.id });
      if (!deleted) notFound("Circle");
      return { ok: true };
    }),

  addMember: protectedProcedure
    .input(
      z.object({
        circleId: z.string().min(1),
        friendshipId: z.string().min(1),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      let memberId: string | null = null;
      await db.transaction(async (tx) => {
        const claimed = await tx
          .update(friendCircles)
          .set({
            revision: sql`${friendCircles.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(friendCircles.id, input.circleId),
              eq(friendCircles.ownerUserId, userId),
              eq(friendCircles.revision, input.expectedRevision),
            ),
          )
          .returning({ id: friendCircles.id });
        if (claimed.length !== 1)
          throw new ORPCError("CONFLICT", {
            message: "The circle changed in another session",
          });
        const [friendship] = await tx
          .select()
          .from(friendships)
          .where(
            and(
              eq(friendships.id, input.friendshipId),
              or(
                eq(friendships.userLowId, userId),
                eq(friendships.userHighId, userId),
              ),
            ),
          )
          .limit(1);
        if (!friendship) notFound("Friend");
        const friendUserId =
          friendship.userLowId === userId
            ? friendship.userHighId
            : friendship.userLowId;
        const [block] = await tx
          .select({ id: userBlocks.id })
          .from(userBlocks)
          .where(
            or(
              and(
                eq(userBlocks.blockerUserId, userId),
                eq(userBlocks.blockedUserId, friendUserId),
              ),
              and(
                eq(userBlocks.blockerUserId, friendUserId),
                eq(userBlocks.blockedUserId, userId),
              ),
            ),
          )
          .limit(1);
        if (block) notFound("Friend");
        const [member] = await tx
          .insert(friendCircleMembers)
          .values({ circleId: input.circleId, friendUserId })
          .onConflictDoNothing({
            target: [
              friendCircleMembers.circleId,
              friendCircleMembers.friendUserId,
            ],
          })
          .returning({ id: friendCircleMembers.id });
        memberId = member?.id ?? null;
      });
      return { ok: true, memberId };
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        circleId: z.string().min(1),
        circleMemberId: z.string().min(1),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await db.transaction(async (tx) => {
        const claimed = await tx
          .update(friendCircles)
          .set({
            revision: sql`${friendCircles.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(friendCircles.id, input.circleId),
              eq(friendCircles.ownerUserId, context.session.user.id),
              eq(friendCircles.revision, input.expectedRevision),
            ),
          )
          .returning({ id: friendCircles.id });
        if (claimed.length !== 1)
          throw new ORPCError("CONFLICT", {
            message: "The circle changed in another session",
          });
        await tx
          .delete(friendCircleMembers)
          .where(
            and(
              eq(friendCircleMembers.id, input.circleMemberId),
              eq(friendCircleMembers.circleId, input.circleId),
            ),
          );
      });
      return { ok: true };
    }),
};

async function resolveBlockTarget(
  viewerUserId: string,
  source: string,
  sourceId: string,
) {
  if (source === "friendship") {
    const [row] = await db
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.id, sourceId),
          or(
            eq(friendships.userLowId, viewerUserId),
            eq(friendships.userHighId, viewerUserId),
          ),
        ),
      )
      .limit(1);
    return row
      ? row.userLowId === viewerUserId
        ? row.userHighId
        : row.userLowId
      : null;
  }
  if (source === "friend_request") {
    const [row] = await db
      .select()
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.id, sourceId),
          or(
            eq(friendRequests.senderUserId, viewerUserId),
            eq(friendRequests.recipientUserId, viewerUserId),
          ),
        ),
      )
      .limit(1);
    return row
      ? row.senderUserId === viewerUserId
        ? row.recipientUserId
        : row.senderUserId
      : null;
  }
  const [target] = await db
    .select()
    .from(groupMemberships)
    .where(eq(groupMemberships.id, sourceId))
    .limit(1);
  if (!target || target.userId === viewerUserId) return null;
  const [viewer] = await db
    .select({ id: groupMemberships.id })
    .from(groupMemberships)
    .where(
      and(
        eq(groupMemberships.groupId, target.groupId),
        eq(groupMemberships.userId, viewerUserId),
        inArray(groupMemberships.state, ["active", "consent_required"]),
      ),
    )
    .limit(1);
  return viewer ? target.userId : null;
}

export const socialBlocksRouter = {
  list: protectedProcedure.handler(({ context }) =>
    db
      .select({
        id: userBlocks.id,
        createdAt: userBlocks.createdAt,
        displayName: socialProfiles.displayName,
        handle: socialProfiles.handle,
      })
      .from(userBlocks)
      .leftJoin(
        socialProfiles,
        eq(socialProfiles.userId, userBlocks.blockedUserId),
      )
      .where(eq(userBlocks.blockerUserId, context.session.user.id))
      .orderBy(desc(userBlocks.createdAt)),
  ),

  create: protectedProcedure
    .input(
      z.object({
        source: z.enum(["friendship", "friend_request", "group_membership"]),
        sourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const blockerUserId = context.session.user.id;
      const targetUserId = await resolveBlockTarget(
        blockerUserId,
        input.source,
        input.sourceId,
      );
      if (!targetUserId) notFound("Profile");
      const [low, high] =
        blockerUserId < targetUserId
          ? [blockerUserId, targetUserId]
          : [targetUserId, blockerUserId];
      await db.transaction(async (tx) => {
        await tx
          .insert(userBlocks)
          .values({ blockerUserId, blockedUserId: targetUserId })
          .onConflictDoNothing({
            target: [userBlocks.blockerUserId, userBlocks.blockedUserId],
          });
        const deletedFriendships = await tx
          .delete(friendships)
          .where(
            and(
              eq(friendships.userLowId, low),
              eq(friendships.userHighId, high),
            ),
          )
          .returning({ id: friendships.id });
        await tx
          .delete(friendRequests)
          .where(
            and(
              eq(friendRequests.userLowId, low),
              eq(friendRequests.userHighId, high),
            ),
          );
        await tx
          .delete(friendCircleMembers)
          .where(
            or(
              and(
                eq(friendCircleMembers.friendUserId, targetUserId),
                inArray(
                  friendCircleMembers.circleId,
                  tx
                    .select({ id: friendCircles.id })
                    .from(friendCircles)
                    .where(eq(friendCircles.ownerUserId, blockerUserId)),
                ),
              ),
              and(
                eq(friendCircleMembers.friendUserId, blockerUserId),
                inArray(
                  friendCircleMembers.circleId,
                  tx
                    .select({ id: friendCircles.id })
                    .from(friendCircles)
                    .where(eq(friendCircles.ownerUserId, targetUserId)),
                ),
              ),
            ),
          );
        if (deletedFriendships.length > 0) {
          await tx
            .update(socialProfileGrants)
            .set({ withdrawnAt: new Date() })
            .where(
              and(
                eq(socialProfileGrants.audience, "specific_user"),
                inArray(
                  socialProfileGrants.audienceId,
                  deletedFriendships.map((row) => row.id),
                ),
                isNull(socialProfileGrants.withdrawnAt),
              ),
            );
        }
        await tx.insert(socialAuditEvents).values({
          actorUserId: blockerUserId,
          subjectUserId: targetUserId,
          action: "user.blocked",
          entityType: "user_block",
          changedKeys: JSON.stringify(["friendship", "requests", "sharing"]),
        });
      });
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ blockId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const [deleted] = await db
        .delete(userBlocks)
        .where(
          and(
            eq(userBlocks.id, input.blockId),
            eq(userBlocks.blockerUserId, context.session.user.id),
          ),
        )
        .returning({
          id: userBlocks.id,
          blockedUserId: userBlocks.blockedUserId,
        });
      if (!deleted) notFound("Block");
      await audit({
        actorUserId: context.session.user.id,
        subjectUserId: deleted.blockedUserId,
        action: "user.unblocked",
        entityType: "user_block",
        entityId: deleted.id,
        changedKeys: ["deleted"],
      });
      return { ok: true };
    }),
};
