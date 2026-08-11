import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  friendInvitations,
  friendships,
  socialProfiles,
  userBlocks,
  users,
} from "../../db/schema";
import { notFound, protectedProcedure } from "../../lib/orpc";
import {
  canonicalPair,
  hashOpaque,
  issueOpaqueToken,
  reserveSocialRateLimit,
} from "../../lib/social-policy";
import {
  assertActiveProfile,
  assertActiveProfileFrom,
  blocked,
  notify,
} from "./shared";

export const socialFriendInvitationsRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    await assertActiveProfile(userId);
    return db
      .select({
        id: friendInvitations.id,
        tokenPrefix: friendInvitations.tokenPrefix,
        expiresAt: friendInvitations.expiresAt,
        consumedAt: friendInvitations.consumedAt,
        revokedAt: friendInvitations.revokedAt,
        createdAt: friendInvitations.createdAt,
      })
      .from(friendInvitations)
      .where(eq(friendInvitations.createdByUserId, userId))
      .orderBy(desc(friendInvitations.createdAt))
      .limit(50);
  }),

  create: protectedProcedure
    .input(
      z.object({ expiresInDays: z.number().int().min(1).max(30).default(7) }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const profile = await assertActiveProfile(userId);
      if (profile.discovery !== "invite_only") {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Set profile discovery to invite-only first",
        });
      }
      await reserveSocialRateLimit({
        subject: userId,
        action: "social.friend.invitation.create",
        limit: 10,
        windowMs: 86_400_000,
      });
      const issued = issueOpaqueToken();
      const [created] = await db
        .insert(friendInvitations)
        .values({
          createdByUserId: userId,
          tokenHash: issued.tokenHash,
          tokenPrefix: issued.tokenPrefix,
          expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
        })
        .returning({
          id: friendInvitations.id,
          expiresAt: friendInvitations.expiresAt,
        });
      return {
        ...created,
        token: issued.token,
        sharePath: `/social/invitation#kind=friend&token=${encodeURIComponent(issued.token)}`,
      };
    }),

  preview: protectedProcedure
    .input(z.object({ token: z.string().min(32).max(256) }))
    .handler(async ({ context, input }) => {
      const viewerUserId = context.session.user.id;
      const [invitation] = await db
        .select({
          id: friendInvitations.id,
          creatorUserId: friendInvitations.createdByUserId,
          expiresAt: friendInvitations.expiresAt,
          displayName: socialProfiles.displayName,
          avatar: users.avatarUrl,
        })
        .from(friendInvitations)
        .innerJoin(
          socialProfiles,
          eq(socialProfiles.userId, friendInvitations.createdByUserId),
        )
        .innerJoin(users, eq(users.id, friendInvitations.createdByUserId))
        .where(
          and(
            eq(friendInvitations.tokenHash, hashOpaque(input.token)),
            isNull(friendInvitations.consumedAt),
            isNull(friendInvitations.revokedAt),
            gt(friendInvitations.expiresAt, new Date()),
            eq(socialProfiles.status, "active"),
            eq(socialProfiles.discovery, "invite_only"),
          ),
        )
        .limit(1);
      if (
        !invitation ||
        invitation.creatorUserId === viewerUserId ||
        (await blocked(viewerUserId, invitation.creatorUserId))
      ) {
        notFound("Invitation");
      }
      return {
        invitationId: invitation.id,
        expiresAt: invitation.expiresAt,
        profile: {
          displayName: invitation.displayName,
          avatar: invitation.avatar,
        },
      };
    }),

  accept: protectedProcedure
    .input(z.object({ token: z.string().min(32).max(256) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await assertActiveProfile(userId);
      const now = new Date();
      let creatorUserId: string | null = null;
      await db.transaction(async (tx) => {
        const [invitation] = await tx
          .select()
          .from(friendInvitations)
          .where(
            and(
              eq(friendInvitations.tokenHash, hashOpaque(input.token)),
              isNull(friendInvitations.consumedAt),
              isNull(friendInvitations.revokedAt),
              gt(friendInvitations.expiresAt, now),
            ),
          )
          .limit(1);
        if (!invitation || invitation.createdByUserId === userId)
          notFound("Invitation");
        const creatorProfile = await assertActiveProfileFrom(
          tx,
          invitation.createdByUserId,
        );
        if (creatorProfile.discovery !== "invite_only") notFound("Invitation");
        const [block] = await tx
          .select({ id: userBlocks.id })
          .from(userBlocks)
          .where(
            or(
              and(
                eq(userBlocks.blockerUserId, userId),
                eq(userBlocks.blockedUserId, invitation.createdByUserId),
              ),
              and(
                eq(userBlocks.blockerUserId, invitation.createdByUserId),
                eq(userBlocks.blockedUserId, userId),
              ),
            ),
          )
          .limit(1);
        if (block) notFound("Invitation");
        const consumed = await tx
          .update(friendInvitations)
          .set({ consumedAt: now, consumedByUserId: userId })
          .where(
            and(
              eq(friendInvitations.id, invitation.id),
              isNull(friendInvitations.consumedAt),
              isNull(friendInvitations.revokedAt),
              gt(friendInvitations.expiresAt, now),
            ),
          )
          .returning({ id: friendInvitations.id });
        if (consumed.length !== 1) {
          throw new ORPCError("CONFLICT", {
            message: "The invitation was already used",
          });
        }
        const [low, high] = canonicalPair(userId, invitation.createdByUserId);
        await tx
          .insert(friendships)
          .values({ userLowId: low, userHighId: high })
          .onConflictDoNothing({
            target: [friendships.userLowId, friendships.userHighId],
          });
        creatorUserId = invitation.createdByUserId;
      });
      if (creatorUserId) {
        await notify({
          userId: creatorUserId,
          actorUserId: userId,
          kind: "friend_invitation.accepted",
          entityType: "friend_request",
        });
      }
      return { ok: true };
    }),

  revoke: protectedProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const [revoked] = await db
        .update(friendInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(friendInvitations.id, input.invitationId),
            eq(friendInvitations.createdByUserId, context.session.user.id),
            isNull(friendInvitations.consumedAt),
            isNull(friendInvitations.revokedAt),
          ),
        )
        .returning({ id: friendInvitations.id });
      if (!revoked) notFound("Invitation");
      return { ok: true };
    }),
};
