import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  friendCircleMembers,
  friendCircles,
  friendInvitations,
  friendRequests,
  friendships,
  groupInvitations,
  groupMemberConsents,
  groupMemberConsentFields,
  groupMemberships,
  groupPolicyFields,
  groupPolicyVersions,
  groupRankingOptIns,
  guardianConsentRequests,
  socialAggregateCache,
  socialAuditEvents,
  socialEligibility,
  socialFeatureConsents,
  socialNotifications,
  socialProfileGrants,
  socialProfiles,
  socialReports,
  socialGroups,
  userBlocks,
} from "../../db/schema";
import { notFound, protectedProcedure } from "../../lib/orpc";
import {
  SOCIAL_POLICY_VERSION,
  reserveSocialRateLimit,
} from "../../lib/social-policy";
import { audit, eligibilityView, grantDto, ownProfileDto } from "./shared";

export const socialNotificationsRouter = {
  list: protectedProcedure
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ context, input }) => {
      const rows = await db
        .select({
          id: socialNotifications.id,
          kind: socialNotifications.kind,
          entityType: socialNotifications.entityType,
          entityId: socialNotifications.entityId,
          safeParams: socialNotifications.safeParams,
          readAt: socialNotifications.readAt,
          createdAt: socialNotifications.createdAt,
        })
        .from(socialNotifications)
        .where(
          and(
            eq(socialNotifications.userId, context.session.user.id),
            input.unreadOnly
              ? sql`${socialNotifications.readAt} is null`
              : undefined,
          ),
        )
        .orderBy(desc(socialNotifications.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return rows.map((row) => ({
        ...row,
        safeParams: JSON.parse(row.safeParams) as Record<string, string>,
      }));
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
          ),
        )
        .returning({ id: socialNotifications.id });
      if (!updated) notFound("Notification");
      return { ok: true };
    }),

  markAllRead: protectedProcedure.handler(async ({ context }) => {
    await db
      .update(socialNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(socialNotifications.userId, context.session.user.id),
          sql`${socialNotifications.readAt} is null`,
        ),
      );
    return { ok: true };
  }),
};

async function reportTarget(
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
      ? {
          targetUserId:
            row.userLowId === viewerUserId ? row.userHighId : row.userLowId,
          groupId: null,
        }
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
      ? {
          targetUserId:
            row.senderUserId === viewerUserId
              ? row.recipientUserId
              : row.senderUserId,
          groupId: null,
        }
      : null;
  }
  if (source === "group") {
    const [membership] = await db
      .select({ id: groupMemberships.id })
      .from(groupMemberships)
      .where(
        and(
          eq(groupMemberships.groupId, sourceId),
          eq(groupMemberships.userId, viewerUserId),
          inArray(groupMemberships.state, ["active", "consent_required"]),
        ),
      )
      .limit(1);
    return membership ? { targetUserId: null, groupId: sourceId } : null;
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
  return viewer
    ? { targetUserId: target.userId, groupId: target.groupId }
    : null;
}

export const socialReportsRouter = {
  create: protectedProcedure
    .input(
      z.object({
        source: z.enum([
          "friendship",
          "friend_request",
          "group",
          "group_membership",
        ]),
        sourceId: z.string().min(1),
        category: z.enum([
          "harassment",
          "privacy",
          "impersonation",
          "unsafe_content",
          "other",
        ]),
        message: z.string().trim().min(10).max(2_000),
      }),
    )
    .handler(async ({ context, input }) => {
      const reporterUserId = context.session.user.id;
      await reserveSocialRateLimit({
        subject: reporterUserId,
        action: "social.report.create",
        limit: 5,
        windowMs: 86_400_000,
      });
      const target = await reportTarget(
        reporterUserId,
        input.source,
        input.sourceId,
      );
      if (!target) notFound("Report target");
      const [created] = await db
        .insert(socialReports)
        .values({
          reporterUserId,
          targetUserId: target.targetUserId,
          groupId: target.groupId,
          category: input.category,
          message: input.message,
          priority: input.category === "privacy" ? "high" : "normal",
        })
        .returning({
          id: socialReports.id,
          category: socialReports.category,
          status: socialReports.status,
          priority: socialReports.priority,
          createdAt: socialReports.createdAt,
        });
      if (!created) notFound("Report");
      await audit({
        actorUserId: reporterUserId,
        subjectUserId: target.targetUserId,
        action: "report.created",
        entityType: "social_report",
        entityId: created.id,
        changedKeys: ["category", "target"],
      });
      return created;
    }),

  mine: protectedProcedure.handler(({ context }) =>
    db
      .select({
        id: socialReports.id,
        category: socialReports.category,
        status: socialReports.status,
        priority: socialReports.priority,
        createdAt: socialReports.createdAt,
        updatedAt: socialReports.updatedAt,
        resolvedAt: socialReports.resolvedAt,
      })
      .from(socialReports)
      .where(eq(socialReports.reporterUserId, context.session.user.id))
      .orderBy(desc(socialReports.createdAt))
      .limit(50),
  ),
};

export async function exportSocialData(userId: string) {
  const [
    eligibility,
    profileRows,
    grants,
    consents,
    requests,
    invitationRows,
    friendshipRows,
    circles,
    circleMemberRows,
    blockRows,
    memberships,
    memberConsents,
    memberConsentFields,
    rankingOptIns,
    ownedGroups,
    ownedPolicies,
    ownedPolicyFields,
    groupInvitationRows,
    guardianRequests,
    guardianAuthorizations,
    notificationRows,
    reports,
    auditRows,
  ] = await Promise.all([
    eligibilityView(userId),
    db
      .select()
      .from(socialProfiles)
      .where(eq(socialProfiles.userId, userId))
      .limit(1),
    db
      .select()
      .from(socialProfileGrants)
      .where(eq(socialProfileGrants.userId, userId)),
    db
      .select({
        id: socialFeatureConsents.id,
        policyVersion: socialFeatureConsents.policyVersion,
        actorType: socialFeatureConsents.actorType,
        event: socialFeatureConsents.event,
        channel: socialFeatureConsents.channel,
        occurredAt: socialFeatureConsents.occurredAt,
      })
      .from(socialFeatureConsents)
      .where(eq(socialFeatureConsents.userId, userId)),
    db
      .select({
        id: friendRequests.id,
        direction: friendRequests.senderUserId,
        status: friendRequests.status,
        expiresAt: friendRequests.expiresAt,
        createdAt: friendRequests.createdAt,
        respondedAt: friendRequests.respondedAt,
      })
      .from(friendRequests)
      .where(
        or(
          eq(friendRequests.senderUserId, userId),
          eq(friendRequests.recipientUserId, userId),
        ),
      ),
    db
      .select({
        id: friendInvitations.id,
        tokenPrefix: friendInvitations.tokenPrefix,
        expiresAt: friendInvitations.expiresAt,
        consumedAt: friendInvitations.consumedAt,
        revokedAt: friendInvitations.revokedAt,
        createdAt: friendInvitations.createdAt,
      })
      .from(friendInvitations)
      .where(eq(friendInvitations.createdByUserId, userId)),
    db
      .select({
        id: friendships.id,
        createdAt: friendships.createdAt,
        low: friendships.userLowId,
        high: friendships.userHighId,
      })
      .from(friendships)
      .where(
        or(
          eq(friendships.userLowId, userId),
          eq(friendships.userHighId, userId),
        ),
      ),
    db
      .select({
        id: friendCircles.id,
        name: friendCircles.name,
        revision: friendCircles.revision,
      })
      .from(friendCircles)
      .where(eq(friendCircles.ownerUserId, userId)),
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
      .select({ id: userBlocks.id, createdAt: userBlocks.createdAt })
      .from(userBlocks)
      .where(eq(userBlocks.blockerUserId, userId)),
    db
      .select({
        id: groupMemberships.id,
        groupId: groupMemberships.groupId,
        role: groupMemberships.role,
        state: groupMemberships.state,
        alias: groupMemberships.alias,
        joinedAt: groupMemberships.joinedAt,
        leftAt: groupMemberships.leftAt,
      })
      .from(groupMemberships)
      .where(eq(groupMemberships.userId, userId)),
    db
      .select({
        id: groupMemberConsents.id,
        groupId: groupMemberConsents.groupId,
        policyVersion: groupMemberConsents.policyVersion,
        status: groupMemberConsents.status,
        acceptedAt: groupMemberConsents.acceptedAt,
        withdrawnAt: groupMemberConsents.withdrawnAt,
        channel: groupMemberConsents.channel,
      })
      .from(groupMemberConsents)
      .where(eq(groupMemberConsents.userId, userId)),
    db
      .select({
        consentId: groupMemberConsentFields.consentId,
        fieldKey: groupMemberConsentFields.fieldKey,
      })
      .from(groupMemberConsentFields)
      .innerJoin(
        groupMemberConsents,
        eq(groupMemberConsents.id, groupMemberConsentFields.consentId),
      )
      .where(eq(groupMemberConsents.userId, userId)),
    db
      .select({
        id: groupRankingOptIns.id,
        groupId: groupRankingOptIns.groupId,
        policyVersion: groupRankingOptIns.policyVersion,
        metric: groupRankingOptIns.metric,
        enabled: groupRankingOptIns.enabled,
      })
      .from(groupRankingOptIns)
      .where(eq(groupRankingOptIns.userId, userId)),
    db
      .select({
        id: socialGroups.id,
        type: socialGroups.type,
        name: socialGroups.name,
        description: socialGroups.description,
        state: socialGroups.state,
        currentPolicyVersion: socialGroups.currentPolicyVersion,
        revision: socialGroups.revision,
        createdAt: socialGroups.createdAt,
        updatedAt: socialGroups.updatedAt,
      })
      .from(socialGroups)
      .where(eq(socialGroups.ownerUserId, userId)),
    db
      .select({
        id: groupPolicyVersions.id,
        groupId: groupPolicyVersions.groupId,
        version: groupPolicyVersions.version,
        purpose: groupPolicyVersions.purpose,
        audienceDescription: groupPolicyVersions.audienceDescription,
        window: groupPolicyVersions.window,
        digest: groupPolicyVersions.digest,
        rankingsEnabled: groupPolicyVersions.rankingsEnabled,
        createdAt: groupPolicyVersions.createdAt,
      })
      .from(groupPolicyVersions)
      .where(
        inArray(
          groupPolicyVersions.groupId,
          db
            .select({ id: socialGroups.id })
            .from(socialGroups)
            .where(eq(socialGroups.ownerUserId, userId)),
        ),
      ),
    db
      .select({
        id: groupPolicyFields.id,
        policyVersionId: groupPolicyFields.policyVersionId,
        fieldKey: groupPolicyFields.fieldKey,
        required: groupPolicyFields.required,
        exposure: groupPolicyFields.exposure,
      })
      .from(groupPolicyFields)
      .innerJoin(
        groupPolicyVersions,
        eq(groupPolicyVersions.id, groupPolicyFields.policyVersionId),
      )
      .innerJoin(socialGroups, eq(socialGroups.id, groupPolicyVersions.groupId))
      .where(eq(socialGroups.ownerUserId, userId)),
    db
      .select({
        id: groupInvitations.id,
        groupId: groupInvitations.groupId,
        policyVersion: groupInvitations.policyVersion,
        tokenPrefix: groupInvitations.tokenPrefix,
        targeted: groupInvitations.targetEmailHash,
        expiresAt: groupInvitations.expiresAt,
        consumedAt: groupInvitations.consumedAt,
        revokedAt: groupInvitations.revokedAt,
        createdAt: groupInvitations.createdAt,
      })
      .from(groupInvitations)
      .where(eq(groupInvitations.createdByUserId, userId)),
    db
      .select({
        id: guardianConsentRequests.id,
        policyVersion: guardianConsentRequests.policyVersion,
        status: guardianConsentRequests.status,
        expiresAt: guardianConsentRequests.expiresAt,
        respondedAt: guardianConsentRequests.respondedAt,
        createdAt: guardianConsentRequests.createdAt,
      })
      .from(guardianConsentRequests)
      .where(eq(guardianConsentRequests.childUserId, userId)),
    db
      .select({
        id: guardianConsentRequests.id,
        policyVersion: guardianConsentRequests.policyVersion,
        status: guardianConsentRequests.status,
        expiresAt: guardianConsentRequests.expiresAt,
        respondedAt: guardianConsentRequests.respondedAt,
        createdAt: guardianConsentRequests.createdAt,
      })
      .from(guardianConsentRequests)
      .where(eq(guardianConsentRequests.guardianUserId, userId)),
    db
      .select({
        id: socialNotifications.id,
        kind: socialNotifications.kind,
        entityType: socialNotifications.entityType,
        entityId: socialNotifications.entityId,
        safeParams: socialNotifications.safeParams,
        readAt: socialNotifications.readAt,
        createdAt: socialNotifications.createdAt,
      })
      .from(socialNotifications)
      .where(eq(socialNotifications.userId, userId)),
    db
      .select({
        id: socialReports.id,
        category: socialReports.category,
        status: socialReports.status,
        priority: socialReports.priority,
        message: socialReports.message,
        createdAt: socialReports.createdAt,
        updatedAt: socialReports.updatedAt,
      })
      .from(socialReports)
      .where(eq(socialReports.reporterUserId, userId)),
    db
      .select({
        id: socialAuditEvents.id,
        action: socialAuditEvents.action,
        entityType: socialAuditEvents.entityType,
        entityId: socialAuditEvents.entityId,
        changedKeys: socialAuditEvents.changedKeys,
        occurredAt: socialAuditEvents.occurredAt,
      })
      .from(socialAuditEvents)
      .where(
        or(
          eq(socialAuditEvents.actorUserId, userId),
          eq(socialAuditEvents.subjectUserId, userId),
        ),
      ),
  ]);
  const friendshipIdByPeer = new Map(
    friendshipRows.map((friendship) => [
      friendship.low === userId ? friendship.high : friendship.low,
      friendship.id,
    ]),
  );
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    eligibility,
    profile: profileRows[0] ? ownProfileDto(profileRows[0]) : null,
    grants: grants.map((grant) => ({
      id: grant.id,
      fieldKey: grant.fieldKey,
      audience: grant.audience,
      audienceId: grant.audienceId,
      grantedAt: grant.grantedAt,
      withdrawnAt: grant.withdrawnAt,
    })),
    consents,
    friendRequests: requests.map((row) => ({
      ...row,
      direction: row.direction === userId ? "outgoing" : "incoming",
    })),
    friendInvitations: invitationRows,
    friendships: friendshipRows.map((friendship) => ({
      id: friendship.id,
      createdAt: friendship.createdAt,
    })),
    circles: circles.map((circle) => ({
      ...circle,
      members: circleMemberRows
        .filter((member) => member.circleId === circle.id)
        .map((member) => ({
          id: member.id,
          friendshipId: friendshipIdByPeer.get(member.friendUserId) ?? null,
          createdAt: member.createdAt,
        })),
    })),
    blocks: blockRows,
    groupMemberships: memberships,
    groupConsents: memberConsents.map((consent) => ({
      ...consent,
      fields: memberConsentFields
        .filter((field) => field.consentId === consent.id)
        .map((field) => field.fieldKey),
    })),
    rankingOptIns,
    ownedGroups,
    ownedGroupPolicies: ownedPolicies,
    ownedGroupPolicyFields: ownedPolicyFields,
    groupInvitations: groupInvitationRows.map((invitation) => ({
      ...invitation,
      targeted: Boolean(invitation.targeted),
    })),
    guardianRequests,
    guardianAuthorizations,
    notifications: notificationRows.map((notification) => ({
      ...notification,
      safeParams: JSON.parse(notification.safeParams) as Record<string, string>,
    })),
    reports,
    audit: auditRows.map((row) => ({
      ...row,
      changedKeys: JSON.parse(row.changedKeys) as string[],
    })),
  };
}

export const socialAccountRouter = {
  export: protectedProcedure.handler(({ context }) =>
    exportSocialData(context.session.user.id),
  ),

  reset: protectedProcedure
    .input(z.object({ confirmation: z.literal("RESET SOCIAL") }))
    .handler(async ({ context }) => {
      const userId = context.session.user.id;
      const now = new Date();
      await db.transaction(async (tx) => {
        const [eligibilityBeforeReset] = await tx
          .select({ ageBand: socialEligibility.ageBand })
          .from(socialEligibility)
          .where(eq(socialEligibility.userId, userId))
          .limit(1);
        const ownedGroups = tx
          .select({ id: socialGroups.id })
          .from(socialGroups)
          .where(eq(socialGroups.ownerUserId, userId));
        const affectedGroups = tx
          .select({ id: groupMemberships.groupId })
          .from(groupMemberships)
          .where(eq(groupMemberships.userId, userId));
        const friendshipIds = tx
          .select({ id: friendships.id })
          .from(friendships)
          .where(
            or(
              eq(friendships.userLowId, userId),
              eq(friendships.userHighId, userId),
            ),
          );
        await tx
          .update(socialGroups)
          .set({
            state: "archived",
            revision: sql`${socialGroups.revision} + 1`,
            updatedAt: now,
          })
          .where(eq(socialGroups.ownerUserId, userId));
        await tx
          .update(socialGroups)
          .set({ revision: sql`${socialGroups.revision} + 1`, updatedAt: now })
          .where(
            and(
              inArray(socialGroups.id, affectedGroups),
              ne(socialGroups.ownerUserId, userId),
            ),
          );
        await tx
          .update(groupMemberships)
          .set({
            state: "consent_required",
            sharedYearId: null,
            updatedAt: now,
          })
          .where(inArray(groupMemberships.groupId, ownedGroups));
        await tx
          .update(groupMemberships)
          .set({
            state: "left",
            sharedYearId: null,
            leftAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(groupMemberships.userId, userId),
              eq(groupMemberships.role, "member"),
            ),
          );
        await tx
          .update(groupMemberConsents)
          .set({ status: "withdrawn", withdrawnAt: now, updatedAt: now })
          .where(
            and(
              eq(groupMemberConsents.userId, userId),
              eq(groupMemberConsents.status, "accepted"),
            ),
          );
        await tx
          .update(groupRankingOptIns)
          .set({ enabled: false, updatedAt: now })
          .where(eq(groupRankingOptIns.userId, userId));
        await tx
          .update(groupInvitations)
          .set({ revokedAt: now })
          .where(
            and(
              eq(groupInvitations.createdByUserId, userId),
              sql`${groupInvitations.consumedAt} is null`,
            ),
          );
        await tx
          .update(friendInvitations)
          .set({ revokedAt: now })
          .where(
            and(
              eq(friendInvitations.createdByUserId, userId),
              sql`${friendInvitations.consumedAt} is null`,
            ),
          );
        await tx
          .update(socialProfileGrants)
          .set({ withdrawnAt: now })
          .where(
            and(
              eq(socialProfileGrants.audience, "specific_user"),
              inArray(socialProfileGrants.audienceId, friendshipIds),
              sql`${socialProfileGrants.withdrawnAt} is null`,
            ),
          );
        await tx
          .delete(friendCircleMembers)
          .where(
            or(
              eq(friendCircleMembers.friendUserId, userId),
              inArray(
                friendCircleMembers.circleId,
                tx
                  .select({ id: friendCircles.id })
                  .from(friendCircles)
                  .where(eq(friendCircles.ownerUserId, userId)),
              ),
            ),
          );
        await tx
          .delete(friendships)
          .where(
            or(
              eq(friendships.userLowId, userId),
              eq(friendships.userHighId, userId),
            ),
          );
        await tx
          .delete(friendRequests)
          .where(
            or(
              eq(friendRequests.senderUserId, userId),
              eq(friendRequests.recipientUserId, userId),
            ),
          );
        await tx
          .delete(friendCircles)
          .where(eq(friendCircles.ownerUserId, userId));
        await tx
          .update(socialProfileGrants)
          .set({ withdrawnAt: now })
          .where(
            and(
              eq(socialProfileGrants.userId, userId),
              sql`${socialProfileGrants.withdrawnAt} is null`,
            ),
          );
        await tx
          .update(socialProfiles)
          .set({
            status: "off",
            discovery: "off",
            handle: null,
            revision: sql`${socialProfiles.revision} + 1`,
            updatedAt: now,
          })
          .where(eq(socialProfiles.userId, userId));
        await tx
          .update(socialEligibility)
          .set({
            ageBand: "unknown",
            assuranceLevel: "none",
            providerRef: null,
            verifiedAt: null,
            expiresAt: null,
            updatedAt: now,
          })
          .where(eq(socialEligibility.userId, userId));
        await tx.insert(socialFeatureConsents).values({
          userId,
          policyVersion: SOCIAL_POLICY_VERSION,
          actorType:
            eligibilityBeforeReset?.ageBand === "under15" ? "child" : "user",
          event: "withdrawn",
          channel: "web",
        });
        await tx
          .delete(socialNotifications)
          .where(eq(socialNotifications.userId, userId));
        await tx.delete(socialAggregateCache).where(
          inArray(
            socialAggregateCache.groupId,
            tx
              .select({ id: socialGroups.id })
              .from(socialGroups)
              .where(
                or(
                  eq(socialGroups.ownerUserId, userId),
                  inArray(socialGroups.id, affectedGroups),
                ),
              ),
          ),
        );
        await tx.insert(socialAuditEvents).values({
          actorUserId: userId,
          subjectUserId: userId,
          action: "account.social_reset",
          entityType: "social_account",
          changedKeys: JSON.stringify([
            "profile",
            "consents",
            "relations",
            "groups",
          ]),
        });
      });
      return { ok: true };
    }),
};
