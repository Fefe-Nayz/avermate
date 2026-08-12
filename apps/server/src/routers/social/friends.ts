import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  friendInvitations,
  friendRequests,
  friendships,
  socialProfiles,
  userBlocks,
  users,
} from "../../db/schema";
import { badRequest, notFound, protectedProcedure } from "../../lib/orpc";
import {
  FRIEND_INVITATION_TTL_MS,
  canonicalPair,
  hashOpaque,
  issueOpaqueToken,
} from "../../lib/social-policy";
import {
  areFriends,
  blocked,
  friendOf,
  friendshipBetween,
  handleSchema,
  identities,
  identity,
  notify,
  sharedAcademics,
} from "./shared";

/**
 * Friends, without ceremony: find someone by handle or hand them a link,
 * they accept, you are friends. What a friend can see is governed by the
 * owner's sharing locks and read through `detail`.
 */

async function createFriendship(left: string, right: string) {
  const [low, high] = canonicalPair(left, right);
  await db
    .insert(friendships)
    .values({ userLowId: low, userHighId: high })
    .onConflictDoNothing({
      target: [friendships.userLowId, friendships.userHighId],
    });
}

async function assertNotBlocked(left: string, right: string) {
  if (await blocked(left, right)) {
    // Deliberately the same error as an unknown handle: a block should not
    // be detectable from the outside.
    notFound("Profile");
  }
}

export const socialFriendsRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const rows = await db
      .select()
      .from(friendships)
      .where(
        or(
          eq(friendships.userLowId, userId),
          eq(friendships.userHighId, userId),
        ),
      )
      .orderBy(desc(friendships.createdAt));
    const friendIds = rows.map((row) => friendOf(row, userId));
    const [named, profiles] = await Promise.all([
      identities(friendIds),
      friendIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              userId: socialProfiles.userId,
              shareGeneralAverage: socialProfiles.shareGeneralAverage,
              shareSubjectsMode: socialProfiles.shareSubjectsMode,
            })
            .from(socialProfiles)
            .where(
              or(...friendIds.map((id) => eq(socialProfiles.userId, id))),
            ),
    ]);
    const sharing = new Map(profiles.map((row) => [row.userId, row]));
    return {
      friends: rows.map((row) => {
        const friendId = friendOf(row, userId);
        const who = named.get(friendId);
        const locks = sharing.get(friendId);
        return {
          friendshipId: row.id,
          userId: friendId,
          name: who?.name ?? "",
          avatar: who?.avatar ?? null,
          handle: who?.handle ?? null,
          since: row.createdAt,
          // A missing profile row means untouched defaults, which share.
          sharesSomething: locks
            ? locks.shareGeneralAverage || locks.shareSubjectsMode !== "none"
            : true,
        };
      }),
    };
  }),

  /** One friend, with everything they currently share. */
  detail: protectedProcedure
    .input(z.object({ friendshipId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [row] = await db
        .select()
        .from(friendships)
        .where(eq(friendships.id, input.friendshipId))
        .limit(1);
      if (!row || (row.userLowId !== userId && row.userHighId !== userId)) {
        notFound("Friend");
      }
      const friendId = friendOf(row, userId);
      const [who, sharing] = await Promise.all([
        identity(friendId),
        sharedAcademics(friendId),
      ]);
      if (!who) notFound("Friend");
      return {
        friendshipId: row.id,
        userId: friendId,
        name: who.name,
        avatar: who.avatar,
        handle: who.handle,
        since: row.createdAt,
        sharing,
      };
    }),

  requests: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const rows = await db
      .select()
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.status, "pending"),
          or(
            eq(friendRequests.senderUserId, userId),
            eq(friendRequests.recipientUserId, userId),
          ),
        ),
      )
      .orderBy(desc(friendRequests.createdAt));
    const named = await identities(
      rows.map((row) =>
        row.senderUserId === userId ? row.recipientUserId : row.senderUserId,
      ),
    );
    const dto = (row: (typeof rows)[number]) => {
      const otherId =
        row.senderUserId === userId ? row.recipientUserId : row.senderUserId;
      const who = named.get(otherId);
      return {
        id: row.id,
        message: row.message,
        createdAt: row.createdAt,
        userId: otherId,
        name: who?.name ?? "",
        avatar: who?.avatar ?? null,
        handle: who?.handle ?? null,
      };
    };
    return {
      incoming: rows
        .filter((row) => row.recipientUserId === userId)
        .map(dto),
      outgoing: rows.filter((row) => row.senderUserId === userId).map(dto),
    };
  }),

  request: protectedProcedure
    .input(
      z.object({
        handle: handleSchema,
        message: z.string().trim().max(280).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [target] = await db
        .select({ userId: socialProfiles.userId })
        .from(socialProfiles)
        .where(eq(socialProfiles.handle, input.handle))
        .limit(1);
      if (!target) notFound("Profile");
      if (target.userId === userId) {
        badRequest("That handle is yours");
      }
      await assertNotBlocked(userId, target.userId);
      if (await areFriends(userId, target.userId)) {
        badRequest("You are already friends");
      }

      const [low, high] = canonicalPair(userId, target.userId);
      const [existing] = await db
        .select()
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.userLowId, low),
            eq(friendRequests.userHighId, high),
          ),
        )
        .limit(1);

      if (existing?.status === "pending") {
        if (existing.senderUserId === userId) {
          badRequest("Your request is already waiting for an answer");
        }
        // They asked first: two intents make a friendship, not a queue.
        await db
          .update(friendRequests)
          .set({
            status: "accepted",
            respondedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(friendRequests.id, existing.id));
        await createFriendship(userId, target.userId);
        await notify({
          userId: target.userId,
          actorUserId: userId,
          kind: "friend_accept",
          entityType: "friend_request",
          entityId: existing.id,
        });
        return { status: "accepted" as const };
      }

      const values = {
        userLowId: low,
        userHighId: high,
        senderUserId: userId,
        recipientUserId: target.userId,
        status: "pending" as const,
        message: input.message?.trim() || null,
        respondedAt: null,
        updatedAt: new Date(),
      };
      const [request] = existing
        ? await db
            .update(friendRequests)
            .set(values)
            .where(eq(friendRequests.id, existing.id))
            .returning()
        : await db.insert(friendRequests).values(values).returning();
      if (!request) badRequest("The request could not be created");
      await notify({
        userId: target.userId,
        actorUserId: userId,
        kind: "friend_request",
        entityType: "friend_request",
        entityId: request.id,
      });
      return { status: "pending" as const };
    }),

  respond: protectedProcedure
    .input(z.object({ requestId: z.string().min(1), accept: z.boolean() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [request] = await db
        .select()
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.id, input.requestId),
            eq(friendRequests.recipientUserId, userId),
            eq(friendRequests.status, "pending"),
          ),
        )
        .limit(1);
      if (!request) notFound("Friend request");
      await db
        .update(friendRequests)
        .set({
          status: input.accept ? "accepted" : "declined",
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(friendRequests.id, request.id));
      if (input.accept) {
        await createFriendship(userId, request.senderUserId);
        await notify({
          userId: request.senderUserId,
          actorUserId: userId,
          kind: "friend_accept",
          entityType: "friend_request",
          entityId: request.id,
        });
      }
      return { status: input.accept ? "accepted" : "declined" };
    }),

  cancel: protectedProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [updated] = await db
        .update(friendRequests)
        .set({
          status: "cancelled",
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(friendRequests.id, input.requestId),
            eq(friendRequests.senderUserId, userId),
            eq(friendRequests.status, "pending"),
          ),
        )
        .returning({ id: friendRequests.id });
      if (!updated) notFound("Friend request");
      return { status: "cancelled" as const };
    }),

  remove: protectedProcedure
    .input(z.object({ friendshipId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [row] = await db
        .select()
        .from(friendships)
        .where(eq(friendships.id, input.friendshipId))
        .limit(1);
      if (!row || (row.userLowId !== userId && row.userHighId !== userId)) {
        notFound("Friend");
      }
      await db.delete(friendships).where(eq(friendships.id, row.id));
      // Clearing the pair's request record lets either side ask again later.
      await db
        .delete(friendRequests)
        .where(
          and(
            eq(friendRequests.userLowId, row.userLowId),
            eq(friendRequests.userHighId, row.userHighId),
          ),
        );
      return { removed: true };
    }),
};

export const socialFriendInvitationsRouter = {
  create: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const { token, tokenHash, tokenPrefix } = issueOpaqueToken();
    const expiresAt = new Date(Date.now() + FRIEND_INVITATION_TTL_MS);
    const [invitation] = await db
      .insert(friendInvitations)
      .values({ createdByUserId: userId, tokenHash, tokenPrefix, expiresAt })
      .returning();
    if (!invitation) badRequest("The invitation could not be created");
    return {
      id: invitation.id,
      token,
      tokenPrefix,
      expiresAt,
    };
  }),

  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const rows = await db
      .select()
      .from(friendInvitations)
      .where(
        and(
          eq(friendInvitations.createdByUserId, userId),
          isNull(friendInvitations.consumedAt),
          isNull(friendInvitations.revokedAt),
          gt(friendInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(friendInvitations.createdAt));
    return rows.map((row) => ({
      id: row.id,
      tokenPrefix: row.tokenPrefix,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }));
  }),

  revoke: protectedProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [updated] = await db
        .update(friendInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(friendInvitations.id, input.invitationId),
            eq(friendInvitations.createdByUserId, userId),
            isNull(friendInvitations.revokedAt),
          ),
        )
        .returning({ id: friendInvitations.id });
      if (!updated) notFound("Invitation");
      return { revoked: true };
    }),

  preview: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [invitation] = await db
        .select()
        .from(friendInvitations)
        .where(eq(friendInvitations.tokenHash, hashOpaque(input.token)))
        .limit(1);
      if (
        !invitation ||
        invitation.revokedAt ||
        invitation.consumedAt ||
        invitation.expiresAt < new Date()
      ) {
        notFound("Invitation");
      }
      await assertNotBlocked(userId, invitation.createdByUserId);
      const who = await identity(invitation.createdByUserId);
      if (!who) notFound("Invitation");
      return {
        inviter: { name: who.name, avatar: who.avatar, handle: who.handle },
        self: invitation.createdByUserId === userId,
        alreadyFriends: await areFriends(userId, invitation.createdByUserId),
        expiresAt: invitation.expiresAt,
      };
    }),

  accept: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [invitation] = await db
        .select()
        .from(friendInvitations)
        .where(eq(friendInvitations.tokenHash, hashOpaque(input.token)))
        .limit(1);
      if (
        !invitation ||
        invitation.revokedAt ||
        invitation.consumedAt ||
        invitation.expiresAt < new Date()
      ) {
        notFound("Invitation");
      }
      if (invitation.createdByUserId === userId) {
        badRequest("This invitation is your own");
      }
      await assertNotBlocked(userId, invitation.createdByUserId);
      const [claimed] = await db
        .update(friendInvitations)
        .set({ consumedAt: new Date(), consumedByUserId: userId })
        .where(
          and(
            eq(friendInvitations.id, invitation.id),
            isNull(friendInvitations.consumedAt),
          ),
        )
        .returning({ id: friendInvitations.id });
      if (!claimed) notFound("Invitation");
      await createFriendship(userId, invitation.createdByUserId);
      // The pair may have an old request row; align it with reality.
      const [low, high] = canonicalPair(userId, invitation.createdByUserId);
      await db
        .delete(friendRequests)
        .where(
          and(
            eq(friendRequests.userLowId, low),
            eq(friendRequests.userHighId, high),
          ),
        );
      await notify({
        userId: invitation.createdByUserId,
        actorUserId: userId,
        kind: "friend_accept",
        entityType: "friend_request",
        entityId: invitation.id,
      });
      const friendship = await friendshipBetween(
        userId,
        invitation.createdByUserId,
      );
      return { friendshipId: friendship?.id ?? null };
    }),
};

export const socialBlocksRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const rows = await db
      .select({
        id: userBlocks.id,
        blockedUserId: userBlocks.blockedUserId,
        createdAt: userBlocks.createdAt,
        name: users.name,
        avatar: users.avatarUrl,
      })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedUserId))
      .where(eq(userBlocks.blockerUserId, userId))
      .orderBy(desc(userBlocks.createdAt));
    return rows;
  }),

  create: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const blockerUserId = context.session.user.id;
      if (input.userId === blockerUserId) {
        badRequest("An account cannot block itself");
      }
      const [target] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) notFound("Profile");
      await db
        .insert(userBlocks)
        .values({ blockerUserId, blockedUserId: input.userId })
        .onConflictDoNothing({
          target: [userBlocks.blockerUserId, userBlocks.blockedUserId],
        });
      // A block severs the relationship in both directions.
      const [low, high] = canonicalPair(blockerUserId, input.userId);
      await db
        .delete(friendships)
        .where(
          and(
            eq(friendships.userLowId, low),
            eq(friendships.userHighId, high),
          ),
        );
      await db
        .delete(friendRequests)
        .where(
          and(
            eq(friendRequests.userLowId, low),
            eq(friendRequests.userHighId, high),
          ),
        );
      return { blocked: true };
    }),

  remove: protectedProcedure
    .input(z.object({ blockId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [deleted] = await db
        .delete(userBlocks)
        .where(
          and(
            eq(userBlocks.id, input.blockId),
            eq(userBlocks.blockerUserId, userId),
          ),
        )
        .returning({ id: userBlocks.id });
      if (!deleted) notFound("Block");
      return { removed: true };
    }),
};
