import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  friendCircleMembers,
  friendCircles,
  friendRequests,
  friendships,
  socialAuditEvents,
  socialProfileGrants,
  socialProfiles,
  userBlocks,
} from "../../db/schema";
import { notFound, protectedProcedure } from "../../lib/orpc";
import {
  FRIEND_REQUEST_TTL_MS,
  canonicalPair,
  reserveSocialRateLimit,
} from "../../lib/social-policy";
import {
  assertActiveProfile,
  assertActiveProfileFrom,
  audit,
  blocked,
  eligibilityView,
  handleSchema,
  notify,
  projectFriendProfile,
  requestIdentity,
} from "./shared";

export const socialFriendsRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const own = await assertActiveProfile(userId);
    const rows = await db
      .select()
      .from(friendships)
      .where(
        or(
          eq(friendships.userLowId, userId),
          eq(friendships.userHighId, userId),
        ),
      )
      .orderBy(desc(friendships.createdAt))
      .limit(500);
    const projected = await Promise.all(
      rows.map(async (row) => {
        const friendUserId =
          row.userLowId === userId ? row.userHighId : row.userLowId;
        return {
          friendshipId: row.id,
          since: row.createdAt,
          profile: await projectFriendProfile(userId, friendUserId),
        };
      }),
    );
    return {
      revision: own.revision,
      friends: projected.filter(
        (
          row,
        ): row is typeof row & { profile: NonNullable<typeof row.profile> } =>
          row.profile !== null,
      ),
    };
  }),

  requests: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    await assertActiveProfile(userId);
    const now = new Date();
    await db
      .update(friendRequests)
      .set({ status: "expired", respondedAt: now, updatedAt: now })
      .where(
        and(
          or(
            eq(friendRequests.senderUserId, userId),
            eq(friendRequests.recipientUserId, userId),
          ),
          eq(friendRequests.status, "pending"),
          sql`${friendRequests.expiresAt} <= ${now}`,
        ),
      );
    const rows = await db
      .select()
      .from(friendRequests)
      .where(
        and(
          or(
            eq(friendRequests.senderUserId, userId),
            eq(friendRequests.recipientUserId, userId),
          ),
          eq(friendRequests.status, "pending"),
        ),
      )
      .orderBy(desc(friendRequests.createdAt));
    const safe = await Promise.all(
      rows.map(async (row) => {
        const otherId =
          row.senderUserId === userId ? row.recipientUserId : row.senderUserId;
        if (await blocked(userId, otherId)) return null;
        return {
          id: row.id,
          direction:
            row.senderUserId === userId
              ? ("outgoing" as const)
              : ("incoming" as const),
          status: row.status,
          expiresAt: row.expiresAt,
          message: row.recipientUserId === userId ? row.message : null,
          profile: await requestIdentity(otherId),
        };
      }),
    );
    const visible = safe.filter(
      (row): row is NonNullable<typeof row> => row !== null,
    );
    return {
      incoming: visible.filter((row) => row.direction === "incoming"),
      outgoing: visible.filter((row) => row.direction === "outgoing"),
    };
  }),

  send: protectedProcedure
    .input(
      z.object({
        handle: handleSchema,
        message: z.string().trim().max(180).nullable().default(null),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await assertActiveProfile(userId);
      await reserveSocialRateLimit({
        subject: userId,
        action: "social.friend.send",
        limit: 10,
        windowMs: 3_600_000,
      });
      const [target] = await db
        .select({ userId: socialProfiles.userId })
        .from(socialProfiles)
        .where(
          and(
            eq(socialProfiles.handle, input.handle),
            eq(socialProfiles.discovery, "exact_handle"),
            eq(socialProfiles.status, "active"),
          ),
        )
        .limit(1);
      if (
        !target ||
        target.userId === userId ||
        (await blocked(userId, target.userId)) ||
        !(await eligibilityView(target.userId)).canUseSocial
      ) {
        return { ok: true };
      }
      const [low, high] = canonicalPair(userId, target.userId);
      const now = new Date();
      let notifyTarget = false;
      await db.transaction(async (tx) => {
        await assertActiveProfileFrom(tx, userId);
        const targetProfile = await assertActiveProfileFrom(tx, target.userId);
        if (targetProfile.discovery !== "exact_handle") return;
        const [friend] = await tx
          .select({ id: friendships.id })
          .from(friendships)
          .where(
            and(
              eq(friendships.userLowId, low),
              eq(friendships.userHighId, high),
            ),
          )
          .limit(1);
        if (friend) return;
        const [existing] = await tx
          .select()
          .from(friendRequests)
          .where(
            and(
              eq(friendRequests.userLowId, low),
              eq(friendRequests.userHighId, high),
            ),
          )
          .limit(1);
        if (
          existing?.status === "pending" &&
          existing.senderUserId === target.userId &&
          existing.expiresAt > now
        ) {
          const accepted = await tx
            .update(friendRequests)
            .set({ status: "accepted", respondedAt: now, updatedAt: now })
            .where(
              and(
                eq(friendRequests.id, existing.id),
                eq(friendRequests.status, "pending"),
              ),
            )
            .returning({ id: friendRequests.id });
          if (accepted.length === 1) {
            await tx
              .insert(friendships)
              .values({ userLowId: low, userHighId: high })
              .onConflictDoNothing({
                target: [friendships.userLowId, friendships.userHighId],
              });
          }
          return;
        }
        const values = {
          senderUserId: userId,
          recipientUserId: target.userId,
          status: "pending" as const,
          message: input.message,
          expiresAt: new Date(now.getTime() + FRIEND_REQUEST_TTL_MS),
          respondedAt: null,
          updatedAt: now,
        };
        if (existing) {
          await tx
            .update(friendRequests)
            .set({ ...values, createdAt: now })
            .where(eq(friendRequests.id, existing.id));
        } else {
          await tx
            .insert(friendRequests)
            .values({ userLowId: low, userHighId: high, ...values });
        }
        notifyTarget = true;
      });
      if (notifyTarget) {
        await notify({
          userId: target.userId,
          actorUserId: userId,
          kind: "friend_request.received",
          entityType: "friend_request",
        });
      }
      await audit({
        actorUserId: userId,
        subjectUserId: target.userId,
        action: "friend_request.sent",
        entityType: "friend_request",
        changedKeys: input.message ? ["status", "message"] : ["status"],
      });
      return { ok: true };
    }),

  accept: protectedProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await assertActiveProfile(userId);
      const now = new Date();
      let senderId: string | null = null;
      await db.transaction(async (tx) => {
        const [request] = await tx
          .select()
          .from(friendRequests)
          .where(
            and(
              eq(friendRequests.id, input.requestId),
              eq(friendRequests.recipientUserId, userId),
              eq(friendRequests.status, "pending"),
              gt(friendRequests.expiresAt, now),
            ),
          )
          .limit(1);
        if (!request) notFound("Friend request");
        await assertActiveProfileFrom(tx, userId);
        const senderProfile = await assertActiveProfileFrom(
          tx,
          request.senderUserId,
        );
        if (senderProfile.discovery === "off") notFound("Friend request");
        const [block] = await tx
          .select({ id: userBlocks.id })
          .from(userBlocks)
          .where(
            or(
              and(
                eq(userBlocks.blockerUserId, userId),
                eq(userBlocks.blockedUserId, request.senderUserId),
              ),
              and(
                eq(userBlocks.blockerUserId, request.senderUserId),
                eq(userBlocks.blockedUserId, userId),
              ),
            ),
          )
          .limit(1);
        if (block) notFound("Friend request");
        const accepted = await tx
          .update(friendRequests)
          .set({ status: "accepted", respondedAt: now, updatedAt: now })
          .where(
            and(
              eq(friendRequests.id, request.id),
              eq(friendRequests.status, "pending"),
            ),
          )
          .returning({ id: friendRequests.id });
        if (accepted.length !== 1) {
          throw new ORPCError("CONFLICT", {
            message: "The friend request is no longer pending",
          });
        }
        await tx
          .insert(friendships)
          .values({
            userLowId: request.userLowId,
            userHighId: request.userHighId,
          })
          .onConflictDoNothing({
            target: [friendships.userLowId, friendships.userHighId],
          });
        senderId = request.senderUserId;
      });
      if (senderId) {
        await notify({
          userId: senderId,
          actorUserId: userId,
          kind: "friend_request.accepted",
          entityType: "friend_request",
          entityId: input.requestId,
        });
      }
      return { ok: true };
    }),

  decline: protectedProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const [updated] = await db
        .update(friendRequests)
        .set({
          status: "declined",
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(friendRequests.id, input.requestId),
            eq(friendRequests.recipientUserId, context.session.user.id),
            eq(friendRequests.status, "pending"),
          ),
        )
        .returning({ id: friendRequests.id });
      if (!updated) notFound("Friend request");
      return { ok: true };
    }),

  cancel: protectedProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
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
            eq(friendRequests.senderUserId, context.session.user.id),
            eq(friendRequests.status, "pending"),
          ),
        )
        .returning({ id: friendRequests.id });
      if (!updated) notFound("Friend request");
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ friendshipId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(friendships)
          .where(
            and(
              eq(friendships.id, input.friendshipId),
              or(
                eq(friendships.userLowId, userId),
                eq(friendships.userHighId, userId),
              ),
            ),
          )
          .returning();
        if (!deleted) notFound("Friendship");
        const friendUserId =
          deleted.userLowId === userId ? deleted.userHighId : deleted.userLowId;
        await tx
          .delete(friendCircleMembers)
          .where(
            or(
              and(
                eq(friendCircleMembers.friendUserId, friendUserId),
                inArray(
                  friendCircleMembers.circleId,
                  tx
                    .select({ id: friendCircles.id })
                    .from(friendCircles)
                    .where(eq(friendCircles.ownerUserId, userId)),
                ),
              ),
              and(
                eq(friendCircleMembers.friendUserId, userId),
                inArray(
                  friendCircleMembers.circleId,
                  tx
                    .select({ id: friendCircles.id })
                    .from(friendCircles)
                    .where(eq(friendCircles.ownerUserId, friendUserId)),
                ),
              ),
            ),
          );
        const now = new Date();
        await tx
          .update(socialProfileGrants)
          .set({ withdrawnAt: now })
          .where(
            and(
              eq(socialProfileGrants.audience, "specific_user"),
              eq(socialProfileGrants.audienceId, deleted.id),
              isNull(socialProfileGrants.withdrawnAt),
            ),
          );
        await tx.insert(socialAuditEvents).values({
          actorUserId: userId,
          subjectUserId: friendUserId,
          action: "friendship.removed",
          entityType: "friendship",
          entityId: deleted.id,
          changedKeys: JSON.stringify([
            "circles",
            "friendship",
            "specificUserGrants",
          ]),
        });
      });
      return { ok: true };
    }),
};
