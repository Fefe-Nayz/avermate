import { ORPCError } from "@orpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  groupMemberConsentFields,
  groupMemberConsents,
  groupMemberships,
  groupPolicyFields,
  groupPolicyVersions,
  groupRankingOptIns,
  socialAggregateCache,
  socialGroups,
} from "../../db/schema";
import { badRequest, notFound, protectedProcedure } from "../../lib/orpc";
import { groupPolicyDigest } from "../../lib/social-policy";
import {
  assertOwnedYear,
  assertGroupOperational,
  assertOwner,
  currentPolicy,
  groupAccess,
  groupPolicyInputSchema,
  policyDto,
  socialMetricSchema,
} from "./groups-shared";

export const socialGroupPolicyRouter = {
  current: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      const policy = await currentPolicy(
        access.group.id,
        access.group.currentPolicyVersion,
      );
      const rankingOptIns = await db
        .select({ metric: groupRankingOptIns.metric })
        .from(groupRankingOptIns)
        .where(
          and(
            eq(groupRankingOptIns.groupId, input.groupId),
            eq(groupRankingOptIns.userId, context.session.user.id),
            eq(groupRankingOptIns.policyVersion, policy.policy.version),
            eq(groupRankingOptIns.enabled, true),
          ),
        );
      return {
        policy: policyDto(policy),
        membershipId: access.membership.id,
        membershipState: access.membership.state,
        viewerRankingOptIns: rankingOptIns.map((row) => row.metric),
      };
    }),

  createVersion: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        expectedRevision: z.number().int().min(1),
        policy: groupPolicyInputSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertOwner(access);
      const nextVersion = access.group.currentPolicyVersion + 1;
      const digest = groupPolicyDigest(input.policy);
      const policy = await db.transaction(async (tx) => {
        const claimed = await tx
          .update(socialGroups)
          .set({
            currentPolicyVersion: nextVersion,
            revision: sql`${socialGroups.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(socialGroups.id, input.groupId),
              eq(socialGroups.revision, input.expectedRevision),
              eq(
                socialGroups.currentPolicyVersion,
                access.group.currentPolicyVersion,
              ),
            ),
          )
          .returning({ id: socialGroups.id });
        if (claimed.length !== 1) {
          throw new ORPCError("CONFLICT", {
            message: "The group changed in another session",
          });
        }
        const [created] = await tx
          .insert(groupPolicyVersions)
          .values({
            groupId: input.groupId,
            version: nextVersion,
            purpose: input.policy.purpose,
            audienceDescription: input.policy.audienceDescription,
            window: input.policy.window,
            digest,
            rankingsEnabled: input.policy.rankingsEnabled,
            createdByUserId: userId,
          })
          .returning();
        if (!created)
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Policy creation failed",
          });
        await tx.insert(groupPolicyFields).values(
          input.policy.fields.map((field) => ({
            policyVersionId: created.id,
            ...field,
          })),
        );
        await tx
          .update(groupMemberships)
          .set({ state: "consent_required", updatedAt: new Date() })
          .where(
            and(
              eq(groupMemberships.groupId, input.groupId),
              eq(groupMemberships.state, "active"),
            ),
          );
        await tx
          .update(groupRankingOptIns)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(groupRankingOptIns.groupId, input.groupId));
        await tx
          .delete(socialAggregateCache)
          .where(eq(socialAggregateCache.groupId, input.groupId));
        return created;
      });
      const fields = input.policy.fields;
      return policyDto({ policy, fields });
    }),

  reconsent: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        policyDigest: z.string().length(64),
        selectedFields: z.array(socialMetricSchema).max(6),
        sharedYearId: z.string().min(1),
        accepted: z.literal(true),
        channel: z.enum(["web", "mobile", "mcp"]),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertGroupOperational(access);
      const policy = await currentPolicy(
        access.group.id,
        access.group.currentPolicyVersion,
      );
      if (input.policyDigest !== policy.policy.digest) {
        throw new ORPCError("CONFLICT", {
          message: "The group policy changed",
        });
      }
      await assertOwnedYear(userId, input.sharedYearId);
      const selected = new Set(input.selectedFields);
      if (selected.size !== input.selectedFields.length)
        badRequest("A metric can only be selected once");
      const allowed = new Set(policy.fields.map((field) => field.fieldKey));
      if (input.selectedFields.some((field) => !allowed.has(field)))
        badRequest("Unknown policy metric");
      const missingRequired = policy.fields.filter(
        (field) => field.required && !selected.has(field.fieldKey),
      );
      if (missingRequired.length > 0) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Required policy metrics must be accepted",
          data: {
            requiredFields: missingRequired.map((field) => field.fieldKey),
          },
        });
      }
      await db.transaction(async (tx) => {
        const claimedPolicy = await tx
          .update(socialGroups)
          .set({
            revision: sql`${socialGroups.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(socialGroups.id, input.groupId),
              eq(socialGroups.currentPolicyVersion, policy.policy.version),
              eq(socialGroups.state, "active"),
            ),
          )
          .returning({ id: socialGroups.id });
        if (claimedPolicy.length !== 1) {
          throw new ORPCError("CONFLICT", {
            message: "The group policy changed",
          });
        }
        const [consent] = await tx
          .insert(groupMemberConsents)
          .values({
            groupId: input.groupId,
            userId,
            policyVersion: policy.policy.version,
            status: "accepted",
            policyDigest: policy.policy.digest,
            acceptedAt: new Date(),
            withdrawnAt: null,
            channel: input.channel,
          })
          .onConflictDoUpdate({
            target: [
              groupMemberConsents.groupId,
              groupMemberConsents.userId,
              groupMemberConsents.policyVersion,
            ],
            set: {
              status: "accepted",
              policyDigest: policy.policy.digest,
              acceptedAt: new Date(),
              withdrawnAt: null,
              channel: input.channel,
              updatedAt: new Date(),
            },
          })
          .returning();
        if (!consent)
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Consent could not be saved",
          });
        await tx
          .delete(groupMemberConsentFields)
          .where(eq(groupMemberConsentFields.consentId, consent.id));
        if (input.selectedFields.length > 0) {
          await tx.insert(groupMemberConsentFields).values(
            input.selectedFields.map((fieldKey) => ({
              consentId: consent.id,
              fieldKey,
            })),
          );
        }
        const activated = await tx
          .update(groupMemberships)
          .set({
            state: "active",
            sharedYearId: input.sharedYearId,
            joinedAt: sql`coalesce(${groupMemberships.joinedAt}, unixepoch())`,
            leftAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(groupMemberships.id, access.membership.id),
              inArray(groupMemberships.state, ["active", "consent_required"]),
            ),
          )
          .returning({ id: groupMemberships.id });
        if (activated.length !== 1) notFound("Group membership");
        await tx
          .delete(socialAggregateCache)
          .where(eq(socialAggregateCache.groupId, input.groupId));
      });
      return {
        ok: true,
        membershipId: access.membership.id,
        policyVersion: policy.policy.version,
      };
    }),

  withdraw: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id, {
        allowIneligible: true,
      });
      const policy = await currentPolicy(
        access.group.id,
        access.group.currentPolicyVersion,
      );
      await db.transaction(async (tx) => {
        await tx
          .update(groupMemberConsents)
          .set({
            status: "withdrawn",
            withdrawnAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(groupMemberConsents.groupId, input.groupId),
              eq(groupMemberConsents.userId, context.session.user.id),
              eq(groupMemberConsents.policyVersion, policy.policy.version),
              eq(groupMemberConsents.status, "accepted"),
            ),
          );
        await tx
          .update(groupMemberships)
          .set({
            state: "consent_required",
            sharedYearId: null,
            updatedAt: new Date(),
          })
          .where(eq(groupMemberships.id, access.membership.id));
        await tx
          .update(groupRankingOptIns)
          .set({ enabled: false, updatedAt: new Date() })
          .where(
            and(
              eq(groupRankingOptIns.groupId, input.groupId),
              eq(groupRankingOptIns.userId, context.session.user.id),
            ),
          );
        await tx
          .update(socialGroups)
          .set({
            revision: sql`${socialGroups.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(socialGroups.id, input.groupId));
        await tx
          .delete(socialAggregateCache)
          .where(eq(socialAggregateCache.groupId, input.groupId));
      });
      return { ok: true };
    }),

  setRankingOptIn: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        metric: socialMetricSchema,
        enabled: z.boolean(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertGroupOperational(access);
      if (access.membership.state !== "active")
        badRequest("Accept the current group policy first");
      const policy = await currentPolicy(
        access.group.id,
        access.group.currentPolicyVersion,
      );
      const field = policy.fields.find(
        (candidate) => candidate.fieldKey === input.metric,
      );
      if (!policy.policy.rankingsEnabled || field?.exposure !== "ranking") {
        notFound("Ranking metric");
      }
      const [consent] = await db
        .select({ id: groupMemberConsents.id })
        .from(groupMemberConsents)
        .innerJoin(
          groupMemberConsentFields,
          eq(groupMemberConsentFields.consentId, groupMemberConsents.id),
        )
        .where(
          and(
            eq(groupMemberConsents.groupId, input.groupId),
            eq(groupMemberConsents.userId, userId),
            eq(groupMemberConsents.policyVersion, policy.policy.version),
            eq(groupMemberConsents.policyDigest, policy.policy.digest),
            eq(groupMemberConsents.status, "accepted"),
            eq(groupMemberConsentFields.fieldKey, input.metric),
          ),
        )
        .limit(1);
      if (!consent)
        badRequest("Share this metric before opting into its ranking");
      await db
        .insert(groupRankingOptIns)
        .values({
          groupId: input.groupId,
          userId,
          policyVersion: policy.policy.version,
          metric: input.metric,
          enabled: input.enabled,
        })
        .onConflictDoUpdate({
          target: [
            groupRankingOptIns.groupId,
            groupRankingOptIns.userId,
            groupRankingOptIns.policyVersion,
            groupRankingOptIns.metric,
          ],
          set: { enabled: input.enabled, updatedAt: new Date() },
        });
      return { ok: true, enabled: input.enabled };
    }),
};
