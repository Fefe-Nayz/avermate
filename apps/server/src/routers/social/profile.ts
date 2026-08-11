import { ORPCError } from "@orpc/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  friendCircles,
  friendships,
  socialProfileGrants,
  socialProfiles,
} from "../../db/schema";
import { badRequest, notFound, protectedProcedure } from "../../lib/orpc";
import {
  assertActiveProfile,
  assertSocialAccess,
  audit,
  eligibilityView,
  grantDto,
  handleSchema,
  listActiveGrants,
  ownProfileDto,
  previewOwnProfile,
  profileFieldSchema,
  projectFriendProfile,
} from "./shared";

export const socialProfileRouter = {
  mine: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [eligibility, profileRows, grants] = await Promise.all([
      eligibilityView(userId),
      db
        .select()
        .from(socialProfiles)
        .where(eq(socialProfiles.userId, userId))
        .limit(1),
      listActiveGrants(userId),
    ]);
    return {
      eligibility,
      profile: profileRows[0] ? ownProfileDto(profileRows[0]) : null,
      grants,
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        status: z.enum(["off", "active"]).optional(),
        discovery: z.enum(["off", "invite_only", "exact_handle"]).optional(),
        handle: handleSchema.nullable().optional(),
        displayName: z.string().trim().min(1).max(80).optional(),
        bio: z.string().trim().max(280).optional(),
        educationBand: z
          .enum([
            "unknown",
            "middle_school",
            "high_school",
            "higher_education",
            "other",
          ])
          .optional(),
        expectedRevision: z.number().int().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await assertSocialAccess(userId);
      const [current] = await db
        .select()
        .from(socialProfiles)
        .where(eq(socialProfiles.userId, userId))
        .limit(1);
      if (!current) badRequest("Complete social eligibility first");
      const nextDiscovery = input.discovery ?? current.discovery;
      const nextHandle =
        input.handle === undefined ? current.handle : input.handle;
      if (nextDiscovery === "exact_handle" && !nextHandle) {
        badRequest("An exact handle is required for handle discovery");
      }
      const changedKeys = Object.keys(input).filter(
        (key) => key !== "expectedRevision",
      );
      if (changedKeys.length === 0) return ownProfileDto(current);
      try {
        const [updated] = await db
          .update(socialProfiles)
          .set({
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.discovery !== undefined
              ? { discovery: input.discovery }
              : {}),
            ...(input.handle !== undefined ? { handle: input.handle } : {}),
            ...(input.displayName !== undefined
              ? { displayName: input.displayName }
              : {}),
            ...(input.bio !== undefined ? { bio: input.bio } : {}),
            ...(input.educationBand !== undefined
              ? { educationBand: input.educationBand }
              : {}),
            revision: sql`${socialProfiles.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(socialProfiles.userId, userId),
              input.expectedRevision === undefined
                ? undefined
                : eq(socialProfiles.revision, input.expectedRevision),
            ),
          )
          .returning();
        if (!updated) {
          throw new ORPCError("CONFLICT", {
            message: "The profile changed in another session",
          });
        }
        await audit({
          actorUserId: userId,
          action: "profile.updated",
          entityType: "social_profile",
          changedKeys,
        });
        return ownProfileDto(updated);
      } catch (error) {
        if (error instanceof Error && /unique|handle/i.test(error.message)) {
          throw new ORPCError("CONFLICT", {
            message: "That handle is unavailable",
          });
        }
        throw error;
      }
    }),

  preview: protectedProcedure
    .input(z.object({ friendshipId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const viewerUserId = context.session.user.id;
      await assertActiveProfile(viewerUserId);
      const [friendship] = await db
        .select()
        .from(friendships)
        .where(
          and(
            eq(friendships.id, input.friendshipId),
            or(
              eq(friendships.userLowId, viewerUserId),
              eq(friendships.userHighId, viewerUserId),
            ),
          ),
        )
        .limit(1);
      if (!friendship) notFound("Profile");
      const targetUserId =
        friendship.userLowId === viewerUserId
          ? friendship.userHighId
          : friendship.userLowId;
      const profile = await projectFriendProfile(viewerUserId, targetUserId);
      if (!profile) notFound("Profile");
      return { friendshipId: friendship.id, profile };
    }),

  previewMineAs: protectedProcedure
    .input(
      z.object({
        audience: z.enum(["friends", "circle", "specific_user"]),
        audienceId: z.string().min(1).nullable().default(null),
      }),
    )
    .handler(async ({ context, input }) => {
      await assertActiveProfile(context.session.user.id);
      if (input.audience !== "friends" && !input.audienceId) {
        badRequest("This audience requires a target");
      }
      return previewOwnProfile({
        ownerUserId: context.session.user.id,
        audience: input.audience,
        audienceId: input.audienceId,
      });
    }),
};

export const socialGrantsRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    await assertSocialAccess(context.session.user.id);
    return listActiveGrants(context.session.user.id);
  }),

  upsert: protectedProcedure
    .input(
      z.object({
        fieldKey: profileFieldSchema,
        audience: z.enum(["friends", "circle", "specific_user"]),
        audienceId: z.string().min(1).nullable().default(null),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await assertActiveProfile(userId);
      const audienceId = input.audience === "friends" ? "" : input.audienceId;
      if (input.audience !== "friends" && !audienceId)
        badRequest("This audience requires a target");
      if (input.audience === "circle") {
        const [circle] = await db
          .select({ id: friendCircles.id })
          .from(friendCircles)
          .where(
            and(
              eq(friendCircles.id, audienceId ?? ""),
              eq(friendCircles.ownerUserId, userId),
            ),
          )
          .limit(1);
        if (!circle) notFound("Circle");
      }
      if (input.audience === "specific_user") {
        const [friendship] = await db
          .select({ id: friendships.id })
          .from(friendships)
          .where(
            and(
              eq(friendships.id, audienceId ?? ""),
              or(
                eq(friendships.userLowId, userId),
                eq(friendships.userHighId, userId),
              ),
            ),
          )
          .limit(1);
        if (!friendship) notFound("Friend");
      }
      const [grant] = await db
        .insert(socialProfileGrants)
        .values({
          userId,
          fieldKey: input.fieldKey,
          audience: input.audience,
          audienceId,
        })
        .onConflictDoUpdate({
          target: [
            socialProfileGrants.userId,
            socialProfileGrants.fieldKey,
            socialProfileGrants.audience,
            socialProfileGrants.audienceId,
          ],
          set: { grantedAt: new Date(), withdrawnAt: null },
        })
        .returning();
      await audit({
        actorUserId: userId,
        action: "profile.grant_upserted",
        entityType: "profile_grant",
        entityId: grant?.id,
        changedKeys: ["fieldKey", "audience", "audienceId"],
      });
      if (!grant) badRequest("The profile grant could not be saved");
      return grantDto(grant);
    }),

  revoke: protectedProcedure
    .input(z.object({ grantId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const [revoked] = await db
        .update(socialProfileGrants)
        .set({ withdrawnAt: new Date() })
        .where(
          and(
            eq(socialProfileGrants.id, input.grantId),
            eq(socialProfileGrants.userId, context.session.user.id),
            isNull(socialProfileGrants.withdrawnAt),
          ),
        )
        .returning({ id: socialProfileGrants.id });
      if (!revoked) notFound("Grant");
      await audit({
        actorUserId: context.session.user.id,
        action: "profile.grant_revoked",
        entityType: "profile_grant",
        entityId: revoked.id,
        changedKeys: ["withdrawnAt"],
      });
      return { ok: true };
    }),
};
