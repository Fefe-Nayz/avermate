import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  groupInvitations,
  groupMemberConsents,
  groupMemberships,
  groupPolicyVersions,
  socialGroups,
  userBlocks,
} from "../../db/schema";
import { notFound, protectedProcedure } from "../../lib/orpc";
import {
  GROUP_INVITATION_MAX_TTL_MS,
  hashOpaque,
  issueOpaqueToken,
  reserveSocialRateLimit,
} from "../../lib/social-policy";
import { assertSocialAccess, eligibilityViewFrom, notify } from "./shared";
import {
  assertManager,
  currentPolicy,
  groupAccess,
  policyDto,
} from "./groups-shared";

export const socialGroupInvitationsRouter = {
  list: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertManager(access);
      return db
        .select({
          id: groupInvitations.id,
          tokenPrefix: groupInvitations.tokenPrefix,
          policyVersion: groupInvitations.policyVersion,
          targeted: groupInvitations.targetEmailHash,
          expiresAt: groupInvitations.expiresAt,
          consumedAt: groupInvitations.consumedAt,
          revokedAt: groupInvitations.revokedAt,
          createdAt: groupInvitations.createdAt,
        })
        .from(groupInvitations)
        .where(eq(groupInvitations.groupId, input.groupId))
        .orderBy(desc(groupInvitations.createdAt))
        .limit(100)
        .then((rows) =>
          rows.map((row) => ({ ...row, targeted: Boolean(row.targeted) })),
        );
    }),

  create: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        targetEmail: z
          .string()
          .trim()
          .email()
          .max(320)
          .nullable()
          .default(null),
        expiresInDays: z.number().int().min(1).max(30).default(7),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertManager(access);
      if (access.group.state !== "active") notFound("Group");
      await reserveSocialRateLimit({
        subject: userId,
        action: "social.group.invitation.create",
        limit: 30,
        windowMs: 86_400_000,
      });
      const issued = issueOpaqueToken();
      const expiresInMs = Math.min(
        input.expiresInDays * 86_400_000,
        GROUP_INVITATION_MAX_TTL_MS,
      );
      const [created] = await db
        .insert(groupInvitations)
        .values({
          groupId: input.groupId,
          createdByUserId: userId,
          policyVersion: access.group.currentPolicyVersion,
          tokenHash: issued.tokenHash,
          tokenPrefix: issued.tokenPrefix,
          targetEmailHash: input.targetEmail
            ? hashOpaque(input.targetEmail)
            : null,
          expiresAt: new Date(Date.now() + expiresInMs),
        })
        .returning({
          id: groupInvitations.id,
          policyVersion: groupInvitations.policyVersion,
          expiresAt: groupInvitations.expiresAt,
        });
      if (!created)
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Invitation creation failed",
        });
      return {
        ...created,
        token: issued.token,
        sharePath: `/social/invitation#kind=group&token=${encodeURIComponent(issued.token)}`,
      };
    }),

  preview: protectedProcedure
    .input(z.object({ token: z.string().min(32).max(256) }))
    .handler(async ({ context, input }) => {
      const [row] = await db
        .select({ invitation: groupInvitations, group: socialGroups })
        .from(groupInvitations)
        .innerJoin(socialGroups, eq(socialGroups.id, groupInvitations.groupId))
        .where(
          and(
            eq(groupInvitations.tokenHash, hashOpaque(input.token)),
            isNull(groupInvitations.consumedAt),
            isNull(groupInvitations.revokedAt),
            gt(groupInvitations.expiresAt, new Date()),
            eq(socialGroups.state, "active"),
            eq(
              groupInvitations.policyVersion,
              socialGroups.currentPolicyVersion,
            ),
          ),
        )
        .limit(1);
      if (
        !row ||
        (row.invitation.targetEmailHash &&
          row.invitation.targetEmailHash !==
            hashOpaque(context.session.user.email))
      ) {
        notFound("Invitation");
      }
      const policy = await currentPolicy(
        row.group.id,
        row.group.currentPolicyVersion,
      );
      const [ownerMembership] = await db
        .select({ alias: groupMemberships.alias })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, row.group.id),
            eq(groupMemberships.role, "owner"),
          ),
        )
        .limit(1);
      return {
        invitationId: row.invitation.id,
        group: {
          id: row.group.id,
          name: row.group.name,
          description: row.group.description,
          type: row.group.type,
        },
        policy: policyDto(policy),
        ownerAlias: ownerMembership?.alias ?? "Group owner",
        ownerIsSelfDeclared: true as const,
        expiresAt: row.invitation.expiresAt,
      };
    }),

  accept: protectedProcedure
    .input(
      z.object({
        token: z.string().min(32).max(256),
        alias: z.string().trim().min(1).max(60),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await assertSocialAccess(userId);
      const now = new Date();
      let notificationOwner: string | null = null;
      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ invitation: groupInvitations, group: socialGroups })
          .from(groupInvitations)
          .innerJoin(
            socialGroups,
            eq(socialGroups.id, groupInvitations.groupId),
          )
          .where(
            and(
              eq(groupInvitations.tokenHash, hashOpaque(input.token)),
              isNull(groupInvitations.consumedAt),
              isNull(groupInvitations.revokedAt),
              gt(groupInvitations.expiresAt, now),
              eq(
                groupInvitations.policyVersion,
                socialGroups.currentPolicyVersion,
              ),
              eq(socialGroups.state, "active"),
            ),
          )
          .limit(1);
        if (
          !row ||
          row.group.ownerUserId === userId ||
          (row.invitation.targetEmailHash &&
            row.invitation.targetEmailHash !==
              hashOpaque(context.session.user.email))
        )
          notFound("Invitation");
        const [ownerAccess, creatorAccess, currentGroupPolicy] =
          await Promise.all([
            eligibilityViewFrom(tx, row.group.ownerUserId),
            eligibilityViewFrom(tx, row.invitation.createdByUserId),
            tx
              .select({ digest: groupPolicyVersions.digest })
              .from(groupPolicyVersions)
              .where(
                and(
                  eq(groupPolicyVersions.groupId, row.group.id),
                  eq(
                    groupPolicyVersions.version,
                    row.group.currentPolicyVersion,
                  ),
                ),
              )
              .limit(1)
              .then((rows) => rows[0]),
          ]);
        if (
          !ownerAccess.canUseSocial ||
          !creatorAccess.canUseSocial ||
          !currentGroupPolicy
        ) {
          notFound("Invitation");
        }
        const authorityRows = await tx
          .select({
            userId: groupMemberships.userId,
            role: groupMemberships.role,
          })
          .from(groupMemberships)
          .innerJoin(
            groupMemberConsents,
            and(
              eq(groupMemberConsents.groupId, groupMemberships.groupId),
              eq(groupMemberConsents.userId, groupMemberships.userId),
            ),
          )
          .where(
            and(
              eq(groupMemberships.groupId, row.group.id),
              inArray(groupMemberships.userId, [
                row.group.ownerUserId,
                row.invitation.createdByUserId,
              ]),
              eq(groupMemberships.state, "active"),
              eq(
                groupMemberConsents.policyVersion,
                row.group.currentPolicyVersion,
              ),
              eq(groupMemberConsents.policyDigest, currentGroupPolicy.digest),
              eq(groupMemberConsents.status, "accepted"),
            ),
          );
        const ownerAuthority = authorityRows.find(
          (authority) =>
            authority.userId === row.group.ownerUserId &&
            authority.role === "owner",
        );
        const creatorAuthority = authorityRows.find(
          (authority) =>
            authority.userId === row.invitation.createdByUserId &&
            (authority.role === "owner" || authority.role === "moderator"),
        );
        if (!ownerAuthority || !creatorAuthority) notFound("Invitation");
        const [block] = await tx
          .select({ id: userBlocks.id })
          .from(userBlocks)
          .where(
            or(
              and(
                eq(userBlocks.blockerUserId, userId),
                eq(userBlocks.blockedUserId, row.group.ownerUserId),
              ),
              and(
                eq(userBlocks.blockerUserId, row.group.ownerUserId),
                eq(userBlocks.blockedUserId, userId),
              ),
            ),
          )
          .limit(1);
        if (block) notFound("Invitation");
        const consumed = await tx
          .update(groupInvitations)
          .set({ consumedAt: now, consumedByUserId: userId })
          .where(
            and(
              eq(groupInvitations.id, row.invitation.id),
              isNull(groupInvitations.consumedAt),
              isNull(groupInvitations.revokedAt),
              gt(groupInvitations.expiresAt, now),
            ),
          )
          .returning({ id: groupInvitations.id });
        if (consumed.length !== 1) {
          throw new ORPCError("CONFLICT", {
            message: "The invitation was already used",
          });
        }
        const [membership] = await tx
          .insert(groupMemberships)
          .values({
            groupId: row.group.id,
            userId,
            role: "member",
            state: "consent_required",
            alias: input.alias,
          })
          .onConflictDoUpdate({
            target: [groupMemberships.groupId, groupMemberships.userId],
            set: {
              role: "member",
              state: "consent_required",
              alias: input.alias,
              sharedYearId: null,
              joinedAt: null,
              leftAt: null,
              updatedAt: now,
            },
          })
          .returning({
            id: groupMemberships.id,
            state: groupMemberships.state,
          });
        if (!membership)
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Membership creation failed",
          });
        notificationOwner = row.group.ownerUserId;
        return {
          groupId: row.group.id,
          membershipId: membership.id,
          state: membership.state,
        };
      });
      if (notificationOwner) {
        await notify({
          userId: notificationOwner,
          actorUserId: userId,
          kind: "group.member_joined",
          entityType: "group",
          entityId: result.groupId,
        });
      }
      return result;
    }),

  decline: protectedProcedure
    .input(z.object({ token: z.string().min(32).max(256) }))
    .handler(async ({ context, input }) => {
      const [invitation] = await db
        .select({
          id: groupInvitations.id,
          targetEmailHash: groupInvitations.targetEmailHash,
        })
        .from(groupInvitations)
        .where(
          and(
            eq(groupInvitations.tokenHash, hashOpaque(input.token)),
            isNull(groupInvitations.consumedAt),
            isNull(groupInvitations.revokedAt),
            gt(groupInvitations.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!invitation) notFound("Invitation");
      // An untargeted link is a bearer capability. A viewer may dismiss it in
      // their UI, but must not globally invalidate it for its intended user.
      if (!invitation.targetEmailHash) {
        return { ok: true, dismissedLocally: true as const };
      }
      if (
        invitation.targetEmailHash !== hashOpaque(context.session.user.email)
      ) {
        notFound("Invitation");
      }
      const [declined] = await db
        .update(groupInvitations)
        .set({
          consumedAt: new Date(),
          consumedByUserId: context.session.user.id,
        })
        .where(
          and(
            eq(groupInvitations.tokenHash, hashOpaque(input.token)),
            isNull(groupInvitations.consumedAt),
            isNull(groupInvitations.revokedAt),
            gt(groupInvitations.expiresAt, new Date()),
            eq(
              groupInvitations.targetEmailHash,
              hashOpaque(context.session.user.email),
            ),
          ),
        )
        .returning({ id: groupInvitations.id });
      if (!declined) notFound("Invitation");
      return { ok: true, dismissedLocally: false as const };
    }),

  revoke: protectedProcedure
    .input(
      z.object({ groupId: z.string().min(1), invitationId: z.string().min(1) }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertManager(access);
      const [revoked] = await db
        .update(groupInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(groupInvitations.id, input.invitationId),
            eq(groupInvitations.groupId, input.groupId),
            isNull(groupInvitations.consumedAt),
            isNull(groupInvitations.revokedAt),
          ),
        )
        .returning({ id: groupInvitations.id });
      if (!revoked) notFound("Invitation");
      return { ok: true };
    }),
};
