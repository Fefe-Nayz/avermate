import { ORPCError } from "@orpc/server";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  groupMemberConsentFields,
  groupMemberConsents,
  groupMemberships,
  groupPolicyFields,
  groupPolicyVersions,
  socialAggregateCache,
  socialAuditEvents,
  socialEligibility,
  socialGroups,
} from "../../db/schema";
import { badRequest, notFound, protectedProcedure } from "../../lib/orpc";
import { groupPolicyDigest } from "../../lib/social-policy";
import { assertSocialAccess, audit, blocked, eligibilityView } from "./shared";
import {
  assertManager,
  assertOwnedYear,
  assertOwner,
  currentPolicy,
  groupAccess,
  groupDto,
  groupPolicyInputSchema,
  invalidateGroup,
  metricProjection,
  policyDto,
} from "./groups-shared";

const createGroupSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).default(""),
    type: z.enum(["friends", "study_group", "class"]),
    classSelfDeclared: z.boolean().default(false),
    alias: z.string().trim().min(1).max(60),
    sharedYearId: z.string().min(1),
    accepted: z.literal(true),
    channel: z.enum(["web", "mobile", "mcp"]),
    policy: groupPolicyInputSchema,
  })
  .refine((value) => value.type !== "class" || value.classSelfDeclared, {
    message: "A class group must be explicitly identified as self-declared",
    path: ["classSelfDeclared"],
  });

async function visibleMemberCount(groupId: string, viewerUserId: string) {
  const members = await db
    .select({ userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(
      and(
        eq(groupMemberships.groupId, groupId),
        inArray(groupMemberships.state, ["active", "consent_required"]),
      ),
    );
  let count = 0;
  for (const member of members) {
    if (!(await eligibilityView(member.userId)).canUseSocial) continue;
    if (
      member.userId !== viewerUserId &&
      (await blocked(viewerUserId, member.userId))
    )
      continue;
    count += 1;
  }
  return count;
}

export const socialGroupsCoreRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    await assertSocialAccess(userId);
    const rows = await db
      .select({
        group: socialGroups,
        membership: groupMemberships,
      })
      .from(groupMemberships)
      .innerJoin(socialGroups, eq(socialGroups.id, groupMemberships.groupId))
      .where(
        and(
          eq(groupMemberships.userId, userId),
          inArray(groupMemberships.state, ["active", "consent_required"]),
          ne(socialGroups.state, "archived"),
        ),
      );
    const groups = await Promise.all(
      rows.map(async (row) =>
        groupDto(
          row.group,
          row.membership,
          await visibleMemberCount(row.group.id, userId),
        ),
      ),
    );
    return {
      revision: rows.reduce(
        (revision, row) => Math.max(revision, row.group.revision),
        0,
      ),
      groups,
    };
  }),

  create: protectedProcedure
    .input(createGroupSchema)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await assertSocialAccess(userId);
      await assertOwnedYear(userId, input.sharedYearId);
      const digest = groupPolicyDigest(input.policy);
      const result = await db.transaction(async (tx) => {
        const [group] = await tx
          .insert(socialGroups)
          .values({
            ownerUserId: userId,
            type: input.type,
            name: input.name,
            description: input.description,
            classDeclarationVersion:
              input.type === "class" ? "2026-08-11.1" : null,
            classDeclaredAt: input.type === "class" ? new Date() : null,
            classDeclaredByUserId: input.type === "class" ? userId : null,
            currentPolicyVersion: 1,
          })
          .returning();
        if (!group)
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Group creation failed",
          });
        const [policy] = await tx
          .insert(groupPolicyVersions)
          .values({
            groupId: group.id,
            version: 1,
            purpose: input.policy.purpose,
            audienceDescription: input.policy.audienceDescription,
            window: input.policy.window,
            digest,
            rankingsEnabled: input.policy.rankingsEnabled,
            createdByUserId: userId,
          })
          .returning();
        if (!policy)
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Policy creation failed",
          });
        await tx.insert(groupPolicyFields).values(
          input.policy.fields.map((field) => ({
            policyVersionId: policy.id,
            ...field,
          })),
        );
        const [membership] = await tx
          .insert(groupMemberships)
          .values({
            groupId: group.id,
            userId,
            role: "owner",
            state: "active",
            alias: input.alias,
            sharedYearId: input.sharedYearId,
            joinedAt: new Date(),
          })
          .returning();
        if (!membership)
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Membership creation failed",
          });
        const [consent] = await tx
          .insert(groupMemberConsents)
          .values({
            groupId: group.id,
            userId,
            policyVersion: 1,
            status: "accepted",
            policyDigest: digest,
            acceptedAt: new Date(),
            channel: input.channel,
          })
          .returning();
        if (!consent)
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Consent creation failed",
          });
        await tx.insert(groupMemberConsentFields).values(
          input.policy.fields.map((field) => ({
            consentId: consent.id,
            fieldKey: field.fieldKey,
          })),
        );
        await tx.insert(socialAuditEvents).values({
          actorUserId: userId,
          subjectUserId: userId,
          action: "group.created",
          entityType: "social_group",
          entityId: group.id,
          changedKeys: JSON.stringify([
            "type",
            "policy",
            "membership",
            ...(input.type === "class" ? ["classSelfDeclaration"] : []),
          ]),
        });
        return { group, membership };
      });
      const policy = await currentPolicy(result.group.id, 1);
      return {
        group: groupDto(result.group, result.membership, 1),
        policy: policyDto(policy),
      };
    }),

  get: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      const policy = await currentPolicy(
        access.group.id,
        access.group.currentPolicyVersion,
      );
      const memberRows = await db
        .select()
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, access.group.id),
            inArray(groupMemberships.state, ["active", "consent_required"]),
          ),
        );
      if (access.group.state !== "active") {
        return {
          group: groupDto(access.group, access.membership, 0),
          policy: policyDto(policy),
          members: [],
        };
      }
      const unblockedRows = [] as typeof memberRows;
      for (const membership of memberRows) {
        if (
          (await eligibilityView(membership.userId)).canUseSocial &&
          (membership.userId === userId ||
            !(await blocked(userId, membership.userId)))
        ) {
          unblockedRows.push(membership);
        }
      }
      const group = groupDto(
        access.group,
        access.membership,
        unblockedRows.length,
      );
      if (access.membership.state !== "active") {
        return { group, policy: policyDto(policy), members: [] };
      }
      const visibleFields = policy.fields.filter(
        (field) => field.exposure === "member_visible",
      );
      const members = await Promise.all(
        unblockedRows.map(async (membership) => {
          const base = {
            membershipId: membership.id,
            alias: membership.alias,
            role: membership.role,
            state: membership.state,
            joinedAt: membership.joinedAt,
          };
          if (membership.state !== "active") return { ...base, metrics: {} };
          const [consent] = await db
            .select()
            .from(groupMemberConsents)
            .where(
              and(
                eq(groupMemberConsents.groupId, access.group.id),
                eq(groupMemberConsents.userId, membership.userId),
                eq(groupMemberConsents.policyVersion, policy.policy.version),
                eq(groupMemberConsents.policyDigest, policy.policy.digest),
                eq(groupMemberConsents.status, "accepted"),
              ),
            )
            .limit(1);
          if (!consent) return { ...base, metrics: {} };
          const selected = new Set(
            (
              await db
                .select({ fieldKey: groupMemberConsentFields.fieldKey })
                .from(groupMemberConsentFields)
                .where(eq(groupMemberConsentFields.consentId, consent.id))
            ).map((row) => row.fieldKey),
          );
          const [memberEligibility] = await db
            .select({ ageBand: socialEligibility.ageBand })
            .from(socialEligibility)
            .where(eq(socialEligibility.userId, membership.userId))
            .limit(1);
          const metrics = Object.fromEntries(
            await Promise.all(
              visibleFields
                .filter((field) => selected.has(field.fieldKey))
                .map(async (field) => {
                  const projection = await metricProjection({
                    membership,
                    policy,
                    metric: field.fieldKey,
                  });
                  const safeProjection =
                    membership.userId !== userId &&
                    memberEligibility?.ageBand !== "adult" &&
                    projection.numeric !== null
                      ? {
                          metric: field.fieldKey,
                          numeric: null,
                          band: "minor_private",
                        }
                      : projection;
                  return [field.fieldKey, safeProjection] as const;
                }),
            ),
          );
          return { ...base, metrics };
        }),
      );
      return { group, policy: policyDto(policy), members };
    }),

  update: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        name: z.string().trim().min(2).max(100).optional(),
        description: z.string().trim().max(500).optional(),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      const [updated] = await db
        .update(socialGroups)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          revision: sql`${socialGroups.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(socialGroups.id, input.groupId),
            eq(socialGroups.revision, input.expectedRevision),
          ),
        )
        .returning();
      if (!updated)
        throw new ORPCError("CONFLICT", {
          message: "The group changed in another session",
        });
      return groupDto(
        updated,
        access.membership,
        await visibleMemberCount(input.groupId, context.session.user.id),
      );
    }),

  transfer: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        membershipId: z.string().min(1),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertOwner(access);
      const [target] = await db
        .select()
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.id, input.membershipId),
            eq(groupMemberships.groupId, input.groupId),
            eq(groupMemberships.state, "active"),
            ne(groupMemberships.userId, userId),
          ),
        )
        .limit(1);
      if (!target) notFound("Group member");
      await db.transaction(async (tx) => {
        const claimed = await tx
          .update(socialGroups)
          .set({
            ownerUserId: target.userId,
            revision: sql`${socialGroups.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(socialGroups.id, input.groupId),
              eq(socialGroups.revision, input.expectedRevision),
            ),
          )
          .returning({ id: socialGroups.id });
        if (claimed.length !== 1)
          throw new ORPCError("CONFLICT", {
            message: "The group changed in another session",
          });
        await tx
          .update(groupMemberships)
          .set({ role: "member", updatedAt: new Date() })
          .where(eq(groupMemberships.id, access.membership.id));
        await tx
          .update(groupMemberships)
          .set({ role: "owner", updatedAt: new Date() })
          .where(eq(groupMemberships.id, target.id));
      });
      return { ok: true };
    }),

  archive: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        archived: z.boolean(),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      const [updated] = await db
        .update(socialGroups)
        .set({
          state: input.archived ? "archived" : "active",
          revision: sql`${socialGroups.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(socialGroups.id, input.groupId),
            eq(socialGroups.revision, input.expectedRevision),
          ),
        )
        .returning({
          id: socialGroups.id,
          state: socialGroups.state,
          revision: socialGroups.revision,
        });
      if (!updated)
        throw new ORPCError("CONFLICT", {
          message: "The group changed in another session",
        });
      return updated;
    }),

  delete: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        expectedRevision: z.number().int().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      const [deleted] = await db
        .delete(socialGroups)
        .where(
          and(
            eq(socialGroups.id, input.groupId),
            eq(socialGroups.revision, input.expectedRevision),
          ),
        )
        .returning({ id: socialGroups.id });
      if (!deleted)
        throw new ORPCError("CONFLICT", {
          message: "The group changed in another session",
        });
      return { ok: true };
    }),
};

export const socialGroupMembersRouter = {
  setRole: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        membershipId: z.string().min(1),
        role: z.enum(["member", "moderator"]),
      }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      const [updated] = await db.transaction(async (tx) => {
        const rows = await tx
          .update(groupMemberships)
          .set({ role: input.role, updatedAt: new Date() })
          .where(
            and(
              eq(groupMemberships.id, input.membershipId),
              eq(groupMemberships.groupId, input.groupId),
              ne(groupMemberships.role, "owner"),
              inArray(groupMemberships.state, ["active", "consent_required"]),
            ),
          )
          .returning({ id: groupMemberships.id, role: groupMemberships.role });
        if (rows.length !== 1) return [];
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
        await tx.insert(socialAuditEvents).values({
          actorUserId: context.session.user.id,
          action: "group.member_role_changed",
          entityType: "group_membership",
          entityId: input.membershipId,
          changedKeys: JSON.stringify(["role"]),
        });
        return rows;
      });
      if (!updated) notFound("Group member");
      return { membershipId: updated.id, role: updated.role };
    }),

  remove: protectedProcedure
    .input(
      z.object({ groupId: z.string().min(1), membershipId: z.string().min(1) }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertManager(access);
      const [target] = await db
        .select()
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.id, input.membershipId),
            eq(groupMemberships.groupId, input.groupId),
          ),
        )
        .limit(1);
      if (
        !target ||
        target.role === "owner" ||
        (access.membership.role === "moderator" && target.role === "moderator")
      ) {
        notFound("Group member");
      }
      await db.transaction(async (tx) => {
        const removed = await tx
          .update(groupMemberships)
          .set({ state: "removed", leftAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(groupMemberships.id, target.id),
              inArray(groupMemberships.state, ["active", "consent_required"]),
            ),
          )
          .returning({ id: groupMemberships.id });
        if (removed.length !== 1) notFound("Group member");
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
        await tx.insert(socialAuditEvents).values({
          actorUserId: context.session.user.id,
          subjectUserId: target.userId,
          action: "group.member_removed",
          entityType: "group_membership",
          entityId: target.id,
          changedKeys: JSON.stringify(["state"]),
        });
      });
      return { ok: true };
    }),

  leave: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id, {
        allowIneligible: true,
      });
      if (access.membership.role === "owner")
        badRequest("Transfer ownership before leaving the group");
      await db.transaction(async (tx) => {
        const left = await tx
          .update(groupMemberships)
          .set({ state: "left", leftAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(groupMemberships.id, access.membership.id),
              inArray(groupMemberships.state, ["active", "consent_required"]),
            ),
          )
          .returning({ id: groupMemberships.id });
        if (left.length !== 1) notFound("Group membership");
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
        await tx.insert(socialAuditEvents).values({
          actorUserId: context.session.user.id,
          subjectUserId: context.session.user.id,
          action: "group.member_left",
          entityType: "group_membership",
          entityId: access.membership.id,
          changedKeys: JSON.stringify(["state"]),
        });
      });
      return { ok: true };
    }),
};
